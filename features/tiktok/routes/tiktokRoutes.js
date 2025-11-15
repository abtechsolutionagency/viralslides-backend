import express from 'express';
import tiktokAccountController from '../controllers/tiktokAccountController.js';
import tiktokOAuthController from '../controllers/tiktokOAuthController.js';
import tiktokPostController from '../controllers/tiktokPostController.js';
import tiktokWebhookController from '../controllers/tiktokWebhookController.js';
import {
  authenticate,
  requireVerifiedEmail,
  requireActiveSubscription
} from '../../auth/middleware/authMiddleware.js';
import { validate } from '../../../shared/middleware/validate.js';
import multer from 'multer';
import {
  oauthCallbackValidator,
  recordUsageValidator,
  startOAuthValidator,
  tokenRefreshValidator
} from '../validators/tiktokValidator.js';
import { createPostValidator } from '../validators/tiktokPostValidator.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } });

// Public webhook (no auth)
router.post('/webhook', tiktokWebhookController.handle.bind(tiktokWebhookController));

router.use(authenticate, requireVerifiedEmail, requireActiveSubscription);

router.get(
  '/accounts',
  tiktokAccountController.listAccounts.bind(tiktokAccountController)
);

router.get(
  '/accounts/:accountId',
  tiktokAccountController.getAccount.bind(tiktokAccountController)
);

router.delete(
  '/accounts/:accountId',
  tiktokAccountController.disconnectAccount.bind(tiktokAccountController)
);

router.post(
  '/accounts/:accountId/usage',
  validate(recordUsageValidator),
  tiktokAccountController.recordUsage.bind(tiktokAccountController)
);

router.post(
  '/accounts/:accountId/reset-quota',
  tiktokAccountController.resetQuota.bind(tiktokAccountController)
);

router.post(
  '/oauth/start',
  validate(startOAuthValidator),
  tiktokOAuthController.startConnection.bind(tiktokOAuthController)
);

// Support GET callback for redirect_uri in env
router.get(
  '/oauth/callback',
  tiktokOAuthController.handleCallbackGet.bind(tiktokOAuthController)
);

router.post(
  '/oauth/callback',
  validate(oauthCallbackValidator),
  tiktokOAuthController.handleCallback.bind(tiktokOAuthController)
);

router.post(
  '/oauth/refresh',
  validate(tokenRefreshValidator),
  tiktokOAuthController.refreshToken.bind(tiktokOAuthController)
);

// Publish a TikTok post (video-only for now)
router.post(
  '/posts',
  upload.single('video'),
  validate(createPostValidator),
  tiktokPostController.create.bind(tiktokPostController)
);

// Webhook endpoint (no auth) - define before auth middleware or add separate router in server.js

export default router;
