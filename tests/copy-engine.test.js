/**
 * Copy-trading decision engine — pure logic tests.
 * Money-adjacent, so every sizing path, cap, budget, and safety gate is pinned.
 */

import { describe, it, expect } from 'vitest';
import {
	planCopyOrder, normalizeSubscriptionInput, rawOrderSol, evaluateSafety,
} from '../api/_lib/copy-engine.js';

const baseSub = {
	status: 'active',
	sizing_rule: 'fixed',
	fixed_sol: 0.2,
	multiplier: 0.1,
	pct_balance: 10,
	per_trade_cap_sol: 0.5,
	min_order_sol: 0.02,
	daily_budget_sol: 1,
	max_open_copies: 5,
	mcap_floor_usd: null,
	mcap_ceiling_usd: null,
	copy_sells: true,
	require_safety_pass: false,
};
const buy = (entry = 1) => ({ direction: 'buy', entry_sol: entry, mint: 'M', symbol: 'X' });

describe('rawOrderSol', () => {
	it('fixed → the fixed amount', () => {
		expect(rawOrderSol(baseSub, { leaderEntrySol: 5 })).toBe(0.2);
	});
	it('multiplier → leader entry × multiplier', () => {
		expect(rawOrderSol({ ...baseSub, sizing_rule: 'multiplier' }, { leaderEntrySol: 4 })).toBeCloseTo(0.4, 6);
	});
	it('pct_balance → % of copier balance, NaN without balance', () => {
		expect(rawOrderSol({ ...baseSub, sizing_rule: 'pct_balance' }, { copierBalanceSol: 2 })).toBeCloseTo(0.2, 6);
		expect(Number.isNaN(rawOrderSol({ ...baseSub, sizing_rule: 'pct_balance' }, {}))).toBe(true);
	});
});

describe('planCopyOrder — sizing & caps', () => {
	it('sizes a fixed buy', () => {
		const d = planCopyOrder({ subscription: baseSub, position: buy(1) });
		expect(d.action).toBe('copy');
		expect(d.order_sol).toBe(0.2);
	});

	it('clamps to the per-trade cap', () => {
		const sub = { ...baseSub, sizing_rule: 'multiplier', multiplier: 1 };
		const d = planCopyOrder({ subscription: sub, position: buy(5) }); // raw 5 → cap 0.5
		expect(d.order_sol).toBe(0.5);
	});

	it('clamps to remaining daily budget', () => {
		const d = planCopyOrder({ subscription: baseSub, position: buy(1), spentTodaySol: 0.9 });
		expect(d.order_sol).toBeCloseTo(0.1, 6); // 1.0 budget − 0.9 spent
	});

	it('skips when the daily budget is exhausted', () => {
		const d = planCopyOrder({ subscription: baseSub, position: buy(1), spentTodaySol: 1 });
		expect(d.action).toBe('skip');
		expect(d.reason).toBe('daily_budget_spent');
	});

	it('skips when the sized order is below the minimum', () => {
		const sub = { ...baseSub, sizing_rule: 'multiplier', multiplier: 0.001 };
		const d = planCopyOrder({ subscription: sub, position: buy(1) }); // 0.001 < 0.02
		expect(d.action).toBe('skip');
		expect(d.reason).toBe('below_min_order');
	});

	it('skips pct_balance sizing when balance is unknown', () => {
		const d = planCopyOrder({ subscription: { ...baseSub, sizing_rule: 'pct_balance' }, position: buy(1) });
		expect(d.action).toBe('skip');
		expect(d.reason).toBe('sizing_unavailable');
	});
});

describe('planCopyOrder — guards', () => {
	it('skips an inactive subscription', () => {
		const d = planCopyOrder({ subscription: { ...baseSub, status: 'paused' }, position: buy(1) });
		expect(d.reason).toBe('subscription_inactive');
	});

	it('enforces the open-copies cap', () => {
		const d = planCopyOrder({ subscription: baseSub, position: buy(1), openCopies: 5 });
		expect(d.action).toBe('skip');
		expect(d.reason).toBe('max_open_copies');
	});

	it('mirrors a sell with zero new SOL when copy_sells is on', () => {
		const d = planCopyOrder({ subscription: baseSub, position: { direction: 'sell', mint: 'M', entry_sol: 1 } });
		expect(d.action).toBe('copy');
		expect(d.direction).toBe('sell');
		expect(d.order_sol).toBe(0);
	});

	it('skips a sell when copy_sells is off', () => {
		const d = planCopyOrder({ subscription: { ...baseSub, copy_sells: false }, position: { direction: 'sell', mint: 'M' } });
		expect(d.reason).toBe('sells_disabled');
	});
});

