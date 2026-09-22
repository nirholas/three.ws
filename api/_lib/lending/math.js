// Pure lending math: amounts, projections, withdraw validation, interest
// accounting, health factor and the earn-rule planner. No I/O and no SDK, so
// every number a preview or a rule shows is covered by unit tests against
// recorded mainnet values (tests/lending-math.test.js).

import { LendingError } from './errors.js';

export const U64_MAX = 18446744073709551615n;
const DAYS_PER_YEAR = 365;

/**
 * Parse a user-entered token amount into base units.
 * Accepts a decimal string or number ("25", "0.5", 12.25). Refuses more
 * fractional digits than the token has, zero, negatives and junk.
 * @returns {bigint}
 */
export function parseAmount(input, decimals, { name = 'amount' } = {}) {
	const raw = typeof input === 'number' ? (Number.isFinite(input) ? input.toString() : '') : String(input ?? '').trim();
	// A number like 1e-7 stringifies in exponent form; normalize it.
	const text = /e/i.test(raw) && typeof input === 'number' ? input.toFixed(decimals) : raw;
	const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
	if (!m) throw new LendingError('invalid_amount', `${name} must be a positive decimal number, e.g. "25" or "0.5".`, 400, { parameter: name });
	const [, whole, frac = ''] = m;
	const trimmed = frac.replace(/0+$/, '');
	if (trimmed.length > decimals) {
		throw new LendingError('invalid_amount', `${name} has more than ${decimals} decimal places, the most this token supports.`, 400, { parameter: name, decimals });
	}
	const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((trimmed || '0').padEnd(decimals, '0'));
	if (value <= 0n) throw new LendingError('invalid_amount', `${name} must be greater than zero.`, 400, { parameter: name });
	if (value >= U64_MAX) throw new LendingError('invalid_amount', `${name} is too large.`, 400, { parameter: name });
	return value;
}

