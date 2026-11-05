import { describe, it, expect } from 'vitest';
import {
	parseAmount, formatRaw, projectInterest, checkWithdraw, healthFactor, interestEarned,
	planEarn, selectCanonicalReserves, withdrawKeepsHealth, U64_MAX, HEALTH_FLOOR,
} from '../api/_lib/lending/math.js';
import { LendingError } from '../api/_lib/lending/errors.js';

describe('parseAmount', () => {
	it('parses decimals into base units', () => {
		expect(parseAmount('25', 6)).toBe(25_000_000n);
		expect(parseAmount('0.5', 6)).toBe(500_000n);
		expect(parseAmount(12.25, 6)).toBe(12_250_000n);
		expect(parseAmount(1e-7, 9)).toBe(100n);
	});
	it('refuses zero, junk, negatives and excess precision', () => {
		for (const bad of ['0', '', 'abc', '-1', '1.1234567']) {
			expect(() => parseAmount(bad, 6)).toThrow(LendingError);
		}
	});
});

describe('checkWithdraw', () => {
	it('refuses a withdraw larger than the position before anything is built', () => {
		try {
			checkWithdraw({ requestedRaw: 11_000_000n, suppliedRaw: 10_000_000n, decimals: 6, symbol: 'USDC' });
			throw new Error('should have thrown');
		} catch (err) {
			expect(err.code).toBe('exceeds_position');
			expect(err.status).toBe(422);
			expect(err.detail.supplied).toBe('10');
		}
	});
	it('refuses when nothing is supplied', () => {
		expect(() => checkWithdraw({ requestedRaw: 1n, suppliedRaw: 0n, decimals: 6, symbol: 'USDC' })).toThrow(/nothing to withdraw/);
	});
	it('turns a near-total request into a full exit', () => {
		const r = checkWithdraw({ requestedRaw: 9_999_999n, suppliedRaw: 10_000_000n, decimals: 6, symbol: 'USDC' });
		expect(r).toEqual({ amountRaw: U64_MAX, all: true });
	});
	it('passes an in-bounds partial withdraw through', () => {
		expect(checkWithdraw({ requestedRaw: 4_000_000n, suppliedRaw: 10_000_000n, decimals: 6, symbol: 'USDC' })).toEqual({ amountRaw: 4_000_000n, all: false });
	});
});

describe('healthFactor', () => {
	it('is null with no debt and the limit-to-debt ratio otherwise', () => {
		expect(healthFactor({ unhealthyBorrowValue: 100, borrowedValueAdjusted: 0 })).toBeNull();
		expect(healthFactor({ unhealthyBorrowValue: 150, borrowedValueAdjusted: 100 })).toBe(1.5);
	});
});

describe('withdrawKeepsHealth', () => {
	const base = { liquidationLimitUsd: 150, debtAdjustedUsd: 100, liquidationThreshold: 0.8 };
	it('always allows a withdraw when there is no debt', () => {
		expect(withdrawKeepsHealth({ ...base, debtAdjustedUsd: 0, withdrawUsd: 1000 })).toEqual({ ok: true, healthAfter: null });
	});
	it('allows a withdraw that leaves the factor above the floor', () => {
		const r = withdrawKeepsHealth({ ...base, withdrawUsd: 5 });
		expect(r.ok).toBe(true);
		expect(r.healthAfter).toBeCloseTo((150 - 4) / 100, 6);
	});
	it('refuses a withdraw that would drop the factor below the floor', () => {
		const r = withdrawKeepsHealth({ ...base, withdrawUsd: 40 });
		expect(r.ok).toBe(false);
		expect(r.healthAfter).toBeLessThan(HEALTH_FLOOR);
	});
});

describe('planEarn', () => {
	it('deposit_idle keeps the reserve and supplies the rest', () => {
		expect(planEarn({ mode: 'deposit_idle', balanceRaw: 100_000_000n, suppliedRaw: 0n, reserveRaw: 25_000_000n })).toMatchObject({ action: 'deposit', amountRaw: 75_000_000n });
	});
	it('deposit_idle does nothing at or under the reserve and under the minimum move', () => {
		expect(planEarn({ mode: 'deposit_idle', balanceRaw: 25_000_000n, suppliedRaw: 0n, reserveRaw: 25_000_000n }).action).toBe('none');
		expect(planEarn({ mode: 'deposit_idle', balanceRaw: 26_000_000n, suppliedRaw: 0n, reserveRaw: 25_000_000n, minMoveRaw: 5_000_000n }).action).toBe('none');
	});
	it('withdraw_below tops the wallet back up to the floor, bounded by the position', () => {
		expect(planEarn({ mode: 'withdraw_below', balanceRaw: 2_000_000n, suppliedRaw: 50_000_000n, floorRaw: 10_000_000n })).toMatchObject({ action: 'withdraw', amountRaw: 8_000_000n, all: false });
		expect(planEarn({ mode: 'withdraw_below', balanceRaw: 0n, suppliedRaw: 4_000_000n, floorRaw: 10_000_000n })).toMatchObject({ action: 'withdraw', amountRaw: 4_000_000n, all: true });
	});
	it('rejects an unknown mode', () => {
		expect(() => planEarn({ mode: 'x', balanceRaw: 0n, suppliedRaw: 0n })).toThrow(LendingError);
	});
});

describe('interestEarned and projections', () => {
	it('is the position value minus net deposits', () => {
		const r = interestEarned({ currentRaw: 10_500_000n, events: [{ kind: 'deposit', amountRaw: 10_000_000n }] });
		expect(r.total_raw).toBe(500_000n);
	});
	it('counts interest realized by an over-withdraw', () => {
		const r = interestEarned({ currentRaw: 0n, events: [{ kind: 'deposit', amountRaw: 10_000_000n }, { kind: 'withdraw', amountRaw: 10_100_000n }] });
		expect(r.realized_raw).toBe(100_000n);
	});
	it('projects a yearly figure of amount times apy', () => {
		expect(projectInterest(1000, 0.05).per_year).toBeCloseTo(50, 6);
		expect(projectInterest(0, 0.05).per_year).toBe(0);
	});
	it('formats base units exactly', () => {
		expect(formatRaw(1_500_000n, 6)).toBe('1.5');
	});
});

describe('selectCanonicalReserves', () => {
	it('keeps the deepest active open-term reserve per mint', () => {
		const out = selectCanonicalReserves([
			{ address: 'a', mint: 'M1', status: 'Active', deprecated: false, debtTermSeconds: 0, totalSupplyUsd: 5 },
			{ address: 'b', mint: 'M1', status: 'Active', deprecated: false, debtTermSeconds: 0, totalSupplyUsd: 9 },
			{ address: 'c', mint: 'M2', status: 'Hidden', deprecated: false, debtTermSeconds: 0, totalSupplyUsd: 99 },
			{ address: 'd', mint: 'M3', status: 'Active', deprecated: false, debtTermSeconds: 86400, totalSupplyUsd: 99 },
		]);
		expect(out.map((r) => r.address)).toEqual(['b']);
	});
});
