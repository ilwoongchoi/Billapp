import Stripe from "stripe";

let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  if (cachedClient) {
    return cachedClient;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return null;
  }

  cachedClient = new Stripe(secretKey);
  return cachedClient;
}

