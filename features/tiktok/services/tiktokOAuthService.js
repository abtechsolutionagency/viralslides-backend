import crypto from 'crypto';
import TikTokAccount from '../models/TikTokAccount.js';
import tiktokAccountService from './tiktokAccountService.js';
import {
  TIKTOK_OAUTH_SCOPES as DEFAULT_SCOPE_ARRAY,
  TIKTOK_TOKEN_GRACE_PERIOD_SECONDS,
  TIKTOK_ACCOUNT_STATUS
} from '../constants/tiktokConstants.js';
import { encryptSecret, decryptSecret, isEncryptionEnabled } from '../utils/secretUtils.js';

const {
  TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET,
  TIKTOK_REDIRECT_URI,
  TIKTOK_API_BASE_URL,
  TIKTOK_OAUTH_SCOPES: TIKTOK_SCOPE_STRING
} = process.env;

const AUTH_BASE_URL = 'https://www.tiktok.com';
const AUTH_PATH = '/v2/auth/authorize/';
const API_BASE_URL = TIKTOK_API_BASE_URL?.replace(/\/$/, '') || 'https://open-api.tiktok.com';
const TOKEN_ENDPOINT = '/v2/oauth/token/';
const USER_INFO_ENDPOINT = '/v2/user/info/';

const TOKEN_GRACE_PERIOD =
  Number(process.env.TIKTOK_TOKEN_GRACE_PERIOD_SECONDS || TIKTOK_TOKEN_GRACE_PERIOD_SECONDS) || 300;

function assertConfig () {
  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
    throw new Error('TikTok client credentials are not configured');
  }
}

function resolveRedirectUri (fallback) {
  return fallback || TIKTOK_REDIRECT_URI;
}

function getScopeList () {
  if (TIKTOK_SCOPE_STRING) {
    return TIKTOK_SCOPE_STRING.split(',').map((scope) => scope.trim()).filter(Boolean);
  }

  return DEFAULT_SCOPE_ARRAY;
}

