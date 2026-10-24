// Launch-time fee configuration: the shared validators (decaying-fee schedule,
// shared fee vault split, referral copy) and the server-side preview that runs a
// candidate schedule through the Dynamic Bonding Curve SDK's own validators.

import { describe, it, expect } from 'vitest';
import {
	validateFeeSchedule,
	describeFeeSchedule,
	describeReferral,
	referralShareOfTradingFeePercent,
	validateShareholders,
} from '../src/shared/launch-fees.js';
import { previewFeeConfig, feeBpsAtSlot } from '../api/_lib/native-launch/fee-config.js';
import { curveBuildParams, defaultFeeSchedule, laneInfo } from '../api/_lib/native-launch/config.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
// Distinct synthetic base58 wallets: a letter per index, repeated to 32 chars.
const wallet = (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[n - 1].repeat(32);
const good = { mode: 'exponential', start_fee_bps: 3000, end_fee_bps: 100, periods: 20, duration_slots: 200 };

describe('validateFeeSchedule', () => {
	it('accepts a falling schedule and a flat fee', () => {
		expect(validateFeeSchedule(good).ok).toBe(true);
		expect(validateFeeSchedule({ start_fee_bps: 100, end_fee_bps: 100 }).ok).toBe(true);
	});

	it('rejects a fee that rises', () => {
		const r = validateFeeSchedule({ ...good, start_fee_bps: 100, end_fee_bps: 500 });
		expect(r.ok).toBe(false);
		expect(r.errors.join(' ')).toMatch(/can only fall/);
	});

	it('rejects fees outside the program range', () => {
		expect(validateFeeSchedule({ ...good, start_fee_bps: 9901 }).ok).toBe(false);
		expect(validateFeeSchedule({ ...good, end_fee_bps: 10 }).ok).toBe(false);
	});

	it('requires periods and duration when the fee falls, and forbids them when flat', () => {
		expect(validateFeeSchedule({ ...good, periods: 0 }).ok).toBe(false);
		expect(validateFeeSchedule({ ...good, periods: 50, duration_slots: 10 }).errors.join(' ')).toMatch(/at least periods/);
		expect(validateFeeSchedule({ start_fee_bps: 100, end_fee_bps: 100, periods: 5, duration_slots: 5 }).ok).toBe(false);
	});

	it('refuses the deprecated rate limiter with the reason', () => {
		const r = validateFeeSchedule({ ...good, mode: 'rate_limiter' });
		expect(r.ok).toBe(false);
		expect(r.errors[0]).toMatch(/deprecated/);
	});

	it('describes the schedule in plain language', () => {
		expect(describeFeeSchedule(validateFeeSchedule(good).schedule)).toBe(
			'Fee starts at 30% and falls to 1% over about 80 seconds (200 slots, 20 steps, with the steepest drop first).',
		);
		expect(describeFeeSchedule({ start_fee_bps: 100, end_fee_bps: 100 })).toBe('Fee is a flat 1% from the first trade.');
	});

	it('states the referral share without promising returns', () => {
		expect(referralShareOfTradingFeePercent()).toBe(4);
		expect(describeReferral()).toMatch(/4% of the fee/);
		expect(describeReferral()).not.toMatch(/buyback|return|profit/i);
	});
});

describe('validateShareholders (shared fee vault)', () => {
	const rows = (...bps) => bps.map((share_bps, i) => ({ address: wallet(i + 1), share_bps }));

	it('accepts one to ten holders that total 100%', () => {
		expect(validateShareholders(rows(10_000)).ok).toBe(true);
		expect(validateShareholders(rows(...Array(10).fill(1_000))).ok).toBe(true);
		expect(validateShareholders([{ address: THREE_MINT, percent: 100 }]).ok).toBe(true);
	});

	it('rejects shares that do not total 100%', () => {
		const under = validateShareholders(rows(5_000, 4_000));
		expect(under.ok).toBe(false);
		expect(under.errors.join(' ')).toMatch(/total 100% \(currently 90%\)/);
		expect(validateShareholders(rows(6_000, 5_000)).ok).toBe(false);
	});

	it('rejects more than ten holders, duplicates, bad addresses and empty lists', () => {
		expect(validateShareholders(rows(...Array(11).fill(909))).errors.join(' ')).toMatch(/at most 10/);
		const dup = validateShareholders([
			{ address: wallet(1), share_bps: 5_000 },
			{ address: wallet(1), share_bps: 5_000 },
		]);
		expect(dup.errors.join(' ')).toMatch(/repeats/);
		expect(validateShareholders([{ address: 'not-a-wallet', share_bps: 10_000 }]).ok).toBe(false);
		expect(validateShareholders([]).ok).toBe(false);
	});

	it('returns basis points ready for the fee-sharing instruction', () => {
		const r = validateShareholders([
			{ address: wallet(1), percent: 33.33 },
			{ address: wallet(2), percent: 66.67 },
		]);
		expect(r.shareholders.map((s) => s.share_bps)).toEqual([3333, 6667]);
	});
});

describe('previewFeeConfig', () => {
	it('builds the live lane schedule through the SDK validators', async () => {
		const p = await previewFeeConfig();
		expect(p.schedule).toEqual(defaultFeeSchedule());
		expect(p.fee_curve[0].fee_bps).toBe(5_000);
		expect(p.preview).toMatch(/^Fee starts at 50%/);
	});

	it('carries a candidate schedule onto the SDK-built config and decays monotonically', async () => {
		const p = await previewFeeConfig(good);
		expect(p.config.poolFees.baseFee.cliffFeeNumerator.toString()).toBe('300000000');
		const fees = p.fee_curve.map((c) => c.fee_bps);
		expect(fees[0]).toBe(3_000);
		for (let i = 1; i < fees.length; i++) expect(fees[i]).toBeLessThan(fees[i - 1]);
		expect(await feeBpsAtSlot(curveBuildParams({ feeSchedule: good }).fee.baseFeeParams, 10_000)).toBe(fees.at(-1));
	});

	it('supports a linear schedule', async () => {
		const p = await previewFeeConfig({ ...good, mode: 'linear' });
		expect(p.fee_curve[2].fee_bps).toBeGreaterThan(1_000);
		expect(p.fee_curve.at(-1).fee_bps).toBeGreaterThanOrEqual(100);
	});

	it('turns validator and SDK failures into 400s that name the problem', async () => {
		await expect(previewFeeConfig({ ...good, mode: 'rate_limiter' })).rejects.toMatchObject({ status: 400, code: 'validation_error' });
		await expect(previewFeeConfig({ ...good, start_fee_bps: 100, end_fee_bps: 500 })).rejects.toMatchObject({ status: 400 });
		await expect(previewFeeConfig({ ...good, start_fee_bps: 26, end_fee_bps: 25, periods: 60000, duration_slots: 60000 })).rejects.toMatchObject({ status: 400 });
	});
});

describe('laneInfo fee surface', () => {
	it('publishes the schedule, its preview, the limits and the referral share', () => {
		const info = laneInfo('mainnet');
		expect(info.fee_schedule).toEqual(defaultFeeSchedule());
		expect(info.fee_schedule_preview).toMatch(/falls to 1%/);
		expect(info.fee_limits).toMatchObject({ min_fee_bps: 25, max_fee_bps: 9900 });
		expect(info.referral.share_of_trading_fee_percent).toBe(4);
	});
});
