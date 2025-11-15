import { TIKTOK_ACCOUNT_STATUS } from '../constants/tiktokConstants.js';
import TikTokAccount from '../models/TikTokAccount.js';

class TikTokWebhookController {
  async handle (req, res) {
    try {
      const secret = process.env.TIKTOK_WEBHOOK_SECRET;
      const sig = req.headers['x-tiktok-signature'] || req.headers['x-webhook-signature'];
      if (secret && sig && sig !== secret) {
        return res.status(401).json({ success: false, message: 'Invalid signature' });
      }

      const event = req.body || {};
      if (event.type === 'permissions.revoked' && event.account_id) {
        await TikTokAccount.updateMany(
          { tiktokUserId: event.account_id },
          { $set: { status: TIKTOK_ACCOUNT_STATUS.REVOKED, lastError: 'Permissions revoked via webhook' } }
        );
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      req.log?.error({ err }, 'TikTok webhook error');
      return res.status(400).json({ success: false });
    }
  }
}

export default new TikTokWebhookController();

