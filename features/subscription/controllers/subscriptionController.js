import subscriptionService from '../services/subscriptionService.js';

class SubscriptionController {
  async listPlans (_req, res) {
    const plans = subscriptionService.listPlans();
    res.status(200).json({
      success: true,
      data: { plans }
    });
  }

  async getMySubscription (req, res) {
    try {
      const result = await subscriptionService.getUserSubscription(req.user._id);
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      req.log?.error({ err: error }, 'Failed to load subscription');
      res.status(404).json({
        success: false,
        message: error.message
      });
    }
  }

  async activatePlan (req, res) {
    try {
      const { planId } = req.body;
      const result = await subscriptionService.activatePlan({
        userId: req.user._id,
        planId
      });

      req.log?.info({ userId: req.user._id, planId }, 'Subscription activated');
      res.status(200).json({
        success: true,
        message: 'Subscription activated successfully',
        data: result
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Plan activation failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async cancelSubscription (req, res) {
    try {
      const { cancelAtPeriodEnd = true } = req.body;
      const result = await subscriptionService.cancelSubscription({
        userId: req.user._id,
        cancelAtPeriodEnd
      });

      req.log?.info({ userId: req.user._id, cancelAtPeriodEnd }, 'Subscription cancellation updated');
      res.status(200).json({
        success: true,
        message: cancelAtPeriodEnd
          ? 'Subscription will cancel at the end of the current period'
          : 'Subscription cancelled immediately',
        data: result
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Subscription cancellation failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async resumeSubscription (req, res) {
    try {
      const result = await subscriptionService.resumeSubscription({
        userId: req.user._id
      });

      req.log?.info({ userId: req.user._id }, 'Subscription resumed');
      res.status(200).json({
        success: true,
        message: 'Subscription resumed successfully',
        data: result
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Resume subscription failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async purchaseCredits (req, res) {
    try {
      const { credits } = req.body;
      const result = await subscriptionService.purchaseCredits({
        userId: req.user._id,
        credits,
        metadata: { source: 'manual_purchase' }
      });

      req.log?.info({ userId: req.user._id, credits }, 'Credits purchased');
      res.status(200).json({
        success: true,
        message: `${credits} credits added to your account`,
        data: result
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Credit purchase failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async getCreditHistory (req, res) {
    try {
      const history = await subscriptionService.getCreditHistory({
        userId: req.user._id,
        limit: Number(req.query.limit) || 50
      });

      res.status(200).json({
        success: true,
        data: { history }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Fetch credit history failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
}

export default new SubscriptionController();
