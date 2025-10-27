export const SUBSCRIPTION_PLANS = {
  creator: {
    id: 'creator',
    name: 'Creator',
    price: 19.99,
    currency: 'usd',
    monthlyCredits: 250,
    maxTikTokAccounts: 1,
    description: 'Perfect for solo creators—generate and schedule content with ease.'
  },
  entrepreneur: {
    id: 'entrepreneur',
    name: 'Entrepreneur',
    price: 38.99,
    currency: 'usd',
    monthlyCredits: 250,
    maxTikTokAccounts: Infinity,
    description: 'Scale across multiple brands with unlimited TikTok accounts.'
  }
};

export function getPlanById (planId) {
  return SUBSCRIPTION_PLANS[planId] || null;
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
