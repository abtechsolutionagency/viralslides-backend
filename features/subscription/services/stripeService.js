import Stripe from 'stripe';
import User from '../../auth/models/User.js';
import { getPlanByStripePriceId, SUBSCRIPTION_PLANS } from '../constants/plans.js';
import { getCreditPackByPriceId, CREDIT_PACKS } from '../constants/plans.js';

const secretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

const stripe = secretKey ? new Stripe(secretKey, { apiVersion: '2024-11-20.acacia' }) : null;

/**
 * Get or create Stripe customer for user.
 */
async function getOrCreateStripeCustomer (userId, email, name) {
  if (!stripe) throw new Error('Stripe is not configured');
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (user.subscription?.stripeCustomerId) {
    return user.subscription.stripeCustomerId;
  }
  const customer = await stripe.customers.create({
    email,
    name: name || undefined,
    metadata: { userId: userId.toString() }
  });
  user.subscription = user.subscription || {};
  user.subscription.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
}

/**
 * Create Checkout Session for subscription (recurring).
 * Redirects to Stripe Hosted Checkout; on success Stripe sends webhook.
 */
async function createSubscriptionCheckoutSession ({ userId, userEmail, userName, planId, successPath = '/subscription/success', cancelPath = '/subscription' }) {
  if (!stripe) throw new Error('Stripe is not configured');
  const plan = SUBSCRIPTION_PLANS[planId];
  if (!plan?.stripePriceId) throw new Error('Plan not linked to Stripe. Set stripePriceId for this plan.');
  const customerId = await getOrCreateStripeCustomer(userId, userEmail, userName);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${frontendUrl}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}${cancelPath}`,
    subscription_data: {
      metadata: { userId: userId.toString(), planId }
    },
    allow_promotion_codes: true
  });
  return { sessionId: session.id, url: session.url };
}

/**
 * Create Checkout Session for one-time credit pack.
 */
async function createCreditsCheckoutSession ({ userId, userEmail, userName, stripePriceId, successPath = '/credits/success', cancelPath = '/credits' }) {
  if (!stripe) throw new Error('Stripe is not configured');
  const pack = getCreditPackByPriceId(stripePriceId);
  if (!pack?.stripePriceId) throw new Error('Credit pack not found or not linked to Stripe.');
  const customerId = await getOrCreateStripeCustomer(userId, userEmail, userName);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment',
    line_items: [{ price: stripePriceId, quantity: 1 }],
    success_url: `${frontendUrl}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}${cancelPath}`,
    metadata: { userId: userId.toString(), credits: String(pack.credits), type: 'credits' }
  });
  return { sessionId: session.id, url: session.url };
}

/**
 * Cancel subscription in Stripe (optional: cancel at period end).
 */
async function cancelStripeSubscription (stripeSubscriptionId, cancelAtPeriodEnd = true) {
  if (!stripe) throw new Error('Stripe is not configured');
  if (cancelAtPeriodEnd) {
    await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });
  } else {
    await stripe.subscriptions.cancel(stripeSubscriptionId);
  }
}

/**
 * Resume subscription in Stripe (clear cancel_at_period_end).
 */
async function resumeStripeSubscription (stripeSubscriptionId) {
  if (!stripe) throw new Error('Stripe is not configured');
  await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: false });
}

/**
 * Verify webhook signature and return event (throws if invalid).
 */
function constructWebhookEvent (rawBody, signature) {
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

export default {
  stripe,
  getOrCreateStripeCustomer,
  createSubscriptionCheckoutSession,
  createCreditsCheckoutSession,
  cancelStripeSubscription,
  resumeStripeSubscription,
  constructWebhookEvent,
  getPlanByStripePriceId,
  getCreditPackByPriceId,
  CREDIT_PACKS
};
