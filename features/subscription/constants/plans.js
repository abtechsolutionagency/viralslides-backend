/**
 * Subscription plans. Display and business logic live here.
 * Create matching Products and recurring Prices in Stripe Dashboard, then set stripePriceId.
 */
export const SUBSCRIPTION_PLANS = {
  creator: {
    id: 'creator',
    name: 'Creator',
    price: 19.99,
    currency: 'usd',
    monthlyCredits: 250,
    maxTikTokAccounts: 1,
    description: 'Perfect for solo creators—generate and schedule content with ease.',
    stripePriceId: process.env.STRIPE_PRICE_CREATOR || '' // e.g. price_xxx from Stripe
  },
  entrepreneur: {
    id: 'entrepreneur',
    name: 'Entrepreneur',
    price: 38.99,
    currency: 'usd',
    monthlyCredits: 250,
    maxTikTokAccounts: Infinity,
    description: 'Scale across multiple brands with unlimited TikTok accounts.',
    stripePriceId: process.env.STRIPE_PRICE_ENTREPRENEUR || '' // e.g. price_xxx from Stripe
  }
};

/**
 * One-time credit packs. Create a Product "Credits" in Stripe and one Price per pack.
 */
export const CREDIT_PACKS = [
  { credits: 50, price: 4.99, stripePriceId: process.env.STRIPE_PRICE_CREDITS_50 || '' },
  { credits: 100, price: 8.99, stripePriceId: process.env.STRIPE_PRICE_CREDITS_100 || '' },
  { credits: 250, price: 19.99, stripePriceId: process.env.STRIPE_PRICE_CREDITS_250 || '' }
];

export function getPlanById (planId) {
  return SUBSCRIPTION_PLANS[planId] || null;
}

export function getPlanByStripePriceId (stripePriceId) {
  return Object.values(SUBSCRIPTION_PLANS).find((p) => p.stripePriceId === stripePriceId) || null;
}

export function serializePlan (plan) {
  if (!plan) return null;

  const { id, name, price, currency, monthlyCredits, maxTikTokAccounts, description } = plan;
  return {
    id,
    name,
    price,
    currency,
    monthlyCredits,
    maxTikTokAccounts: Number.isFinite(maxTikTokAccounts) ? maxTikTokAccounts : 'unlimited',
    description
  };
}

export function getCreditPackByPriceId (stripePriceId) {
  return CREDIT_PACKS.find((p) => p.stripePriceId === stripePriceId) || null;
}

export function getCreditPackByCredits (credits) {
  return CREDIT_PACKS.find((p) => p.credits === credits) || null;
}
