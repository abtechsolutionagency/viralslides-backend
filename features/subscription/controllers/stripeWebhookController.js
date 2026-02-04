import stripeService from '../services/stripeService.js';
import subscriptionService from '../services/subscriptionService.js';
import { getPlanByStripePriceId, getPlanById } from '../constants/plans.js';

/**
 * Handle Stripe webhook events. Must be invoked with raw body (Buffer).
 * Signature is in header: stripe-signature.
 */
async function handleStripeWebhook (req, res) {
  const signature = req.headers['stripe-signature'];
  const rawBody = req.body; // Buffer from express.raw()

  if (!signature || !rawBody) {
    req.log?.warn('Stripe webhook missing signature or body');
    return res.status(400).json({ error: 'Missing signature or body' });
  }

  let event;
  try {
    event = stripeService.constructWebhookEvent(rawBody, signature);
  } catch (err) {
    req.log?.warn({ err }, 'Stripe webhook signature verification failed');
    return res.status(400).json({ error: err.message });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          // Fetch subscription to get metadata (metadata is on subscription_data, not session)
          if (!stripeService.stripe) {
            throw new Error('Stripe is not configured');
          }
          // Metadata is already included in subscription object, no need to expand
          const stripeSubscription = await stripeService.stripe.subscriptions.retrieve(session.subscription);
          req.log?.info({
            subscriptionId: stripeSubscription.id,
            subscriptionStatus: stripeSubscription.status,
            metadata: stripeSubscription.metadata,
            sessionCustomer: session.customer
          }, 'Processing checkout.session.completed for subscription');
          await subscriptionService.activatePlanFromStripe({ session, stripeSubscription });
          req.log?.info({ userId: stripeSubscription.metadata?.userId, planId: stripeSubscription.metadata?.planId, subscriptionId: stripeSubscription.id }, 'Subscription activated from Stripe');
        } else if (session.mode === 'payment' && session.metadata?.type === 'credits') {
          const result = await subscriptionService.purchaseCreditsFromStripe({ session });
          if (!result.alreadyProcessed) {
            req.log?.info({ userId: session.metadata?.userId, credits: session.metadata?.credits }, 'Credits purchased from Stripe');
          }
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await subscriptionService.syncSubscriptionFromStripe({ stripeSubscription: sub });
        req.log?.info({ subscriptionId: sub.id }, 'Subscription synced from Stripe');
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await subscriptionService.syncSubscriptionFromStripe({ stripeSubscription: sub });
        req.log?.info({ subscriptionId: sub.id }, 'Subscription deleted, synced');
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const subscriptionId = invoice.subscription;
          const priceId = invoice.lines?.data?.[0]?.price?.id;
          const plan = priceId ? getPlanByStripePriceId(priceId) : null;
          
          // Handle initial subscription payment (subscription_create) - ensure subscription is active
          if (invoice.billing_reason === 'subscription_create') {
            // Fetch subscription to ensure it's activated
            if (stripeService.stripe) {
              const stripeSubscription = await stripeService.stripe.subscriptions.retrieve(subscriptionId);
              await subscriptionService.syncSubscriptionFromStripe({ stripeSubscription });
              req.log?.info({ subscriptionId, planId: plan?.id }, 'Initial subscription payment processed, subscription synced');
            }
          }
          
          // Handle subscription update (plan change) - sync subscription to ensure plan is updated
          if (invoice.billing_reason === 'subscription_update') {
            if (stripeService.stripe) {
              const stripeSubscription = await stripeService.stripe.subscriptions.retrieve(subscriptionId);
              await subscriptionService.syncSubscriptionFromStripe({ stripeSubscription });
              req.log?.info({ subscriptionId, planId: plan?.id, amount: invoice.amount_paid }, 'Subscription update payment processed, subscription synced');
            }
          }
          
          // Handle renewal payments (subscription_cycle) - grant renewal credits
          if (invoice.billing_reason === 'subscription_cycle' && plan) {
            const amount = plan.monthlyCredits ?? 0;
            if (amount > 0) {
              await subscriptionService.grantRenewalCreditsFromStripe({
                subscriptionId,
                planId: plan.id,
                amount
              });
              req.log?.info({ subscriptionId, planId: plan.id, amount }, 'Renewal credits granted');
            }
          }
        }
        break;
      }
      case 'invoice.created': {
        const invoice = event.data.object;
        if (invoice.subscription && invoice.billing_reason === 'subscription_update') {
          req.log?.info({
            subscriptionId: invoice.subscription,
            invoiceId: invoice.id,
            amount: invoice.amount_due,
            billingReason: invoice.billing_reason
          }, 'Invoice created for subscription update (proration)');
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.subscription && invoice.billing_reason === 'subscription_update') {
          // Handle subscription update payment success - ensure subscription is synced
          if (stripeService.stripe) {
            const stripeSubscription = await stripeService.stripe.subscriptions.retrieve(invoice.subscription);
            await subscriptionService.syncSubscriptionFromStripe({ stripeSubscription });
            req.log?.info({ subscriptionId: invoice.subscription, amount: invoice.amount_paid }, 'Subscription update payment succeeded');
          }
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription && invoice.billing_reason === 'subscription_update') {
          req.log?.warn({
            subscriptionId: invoice.subscription,
            invoiceId: invoice.id,
            amount: invoice.amount_due,
            attemptCount: invoice.attempt_count
          }, 'Subscription update payment failed');
        }
        break;
      }
      default:
        req.log?.debug({ type: event.type }, 'Unhandled Stripe event');
    }
    res.status(200).json({ received: true });
  } catch (err) {
    req.log?.error({ err, eventType: event.type }, 'Stripe webhook handler error');
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

export { handleStripeWebhook };
