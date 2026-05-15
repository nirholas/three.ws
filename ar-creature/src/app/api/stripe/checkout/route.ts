import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { stripe, PRO_PRICE_ID } from "@/lib/stripe";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!PRO_PRICE_ID) {
    return NextResponse.json(
      { error: "STRIPE_PRO_PRICE_ID is not configured" },
      { status: 500 },
    );
  }

  // Re-use an existing Stripe customer if we have one; otherwise let Checkout create one.
  const existingSub = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    select: { stripeCustomerId: true },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
    success_url: `${appUrl}/account?checkout=success`,
    cancel_url: `${appUrl}/pricing?checkout=cancelled`,
    customer: existingSub?.stripeCustomerId ?? undefined,
    customer_email: existingSub?.stripeCustomerId ? undefined : session.user.email,
    client_reference_id: session.user.id,
    metadata: { userId: session.user.id },
    subscription_data: {
      metadata: { userId: session.user.id },
    },
    allow_promotion_codes: true,
  });

  if (!checkoutSession.url) {
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }

  return NextResponse.json({ url: checkoutSession.url });
}
