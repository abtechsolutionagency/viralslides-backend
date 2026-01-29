import User from '../../auth/models/User.js';
import CreditTransaction from '../models/CreditTransaction.js';
import { SUBSCRIPTION_PLANS, getPlanById, getPlanByStripePriceId, serializePlan } from '../constants/plans.js';

class SubscriptionService {
  listPlans () {
    return Object.values(SUBSCRIPTION_PLANS).map(serializePlan);
  }

  async getUserSubscription (userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const plan = getPlanById(user.subscription.plan);

    return {
      plan: serializePlan(plan),
      status: user.subscription.status,
      cancelAtPeriodEnd: Boolean(user.subscription.cancelAtPeriodEnd),
      currentPeriodStart: user.subscription.currentPeriodStart,
      currentPeriodEnd: user.subscription.currentPeriodEnd,
      credits: {
        balance: user.credits.balance,
        lifetime: user.credits.lifetime
      }
    };
  }

  async activatePlan ({ userId, planId }) {
    const plan = getPlanById(planId);
    if (!plan) {
      throw new Error('Invalid subscription plan selected');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const now = new Date();
    const nextBillingDate = this.calculateNextBillingDate(now);

    const previousPlan = user.subscription.plan;
    user.subscription.plan = plan.id;
    user.subscription.status = 'active';
    user.subscription.cancelAtPeriodEnd = false;
    user.subscription.planChangedAt = now;
    user.subscription.currentPeriodStart = now;
    user.subscription.currentPeriodEnd = nextBillingDate;

    const creditAwarded = plan.monthlyCredits || 0;
    const creditTransaction =
      creditAwarded > 0
        ? await this.adjustCredits({
            user,
            amount: creditAwarded,
            type: previousPlan === plan.id ? 'plan_allocation' : 'plan_change',
            description: `Subscription ${previousPlan === plan.id ? 'renewal' : 'activation'} - ${plan.name}`,
            metadata: { planId: plan.id }
          })
        : null;

    await user.save();

    return {
      plan: serializePlan(plan),
      status: user.subscription.status,
      currentPeriodStart: user.subscription.currentPeriodStart,
      currentPeriodEnd: user.subscription.currentPeriodEnd,
      credits: {
        balance: user.credits.balance,
        lifetime: user.credits.lifetime
      },
      creditTransaction
    };
  }

  async cancelSubscription ({ userId, cancelAtPeriodEnd = true, stripeService }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (user.subscription?.stripeSubscriptionId && stripeService?.cancelStripeSubscription) {
      await stripeService.cancelStripeSubscription(user.subscription.stripeSubscriptionId, cancelAtPeriodEnd);
    }

    user.subscription.cancelAtPeriodEnd = cancelAtPeriodEnd;
    if (!cancelAtPeriodEnd) {
      user.subscription.status = 'cancelled';
      user.subscription.currentPeriodEnd = new Date();
    }

    await user.save();

    const plan = getPlanById(user.subscription.plan);
    return {
      plan: serializePlan(plan),
      status: user.subscription.status,
      cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
      currentPeriodEnd: user.subscription.currentPeriodEnd
    };
  }

  async resumeSubscription ({ userId, stripeService }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (user.subscription.status === 'cancelled' && !user.subscription.currentPeriodEnd) {
      throw new Error('Subscription period has ended. Please activate a plan.');
    }

    if (user.subscription?.stripeSubscriptionId && stripeService?.resumeStripeSubscription) {
      await stripeService.resumeStripeSubscription(user.subscription.stripeSubscriptionId);
    }

    user.subscription.cancelAtPeriodEnd = false;
    user.subscription.status = 'active';
    if (!user.subscription.currentPeriodEnd || user.subscription.currentPeriodEnd < new Date()) {
      const now = new Date();
      user.subscription.currentPeriodStart = now;
      user.subscription.currentPeriodEnd = this.calculateNextBillingDate(now);
    }

    await user.save();

    const plan = getPlanById(user.subscription.plan);
    return {
      plan: serializePlan(plan),
      status: user.subscription.status,
      cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
      currentPeriodStart: user.subscription.currentPeriodStart,
      currentPeriodEnd: user.subscription.currentPeriodEnd
    };
  }

  async purchaseCredits ({ userId, credits, metadata }) {
    if (credits <= 0) {
      throw new Error('Credits must be greater than zero');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const transaction = await this.adjustCredits({
      user,
      amount: credits,
      type: 'one_time_purchase',
      description: `One-time credit purchase (${credits} credits)`,
      metadata
    });

    await user.save();

    return {
      credits: {
        balance: user.credits.balance,
        lifetime: user.credits.lifetime
      },
      transaction
    };
  }

  async getCreditHistory ({ userId, limit = 50 }) {
    return CreditTransaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Called from Stripe webhook when checkout.session.completed (mode: subscription).
   * Updates user subscription and grants initial credits.
   * Note: metadata is on the subscription, not the session.
   */
  async activatePlanFromStripe ({ session, stripeSubscription }) {
    const subscriptionId = session.subscription;
    // Metadata is on subscription_data.metadata, so we need the subscription object
    // If not provided, we'll try session.metadata as fallback (for backwards compatibility)
    let userId = stripeSubscription?.metadata?.userId || session.metadata?.userId || session.customer_details?.metadata?.userId;
    let planId = stripeSubscription?.metadata?.planId || session.metadata?.planId;

    // Fallback: if no userId, look up by customer ID
    if (!userId && session.customer) {
      const user = await User.findOne({ 'subscription.stripeCustomerId': session.customer });
      if (user) userId = user._id.toString();
    }

    // Fallback: if no planId, derive from subscription price
    if (!planId && stripeSubscription?.items?.data?.[0]?.price?.id) {
      const plan = getPlanByStripePriceId(stripeSubscription.items.data[0].price.id);
      if (plan) planId = plan.id;
    }

    if (!userId || !planId) {
      const errorMsg = `Missing userId or planId. userId: ${userId}, planId: ${planId}. Subscription metadata: ${JSON.stringify(stripeSubscription?.metadata)}, Session metadata: ${JSON.stringify(session.metadata)}`;
      throw new Error(errorMsg);
    }
    const user = await User.findById(userId);
    if (!user) throw new Error(`User not found with userId: ${userId}`);

    const plan = getPlanById(planId);
    if (!plan) throw new Error('Invalid plan');

    const now = new Date();
    // Period will be synced from Stripe on invoice.paid or subscription.updated if needed
    const nextBillingDate = this.calculateNextBillingDate(now);

    user.subscription.plan = plan.id;
    user.subscription.status = 'active'; // Always set to active when payment is completed
    user.subscription.stripeSubscriptionId = subscriptionId;
    user.subscription.cancelAtPeriodEnd = false;
    user.subscription.planChangedAt = now;
    // Use actual period from Stripe if available, otherwise calculate
    if (stripeSubscription?.current_period_start && stripeSubscription?.current_period_end) {
      user.subscription.currentPeriodStart = new Date(stripeSubscription.current_period_start * 1000);
      user.subscription.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
    } else {
      user.subscription.currentPeriodStart = now;
      user.subscription.currentPeriodEnd = nextBillingDate;
    }

    const creditAwarded = plan.monthlyCredits || 0;
    if (creditAwarded > 0) {
      await this.adjustCredits({
        user,
        amount: creditAwarded,
        type: 'plan_allocation',
        description: `Subscription activated via Stripe - ${plan.name}`,
        metadata: { planId: plan.id, stripeSubscriptionId: subscriptionId }
      });
    }
    await user.save();
    // Verify the save worked
    const savedUser = await User.findById(userId);
    if (!savedUser || savedUser.subscription.status !== 'active') {
      throw new Error(`Failed to activate subscription. User status after save: ${savedUser?.subscription?.status}`);
    }
    return { user, plan };
  }

  /**
   * Called from Stripe webhook when checkout.session.completed (mode: payment) for credits.
   * Idempotent: skips if session id already recorded.
   */
  async purchaseCreditsFromStripe ({ session }) {
    const userId = session.metadata?.userId;
    const credits = parseInt(session.metadata?.credits, 10);
    const sessionId = session.id;
    if (!userId || !credits || credits <= 0) {
      throw new Error('Missing or invalid userId/credits in session metadata');
    }
    const existing = await CreditTransaction.findOne({
      user: userId,
      'metadata.stripeSessionId': sessionId
    });
    if (existing) return { alreadyProcessed: true };

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const transaction = await this.adjustCredits({
      user,
      amount: credits,
      type: 'one_time_purchase',
      description: `Credit purchase via Stripe (${credits} credits)`,
      metadata: { stripeSessionId: sessionId, source: 'stripe' }
    });
    await user.save();
    return { user, transaction, alreadyProcessed: false };
  }

  /**
   * Sync user subscription from Stripe subscription object (period, cancel_at_period_end, status).
   * userId is optional; if not provided, user is looked up by stripeSubscriptionId.
   */
  async syncSubscriptionFromStripe ({ userId, stripeSubscription }) {
    const user = userId
      ? await User.findById(userId)
      : await User.findOne({ 'subscription.stripeSubscriptionId': stripeSubscription.id });
    if (!user) return;
    const plan = getPlanByStripePriceId(stripeSubscription.items?.data?.[0]?.price?.id) || getPlanById(user.subscription?.plan);
    if (plan) user.subscription.plan = plan.id;
    user.subscription.stripeSubscriptionId = stripeSubscription.id;
    user.subscription.currentPeriodStart = new Date(stripeSubscription.current_period_start * 1000);
    user.subscription.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
    user.subscription.cancelAtPeriodEnd = Boolean(stripeSubscription.cancel_at_period_end);
    
    // Map Stripe subscription statuses to our statuses
    const statusMap = {
      active: 'active',
      trialing: 'active', // Treat trialing as active
      past_due: 'past_due',
      canceled: 'cancelled',
      unpaid: 'past_due',
      incomplete: 'inactive', // Incomplete subscriptions are not active yet
      incomplete_expired: 'cancelled',
      paused: 'cancelled' // Paused subscriptions are effectively cancelled
    };
    
    const mappedStatus = statusMap[stripeSubscription.status] || 'inactive';
    
    // Always update status from Stripe
    // Exception: Don't downgrade from 'active' to 'inactive' if subscription was just activated
    // (handles race condition where incomplete status arrives before active)
    if (mappedStatus === 'active' || user.subscription.status !== 'active' || mappedStatus !== 'inactive') {
      user.subscription.status = mappedStatus;
    }
    
    if (stripeSubscription.status === 'canceled' && stripeSubscription.canceled_at) {
      user.subscription.currentPeriodEnd = new Date(stripeSubscription.canceled_at * 1000);
    }
    
    await user.save();
  }

  /**
   * Grant renewal credits when Stripe invoice is paid for a subscription.
   */
  async grantRenewalCreditsFromStripe ({ subscriptionId, planId, amount }) {
    const user = await User.findOne({ 'subscription.stripeSubscriptionId': subscriptionId });
    if (!user) return;
    const plan = getPlanById(planId);
    if (!plan || amount <= 0) return;
    await this.adjustCredits({
      user,
      amount,
      type: 'plan_allocation',
      description: `Subscription renewal - ${plan.name}`,
      metadata: { planId, stripeSubscriptionId: subscriptionId }
    });
    user.save();
  }

  calculateNextBillingDate (startDate) {
    const next = new Date(startDate);
    next.setMonth(next.getMonth() + 1);
    return next;
  }

  async adjustCredits ({ user, amount, type, description, metadata }) {
    const balanceBefore = user.credits.balance;
    const balanceAfter = Math.max(0, balanceBefore + amount);

    user.credits.balance = balanceAfter;
    if (amount > 0) {
      user.credits.lifetime += amount;
    }

    const transaction = await CreditTransaction.create({
      user: user._id,
      type,
      amount,
      balanceBefore,
      balanceAfter,
      description,
      metadata
    });

    return transaction.toObject();
  }
}

export default new SubscriptionService();
