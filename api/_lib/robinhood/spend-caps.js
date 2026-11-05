// Pure spend-cap rules for the Robinhood Crypto connector. No I/O: service.js
// supplies the amount already reserved today and writes the ledger; this module
// only decides. Caps bound BUY orders (money leaving the owner's buying power).
// Sells reduce exposure and are not capped, but still need an explicit confirm.

export const HARD_PER_ORDER_MAX_USD = 10_000;
export const HARD_DAILY_MAX_USD = 50_000;
export const DEFAULT_PER_ORDER_CAP_USD = 25;
export const DEFAULT_DAILY_CAP_USD = 100;

const cents = (n) => Math.round(Number(n) * 100) / 100;

/** Validate owner-supplied caps. Returns { ok, perOrder, daily } or { ok: false, message }. */
export function parseCaps({ per_order_cap_usd, daily_cap_usd }) {
	const perOrder = Number(per_order_cap_usd ?? DEFAULT_PER_ORDER_CAP_USD);
	const daily = Number(daily_cap_usd ?? DEFAULT_DAILY_CAP_USD);
	if (!Number.isFinite(perOrder) || perOrder <= 0 || perOrder > HARD_PER_ORDER_MAX_USD) {
		return { ok: false, message: `The per-order cap must be between $0.01 and $${HARD_PER_ORDER_MAX_USD}.` };
	}
	if (!Number.isFinite(daily) || daily <= 0 || daily > HARD_DAILY_MAX_USD) {
		return { ok: false, message: `The daily cap must be between $0.01 and $${HARD_DAILY_MAX_USD}.` };
	}
	if (perOrder > daily) return { ok: false, message: 'The per-order cap cannot exceed the daily cap.' };
	return { ok: true, perOrder: cents(perOrder), daily: cents(daily) };
}

/**
 * Decide whether an order may proceed.
 * @returns {{ ok: true, remainingAfterUsd: number | null } | { ok: false, code: 'over_per_order_cap' | 'over_daily_cap', message: string }}
 */
export function checkOrder({ side, notionalUsd, perOrderCapUsd, dailyCapUsd, spentTodayUsd }) {
	if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
		return { ok: false, code: 'over_per_order_cap', message: 'The order value could not be priced, so it cannot be checked against your cap.' };
	}
	if (side === 'sell') return { ok: true, remainingAfterUsd: null };
	if (notionalUsd > perOrderCapUsd) {
		return { ok: false, code: 'over_per_order_cap', message: `This order is about $${cents(notionalUsd).toFixed(2)}, above your $${cents(perOrderCapUsd).toFixed(2)} per-order cap.` };
	}
	const remaining = cents(dailyCapUsd - spentTodayUsd);
	if (notionalUsd > remaining) {
		return { ok: false, code: 'over_daily_cap', message: `This order is about $${cents(notionalUsd).toFixed(2)} but only $${Math.max(remaining, 0).toFixed(2)} is left of your $${cents(dailyCapUsd).toFixed(2)} daily cap.` };
	}
	return { ok: true, remainingAfterUsd: cents(remaining - notionalUsd) };
}