/** Base units → exact decimal string ("1.500000" → "1.5"). */
export function formatRaw(raw, decimals) {
	const v = BigInt(raw);
	const neg = v < 0n;
	const abs = neg ? -v : v;
	const base = 10n ** BigInt(decimals);
	const whole = abs / base;
	const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
	return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Base units → float, for display math only (never for amounts sent on chain). */
export function rawToUi(raw, decimals) {
	return Number(formatRaw(raw, decimals));
}

/** Round a USD figure to cents for display. */
export function usd(n) {
	return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Interest a supplied amount earns at a compounding annual yield.
 * `apy` is a fraction (0.0395 = 3.95%).
 */
export function projectInterest(amountUi, apy) {
	const a = Number(amountUi);
	const y = Number(apy);
	if (!(a > 0) || !Number.isFinite(y) || y < 0) return { per_day: 0, per_month: 0, per_year: 0 };
	const daily = (1 + y) ** (1 / DAYS_PER_YEAR) - 1;
	return {
		per_day: a * daily,
		per_month: a * ((1 + daily) ** 30 - 1),
		per_year: a * y,
	};
}

/**
 * Validate a withdraw request against the live position before anything is
 * built. `all` withdraws the full position including interest accrued up to
 * the slot the transaction lands in.
 * @returns {{ amountRaw: bigint, all: boolean }}
 */
export function checkWithdraw({ requestedRaw, suppliedRaw, all = false, decimals, symbol }) {
	const supplied = BigInt(suppliedRaw ?? 0);
	if (supplied <= 0n) {
		throw new LendingError('no_position', `This agent has no ${symbol} supplied, so there is nothing to withdraw.`, 422, { supplied: '0' });
	}
	if (all) return { amountRaw: U64_MAX, all: true };
	const req = BigInt(requestedRaw);
	if (req > supplied) {
		throw new LendingError(
			'exceeds_position',
			`That withdraws ${formatRaw(req, decimals)} ${symbol}, but the position holds ${formatRaw(supplied, decimals)} ${symbol}. Withdraw at most that, or pass all: true to withdraw everything.`,
			422,
			{ requested: formatRaw(req, decimals), supplied: formatRaw(supplied, decimals), symbol },
		);
	}
	// A request within a hair of the whole position is a full exit: withdrawing
	// the exact snapshot amount would strand the interest that accrues between
	// the read and the slot the transaction lands in.
	if (supplied - req <= supplied / 100_000n) return { amountRaw: U64_MAX, all: true };
	return { amountRaw: req, all: false };
}

/**
 * Health factor of an obligation: the borrow value at which it becomes
 * liquidatable divided by its (borrow-factor adjusted) debt. Above 1 is safe;
 * null means there is no debt, so liquidation is impossible.
 */
export function healthFactor({ unhealthyBorrowValue, borrowedValueAdjusted }) {
	const debt = Number(borrowedValueAdjusted);
	if (!(debt > 0)) return null;
	const limit = Number(unhealthyBorrowValue);
	return Number.isFinite(limit) ? limit / debt : null;
}

/**
 * Interest earned on one token: what the position is worth now minus what the
 * ledger says went in net of what came out. Ledger amounts are base units.
 * A full withdraw carries its landed amount in `amountRaw` (the ledger records
 * the settled token delta, not the U64_MAX sentinel).
 */
export function interestEarned({ currentRaw, events }) {
	let net = 0n;
	let realized = 0n;
	for (const e of events || []) {
		const amt = BigInt(e.amountRaw ?? 0);
		if (e.kind === 'deposit') net += amt;
		else if (e.kind === 'withdraw') {
			net -= amt;
			// Interest realized by a withdraw that took out more than was left in.
			if (net < 0n) {
				realized += -net;
				net = 0n;
			}
		}
	}
	const unrealized = BigInt(currentRaw ?? 0) - net;
	return {
		net_deposited_raw: net,
		unrealized_raw: unrealized > 0n ? unrealized : 0n,
		realized_raw: realized,
		total_raw: (unrealized > 0n ? unrealized : 0n) + realized,
	};
}

/**
 * The earn rule planner. Given the wallet's liquid balance and the lending
 * position for one token, decide what one execution of the rule should do.
 *
 *   deposit_idle    keep `reserveRaw` liquid, supply everything above it
 *   withdraw_below  when liquid falls under `floorRaw`, withdraw enough to
 *                   bring it back to `floorRaw` (bounded by the position)
 *
 * `minMoveRaw` suppresses dust moves that would cost more in fees than they
 * earn. `feeHeadroomRaw` (SOL only) is left untouched for network fees.
 * @returns {{ action: 'deposit'|'withdraw'|'none', amountRaw: bigint, all?: boolean, reason: string }}
 */
export function planEarn({ mode, balanceRaw, suppliedRaw, reserveRaw = 0n, floorRaw = 0n, minMoveRaw = 0n, feeHeadroomRaw = 0n }) {
	const bal = BigInt(balanceRaw);
	const sup = BigInt(suppliedRaw);
	if (mode === 'deposit_idle') {
		const keep = BigInt(reserveRaw) + BigInt(feeHeadroomRaw);
		const idle = bal - keep;
		if (idle <= 0n) return { action: 'none', amountRaw: 0n, reason: 'balance is at or below the reserve to keep' };
		if (idle < BigInt(minMoveRaw)) return { action: 'none', amountRaw: 0n, reason: 'idle amount is below the minimum move' };
		return { action: 'deposit', amountRaw: idle, reason: 'supply the balance above the reserve' };
	}
	if (mode === 'withdraw_below') {
		const floor = BigInt(floorRaw);
		if (bal >= floor) return { action: 'none', amountRaw: 0n, reason: 'balance is at or above the floor' };
		if (sup <= 0n) return { action: 'none', amountRaw: 0n, reason: 'no lending position to draw from' };
		const need = floor - bal;
		if (need < BigInt(minMoveRaw)) return { action: 'none', amountRaw: 0n, reason: 'shortfall is below the minimum move' };
		if (need >= sup) return { action: 'withdraw', amountRaw: sup, all: true, reason: 'withdraw the whole position to cover the shortfall' };
		return { action: 'withdraw', amountRaw: need, all: false, reason: 'withdraw the shortfall back to the floor' };
	}
	throw new LendingError('invalid_mode', 'mode must be deposit_idle or withdraw_below.', 400);
}

/**
 * Pick the one reserve per token a user should supply to: active, not retired
 * from the venue's own UI, open-term (no fixed debt maturity), and the deepest
 * by total supply when a market lists several reserves for the same mint.
 * @param {Array<{ address: string, mint: string, status: string, deprecated: boolean, debtTermSeconds: number, totalSupplyUsd: number }>} reserves
 */
export function selectCanonicalReserves(reserves) {
	const best = new Map();
	for (const r of reserves) {
		if (r.status !== 'Active' || r.deprecated || Number(r.debtTermSeconds) > 0) continue;
		const prev = best.get(r.mint);
		if (!prev || Number(r.totalSupplyUsd) > Number(prev.totalSupplyUsd)) best.set(r.mint, r);
	}
	return [...best.values()].sort((a, b) => Number(b.totalSupplyUsd) - Number(a.totalSupplyUsd));
}
