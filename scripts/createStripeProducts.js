import Stripe from 'stripe';
import { SUBSCRIPTION_PLANS, CREDIT_PACKS } from '../features/subscription/constants/plans.js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey || stripeSecretKey === 'sk_test_xxx') {
  console.error('❌ Error: STRIPE_SECRET_KEY is not set or is placeholder.');
  console.error('   Please set STRIPE_SECRET_KEY in your .env file');
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-11-20.acacia' });

/**
 * Find existing product by name (case-insensitive)
 */
async function findProductByName (name) {
  const products = await stripe.products.list({ limit: 100 });
  return products.data.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Create or get product
 */
async function getOrCreateProduct ({ name, description }) {
  let product = await findProductByName(name);
  if (product) {
    console.log(`   ✓ Product "${name}" already exists (${product.id})`);
    return product;
  }
  product = await stripe.products.create({
    name,
    description: description || undefined
  });
  console.log(`   ✓ Created product "${name}" (${product.id})`);
  return product;
}

/**
 * Find existing price for a product
 */
async function findPriceForProduct (productId, amount, currency, recurring) {
  const prices = await stripe.prices.list({ product: productId, limit: 100 });
  return prices.data.find((p) => {
    if (p.currency !== currency) return false;
    if (recurring && p.recurring?.interval === 'month') {
      return p.unit_amount === Math.round(amount * 100); // Convert to cents
    }
    if (!recurring && !p.recurring) {
      return p.unit_amount === Math.round(amount * 100);
    }
    return false;
  });
}

/**
 * Create or get price
 */
async function getOrCreatePrice ({ productId, amount, currency, recurring, metadata }) {
  const existingPrice = await findPriceForProduct(productId, amount, currency, recurring);
  if (existingPrice) {
    console.log(`   ✓ Price $${amount} already exists (${existingPrice.id})`);
    return existingPrice;
  }
  const priceData = {
    product: productId,
    unit_amount: Math.round(amount * 100), // Convert to cents
    currency: currency || 'usd',
    metadata: metadata || {}
  };
  if (recurring) {
    priceData.recurring = { interval: 'month' };
  }
  const price = await stripe.prices.create(priceData);
  console.log(`   ✓ Created price $${amount} (${price.id})`);
  return price;
}

/**
 * Main function to create all products and prices
 */
async function createStripeProducts () {
  console.log('🚀 Creating Stripe Products and Prices...\n');

  const results = {
    subscriptionPlans: {},
    creditPacks: {}
  };

  try {
    // Create subscription plans
    console.log('📦 Creating Subscription Plans:');
    for (const [key, plan] of Object.entries(SUBSCRIPTION_PLANS)) {
      console.log(`\n   Creating "${plan.name}" plan:`);
      const product = await getOrCreateProduct({
        name: plan.name,
        description: plan.description
      });
      const price = await getOrCreatePrice({
        productId: product.id,
        amount: plan.price,
        currency: plan.currency,
        recurring: true,
        metadata: {
          planId: plan.id,
          monthlyCredits: String(plan.monthlyCredits),
          maxTikTokAccounts: String(plan.maxTikTokAccounts)
        }
      });
      results.subscriptionPlans[key] = {
        productId: product.id,
        priceId: price.id,
        name: plan.name
      };
    }

    // Create credits product
    console.log('\n\n💳 Creating Credits Product:');
    const creditsProduct = await getOrCreateProduct({
      name: 'Credits',
      description: 'One-time credit purchases for ViralSlides'
    });

    // Create credit pack prices
    console.log('\n   Creating credit pack prices:');
    for (const pack of CREDIT_PACKS) {
      const price = await getOrCreatePrice({
        productId: creditsProduct.id,
        amount: pack.price,
        currency: 'usd',
        recurring: false,
        metadata: {
          credits: String(pack.credits),
          type: 'credits'
        }
      });
      results.creditPacks[pack.credits] = {
        priceId: price.id,
        credits: pack.credits,
        price: pack.price
      };
    }

    // Output results
    console.log('\n\n✅ Success! Here are your Stripe Price IDs:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Add these to your .env file:\n');
    console.log(`STRIPE_PRICE_CREATOR=${results.subscriptionPlans.creator.priceId}`);
    console.log(`STRIPE_PRICE_ENTREPRENEUR=${results.subscriptionPlans.entrepreneur.priceId}`);
    console.log(`STRIPE_PRICE_CREDITS_50=${results.creditPacks[50].priceId}`);
    console.log(`STRIPE_PRICE_CREDITS_100=${results.creditPacks[100].priceId}`);
    console.log(`STRIPE_PRICE_CREDITS_250=${results.creditPacks[250].priceId}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('📊 Summary:');
    console.log(`   • Subscription Plans: ${Object.keys(results.subscriptionPlans).length}`);
    console.log(`   • Credit Packs: ${Object.keys(results.creditPacks).length}`);
    console.log('\n✨ Done! Your Stripe products are ready to use.\n');
  } catch (error) {
    console.error('\n❌ Error creating Stripe products:', error.message);
    if (error.type === 'StripeAuthenticationError') {
      console.error('   Make sure your STRIPE_SECRET_KEY is valid');
    }
    process.exit(1);
  }
}

// Run the script
createStripeProducts();
