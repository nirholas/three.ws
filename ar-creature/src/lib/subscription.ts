import { prisma } from "./db";
import { isSubscriptionActive, PLANS, type PlanId } from "./plans";

export interface UserPlan {
  planId: PlanId;
  entitlements: (typeof PLANS)[PlanId]["entitlements"];
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Resolves the user's effective plan by checking their Stripe subscription
 * state in our database. The webhook keeps this up to date.
 */
export async function getUserPlan(userId: string): Promise<UserPlan> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });

  const active = isSubscriptionActive({
    status: sub?.status,
    currentPeriodEnd: sub?.currentPeriodEnd,
  });

  const planId: PlanId = active ? "pro" : "free";

  return {
    planId,
    entitlements: PLANS[planId].entitlements,
    status: sub?.status ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
  };
}
