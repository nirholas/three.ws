// Pure order sizing for the Robinhood Crypto connector. No I/O.
//
// Robinhood publishes, per trading pair, the smallest quantity step
// (asset_increment), the minimum and maximum order size and whether the pair is
// tradable. An order whose quantity is off-step or out of range is rejected by
// Robinhood, so we size and validate before we ever show a preview.
//
// Quantities and prices arrive as decimal strings. Arithmetic runs on BigInt
// fixed point (18 decimals) so "spend $10" floors to the exact step instead of
// drifting on float rounding.

const SCALE = 18;
const ONE = 10n ** BigInt(SCALE);
const DECIMAL_RE = /^\d+(\.\d+)?$/;

export class SizingError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'SizingError';
		this.code = code;
	}
}

/** Decimal string (or finite number) to an 18-decimal BigInt. */
export function toFixed18(value) {
	const s = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(SCALE) : '') : String(value ?? '').trim();
	if (!DECIMAL_RE.test(s)) throw new SizingError('bad_number', `${value} is not a decimal number.`);
	const [whole, frac = ''] = s.split('.');
	return BigInt(whole) * ONE + BigInt((frac + '0'.repeat(SCALE)).slice(0, SCALE));
}

/** 18-decimal BigInt back to a trimmed decimal string. */
export function fromFixed18(v) {
	const whole = v / ONE;
	const frac = (v % ONE).toString().padStart(SCALE, '0').replace(/0+$/, '');
	return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Floor a quantity down to a whole number of steps. */
export function floorToStep(qty18, step18) {
	if (step18 <= 0n) return qty18;
	return (qty18 / step18) * step18;
}

/**
 * Size one order against its trading pair.
 *
 * Exactly one of `quantity` (asset units) or `amountUsd` (spend this many
 * dollars, rounded down to the pair's step) must be given.
 *
 * @param {{ quantity?: string|number, amountUsd?: string|number, priceUsd: string|number,
 *           pair: { asset_increment?: string, min_order_size?: string, max_order_size?: string, status?: string } }} input
 * @returns {{ quantity: string }}
 */
export function sizeOrder({ quantity, amountUsd, priceUsd, pair }) {
	if (!pair) throw new SizingError('pair_unknown', 'Robinhood does not list this pair for crypto trading.');
	if (pair.status && pair.status !== 'tradable') throw new SizingError('pair_not_tradable', `This pair is ${pair.status} on Robinhood right now.`);
	const hasQty = quantity !== undefined && quantity !== null && quantity !== '';
	const hasUsd = amountUsd !== undefined && amountUsd !== null && amountUsd !== '';
	if (hasQty === hasUsd) throw new SizingError('bad_request', 'Give either quantity (asset units) or amount_usd, not both.');

	const step = pair.asset_increment ? toFixed18(pair.asset_increment) : 0n;
	let qty;
	if (hasQty) {
		qty = toFixed18(quantity);
		if (step > 0n && qty % step !== 0n) {
			throw new SizingError('bad_quantity', `Quantity must be a multiple of ${pair.asset_increment}.`);
		}
	} else {
		const price = toFixed18(priceUsd);
		if (price <= 0n) throw new SizingError('unpriced', 'Robinhood returned no price for this pair.');
		qty = floorToStep((toFixed18(amountUsd) * ONE) / price, step);
	}
	if (qty <= 0n) throw new SizingError('bad_quantity', 'That amount is smaller than one quantity step for this pair.');
	if (pair.min_order_size && qty < toFixed18(pair.min_order_size)) {
		throw new SizingError('below_minimum', `The minimum order for this pair is ${pair.min_order_size}.`);
	}
	if (pair.max_order_size && qty > toFixed18(pair.max_order_size)) {
		throw new SizingError('above_maximum', `The maximum order for this pair is ${pair.max_order_size}.`);
	}
	return { quantity: fromFixed18(qty) };
}

/**
 * The dollar value an order is checked against. A limit order is valued at its
 * limit (the most a buy can spend); a market order at the live estimate.
 * Rounded UP to the cent, so a cap is never under-counted.
 */
export function notionalUsd({ type, quantity, limitPrice, priceUsd }) {
	const qty = toFixed18(quantity);
	const price = toFixed18(type === 'limit' ? limitPrice : priceUsd);
	const value = (qty * price) / ONE;
	const cent = ONE / 100n;
	const cents = (value + cent - 1n) / cent;
	return Number(cents) / 100;
}