function base64UrlEncode (buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function toJSON (res) {
  return res.json();
}

class TikTokOAuthService {
  startAuthorization ({ redirectUri, state }) {
    assertConfig();

    const verifier = base64UrlEncode(crypto.randomBytes(32));
    const challenge = base64UrlEncode(
      crypto.createHash('sha256').update(verifier).digest()
    );

    const url = new URL(AUTH_PATH, AUTH_BASE_URL);
    url.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
    url.searchParams.set('scope', getScopeList().join(','));
    url.searchParams.set('redirect_uri', resolveRedirectUri(redirectUri));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    if (state) {
      url.searchParams.set('state', state);
    }

    return {
      authorizationUrl: url.toString(),
      codeVerifier: verifier,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      scopes: getScopeList(),
      encryption: {
        enabled: isEncryptionEnabled()
      }
    };
  }

  async handleCallback ({ userId, code, codeVerifier, redirectUri }) {
    assertConfig();

    if (!codeVerifier) {
      throw new Error('codeVerifier is required to complete TikTok OAuth');
    }

    const redirect = resolveRedirectUri(redirectUri);

    const tokenPayload = await this.exchangeCodeForTokens({
      code,
      codeVerifier,
      redirectUri: redirect
    });

    const profile = await this.fetchUserProfile(tokenPayload.accessToken);
    const normalizedProfile = this.buildProfile({ profile, tokenPayload });

    const securedTokens = this.secureTokens(tokenPayload);

    const account = await tiktokAccountService.upsertAccountFromOAuth({
      userId,
      profile: normalizedProfile,
      tokens: securedTokens
    });

    return {
      account,
      tokens: {
        expiresIn: tokenPayload.expiresIn,
        refreshExpiresIn: tokenPayload.refreshExpiresIn,
        scopes: tokenPayload.scopes
      }
    };
  }

  async refreshAccessToken ({ userId, accountId, force = false }) {
    assertConfig();

    const account = await TikTokAccount.findOne({ _id: accountId, user: userId });
    if (!account) {
      throw new Error('TikTok account not found');
    }

    const now = Date.now();
    const expiresAtTime = account.expiresAt ? new Date(account.expiresAt).getTime() : null;
    const withinGracePeriod =
      typeof expiresAtTime === 'number' && expiresAtTime - now <= TOKEN_GRACE_PERIOD * 1000;

    if (!force && expiresAtTime && expiresAtTime > now && !withinGracePeriod) {
      return {
        refreshed: false,
        account: tiktokAccountService.serializeAccount(account)
      };
    }

    const refreshToken = decryptSecret(account.refreshToken);
    if (!refreshToken) {
      throw new Error('TikTok account is missing a refresh token');
    }

    const refreshedTokens = await this.requestToken({
      endpoint: TOKEN_ENDPOINT,
      payload: {
        grant_type: 'refresh_token',
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        refresh_token: refreshToken
      }
    });

    const securedTokens = this.secureTokens(refreshedTokens);

    account.accessToken = securedTokens.accessToken;
    account.refreshToken = securedTokens.refreshToken;
    account.scopes = refreshedTokens.scopes;
    account.expiresAt = new Date(now + refreshedTokens.expiresIn * 1000);
    account.status = TIKTOK_ACCOUNT_STATUS.ACTIVE;
    account.lastError = null;
    account.lastSyncAt = new Date();
    account.metadata = {
      ...(account.metadata || {}),
      lastRefreshedAt: new Date(),
      openId: refreshedTokens.openId || account.metadata?.openId
    };

    await account.save();
    await tiktokAccountService.resetDailyQuotaIfNeeded(account);

    return {
      refreshed: true,
      account: tiktokAccountService.serializeAccount(account)
    };
  }

  async exchangeCodeForTokens ({ code, codeVerifier, redirectUri }) {
    return this.requestToken({
      endpoint: TOKEN_ENDPOINT,
      payload: {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        redirect_uri: redirectUri
      }
    });
  }

  async requestToken ({ endpoint, payload }) {
    const url = `${API_BASE_URL}${endpoint}`;
    const form = new URLSearchParams();

    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      form.append(key, String(value));
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(
        `TikTok OAuth request failed (${response.status} ${response.statusText}): ${bodyText}`
      );
    }

    const body = await toJSON(response).catch((error) => {
      throw new Error(`Failed to parse TikTok OAuth response: ${error.message}`);
    });

    const data = body?.data || body;
    const errorCode = data?.error_code ?? body?.error_code;
    if (errorCode && errorCode !== 0) {
      const description = data?.description || body?.description || 'Unknown TikTok error';
      throw new Error(`TikTok OAuth error (${errorCode}): ${description}`);
    }

    const accessToken = data?.access_token;
    const refreshToken = data?.refresh_token;
    const expiresIn = Number(data?.expires_in);
    const refreshExpiresIn = Number(data?.refresh_expires_in);
    const openId = data?.open_id || data?.user_id || data?.data?.open_id;
    const scopes = this.parseScopes(data?.scope);

    if (!accessToken || !refreshToken || !Number.isFinite(expiresIn)) {
      const debug = (() => {
        try {
          // redact any potential secrets if present
          const clone = JSON.parse(JSON.stringify(data || {}));
          if (clone.access_token) clone.access_token = '[redacted]';
          if (clone.refresh_token) clone.refresh_token = '[redacted]';
          return JSON.stringify(clone);
        } catch (_) {
          return String(data);
        }
      })();
      throw new Error(`TikTok OAuth response did not include expected token fields: ${debug}`);
    }

    return {
      accessToken,
      refreshToken,
      expiresIn,
      refreshExpiresIn: Number.isFinite(refreshExpiresIn) ? refreshExpiresIn : null,
      scopes,
      openId,
      raw: data
    };
  }

  parseScopes (scope) {
    if (!scope) return getScopeList();

    return scope
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  secureTokens (tokenPayload) {
    return {
      accessToken: encryptSecret(tokenPayload.accessToken),
      refreshToken: encryptSecret(tokenPayload.refreshToken),
      expiresIn: tokenPayload.expiresIn,
      refreshExpiresIn: tokenPayload.refreshExpiresIn,
      scopes: tokenPayload.scopes
    };
  }

  async fetchUserProfile (accessToken) {
    if (!accessToken) return null;

    try {
      const url = new URL(USER_INFO_ENDPOINT, API_BASE_URL);
      url.searchParams.set(
        'fields',
        ['open_id', 'union_id', 'display_name', 'avatar_url', 'username'].join(',')
      );

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(`TikTok user info failed (${response.status}): ${message}`);
      }

      const body = await toJSON(response);
      const data = body?.data || {};
      const user = data?.user || data?.users?.[0];

      if (!user) {
        return null;
      }

      return {
        user_id: user.open_id || user.user_id,
        username: user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        raw: user
      };
    } catch (error) {
      console.warn('[TikTokOAuthService] Failed to fetch user profile', error);
      return null;
    }
  }

  buildProfile ({ profile, tokenPayload }) {
    const userId =
      profile?.user_id ||
      profile?.raw?.open_id ||
      tokenPayload.openId ||
      profile?.raw?.user_id;

    if (!userId) {
      throw new Error('Unable to determine TikTok user id from OAuth response');
    }

    const username =
      profile?.username ||
      profile?.display_name ||
      profile?.raw?.username ||
      tokenPayload.openId ||
      `tiktok_${userId}`;

    return {
      user_id: userId,
      username,
      display_name:
        profile?.display_name || profile?.username || profile?.raw?.display_name || username,
      avatar_url: profile?.avatar_url || profile?.raw?.avatar_url || null,
      raw: {
        ...profile?.raw,
        open_id: tokenPayload.openId || profile?.raw?.open_id
      }
    };
  }
}

export default new TikTokOAuthService();
