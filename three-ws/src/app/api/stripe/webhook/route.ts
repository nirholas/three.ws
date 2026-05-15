import { NextResponse } from "next/server";
import { headers } from "next/headers";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
// Stripe sends raw body; we must NOT touch it before signature verification.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook signature verification failed:", message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const checkoutSession = event.data.object as Stripe.Checkout.Session;
        const userId = checkoutSession.metadata?.userId ?? checkoutSession.client_reference_id;
        if (!userId) {
          console.error("checkout.session.completed missing userId", checkoutSession.id);
          break;
        }
        if (!checkoutSession.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(
          checkoutSession.subscription as string,
        );

        await upsertSubscription(userId, subscription);
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId =
          subscription.metadata?.userId ??
          (await resolveUserIdFromCustomer(subscription.customer as string));
        if (!userId) {
          console.error(`${event.type} missing userId`, subscription.id);
          break;
        }
        await upsertSubscription(userId, subscription);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            invoice.subscription as string,
          );
          const userId =
            subscription.metadata?.userId ??
            (await resolveUserIdFromCustomer(subscription.customer as string));
          if (userId) await upsertSubscription(userId, subscription);
        }
        break;
      }

      default:
        // We don't act on other events but acknowledge receipt.
        break;
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function upsertSubscription(userId: string, sub: Stripe.Subscription) {
  const data = {
    stripeCustomerId: sub.customer as string,
    stripeSubscriptionId: sub.id,
    stripePriceId: sub.items.data[0]?.price.id ?? "",
    status: sub.status,
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };

  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/**
 * Some webhook events arrive without metadata (e.g. subscriptions created
 * outside Checkout). Fall back to looking up the user by Stripe customer ID.
 */
async function resolveUserIdFromCustomer(customerId: string): Promise<string | null> {
  const existing = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });
  return existing?.userId ?? null;
}
