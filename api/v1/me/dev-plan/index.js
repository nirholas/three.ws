// GET /api/v1/me/dev-plan: the caller's developer plan and where this period's
// quota stands. Session or bearer. A key asking about its own quota spends one
// call of it, like any other v1 call; the dashboard (session) spends nothing.

import { defineEndpoint } from '../../../_lib/gateway.js';
import { getDevSubscription } from '../../../_lib/dev-plans/subscription.js';
import { peekDevQuota, devSlotsInFlight, nextDevPlan } from '../../../_lib/dev-plans/quota.js';
import { listDevPlanReceipts, quoteDevPlanChange } from '../../../_lib/dev-plans/billing.js';
import { listDevPlans, devPlanCalculationNote, DEV_PLAN_UPGRADE_URL, DEV_PLAN_MANAGE_URL } from '../../../_lib/dev-plans/config.js';
import { publicPlan } from '../../dev-plans.js';

function quoteOrNull(sub, planId, asset) {
	try {
		const q = quoteDevPlanChange(sub, planId, asset);
		return { kind: q.kind, amount_usd: q.amountUsd, list_usd: q.listUsd, discount_bps: q.discountBps, remaining_fraction: q.remainingFraction, period_start: q.periodStart, period_end: q.periodEnd };
	} catch {
		return null;
	}
}

export default defineEndpoint({
	name: 'v1.me.dev-plan',
	method: 'GET',
	auth: 'required',
	handler: async ({ res, principal }) => {
		const sub = await getDevSubscription(principal.userId);
		const [quota, receipts] = await Promise.all([peekDevQuota(sub), listDevPlanReceipts(principal.userId, 10)]);
		const next = nextDevPlan(sub.planId);
		res.setHeader('cache-control', 'private, no-store');
		return {
			plan: publicPlan(sub.plan),
			period_start: sub.periodStart.toISOString(),
			period_end: sub.periodEnd.toISOString(),
			scheduled_plan: sub.scheduledPlanId,
			renew_with: sub.renewWith,
			paid_usd: sub.paidUsd,
			degraded: Boolean(sub.degraded),
			quota: { limit: quota.limit, used: quota.used, remaining: quota.remaining, reset_at: quota.resetAt.toISOString() },
			concurrency: { limit: sub.plan.concurrent, in_flight: devSlotsInFlight(principal.userId) },
			burst_per_minute: sub.plan.burstPerMinute,
			next_plan: next ? publicPlan(next) : null,
			quotes: Object.fromEntries(
				listDevPlans()
					.filter((p) => p.purchasable && p.rank >= sub.plan.rank)
					.map((p) => [p.id, { credits: quoteOrNull(sub, p.id, 'credits'), USDC: quoteOrNull(sub, p.id, 'USDC'), THREE: quoteOrNull(sub, p.id, 'THREE') }]),
			),
			receipts,
			upgrade_url: DEV_PLAN_UPGRADE_URL,
			manage_url: DEV_PLAN_MANAGE_URL,
			calculation_note: devPlanCalculationNote(),
		};
	},
});
