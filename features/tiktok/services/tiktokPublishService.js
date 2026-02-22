import TikTokAccount from '../models/TikTokAccount.js';
import TikTokPublishLog from '../models/TikTokPublishLog.js';
import tiktokAccountService from './tiktokAccountService.js';
import tiktokOAuthService from './tiktokOAuthService.js';
import { decryptSecret } from '../utils/secretUtils.js';

const API_BASE_URL = (process.env.TIKTOK_CONTENT_POST_API_BASE_URL || 'https://open.tiktokapis.com').replace(/\/$/, '');

// TikTok Content Posting API v2 endpoints
const DIRECT_POST_INIT_ENDPOINT = '/v2/post/publish/video/init/';
const INBOX_POST_INIT_ENDPOINT = '/v2/post/publish/inbox/video/init/';
const CREATOR_INFO_QUERY_ENDPOINT = '/v2/post/publish/creator_info/query/';

const PUBLISH_MODE = {
  DIRECT: 'direct',
  INBOX: 'inbox'
};

function normalizePrivacy (privacy) {
  const value = String(privacy ?? '').toLowerCase();
  if (value === 'private' || value === '2' || value === 'self_only') return 'private';
  if (value === 'friends' || value === '1' || value === 'mutual_follow_friends') return 'friends';
  return 'public';
}

function privacyPreferenceOrder (privacy) {
  const normalized = normalizePrivacy(privacy);
  if (normalized === 'private') {
    return ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'];
  }
  if (normalized === 'friends') {
    return ['MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY', 'PUBLIC_TO_EVERYONE'];
  }
  return ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
}

function resolvePrivacyLevel (privacy, options) {
  const preferred = privacyPreferenceOrder(privacy);
  const available = Array.isArray(options)
    ? options.map((item) => String(item).toUpperCase()).filter(Boolean)
    : [];

  if (available.length === 0) {
    return preferred[0];
  }

  const set = new Set(available);
  return preferred.find((level) => set.has(level)) || available[0];
}

function extractTikTokError (body) {
  const error = body?.error;
  if (error && typeof error === 'object') {
    const code = error.code ?? error.error_code;
    const normalizedCode = typeof code === 'string' ? code.toLowerCase() : code;
    if (code !== undefined && code !== null && code !== 0 && code !== '0' && normalizedCode !== 'ok') {
      return {
        code,
        message: error.message || error.description || 'Unknown TikTok error',
        details: error
      };
    }
  }

  const data = body?.data ?? body;
  const legacyCode = data?.error_code ?? body?.error_code;
  if (legacyCode !== undefined && legacyCode !== null) {
    const normalizedCode = typeof legacyCode === 'string' ? legacyCode.toLowerCase() : legacyCode;
    if (legacyCode !== 0 && legacyCode !== '0' && normalizedCode !== 'ok') {
      return {
        code: legacyCode,
        message: data?.display_message || data?.message || data?.description || body?.description || 'Unknown TikTok error',
        details: data
      };
    }
  }

  return null;
}

function buildTikTokError ({ status, statusText, body }) {
  const tiktokError = extractTikTokError(body);
  if (tiktokError) {
    const err = new Error(`TikTok error (${tiktokError.code}): ${tiktokError.message}`);
    err.code = tiktokError.code;
    err.tiktok = tiktokError.details || body;
    err.status = status;
    throw err;
  }

  const fallbackMessage =
    body?.message ||
    body?.error?.message ||
    body?.description ||
    body?.raw ||
    `${status} ${statusText}`;
  const err = new Error(`TikTok request failed (${status} ${statusText}): ${fallbackMessage}`);
  err.status = status;
  err.tiktok = body;
  throw err;
}

async function parseResponseBody (res) {
  const text = await res.text().catch(() => '');
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (_) {
    return { raw: text };
  }
}

async function requestTikTokJson ({ url, accessToken, payload = {}, method = 'POST' }) {
  const headers = {
    Authorization: `Bearer ${accessToken}`
  };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(payload)
  });

  const body = await parseResponseBody(res);
  if (!res.ok) {
    buildTikTokError({ status: res.status, statusText: res.statusText, body });
  }

  const tiktokError = extractTikTokError(body);
  if (tiktokError) {
    const err = new Error(`TikTok error (${tiktokError.code}): ${tiktokError.message}`);
    err.code = tiktokError.code;
    err.tiktok = tiktokError.details || body;
    throw err;
  }

  return body?.data ?? body;
}

