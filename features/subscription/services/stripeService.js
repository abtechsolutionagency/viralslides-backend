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
      metadata: { userId: userId.toString(), planId, isUpdate: 'false' }
    },
    allow_promotion_codes: true
  });
  return { sessionId: session.id, url: session.url };
}

/**
 * Create Checkout Session for subscription plan update (one-time payment for prorated amount).
 * After payment, subscription will be updated via webhook.
 */
async function createSubscriptionUpdateCheckoutSession ({ userId, userEmail, userName, planId, existingSubscriptionId, successPath = '/subscription/update/success', cancelPath = '/subscription' }) {
  if (!stripe) throw new Error('Stripe is not configured');
  const plan = SUBSCRIPTION_PLANS[planId];
  if (!plan?.stripePriceId) throw new Error('Plan not linked to Stripe. Set stripePriceId for this plan.');
  
  // Get existing subscription to calculate proration
  const existingSubscription = await stripe.subscriptions.retrieve(existingSubscriptionId);
  const existingPriceId = existingSubscription.items?.data?.[0]?.price?.id;
  
  if (!existingPriceId) throw new Error('Existing subscription has no price');
  
  // Calculate prorated amount
  const existingPrice = await stripe.prices.retrieve(existingPriceId);
  const newPrice = await stripe.prices.retrieve(plan.stripePriceId);
  
  // Get remaining time in current period
  const now = Math.floor(Date.now() / 1000);
  const periodEnd = existingSubscription.current_period_end;
  const periodStart = existingSubscription.current_period_start;
  const periodLength = periodEnd - periodStart;
  const remainingTime = periodEnd - now;
  const remainingRatio = remainingTime / periodLength;
  
  // Calculate prorated amount (difference between old and new price for remaining period)
  const existingAmount = existingPrice.unit_amount || 0;
  const newAmount = newPrice.unit_amount || 0;
  const proratedAmount = Math.round((newAmount - existingAmount) * remainingRatio);
  
  const customerId = await getOrCreateStripeCustomer(userId, userEmail, userName);
  
  // If prorated amount is 0 or negative (downgrade), still create checkout but amount will be 0
  // For downgrades, we'll update subscription after payment confirmation
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment', // One-time payment for prorated amount
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Upgrade to ${plan.name}`,
          description: `Prorated charge for remaining billing period`
        },
        unit_amount: Math.max(0, proratedAmount) // Ensure non-negative
      },
      quantity: 1
    }],
    success_url: `${frontendUrl}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}${cancelPath}`,
    metadata: {
      userId: userId.toString(),
      planId,
      existingSubscriptionId,
      isUpdate: 'true',
      proratedAmount: String(proratedAmount)
    },
    payment_intent_data: {
      metadata: {
        userId: userId.toString(),
        planId,
        existingSubscriptionId,
        isUpdate: 'true'
      }
    }
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
 * Update subscription plan in Stripe (change price).
 * Stripe will automatically create a prorated invoice and charge the customer's default payment method.
 * Returns the updated subscription.
 */
async function updateStripeSubscription (stripeSubscriptionId, newStripePriceId, metadata = {}) {
  if (!stripe) throw new Error('Stripe is not configured');
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const subscriptionItemId = subscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) throw new Error('Subscription has no items');
  
  // Ensure collection method is 'charge_automatically' so Stripe charges immediately
  const updateParams = {
    items: [{ id: subscriptionItemId, price: newStripePriceId }],
    proration_behavior: 'create_prorations', // Creates invoice immediately for prorated amount
    metadata: Object.keys(metadata).length ? { ...subscription.metadata, ...metadata } : undefined
  };
  
  if (subscription.collection_method !== 'charge_automatically') {
    updateParams.collection_method = 'charge_automatically';
  }
  
  // Update subscription - this creates prorated invoice items
  const updated = await stripe.subscriptions.update(stripeSubscriptionId, updateParams);
  
  // IMPORTANT: When updating a subscription with proration, Stripe creates invoice items
  // but may not automatically create an invoice. We need to create and pay the invoice.
  // Wait for Stripe to process the update
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Try to find an existing invoice first (Stripe might have created one)
  let invoice = null;
  const existingInvoices = await stripe.invoices.list({
    subscription: stripeSubscriptionId,
    limit: 10
  });
  
  // Look for invoice with subscription_update billing reason or draft status
  invoice = existingInvoices.data.find(inv => 
    (inv.billing_reason === 'subscription_update' || inv.status === 'draft') &&
    inv.status !== 'paid' &&
    inv.status !== 'void' &&
    inv.status !== 'uncollectible'
  );
  
  // If no invoice found, create one (this will include the proration items)
  if (!invoice) {
    try {
      invoice = await stripe.invoices.create({
        customer: updated.customer,
        subscription: stripeSubscriptionId,
        auto_advance: false // Don't auto-finalize, we'll do it manually
      });
      console.log(`📝 Created invoice ${invoice.id} for subscription update`);
    } catch (err) {
      console.error(`❌ Failed to create invoice: ${err.message}`);
      // If creation fails, invoice items might already be on an existing invoice
      // Try to find any draft invoice
      invoice = existingInvoices.data.find(inv => inv.status === 'draft');
      if (!invoice) {
        throw new Error(`Failed to create or find invoice: ${err.message}`);
      }
    }
  }
  
  // Finalize the invoice if it's draft
  if (invoice.status === 'draft') {
    invoice = await stripe.invoices.finalizeInvoice(invoice.id);
    console.log(`📋 Finalized invoice ${invoice.id}`);
  }
  
  // Pay the invoice immediately if it has amount due
  if (invoice.status === 'open' && invoice.amount_due > 0) {
    try {
      const paidInvoice = await stripe.invoices.pay(invoice.id);
      console.log(`✅ Invoice ${paidInvoice.id} paid successfully: $${paidInvoice.amount_paid / 100}`);
      // Payment succeeded - Stripe will send invoice.payment_succeeded and invoice.paid webhooks
    } catch (err) {
      // Payment failed (e.g., no payment method or card declined)
      // Stripe will send invoice.payment_failed webhook
      console.error(`❌ Invoice ${invoice.id} payment failed: ${err.message}`);
      throw new Error(`Payment failed: ${err.message}. Please ensure your payment method is valid.`);
    }
  } else if (invoice.amount_due === 0) {
    // Downgrade scenario - no charge needed
    console.log(`ℹ️ Invoice ${invoice.id} has $0 amount (downgrade), no charge needed`);
  } else {
    console.log(`ℹ️ Invoice ${invoice.id} status: ${invoice.status}, amount: $${invoice.amount_due / 100}`);
  }
  
  return updated;
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
  updateStripeSubscription,
  constructWebhookEvent,
  getPlanByStripePriceId,
  getCreditPackByPriceId,
  CREDIT_PACKS
};
