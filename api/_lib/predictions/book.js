// @ts-check
// Pure order-book math for binary event contracts. No I/O: every function is
// deterministic in its inputs so fills, slippage and depth are unit-tested
// against books recorded from the live venue (tests/predictions-book.test.js).
//
// A book is { yes_bids, no_bids }, each a list of [price, contracts] with price
// a probability in (0, 1), best (highest) first. A contract pays $1 if its side
// wins, so buying YES at p is the same trade as selling NO at 1 - p: the asks
// for one side are the other side's bids, mirrored.

/** @typedef {[number, number]} Level */
/** @typedef {{ yes_bids: Level[], no_bids: Level[] }} Book */
/** @typedef {'yes'|'no'} Side */

const EPS = 1e-9;
const round = (n, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Asks for `side`, cheapest first. */
export function asksFor(/** @type {Book} */ book, /** @type {Side} */ side) {
	const opposite = side === 'yes' ? book.no_bids : book.yes_bids;
	return (opposite || [])
		.map(([p, q]) => /** @type {Level} */ ([round(1 - p, 4), q]))
		.sort((a, b) => a[0] - b[0]);
}

/** Bids for `side`, richest first. */
export function bidsFor(/** @type {Book} */ book, /** @type {Side} */ side) {
	return [...((side === 'yes' ? book.yes_bids : book.no_bids) || [])].sort((a, b) => b[0] - a[0]);
}

/**
 * Walk the asks with a USD budget, never paying above `maxPrice`.
 * @param {Level[]} asks cheapest first
 * @param {number} stakeUsd
 * @param {number} maxPrice
 */
export function estimateBuy(asks, stakeUsd, maxPrice) {
	let remaining = stakeUsd;
	let contracts = 0;
	let spent = 0;
	let worst = null;
	for (const [price, qty] of asks) {
		if (remaining <= EPS) break;
		if (price > maxPrice + EPS) break;
		const levelCost = price * qty;
		if (levelCost >= remaining - EPS) {
			contracts += remaining / price;
			spent += remaining;
			remaining = 0;
			worst = price;
			break;
		}
		contracts += qty;
		spent += levelCost;
		remaining -= levelCost;
		worst = price;
	}
	const best = asks.length ? asks[0][0] : null;
	const avg = contracts > 0 ? spent / contracts : null;
	return {
		contracts: round(contracts, 4),
		spent_usd: round(spent, 4),
		unfilled_usd: round(Math.max(0, remaining), 4),
		filled_fully: remaining <= 1e-6,
		best_price: best,
		avg_price: avg != null ? round(avg, 4) : null,
		worst_price: worst,
		slippage_bps: avg != null && best ? Math.max(0, Math.round(((avg - best) / best) * 10_000)) : null,
		payout_usd: round(contracts, 4),
		max_profit_usd: round(contracts - spent, 4),
	};
}

/**
 * Walk the bids selling `contracts`, never accepting below `minPrice`.
 * @param {Level[]} bids richest first
 * @param {number} contracts
 * @param {number} minPrice
 */
export function estimateSell(bids, contracts, minPrice) {
	let remaining = contracts;
	let proceeds = 0;
	let sold = 0;
	let worst = null;
	for (const [price, qty] of bids) {
		if (remaining <= EPS) break;
		if (price < minPrice - EPS) break;
		const take = Math.min(qty, remaining);
		proceeds += take * price;
		sold += take;
		remaining -= take;
		worst = price;
	}
	const best = bids.length ? bids[0][0] : null;
	const avg = sold > 0 ? proceeds / sold : null;
	return {
		contracts_sold: round(sold, 4),
		unfilled_contracts: round(Math.max(0, remaining), 4),
		filled_fully: remaining <= 1e-6,
		proceeds_usd: round(proceeds, 4),
		best_price: best,
		avg_price: avg != null ? round(avg, 4) : null,
		worst_price: worst,
		slippage_bps: avg != null && best ? Math.max(0, Math.round(((best - avg) / best) * 10_000)) : null,
	};
}

/**
 * USD resting within `band` (probability points) of the best level. For bids
 * that is dollars a seller can hit; for asks, dollars a buyer can lift.
 * @param {Level[]} levels best first
 * @param {number} [band]
 */
export function depthUsd(levels, band = 0.05) {
	if (!levels.length) return 0;
	const best = levels[0][0];
	let total = 0;
	for (const [p, q] of levels) {
		if (Math.abs(p - best) > band + EPS) break;
		total += p * q;
	}
	return round(total, 2);
}

/** A compact summary of both sides for display: best prices, spread, depth. */
export function summarizeBook(/** @type {Book} */ book) {
	const out = {};
	for (const side of /** @type {Side[]} */ (['yes', 'no'])) {
		const asks = asksFor(book, side);
		const bids = bidsFor(book, side);
		out[side] = {
			best_ask: asks[0]?.[0] ?? null,
			best_bid: bids[0]?.[0] ?? null,
			ask_depth_usd: depthUsd(asks),
			bid_depth_usd: depthUsd(bids),
			levels: {
				asks: asks.slice(0, 8),
				bids: bids.slice(0, 8),
			},
		};
	}
	const yesAsk = out.yes.best_ask;
	const yesBid = out.yes.best_bid;
	return {
		...out,
		spread: yesAsk != null && yesBid != null ? round(Math.max(0, yesAsk - yesBid), 4) : null,
		liquidity_usd: round(out.yes.ask_depth_usd + out.yes.bid_depth_usd, 2),
	};
}