class TikTokPublishService {
  async getAccountWithSecrets ({ userId, accountId }) {
    const account = await TikTokAccount.findOne({ _id: accountId, user: userId });
    if (!account) {
      throw new Error('TikTok account not found');
    }
    return account;
  }

  async ensureFreshAccessToken ({ userId, accountId }) {
    // Use existing refresh logic with grace period
    await tiktokOAuthService.refreshAccessToken({ userId, accountId, force: false });
    // Re-load to get latest tokens
    const account = await this.getAccountWithSecrets({ userId, accountId });
    const accessToken = decryptSecret(account.accessToken);
    if (!accessToken) {
      throw new Error('Missing TikTok access token');
    }
    return { account, accessToken };
  }

  async precheckQuota (accountDoc) {
    // Reset if needed then check limit
    await tiktokAccountService.resetDailyQuotaIfNeeded(accountDoc);
    const count = accountDoc.dailyPostCount || 0;
    const limit = accountDoc.dailyPostLimit || 15;
    if (count >= limit) {
      const username = accountDoc.username || 'account';
      throw new Error(`Daily posting limit reached for ${username}`);
    }
  }

  getScopes (accountDoc) {
    return Array.isArray(accountDoc?.scopes) ? accountDoc.scopes : [];
  }

  resolvePublishMode (accountDoc) {
    const scopes = new Set(this.getScopes(accountDoc).map((scope) => String(scope).trim()));
    if (scopes.has('video.publish')) {
      return PUBLISH_MODE.DIRECT;
    }
    if (scopes.has('video.upload')) {
      return PUBLISH_MODE.INBOX;
    }
    throw new Error('TikTok account is missing required scope: video.upload or video.publish');
  }

  buildDirectPostInfo ({ caption, privacy, creatorInfo }) {
    const postInfo = {
      privacy_level: resolvePrivacyLevel(privacy, creatorInfo?.privacy_level_options)
    };

    const title = String(caption || '').trim();
    if (title) {
      postInfo.title = title.slice(0, 2200);
    }

    if (typeof creatorInfo?.comment_disabled === 'boolean') {
      postInfo.disable_comment = creatorInfo.comment_disabled;
    }
    if (typeof creatorInfo?.duet_disabled === 'boolean') {
      postInfo.disable_duet = creatorInfo.duet_disabled;
    }
    if (typeof creatorInfo?.stitch_disabled === 'boolean') {
      postInfo.disable_stitch = creatorInfo.stitch_disabled;
    }

    return postInfo;
  }

  async fetchCreatorInfo ({ accessToken }) {
    const url = `${API_BASE_URL}${CREATOR_INFO_QUERY_ENDPOINT}`;
    return requestTikTokJson({
      url,
      accessToken,
      payload: {},
      method: 'POST'
    });
  }

  async initPostFromUrl ({ accessToken, mediaUrl, caption, privacy, mode }) {
    if (!mediaUrl) throw new Error('mediaUrl is required');

    const endpoint = mode === PUBLISH_MODE.DIRECT ? DIRECT_POST_INIT_ENDPOINT : INBOX_POST_INIT_ENDPOINT;
    const payload = {
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: mediaUrl
      }
    };

    if (mode === PUBLISH_MODE.DIRECT) {
      const creatorInfo = await this.fetchCreatorInfo({ accessToken });
      payload.post_info = this.buildDirectPostInfo({ caption, privacy, creatorInfo });
    }

    const url = `${API_BASE_URL}${endpoint}`;
    const data = await requestTikTokJson({ url, accessToken, payload, method: 'POST' });
    const publishId = data?.publish_id || data?.publishId;
    if (!publishId) {
      throw new Error('TikTok did not return publish_id');
    }

