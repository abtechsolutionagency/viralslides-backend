import TikTokAccount from '../models/TikTokAccount.js';
import TikTokPublishLog from '../models/TikTokPublishLog.js';
import tiktokAccountService from './tiktokAccountService.js';
import tiktokOAuthService from './tiktokOAuthService.js';
import { decryptSecret } from '../utils/secretUtils.js';

const API_BASE_URL = (process.env.TIKTOK_API_BASE_URL || 'https://open-api.tiktok.com').replace(/\/$/, '');

// Endpoints (aligned with TikTok Open API v2 naming)
const VIDEO_UPLOAD_ENDPOINT = '/v2/video/upload/';
const VIDEO_PUBLISH_ENDPOINT = '/v2/video/publish/';

function assertResponseOk (res) {
  if (!res.ok) {
    throw new Error(`TikTok request failed (${res.status} ${res.statusText})`);
  }
}

async function parseTikTokJson (res) {
  const body = await res.json().catch(() => ({}));
  const data = body?.data ?? body;
  const errorCode = data?.error_code ?? body?.error_code;
  if (typeof errorCode === 'number' && errorCode !== 0) {
    const description = data?.description || body?.description || 'Unknown TikTok error';
    const displayMsg = data?.display_message || data?.message || description;
    const code = errorCode;
    const err = new Error(`TikTok error (${code}): ${displayMsg}`);
    err.code = code;
    err.tiktok = data || body;
    throw err;
  }
  return data;
}

function mapPrivacy (privacy) {
  // Map to TikTok expected values (0 public, 1 friends, 2 private) or string enum depending on API variant
  const val = String(privacy || '').toLowerCase();
  if (val === 'private' || val === '2') return 2;
  if (val === 'friends' || val === '1') return 1;
  return 0; // default public
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

  async uploadVideoFromUrl ({ accessToken, mediaUrl }) {
    if (!mediaUrl) throw new Error('mediaUrl is required');

    const downloadRes = await fetch(mediaUrl);
    assertResponseOk(downloadRes);
    const contentType = downloadRes.headers.get('content-type') || 'video/mp4';
    const buffer = Buffer.from(await downloadRes.arrayBuffer());

    return this.uploadVideoBinary({ accessToken, buffer, contentType });
  }

  async uploadVideoBinary ({ accessToken, buffer, contentType = 'video/mp4' }) {
    const url = `${API_BASE_URL}${VIDEO_UPLOAD_ENDPOINT}`;

    const form = new FormData();
    const filename = `upload_${Date.now()}.mp4`;
    form.append('video', new Blob([buffer], { type: contentType }), filename);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: form
    });

    assertResponseOk(res);
    const data = await parseTikTokJson(res);
    const videoId = data?.video_id || data?.video?.video_id || data?.id;
    if (!videoId) {
      throw new Error('TikTok did not return a video_id');
    }
    return { videoId };
  }

  async publishVideo ({ accessToken, videoId, caption, privacy }) {
    const url = `${API_BASE_URL}${VIDEO_PUBLISH_ENDPOINT}`;
    const payload = {
      video_id: videoId,
      text: caption || '',
      privacy_level: mapPrivacy(privacy)
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload)
    });
    assertResponseOk(res);
    const data = await parseTikTokJson(res);
    const postId = data?.publish_id || data?.video_id || data?.id || videoId;
    return { postId, raw: data };
  }

  async publishFromUrl ({ userId, accountId, mediaUrl, caption, privacy }) {
    return this._publish({ userId, accountId, caption, privacy, mediaUrl });
  }

  async publishFromBuffer ({ userId, accountId, buffer, contentType, caption, privacy }) {
    return this._publish({ userId, accountId, buffer, contentType, caption, privacy });
  }

  async _publish ({ userId, accountId, mediaUrl, buffer, contentType, caption, privacy, idempotencyKey }) {
    const { account, accessToken } = await this.ensureFreshAccessToken({ userId, accountId });
    await this.precheckQuota(account);

    // Handle idempotency
    let existingLog = null;
    if (idempotencyKey) {
      existingLog = await TikTokPublishLog.findOne({ user: userId, account: accountId, idempotencyKey });
      if (existingLog && existingLog.postId) {
        return { postId: existingLog.postId, videoId: existingLog.videoId, account: tiktokAccountService.serializeAccount(account), tiktok: existingLog.response };
      }
    }

    let videoId;
    if (buffer) {
      ({ videoId } = await this.uploadVideoBinary({ accessToken, buffer, contentType }));
    } else {
      ({ videoId } = await this.uploadVideoFromUrl({ accessToken, mediaUrl }));
    }

    if (idempotencyKey && !existingLog) {
      try {
        await TikTokPublishLog.create({
          user: userId,
          account: accountId,
          idempotencyKey,
          videoId,
          status: 'created',
          request: { mediaUrl: mediaUrl || null, caption, privacy }
        });
      } catch (_) {}
    }
    const { postId, raw } = await this.publishVideo({ accessToken, videoId, caption, privacy });

    const updated = await tiktokAccountService.recordPostUsage({ userId, accountId, count: 1 });

    if (idempotencyKey) {
      await TikTokPublishLog.findOneAndUpdate(
        { user: userId, account: accountId, idempotencyKey },
        { $set: { postId, response: raw, status: 'published' } },
        { upsert: true }
      );
    }

    return { postId, videoId, account: updated, tiktok: raw };
  }
}

export default new TikTokPublishService();
