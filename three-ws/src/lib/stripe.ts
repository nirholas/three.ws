import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-10-28.acacia",
  typescript: true,
  appInfo: { name: "three.ws", version: "0.1.0" },
});

export const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID!;