    return {
      publishId,
      mode,
      raw: data
    };
  }

  async initPostFromBuffer ({ accessToken, buffer, contentType = 'video/mp4', caption, privacy, mode }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Uploaded video file is empty');
    }

    const endpoint = mode === PUBLISH_MODE.DIRECT ? DIRECT_POST_INIT_ENDPOINT : INBOX_POST_INIT_ENDPOINT;
    const payload = {
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: buffer.length,
        chunk_size: buffer.length,
        total_chunk_count: 1
      }
    };

    if (mode === PUBLISH_MODE.DIRECT) {
      const creatorInfo = await this.fetchCreatorInfo({ accessToken });
      payload.post_info = this.buildDirectPostInfo({ caption, privacy, creatorInfo });
    }

    const url = `${API_BASE_URL}${endpoint}`;
    const data = await requestTikTokJson({ url, accessToken, payload, method: 'POST' });
    const publishId = data?.publish_id || data?.publishId;
    const uploadUrl = data?.upload_url || data?.uploadUrl;
    if (!publishId || !uploadUrl) {
      throw new Error('TikTok did not return upload_url/publish_id for file upload');
    }

    await this.uploadBinaryToUploadUrl({ uploadUrl, buffer, contentType });

    return {
      publishId,
      mode,
      raw: data
    };
  }

  async uploadBinaryToUploadUrl ({ uploadUrl, buffer, contentType }) {
    const total = buffer.length;
    const end = total - 1;

    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType || 'video/mp4',
        'Content-Length': String(total),
        'Content-Range': `bytes 0-${end}/${total}`
      },
      body: buffer
    });

    const body = await parseResponseBody(res);
    if (!res.ok) {
      buildTikTokError({ status: res.status, statusText: res.statusText, body });
    }

    const tiktokError = extractTikTokError(body);
    if (tiktokError) {
      const err = new Error(`TikTok upload error (${tiktokError.code}): ${tiktokError.message}`);
      err.code = tiktokError.code;
      err.tiktok = tiktokError.details || body;
      throw err;
    }
  }

  async publishFromUrl ({ userId, accountId, mediaUrl, caption, privacy, idempotencyKey }) {
    return this._publish({ userId, accountId, caption, privacy, mediaUrl, idempotencyKey });
  }

  async publishFromBuffer ({ userId, accountId, buffer, contentType, caption, privacy, idempotencyKey }) {
    return this._publish({ userId, accountId, buffer, contentType, caption, privacy, idempotencyKey });
  }

  async _publish ({ userId, accountId, mediaUrl, buffer, contentType, caption, privacy, idempotencyKey }) {
    const { account, accessToken } = await this.ensureFreshAccessToken({ userId, accountId });
    await this.precheckQuota(account);
    const mode = this.resolvePublishMode(account);

    // Handle idempotency
    let existingLog = null;
    if (idempotencyKey) {
      existingLog = await TikTokPublishLog.findOne({ user: userId, account: accountId, idempotencyKey });
      if (existingLog && existingLog.postId) {
        return {
          postId: existingLog.postId,
          videoId: existingLog.videoId,
          mode,
          account: tiktokAccountService.serializeAccount(account),
          tiktok: existingLog.response
        };
      }
    }

    let publishResult;
    if (buffer) {
      publishResult = await this.initPostFromBuffer({ accessToken, buffer, contentType, caption, privacy, mode });
    } else {
      publishResult = await this.initPostFromUrl({ accessToken, mediaUrl, caption, privacy, mode });
    }

    const postId = publishResult.publishId;
    const raw = publishResult.raw;
    const logStatus = publishResult.mode === PUBLISH_MODE.DIRECT ? 'published' : 'created';

    if (idempotencyKey && !existingLog) {
      try {
        await TikTokPublishLog.create({
          user: userId,
          account: accountId,
          idempotencyKey,
          videoId: null,
          postId,
          status: 'created',
          request: { mediaUrl: mediaUrl || null, caption, privacy }
        });
      } catch (_) {}
    }

    const updated = await tiktokAccountService.recordPostUsage({ userId, accountId, count: 1 });

    if (idempotencyKey) {
      await TikTokPublishLog.findOneAndUpdate(
        { user: userId, account: accountId, idempotencyKey },
        { $set: { postId, response: raw, status: logStatus } },
        { upsert: true }
      );
    }

    return {
      postId,
      videoId: null,
      mode,
      account: updated,
      tiktok: raw
    };
  }
}

export default new TikTokPublishService();
