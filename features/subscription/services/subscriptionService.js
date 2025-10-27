import User from '../../auth/models/User.js';
import CreditTransaction from '../models/CreditTransaction.js';
import { SUBSCRIPTION_PLANS, getPlanById, serializePlan } from '../constants/plans.js';

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

  async cancelSubscription ({ userId, cancelAtPeriodEnd = true }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
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

  async resumeSubscription ({ userId }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (user.subscription.status === 'cancelled' && !user.subscription.currentPeriodEnd) {
      throw new Error('Subscription period has ended. Please activate a plan.');
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
