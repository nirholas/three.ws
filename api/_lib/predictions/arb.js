// @ts-check
// No-arbitrage scanner for binary event contracts.
//
// A YES and a NO contract on one market together pay exactly $1 whichever way
// it resolves. When the cheapest YES ask plus the cheapest NO ask, plus every
// fee, is under $1, buying both locks in the difference. Everything here that
// decides what counts as an opportunity (fee models, minimum edge, depth) is
// data read from fee-models.json, never a constant in this file.
//
// The arithmetic is pure and unit-tested (tests/predictions-shadow.test.js).
// `scanVenue` is the only function that does I/O: it reads live markets and
// order books from a venue and never places or builds an order.

import MODELS from './fee-models.json' with { type: 'json' };
import { asksFor } from './book.js';

/** @typedef {import('./book.js').Book} Book */

const round = (n, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp + 0;

export const DEFAULT_MODELS = MODELS;

/**
 * Fee, in dollars, for buying one contract at `price` under one fee model.
 * @param {{kind: string, bps?: number, rate?: number, usd?: number}} model
 * @param {number} price probability in (0, 1)
 */
export function feePerContract(model, price) {
	if (!model) return 0;
	if (model.kind === 'bps_of_notional') return (price * (model.bps || 0)) / 10_000;
	if (model.kind === 'p_one_minus_p') return (model.rate || 0) * price * (1 - price);
	if (model.kind === 'flat_per_contract') return model.usd || 0;
	throw new Error(`unknown fee model kind: ${model.kind}`);
}

/** Total fee per contract bought at `price` on a market from `provider`. */
export function totalFee(models, provider, price) {
	const prov = (models.providers && models.providers[provider]) || models.default_provider;
	return feePerContract(models.venue, price) + feePerContract(prov, price);
}

/**
 * Walk YES and NO asks together, buying one of each per step, while the next
 * pair still clears `minEdge` after fees. Asks are [price, contracts], cheapest
 * first.
 * @param {[number, number][]} yesAsks
 * @param {[number, number][]} noAsks
 * @param {{ models?: typeof MODELS, provider?: string|null, minEdge?: number }} [opts]
 */
export function walkComplement(yesAsks, noAsks, { models = MODELS, provider = null, minEdge = models.thresholds.min_edge_per_contract } = {}) {
	let i = 0;
	let j = 0;
	let yLeft = yesAsks[0] ? yesAsks[0][1] : 0;
	let nLeft = noAsks[0] ? noAsks[0][1] : 0;
	let contracts = 0;
	let cost = 0;
	let fees = 0;
	while (i < yesAsks.length && j < noAsks.length) {
		const py = yesAsks[i][0];
		const pn = noAsks[j][0];
		const fee = totalFee(models, provider, py) + totalFee(models, provider, pn);
		const edge = 1 - py - pn - fee;
		if (edge < minEdge) break;
		const take = Math.min(yLeft, nLeft);
		if (!(take > 0)) break;
		contracts += take;
		cost += take * (py + pn);
		fees += take * fee;
		yLeft -= take;
		nLeft -= take;
		if (yLeft <= 1e-9) {
			i += 1;
			yLeft = yesAsks[i] ? yesAsks[i][1] : 0;
		}
		if (nLeft <= 1e-9) {
			j += 1;
			nLeft = noAsks[j] ? noAsks[j][1] : 0;
		}
	}
	const profit = contracts - cost - fees;
	return {
		contracts: round(contracts, 4),
		cost_usd: round(cost, 4),
		fees_usd: round(fees, 4),
		profit_usd: round(profit, 4),
		edge_pct: cost + fees > 0 ? round((profit / (cost + fees)) * 100, 4) : 0,
	};
}

/**
 * Edge at the top of the book, whether or not it clears the threshold. Negative
 * values are the normal state of an efficient market.
 * @param {Book} book
 * @param {{ models?: typeof MODELS, provider?: string|null }} [opts]
 */
export function topOfBookEdge(book, { models = MODELS, provider = null } = {}) {
	const yes = asksFor(book, 'yes')[0];
	const no = asksFor(book, 'no')[0];
	if (!yes || !no) return null;
	const fee = totalFee(models, provider, yes[0]) + totalFee(models, provider, no[0]);
	const gross = 1 - yes[0] - no[0];
	const edge = gross - fee;
	return {
		yes_ask: yes[0],
		no_ask: no[0],
		yes_size: yes[1],
		no_size: no[1],
		gross_edge: round(gross, 6),
		fees_per_contract: round(fee, 6),
		net_edge: round(edge, 6),
		net_edge_pct: round((edge / (yes[0] + no[0] + fee)) * 100, 4),
	};
}

/**
 * Score one market's book into a scanner row.
 * @param {{ id: string, title: string, provider: string|null, event_id?: string|null, close_time?: string|null }} market
 * @param {Book} book
 * @param {{ models?: typeof MODELS, minEdge?: number, minDepthUsd?: number }} [opts]
 */
export function scoreMarket(market, book, { models = MODELS, minEdge, minDepthUsd } = {}) {
	const th = models.thresholds;
	const edgeFloor = minEdge ?? th.min_edge_per_contract;
	const depthFloor = minDepthUsd ?? th.min_depth_usd;
	const top = topOfBookEdge(book, { models, provider: market.provider });
	if (!top) return null;
	const fill = walkComplement(asksFor(book, 'yes'), asksFor(book, 'no'), { models, provider: market.provider, minEdge: edgeFloor });
	const executable = fill.contracts > 0 && fill.cost_usd >= depthFloor && fill.edge_pct >= th.min_edge_pct;
	return {
		market_id: market.id,
		event_id: market.event_id || null,
		title: market.title,
		provider: market.provider,
		close_time: market.close_time || null,
		...top,
		fill,
		executable,
	};
}

/** Rank: executable first, then by net edge, best first. */
export function rankRows(rows) {
	return [...rows].sort((a, b) => Number(b.executable) - Number(a.executable) || b.net_edge - a.net_edge);
}

async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const idx = next++;
			out[idx] = await fn(items[idx], idx);
		}
	});
	await Promise.all(workers);
	return out;
}

