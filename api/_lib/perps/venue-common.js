// Pure helpers every perps venue module shares: number coercion, a short TTL
// memo, the book and fill maths and position projection. Nothing here knows
// about a venue's wire format, so a new venue imports these instead of copying
// them from the Phoenix module.

export const num = (v) => {
	if (v == null || v === '') return null;
	const n = typeof v === 'object' && v !== null && 'ui' in v ? Number(v.ui) : Number(v);
	return Number.isFinite(n) ? n : null;
};

export const round = (n, dp = 6) =>
	n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp;

const _memo = new Map();

/** Share one in-flight read and reuse its value for `ttlMs`; a failed refresh keeps the last good value. */
export async function memo(key, ttlMs, fn) {
	const hit = _memo.get(key);
	if (hit && (hit.promise || Date.now() - hit.at < ttlMs)) return hit.promise || hit.value;
	const promise = fn().then(
		(value) => {
			_memo.set(key, { at: Date.now(), value });
			return value;
		},
		(err) => {
			if (hit?.value !== undefined) _memo.set(key, hit);
			else _memo.delete(key);
			throw err;
		},
	);
	_memo.set(key, { ...(hit || {}), promise });
	return promise;
}

/** Pure: venue book levels ([price, size][]) into the interface's book shape. */
export function normalizeBook(raw, depth = 20) {
	const toLevels = (rows) =>
		(Array.isArray(rows) ? rows : [])
			.slice(0, depth)
			.map(([price, size]) => ({ price: Number(price), size: Number(size) }))
			.filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.size > 0);
	const bids = toLevels(raw?.bids);
	const asks = toLevels(raw?.asks);
	const bestBid = bids[0]?.price ?? null;
	const bestAsk = asks[0]?.price ?? null;
	const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk);
	return {
		slot: raw?.slot ?? null,
		bids,
		asks,
		best_bid: bestBid,
		best_ask: bestAsk,
		mid,
		spread_bps:
			bestBid != null && bestAsk != null && mid
				? round(((bestAsk - bestBid) / mid) * 10_000, 2)
				: null,
	};
}

/**
 * Pure: walk one side of a book to fill `size` base units.
 * @param {{price:number,size:number}[]} levels best price first
 */
export function estimateFill(levels, size) {
	let remaining = size;
	let notional = 0;
	let worst = null;
	for (const l of levels) {
		if (remaining <= 0) break;
		const take = Math.min(remaining, l.size);
		notional += take * l.price;
		remaining -= take;
		worst = l.price;
	}
	const filled = size - Math.max(0, remaining);
	return {
		filled: round(filled, 10),
		complete: remaining <= 1e-12,
		avg_price: filled > 0 ? notional / filled : null,
		worst_price: worst,
		notional_usd: notional,
	};
}

/** Pure: the position after trading `delta` base units at `price`, with the PnL realized by any reduction. */
export function projectPosition({ size = 0, entry = 0, delta, price }) {
	const next = size + delta;
	if (size === 0 || Math.sign(size) === Math.sign(delta)) {
		const total = Math.abs(size) + Math.abs(delta);
		return {
			size: next,
			entry: total ? (Math.abs(size) * entry + Math.abs(delta) * price) / total : 0,
			realized_pnl: 0,
		};
	}
	const closing = Math.min(Math.abs(size), Math.abs(delta));
	const realized = closing * (price - entry) * Math.sign(size);
	if (Math.abs(delta) <= Math.abs(size) + 1e-12) {
		return {
			size: Math.abs(next) < 1e-12 ? 0 : next,
			entry: Math.abs(next) < 1e-12 ? 0 : entry,
			realized_pnl: realized,
		};
	}
	return { size: next, entry: price, realized_pnl: realized };
}
