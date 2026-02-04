import subscriptionService from '../services/subscriptionService.js';
import stripeService from '../services/stripeService.js';

class SubscriptionController {
  async listPlans (_req, res) {
    const plans = subscriptionService.listPlans();
    res.status(200).json({
      success: true,
      data: { plans }
    });
  }

  async listCreditPacks (_req, res) {
    const packs = stripeService.CREDIT_PACKS.map(({ credits, price, stripePriceId }) => ({
      credits,
      price,
      stripePriceId: stripePriceId || null
    }));
    res.status(200).json({
      success: true,
      data: { packs }
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
      const { planId, successPath, cancelPath } = req.body;
      if (stripeService.stripe && process.env.STRIPE_SECRET_KEY) {
        const { sessionId, url } = await stripeService.createSubscriptionCheckoutSession({
          userId: req.user._id,
          userEmail: req.user.email,
          userName: req.user.name,
          planId,
          successPath: successPath || '/subscription/success',
          cancelPath: cancelPath || '/subscription'
        });
        return res.status(200).json({
          success: true,
          message: 'Redirect to Stripe Checkout',
          data: { sessionId, checkoutUrl: url }
        });
      }
      const result = await subscriptionService.activatePlan({
        userId: req.user._id,
        planId
      });
      req.log?.info({ userId: req.user._id, planId }, 'Subscription activated (no Stripe)');
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

  async updateSubscription (req, res) {
    try {
      const { planId } = req.body;
      const result = await subscriptionService.updateSubscription({
        userId: req.user._id,
        planId,
        stripeService: stripeService.stripe ? stripeService : null
      });

      req.log?.info({ userId: req.user._id, planId }, 'Subscription plan update initiated');
      res.status(200).json({
        success: true,
        message: result.message || 'Subscription plan update initiated. Payment will be processed automatically.',
        data: result
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Subscription update failed');
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
        cancelAtPeriodEnd,
        stripeService: stripeService.stripe ? stripeService : null
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
        userId: req.user._id,
        stripeService: stripeService.stripe ? stripeService : null
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
      const { credits, stripePriceId, successPath, cancelPath } = req.body;
      if (stripePriceId && stripeService.stripe && process.env.STRIPE_SECRET_KEY) {
        const { sessionId, url } = await stripeService.createCreditsCheckoutSession({
          userId: req.user._id,
          userEmail: req.user.email,
          userName: req.user.name,
          stripePriceId,
          successPath: successPath || '/credits/success',
          cancelPath: cancelPath || '/credits'
        });
        return res.status(200).json({
          success: true,
          message: 'Redirect to Stripe Checkout',
          data: { sessionId, checkoutUrl: url }
        });
      }
      if (credits == null || credits < 1) {
        return res.status(400).json({
          success: false,
          message: 'Provide credits (for manual grant) or stripePriceId (for Stripe checkout)'
        });
      }
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
