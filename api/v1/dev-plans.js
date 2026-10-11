// GET /api/v1/dev-plans: the developer API plans, straight from the config.
//
// Public and unauthenticated. The /developers page renders this answer, so a
// plan edit in api/_lib/dev-plans/config.js is live on the page the moment it
// deploys, with no number ever typed by hand.

import { defineEndpoint } from '../_lib/gateway.js';
import {
	listDevPlans,
	devPlanCalculationNote,
	threeDiscountBps,
	DEV_PLAN_PERIOD_DAYS,
	DEV_PLAN_PAY_ASSETS,
	DEV_PLAN_UPGRADE_URL,
	DEV_PLAN_MANAGE_URL,
} from '../_lib/dev-plans/config.js';

export function publicPlan(p) {
	return {
		id: p.id,
		name: p.name,
		tagline: p.tagline,
		price_usd: p.priceUsd,
		three_price_usd: p.threePriceUsd,
		included_calls: p.includedCalls,
		burst_per_minute: p.burstPerMinute,
		concurrent: p.concurrent,
		webhooks: p.webhooks,
		purchasable: p.purchasable,
		contact_sales: p.contactSales,
		rank: p.rank,
	};
}

export default defineEndpoint({
	name: 'v1.dev-plans',
	method: 'GET',
	auth: 'public',
	handler: async ({ res }) => {
		res.setHeader('cache-control', 'public, max-age=300, s-maxage=300');
		return {
			plans: listDevPlans().map(publicPlan),
			period_days: DEV_PLAN_PERIOD_DAYS,
			three_discount_bps: threeDiscountBps(),
			pay_assets: DEV_PLAN_PAY_ASSETS,
			upgrade_url: DEV_PLAN_UPGRADE_URL,
			manage_url: DEV_PLAN_MANAGE_URL,
			calculation_note: devPlanCalculationNote(),
		};
	},
});
