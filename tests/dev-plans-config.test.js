// The developer plan config is the single source every surface derives from:
// the gateway envelope, the webhook cap, the checkout prices and the public
// /developers page. These pin its shape and the derived $THREE pricing.

import { describe, it, expect } from 'vitest';

const {
	DEV_PLAN_IDS,
	DEV_PLAN_PERIOD_DAYS,
	listDevPlans,
	devPlanById,
	validateDevPlans,
	threeDiscountBps,
	threePriceUsd,
	devPlanCalculationNote,
} = await import('../api/_lib/dev-plans/config.js');

describe('developer plan config', () => {
	it('defines Free, Builder, Scale and Enterprise in that order', () => {
		expect([...DEV_PLAN_IDS]).toEqual(['free', 'builder', 'scale', 'enterprise']);
		const ranks = listDevPlans().map((p) => p.rank);
		expect(ranks).toEqual([0, 1, 2, 3]);
	});

	it('validates with no findings', () => {
		expect(validateDevPlans()).toEqual([]);
	});

	it('grows every ceiling with the plan', () => {
		const plans = listDevPlans();
		for (let i = 1; i < plans.length; i++) {
			for (const field of ['priceUsd', 'includedCalls', 'burstPerMinute', 'concurrent', 'webhooks']) {
				expect(plans[i][field], `${plans[i].id}.${field}`).toBeGreaterThan(plans[i - 1][field]);
			}
		}
	});

	it('is free at the bottom and purchasable above it', () => {
		expect(devPlanById('free')).toMatchObject({ priceUsd: 0, purchasable: false });
		for (const id of ['builder', 'scale', 'enterprise']) expect(devPlanById(id).purchasable).toBe(true);
	});

	it('derives the $THREE price from the configured discount', () => {
		const bps = threeDiscountBps();
		expect(bps).toBeGreaterThanOrEqual(0);
		expect(bps).toBeLessThanOrEqual(9000);
		const builder = devPlanById('builder');
		expect(threePriceUsd(builder)).toBe(Math.round(builder.priceUsd * (1 - bps / 10_000) * 100) / 100);
		expect(builder.threePriceUsd).toBe(threePriceUsd(builder));
	});

	it('rejects an unknown plan with a 400', () => {
		expect(() => devPlanById('gold')).toThrow(expect.objectContaining({ status: 400, code: 'bad_plan' }));
	});

	it('writes the calculation note from the config, never from typed numbers', () => {
		const note = devPlanCalculationNote();
		expect(note).toContain(`${DEV_PLAN_PERIOD_DAYS}`);
		expect(note).toContain(`${threeDiscountBps() / 100}%`);
	});
});
