import tiktokAccountService from '../services/tiktokAccountService.js';

class TikTokAccountController {
  async listAccounts (req, res) {
    try {
      const accounts = await tiktokAccountService.listAccountsForUser(req.user._id);
      res.status(200).json({
        success: true,
        data: { accounts }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to list TikTok accounts');
      res.status(500).json({
        success: false,
        message: 'Failed to load TikTok accounts'
      });
    }
  }

  async getAccount (req, res) {
    try {
      const account = await tiktokAccountService.getAccountForUser({
        userId: req.user._id,
        accountId: req.params.accountId
      });

      if (!account) {
        return res.status(404).json({
          success: false,
          message: 'TikTok account not found'
        });
      }

      res.status(200).json({
        success: true,
        data: { account }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to fetch TikTok account');
      res.status(500).json({
        success: false,
        message: 'Failed to load TikTok account'
      });
    }
  }

  async disconnectAccount (req, res) {
    try {
      const account = await tiktokAccountService.disconnectAccount({
        userId: req.user._id,
        accountId: req.params.accountId
      });

      if (!account) {
        return res.status(404).json({
          success: false,
          message: 'TikTok account not found'
        });
      }

      req.log?.info({ userId: req.user._id, accountId: req.params.accountId }, 'TikTok account disconnected');
      res.status(200).json({
        success: true,
        message: 'TikTok account disconnected',
        data: { account }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to disconnect TikTok account');
      res.status(500).json({
        success: false,
        message: 'Failed to disconnect TikTok account'
      });
    }
  }

  async recordUsage (req, res) {
    try {
      const { posts = 1 } = req.body;
      const account = await tiktokAccountService.recordPostUsage({
        userId: req.user._id,
        accountId: req.params.accountId,
        count: Number(posts) || 1
      });

      res.status(200).json({
        success: true,
        message: 'TikTok quota updated',
        data: { account }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to record TikTok usage');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async resetQuota (req, res) {
    try {
      const account = await tiktokAccountService.resetDailyQuota({
        userId: req.user._id,
        accountId: req.params.accountId
      });

      res.status(200).json({
        success: true,
        message: 'TikTok quota reset',
        data: { account }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to reset TikTok quota');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
}

export default new TikTokAccountController();