describe('evaluateSafety / planCopyOrder safety gate', () => {
	it('passes when no context and safety not required', () => {
		expect(evaluateSafety(baseSub, null).ok).toBe(true);
	});
	it('fails when no context and safety required', () => {
		const r = evaluateSafety({ ...baseSub, require_safety_pass: true }, null);
		expect(r.ok).toBe(false);
		expect(r.reason).toBe('safety_unknown');
	});
	it('blocks a honeypot', () => {
		expect(evaluateSafety(baseSub, { honeypot: true }).reason).toBe('honeypot');
	});
	it('enforces the market-cap floor and ceiling', () => {
		expect(evaluateSafety({ ...baseSub, mcap_floor_usd: 20000 }, { market_cap_usd: 5000 }).reason).toBe('below_mcap_floor');
		expect(evaluateSafety({ ...baseSub, mcap_ceiling_usd: 50000 }, { market_cap_usd: 90000 }).reason).toBe('above_mcap_ceiling');
		expect(evaluateSafety({ ...baseSub, mcap_floor_usd: 1000, mcap_ceiling_usd: 100000 }, { market_cap_usd: 30000 }).ok).toBe(true);
	});
	it('blocks dev-heavy supply and thin liquidity', () => {
		expect(evaluateSafety(baseSub, { dev_holding_pct: 40 }).reason).toBe('dev_heavy');
		expect(evaluateSafety(baseSub, { liquidity_usd: 500 }).reason).toBe('low_liquidity');
	});
	it('a buy into a flagged coin is skipped end-to-end', () => {
		const d = planCopyOrder({ subscription: baseSub, position: buy(1), coin: { honeypot: true } });
		expect(d.action).toBe('skip');
		expect(d.reason).toBe('honeypot');
	});
	it('blocks a leader wallet linked to the coin creator', () => {
		const r = evaluateSafety(baseSub, { leader_linked_to_creator: true });
		expect(r.ok).toBe(false);
		expect(r.reason).toBe('leader_linked_to_creator');
		expect(r.detail).toMatch(/creator/i);
	});
	it('a buy mirroring a creator-linked leader is skipped end-to-end, even with require_safety_pass off', () => {
		const d = planCopyOrder({
			subscription: baseSub,
			position: buy(1),
			coin: { market_cap_usd: 30000, leader_linked_to_creator: true },
		});
		expect(d.action).toBe('skip');
		expect(d.reason).toBe('leader_linked_to_creator');
	});
});

describe('normalizeSubscriptionInput', () => {
	it('accepts a valid fixed config and applies defaults', () => {
		const r = normalizeSubscriptionInput({ sizing_rule: 'fixed', fixed_sol: 0.3, per_trade_cap_sol: 1, daily_budget_sol: 2 });
		expect(r.ok).toBe(true);
		expect(r.value.fixed_sol).toBe(0.3);
		expect(r.value.max_open_copies).toBe(5);
		expect(r.value.perf_fee_bps).toBe(1000);
	});
	it('rejects a non-positive cap / budget', () => {
		expect(normalizeSubscriptionInput({ per_trade_cap_sol: 0, daily_budget_sol: 1, fixed_sol: 1 }).ok).toBe(false);
		expect(normalizeSubscriptionInput({ per_trade_cap_sol: 1, daily_budget_sol: 0, fixed_sol: 1 }).ok).toBe(false);
	});
	it('rejects min above cap', () => {
		const r = normalizeSubscriptionInput({ per_trade_cap_sol: 0.1, min_order_sol: 0.5, daily_budget_sol: 1, fixed_sol: 0.05 });
		expect(r.ok).toBe(false);
	});
	it('validates per-rule required fields', () => {
		expect(normalizeSubscriptionInput({ sizing_rule: 'fixed', fixed_sol: 0, per_trade_cap_sol: 1, daily_budget_sol: 1 }).ok).toBe(false);
		expect(normalizeSubscriptionInput({ sizing_rule: 'multiplier', multiplier: 0, per_trade_cap_sol: 1, daily_budget_sol: 1 }).ok).toBe(false);
		expect(normalizeSubscriptionInput({ sizing_rule: 'pct_balance', pct_balance: 150, per_trade_cap_sol: 1, daily_budget_sol: 1 }).ok).toBe(false);
	});
	it('clamps perf fee to the allowed band', () => {
		expect(normalizeSubscriptionInput({ perf_fee_bps: 5000, per_trade_cap_sol: 1, daily_budget_sol: 1, fixed_sol: 1 }).ok).toBe(false);
	});
});
