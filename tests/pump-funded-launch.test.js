// Creator-fee rules for funded launches. The picker, the quote and the CLI all
// lean on these two functions, so the contract is pinned here: a creator may
// only choose a rate when the program lets them, and never outside the range.

import { afterEach, describe, expect, it } from 'vitest';
import { creatorFeeRule, configuredCreatorFeeRange } from '../api/_lib/pump-launch-pairs.js';
import { FundedLaunchError, resolveCreatorFee, STAGES, TERMINAL_STAGES } from '../api/_lib/pump-funded-launch.js';

const KEYS = ['PUMP_CREATOR_FEE_MIN_BPS', 'PUMP_CREATOR_FEE_MAX_BPS', 'PUMP_CREATOR_FEE_DEFAULT_BPS'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

const global = (over = {}) => ({ creatorFeeConfigurable: true, maxConfigurableCreatorFeeBps: { toString: () => '500' }, ...over });

describe('configuredCreatorFeeRange', () => {
	it('defaults to 0..1000 bps with a 100 bps default', () => {
		for (const k of KEYS) delete process.env[k];
		expect(configuredCreatorFeeRange()).toEqual({ min_bps: 0, max_bps: 1000, default_bps: 100 });
	});

	it('rejects an inverted range', () => {
		process.env.PUMP_CREATOR_FEE_MIN_BPS = '600';
		process.env.PUMP_CREATOR_FEE_MAX_BPS = '300';
		expect(() => configuredCreatorFeeRange()).toThrow(/above/);
	});
});

describe('creatorFeeRule', () => {
	it('is configurable on an admitted quote, clamped to what the program allows', () => {
		for (const k of KEYS) delete process.env[k];
		const rule = creatorFeeRule({ global: global(), scheduleCreatorBps: 30, admitted: true });
		expect(rule).toMatchObject({ configurable: true, min_bps: 1, max_bps: 500, default_bps: 100, fixed_bps: null });
	});

	it('falls back to the schedule rate when the program gate is off', () => {
		const rule = creatorFeeRule({ global: global({ creatorFeeConfigurable: false }), scheduleCreatorBps: 30, admitted: true });
		expect(rule).toMatchObject({ configurable: false, fixed_bps: 30 });
		expect(rule.reason).toMatch(/not accepting/);
	});

	it('falls back to the schedule rate on a quote that is not admitted', () => {
		const rule = creatorFeeRule({ global: global(), scheduleCreatorBps: 30, admitted: false });
		expect(rule).toMatchObject({ configurable: false, fixed_bps: 30 });
	});

	it('falls back when the configured range does not overlap the chain range', () => {
		process.env.PUMP_CREATOR_FEE_MIN_BPS = '800';
		process.env.PUMP_CREATOR_FEE_MAX_BPS = '900';
		const rule = creatorFeeRule({ global: global(), scheduleCreatorBps: 30, admitted: true });
		expect(rule.configurable).toBe(false);
		expect(rule.fixed_bps).toBe(30);
	});
});

describe('resolveCreatorFee', () => {
	const configurable = { symbol: 'SOL', creator_fee: { configurable: true, min_bps: 1, max_bps: 500, default_bps: 100 } };
	const fixed = { symbol: 'USDC', creator_fee: { configurable: false, fixed_bps: 30, reason: 'This quote pays the schedule rate.' }, fees: { creator_bps: 30 } };

	it('uses the default when the creator picks nothing', () => {
		expect(resolveCreatorFee(configurable, null)).toMatchObject({ bps: 100, configurable: true });
	});

	it('accepts a pick inside the range, including the edges', () => {
		expect(resolveCreatorFee(configurable, 1).bps).toBe(1);
		expect(resolveCreatorFee(configurable, 500).bps).toBe(500);
	});

	it('refuses a pick outside the range and returns the range to correct it', () => {
		try {
			resolveCreatorFee(configurable, 501);
			throw new Error('expected a refusal');
		} catch (err) {
			expect(err).toBeInstanceOf(FundedLaunchError);
			expect(err.status).toBe(400);
			expect(err.code).toBe('creator_fee_out_of_range');
			expect(err.extra).toEqual({ min_bps: 1, max_bps: 500, default_bps: 100 });
		}
	});

	it('returns the fixed rate when the quote is not configurable', () => {
		expect(resolveCreatorFee(fixed, null)).toMatchObject({ bps: 30, configurable: false });
		expect(resolveCreatorFee(fixed, 30).bps).toBe(30);
	});

	it('refuses a different pick on a fixed-rate quote', () => {
		expect(() => resolveCreatorFee(fixed, 250)).toThrow(expect.objectContaining({ code: 'creator_fee_fixed', status: 400 }));
	});
});

describe('stages', () => {
	it('runs quote, paid, submitted, confirmed, indexed, with failed and expired as the only exits', () => {
		expect(STAGES).toEqual(['quote', 'paid', 'submitted', 'confirmed', 'indexed']);
		expect(TERMINAL_STAGES).toEqual(['failed', 'expired']);
	});
});