/**
 * Scan a venue's most active open markets. Reads only. Candidates are the most
 * active markets whose listed YES+NO ask sum is inside the data-defined window;
 * their order books are fetched and scored.
 * @param {{ listEvents: Function, getOrderbook: Function, id: string }} venue
 * @param {{ models?: typeof MODELS, limit?: number }} [opts]
 */
export async function scanVenue(venue, { models = MODELS, limit = 20 } = {}) {
	const th = models.thresholds;
	const pageSize = 25;
	const markets = [];
	for (let start = 0; markets.length < th.max_markets_scanned && start < 100; start += pageSize) {
		const page = await venue.listEvents({ sort: 'volume_24h', start, limit: pageSize });
		for (const ev of page.events || []) {
			for (const m of ev.markets || []) {
				if (m.tradable) markets.push({ ...m, event_title: ev.title });
			}
		}
		if (!page.has_more) break;
	}
	const priced = markets
		.map((m) => {
			const y = m.outcomes.find((o) => o.side === 'yes')?.buy_price;
			const n = m.outcomes.find((o) => o.side === 'no')?.buy_price;
			return { m, sum: y != null && n != null ? y + n : null };
		})
		.filter((x) => x.sum != null && x.sum >= th.candidate_sum_min && x.sum <= th.candidate_sum_max)
		.slice(0, th.max_books_fetched);

	const rows = (
		await mapLimit(priced, 6, async ({ m }) => {
			const book = await venue.getOrderbook(m.id).catch(() => null);
			return book ? scoreMarket(m, book, { models }) : null;
		})
	).filter(Boolean);

	return {
		venue: venue.id,
		scanned_markets: markets.length,
		books_read: rows.length,
		scanned_at: new Date().toISOString(),
		thresholds: th,
		opportunities: rankRows(rows).slice(0, limit),
	};
}
