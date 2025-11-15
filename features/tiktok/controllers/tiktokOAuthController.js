import tiktokOAuthService from '../services/tiktokOAuthService.js';
import crypto from 'crypto';

const PKCE_COOKIE_NAME = 'tiktok_oauth_pkce';

class TikTokOAuthController {
  startConnection (req, res) {
    try {
      const { redirectUri } = req.body;
      // Ensure we always have a state for CSRF protection
      const providedState = typeof req.body.state === 'string' ? req.body.state : '';
      const finalState = providedState || crypto.randomBytes(16).toString('hex');

      const data = tiktokOAuthService.startAuthorization({ redirectUri, state: finalState });

      // Persist the verifier/state briefly via signed, httpOnly cookie for GET callback handling
      const payload = {
        codeVerifier: data.codeVerifier,
        state: finalState,
        redirectUri: redirectUri || null
      };

      const isProd = process.env.NODE_ENV === 'production';
      res.cookie(PKCE_COOKIE_NAME, JSON.stringify(payload), {
        httpOnly: true,
        signed: Boolean(process.env.COOKIE_SECRET),
        sameSite: 'lax',
        secure: isProd,
        maxAge: 10 * 60 * 1000, // 10 minutes
        path: '/'
      });

      res.status(200).json({
        success: true,
        message: 'TikTok OAuth URL generated',
        data: {
          ...data,
          state: finalState
        }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to start TikTok OAuth');
      res.status(500).json({
        success: false,
        message: 'TikTok OAuth configuration error'
      });
    }
  }

  // GET handler for redirect-based callbacks from TikTok
  async handleCallbackGet (req, res) {
    try {
      const code = req.query.code;
      const state = req.query.state;

      if (!code) {
        return res.status(400).json({ success: false, message: 'Authorization code is required' });
      }

      // Read signed cookie set during /oauth/start
      const cookieSource = req.signedCookies?.[PKCE_COOKIE_NAME] || req.cookies?.[PKCE_COOKIE_NAME];
      if (!cookieSource) {
        return res.status(400).json({ success: false, message: 'Missing PKCE context. Restart connection.' });
      }

      let parsed;
      try {
        parsed = typeof cookieSource === 'string' ? JSON.parse(cookieSource) : cookieSource;
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid PKCE context. Restart connection.' });
      }

      if (!parsed?.codeVerifier) {
        return res.status(400).json({ success: false, message: 'Missing code verifier. Restart connection.' });
      }

      if (state && parsed?.state && state !== parsed.state) {
        return res.status(400).json({ success: false, message: 'State mismatch in OAuth callback' });
      }

      const result = await tiktokOAuthService.handleCallback({
        userId: req.user._id,
        code,
        codeVerifier: parsed.codeVerifier,
        redirectUri: parsed.redirectUri || undefined,
        state
      });

      // Clear cookie after successful exchange
      res.clearCookie(PKCE_COOKIE_NAME, { path: '/' });

      res.status(200).json({
        success: true,
        message: 'TikTok account connected',
        data: result
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to complete TikTok OAuth (GET)');
      const status = error.message?.includes('not found') ? 404 : 400;
      res.status(status).json({
        success: false,
        message: error.message || 'Unable to connect TikTok account'
      });
    }
  }

  async handleCallback (req, res) {
    try {
      const { code, codeVerifier, redirectUri, state } = req.body;
      const data = await tiktokOAuthService.handleCallback({
        userId: req.user._id,
        code,
        codeVerifier,
        redirectUri,
        state
      });

      res.status(200).json({
        success: true,
        message: 'TikTok account connected',
        data
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to complete TikTok OAuth');
      const status = error.message?.includes('not found') ? 404 : 400;
      res.status(status).json({
        success: false,
        message: error.message || 'Unable to connect TikTok account'
      });
    }
  }

  async refreshToken (req, res) {
    try {
      const { accountId, force } = req.body;
      const data = await tiktokOAuthService.refreshAccessToken({
        userId: req.user._id,
        accountId,
        force
      });

      res.status(200).json({
        success: true,
        message: data.refreshed ? 'TikTok access token refreshed' : 'TikTok access token still valid',
        data
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to refresh TikTok token');
      const status = error.message?.includes('not found') ? 404 : 400;
      res.status(status).json({
        success: false,
        message: error.message || 'Unable to refresh TikTok access token'
      });
    }
  }
}

export default new TikTokOAuthController();
