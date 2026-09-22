// Solana prediction venue: event contracts settled in USDC on Solana.
//
// The venue runs an on-chain program that holds each trader's positions as
// program accounts on Solana, escrows USDC for open orders, and pays winning
// contracts $1 each at resolution. Liquidity comes from two external event
// order books that the venue's keepers fill against, which is why a market's
// `provider` field names one of them: that is the book the order is filled on
// and the source that resolves it.
//
// This module is the only file that knows the venue's wire format. Everything
// it returns is normalized into the venue-agnostic shapes documented in
// api/_lib/predictions/index.js, so a second venue is one added file.
//
// Reads (events, markets, order books, positions, history) are public and need
// no key. Order building answers `unsupported_region` for requests from
// jurisdictions the venue does not serve; that answer is surfaced verbatim as
// a designed state (VenueError code `venue_region_unavailable`), never retried
// from somewhere else.

import { fetchAnyJson, fetchUpstreamJson, UpstreamError } from '../upstream-fetch.js';
import { createCache, cached } from '../mem-cache.js';

export const VENUE_ID = 'solana';
export const VENUE_LABEL = 'Solana event contracts';
export const SETTLEMENT_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Three hosts serve the same API; the chain fails over in order. An operator
// can replace the list with PREDICTIONS_API_BASES (comma separated).
const DEFAULT_BASES = [
	'https://prediction-market-api.jup.ag/api/v1',
	'https://api.jup.ag/prediction/v1',
	'https://lite-api.jup.ag/prediction/v1',
];

const POLY_HISTORY = 'https://clob.polymarket.com/prices-history';
const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';

const MICRO = 1_000_000;
const READ_TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 15_000;

const cache = createCache({ max: 800, ttlMs: 20_000 });
const slowCache = createCache({ max: 400, ttlMs: 5 * 60_000 });

export class VenueError extends Error {
	constructor(code, message, { status = 502, detail = null } = {}) {
		super(message);
		this.name = 'VenueError';
		this.code = code;
		this.status = status;
		this.detail = detail;
	}
}

function bases() {
	const raw = process.env.PREDICTIONS_API_BASES;
	if (raw && raw.trim()) return raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
	return DEFAULT_BASES;
}

function qs(params) {
	const u = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null || v === '') continue;
		u.set(k, String(v));
	}
	const s = u.toString();
	return s ? `?${s}` : '';
}

async function read(path, params = {}) {
	const urls = bases().map((b) => `${b}${path}${qs(params)}`);
	try {
		const { value } = await fetchAnyJson(urls, {}, { name: 'predictions-venue', timeoutMs: READ_TIMEOUT_MS, label: 'predictions venue' });
		return value;
	} catch (err) {
		const status = err?.cause?.status ?? err?.status;
		if (status === 404) throw new VenueError('not_found', 'The venue has no record of that id.', { status: 404 });
		throw new VenueError('venue_unavailable', 'The prediction venue did not answer. Try again in a moment.', { status: 503 });
	}
}

// Writes go to one host at a time: a transaction built by one host is submitted
// through the same family, and a 4xx is an answer, not an outage, so it is
// never retried on the next host.
async function write(path, { method = 'POST', body } = {}) {
	let lastErr;
	for (const base of bases()) {
		try {
			const res = await fetch(`${base}${path}`, {
				method,
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: body == null ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
			});
			const text = await res.text();
			let data = null;
			try { data = text ? JSON.parse(text) : null; } catch { data = null; }
			if (res.ok && data) return data;
			if (res.status >= 400 && res.status < 500) throw venueRefusal(res.status, data, text);
			lastErr = new VenueError('venue_unavailable', `The venue answered ${res.status}.`, { status: 503 });
		} catch (err) {
			if (err instanceof VenueError && err.code !== 'venue_unavailable') throw err;
			lastErr = err instanceof VenueError ? err : new VenueError('venue_unavailable', 'The prediction venue did not answer. Try again in a moment.', { status: 503 });
		}
	}
	throw lastErr;
}

function venueRefusal(status, data, text) {
	const code = data?.code || data?.error?.code || null;
	const message = data?.message || data?.error?.message || (typeof data?.error === 'string' ? data.error : null) || text?.slice(0, 200) || `HTTP ${status}`;
	if (code === 'unsupported_region') {
		return new VenueError(
			'venue_region_unavailable',
			'The venue does not accept orders from the region this server runs in. Browsing, research and watches keep working; orders cannot be placed from here.',
			{ status: 451, detail: { venue_code: code } },
		);
	}
	if (code === 'INSUFFICIENT_FUNDS' || /insufficient/i.test(message)) {
		return new VenueError('insufficient_funds', 'The agent wallet does not hold enough USDC for this order.', { status: 409, detail: { venue_code: code } });
	}
	return new VenueError('venue_rejected', `The venue rejected the request: ${message}`, { status: 422, detail: { venue_code: code } });
}

// ── Normalizers ──────────────────────────────────────────────────────────────

const usd = (micro) => {
	const n = Number(micro);
	return Number.isFinite(n) ? n / MICRO : null;
};
const prob = (micro) => {
	const n = Number(micro);
	return Number.isFinite(n) && n > 0 ? Math.round((n / MICRO) * 10_000) / 10_000 : null;
};
const iso = (v) => {
	if (v == null || v === '') return null;
	const n = Number(v);
	const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
	return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

function sideLabels(m) {
	const opts = Array.isArray(m.marketOptions) ? m.marketOptions : [];
	const yes = opts.find((o) => o.buyYes === true)?.label;
	const no = opts.find((o) => o.buyYes === false)?.label;
	const outcomes = Array.isArray(m.outcomes) ? m.outcomes : [];
	return { yes: yes || outcomes[0] || 'Yes', no: no || outcomes[1] || 'No' };
}

/** @returns {import('./index.js').PredictionMarket} */
export function normalizeMarket(m, event = null) {
	const p = m.pricing || {};
	const buyYes = prob(p.buyYesPriceUsd);
	const sellYes = prob(p.sellYesPriceUsd);
	const buyNo = prob(p.buyNoPriceUsd);
	const sellNo = prob(p.sellNoPriceUsd);
	const labels = sideLabels(m);
	const mid = buyYes != null && sellYes != null ? (buyYes + sellYes) / 2 : buyYes ?? sellYes ?? (buyNo != null ? 1 - buyNo : null);
	const spread = buyYes != null && sellYes != null ? Math.round(Math.max(0, buyYes - sellYes) * 10_000) / 10_000 : null;
	const series = event?.metadata?.series || null;
	return {
		id: m.marketId,
		event_id: m.eventId || event?.eventId || null,
		venue: VENUE_ID,
		provider: m.provider || null,
		title: m.title || '',
		status: m.status || null,
		result: m.result || null,
		tradable: m.status === 'open',
		open_time: iso(m.openTime),
		close_time: iso(m.closeTime),
		resolve_at: iso(m.resolveAt),
		probability: mid != null ? Math.round(mid * 10_000) / 10_000 : null,
		spread,
		volume_contracts: Number.isFinite(Number(p.volume)) ? Number(p.volume) : null,
		outcomes: [
			{ side: 'yes', label: labels.yes, buy_price: buyYes, sell_price: sellYes },
			{ side: 'no', label: labels.no, buy_price: buyNo, sell_price: sellNo },
		],
		rules: m.rulesPrimary || null,
		rules_secondary: m.rulesSecondary || null,
		image_url: m.imageUrl || m.team?.imageUrl || null,
		history_ref: historyRef(m, series),
	};
}

function historyRef(m, series) {
	if (m.provider === 'polymarket' && Array.isArray(m.clobTokenIds) && m.clobTokenIds[0]) {
		return { source: 'polymarket', token: String(m.clobTokenIds[0]) };
	}
	if (m.provider === 'kalshi' && series && m.marketId) {
		return { source: 'kalshi', series: String(series), ticker: String(m.marketId) };
	}
	return null;
}

/** @returns {import('./index.js').PredictionEvent} */
export function normalizeEvent(e) {
	const md = e.metadata || {};
	const markets = Array.isArray(e.markets) ? e.markets.map((m) => normalizeMarket(m, e)) : [];
	// Lead with the most likely open outcome, the way a reader scans a board.
	markets.sort((a, b) => (b.tradable - a.tradable) || ((b.probability ?? -1) - (a.probability ?? -1)));
	const provider = markets[0]?.provider || (md.series === 'polymarket' ? 'polymarket' : md.series ? 'kalshi' : null);
	return {
		id: e.eventId,
		venue: VENUE_ID,
		provider,
		title: md.title || e.eventId,
		subtitle: md.subtitle || null,
		category: e.category || null,
		subcategory: e.subcategory || null,
		tags: Array.isArray(e.tags) ? e.tags.filter((t) => !/^earn-\d+$/.test(t)).slice(0, 8) : [],
		image_url: md.imageUrl || null,
		is_active: e.isActive !== false,
		is_live: !!(e.isLive || md.isLive),
		begin_at: iso(e.beginAt),
		close_time: iso(md.closeTime),
		volume_usd: usd(e.volumeUsd),
		volume_24h_usd: usd(e.volume24hr),
		resolution: {
			condition: e.closeCondition || md.earlyCloseCondition || null,
			rules_pdf: e.rulesPdf || md.rulesPdf || null,
			source: provider,
		},
		market_count: markets.length,
		markets,
	};
}

/** @returns {import('./index.js').PredictionPosition} */
export function normalizePosition(p) {
	const mm = p.marketMetadata || {};
	const em = p.eventMetadata || {};
	const labels = sideLabels({ marketOptions: mm.marketOptions, outcomes: null });
	const side = p.isYes ? 'yes' : 'no';
	const settled = mm.status === 'closed' || mm.status === 'settled' || mm.lifecycleStatus === 'settled' || !!mm.result;
	const won = settled && mm.result ? (mm.result === 'yes') === !!p.isYes : null;
	return {
		id: p.pubkey,
		venue: VENUE_ID,
		market_id: p.marketId,
		event_id: p.eventId || em.eventId || null,
		event_title: em.title || null,
		market_title: mm.title || null,
		side,
		side_label: side === 'yes' ? labels.yes : labels.no === 'No' && labels.yes !== 'Yes' ? `Not ${labels.yes}` : labels.no,
		contracts: Number(p.contractsDecimal ?? p.contracts ?? 0),
		cost_usd: usd(p.totalCostUsd ?? p.sizeUsd),
		avg_price: prob(p.avgPriceUsd),
		mark_price: prob(p.markPriceUsd),
		exit_price: prob(p.sellPriceUsd),
		value_usd: usd(p.valueUsd),
		pnl_usd: usd(p.pnlUsd),
		pnl_pct: Number.isFinite(Number(p.pnlUsdPercent)) ? Number(p.pnlUsdPercent) : null,
		pnl_after_fees_usd: usd(p.pnlUsdAfterFees),
		realized_pnl_usd: usd(p.realizedPnlUsd),
		fees_paid_usd: usd(p.feesPaidUsd),
		open_orders: Number(p.openOrders || 0),
		status: settled ? (p.claimed ? 'redeemed' : won === false ? 'lost' : 'settled') : 'open',
		result: mm.result || null,
		won,
		claimable: !!p.claimable && !p.claimed,
		claimed: !!p.claimed,
		claimed_usd: usd(p.claimedUsd),
		payout_usd: usd(p.payoutUsd),
		max_slippage_bps: p.maxSlippageBps ?? null,
		opened_at: iso(p.openedAt),
		updated_at: iso(p.updatedAt),
		close_time: iso(mm.closeTime ?? em.closeTime),
		image_url: em.imageUrl || mm.team?.imageUrl || null,
		provider: mm.provider || null,
	};
}

/**
 * The venue's order book lists resting bids per side as [cents, contracts].
 * Return both sides aggregated per price level as probabilities, best first.
 */
export function normalizeOrderbook(raw) {
	const agg = (levels) => {
		const m = new Map();
		for (const lvl of Array.isArray(levels) ? levels : []) {
			const cents = Number(lvl?.[0]);
			const qty = Number(lvl?.[1]);
			if (!Number.isFinite(cents) || !Number.isFinite(qty) || cents <= 0 || cents >= 100 || qty <= 0) continue;
			m.set(cents, (m.get(cents) || 0) + qty);
		}
		return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([c, q]) => [c / 100, Math.round(q * 100) / 100]);
	};
	return { yes_bids: agg(raw?.yes), no_bids: agg(raw?.no) };
}

// ── Reads ────────────────────────────────────────────────────────────────────

const SORTS = { volume: 'volume', volume_24h: 'volume24hr', close: 'closeTime', new: 'beginAt' };

export async function listEvents({ q = '', category = null, subcategory = null, sort = 'volume', start = 0, limit = 24, includeClosed = false } = {}) {
	const lim = Math.min(50, Math.max(1, Number(limit) || 24));
	const st = Math.max(0, Number(start) || 0);
	if (q && q.trim()) {
		const key = `search:${q}:${st}:${lim}`;
		const raw = await cached(cache, key, () => read('/events/search', { query: q.trim().slice(0, 120), includeMarkets: true, start: st, end: st + lim }));
		const events = (raw?.data || []).map(normalizeEvent);
		return { events, total: raw?.pagination?.total ?? events.length, start: st, has_more: !!raw?.pagination?.hasNext };
	}
	const sortBy = SORTS[sort] || 'volume';
	const key = `events:${category}:${subcategory}:${sortBy}:${st}:${lim}:${includeClosed}`;
	const raw = await cached(cache, key, () => read('/events', {
		includeMarkets: true,
		includeCount: true,
		start: st,
		end: st + lim,
		category: category || undefined,
		subcategory: subcategory || undefined,
		sortBy,
		sortDirection: sort === 'close' ? 'asc' : 'desc',
		includeClosed: includeClosed ? true : undefined,
	}));
	const events = (raw?.data || []).map(normalizeEvent);
	return { events, total: raw?.pagination?.total ?? events.length, start: st, has_more: !!raw?.pagination?.hasNext };
}

export async function listCategories() {
	const raw = await cached(slowCache, 'categories', () => read('/events/categories'));
	return (raw?.data || []).map((c) => ({
		id: c.category,
		label: c.category ? c.category.charAt(0).toUpperCase() + c.category.slice(1) : '',
		event_count: Number(c.eventCount || 0),
		subcategories: (c.subcategories || []).map((s) => ({ id: s.subcategory, label: s.label || s.subcategory, event_count: Number(s.eventCount || 0) })),
	})).filter((c) => c.id && c.event_count > 0);
}

export async function getEvent(eventId) {
	const raw = await cached(cache, `event:${eventId}`, () => read(`/events/${encodeURIComponent(eventId)}`, { includeMarkets: true }));
	if (!raw?.eventId) throw new VenueError('not_found', 'No event with that id.', { status: 404 });
	return normalizeEvent(raw);
}

export async function getMarket(marketId) {
	const raw = await cached(cache, `market:${marketId}`, () => read(`/markets/${encodeURIComponent(marketId)}`));
	if (!raw?.marketId) throw new VenueError('not_found', 'No market with that id.', { status: 404 });
	let event = null;
	if (raw.eventId && raw.provider === 'kalshi') {
		event = await getRawEvent(raw.eventId).catch(() => null);
	}
	return normalizeMarket(raw, event);
}

async function getRawEvent(eventId) {
	return cached(cache, `event-raw:${eventId}`, () => read(`/events/${encodeURIComponent(eventId)}`, { includeMarkets: false }));
}

export async function getOrderbook(marketId) {
	const raw = await cached(cache, `book:${marketId}`, () => read(`/orderbook/${encodeURIComponent(marketId)}`));
	return normalizeOrderbook(raw);
}

export async function tradingStatus() {
	const raw = await cached(cache, 'trading-status', () => read('/trading-status'));
	return { trading_active: raw?.trading_active === true };
}

export async function listPositions(owner) {
	const raw = await read('/positions', { ownerPubkey: owner, includePrices: true, start: 0, end: 200 });
	return (raw?.data || []).map(normalizePosition);
}

export async function listFills(owner, { limit = 50 } = {}) {
	const raw = await read('/history', { ownerPubkey: owner, start: 0, end: Math.min(200, limit) });
	return (raw?.data || []).map((h) => ({
		id: h.id,
		type: h.eventType,
		signature: h.signature || null,
		at: iso(h.timestamp),
		market_id: h.marketId,
		event_id: h.eventId || null,
		position_id: h.positionPubkey || null,
		order_id: h.orderPubkey || null,
		side: h.isYes ? 'yes' : 'no',
		is_buy: !!h.isBuy,
		contracts: Number(h.filledContractsDecimal && Number(h.filledContractsDecimal) > 0 ? h.filledContractsDecimal : h.contractsDecimal || 0),
		avg_price: prob(h.avgFillPriceUsd),
		cost_usd: usd(h.totalCostUsd),
		proceeds_usd: usd(h.netProceedsUsd),
		payout_usd: usd(h.payoutAmountUsd),
		fee_usd: usd(h.feeUsd),
		realized_pnl_usd: usd(h.realizedPnl),
		market_title: h.marketMetadata?.title || null,
		event_title: h.eventMetadata?.title || null,
	}));
}

export async function getOrderStatus(orderPubkey) {
	return read(`/orders/status/${encodeURIComponent(orderPubkey)}`);
}

// ── Price history ────────────────────────────────────────────────────────────
// The venue publishes live prices but not their history, so history comes
// from the book that fills the market, which is also its resolution source.

const RANGES = {
	'1d': { seconds: 86_400, polyInterval: '1d', polyFidelity: 15, kalshiPeriod: 60 },
	'1w': { seconds: 7 * 86_400, polyInterval: '1w', polyFidelity: 60, kalshiPeriod: 60 },
	'1m': { seconds: 30 * 86_400, polyInterval: '1m', polyFidelity: 360, kalshiPeriod: 1440 },
	max: { seconds: 365 * 86_400, polyInterval: 'max', polyFidelity: 1440, kalshiPeriod: 1440 },
};

export function parsePolyHistory(raw) {
	return (raw?.history || [])
		.map((h) => ({ t: Number(h.t) * 1000, p: Number(h.p) }))
		.filter((pt) => Number.isFinite(pt.t) && Number.isFinite(pt.p) && pt.p >= 0 && pt.p <= 1);
}

export function parseKalshiCandles(raw) {
	const num = (v) => (v == null || v === '' ? NaN : Number(v));
	return (raw?.candlesticks || [])
		.map((c) => {
			let p = num(c.price?.close_dollars);
			if (!Number.isFinite(p)) {
				const bid = num(c.yes_bid?.close_dollars);
				const ask = num(c.yes_ask?.close_dollars);
				p = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : NaN;
			}
			return { t: Number(c.end_period_ts) * 1000, p };
		})
		.filter((pt) => Number.isFinite(pt.t) && Number.isFinite(pt.p) && pt.p >= 0 && pt.p <= 1);
}

export async function getPriceHistory(market, range = '1w') {
	const r = RANGES[range] || RANGES['1w'];
	const ref = market?.history_ref;
	if (!ref) return { source: null, range, points: [] };
	const key = `hist:${ref.source}:${ref.token || ref.ticker}:${range}`;
	const points = await cached(slowCache, key, async () => {
		if (ref.source === 'polymarket') {
			const raw = await fetchUpstreamJson(`${POLY_HISTORY}${qs({ market: ref.token, interval: r.polyInterval, fidelity: r.polyFidelity })}`, {}, { name: 'predictions-history-poly', timeoutMs: READ_TIMEOUT_MS });
			return parsePolyHistory(raw);
		}
		const now = Math.floor(Date.now() / 1000);
		const raw = await fetchUpstreamJson(
			`${KALSHI_API}/series/${encodeURIComponent(ref.series)}/markets/${encodeURIComponent(ref.ticker)}/candlesticks${qs({ start_ts: now - r.seconds, end_ts: now, period_interval: r.kalshiPeriod })}`,
			{},
			{ name: 'predictions-history-kalshi', timeoutMs: READ_TIMEOUT_MS },
		);
		return parseKalshiCandles(raw);
	}).catch((err) => {
		if (err instanceof UpstreamError) return null;
		throw err;
	});
	if (points == null) return { source: ref.source, range, points: [], unavailable: true };
	return { source: ref.source, range, points };
}

// ── Transaction building + submission ───────────────────────────────────────

function priceMicro(p) {
	// Whole cents are on every market's tick, so a limit is floored (buy) or
	// ceiled (sell) to the cent, which only ever tightens it.
	return Math.round(p * 100) * 10_000;
}

/**
 * Build an order that buys `usd` of one side, never above `maxPrice`.
 * `quoteOnly` asks the venue for its quote without a transaction when the
 * wallet cannot cover it yet (used for previews of an unfunded wallet).
 */
export async function buildOpenOrder({ owner, marketId, side, usd: stakeUsd, maxPrice, quoteOnly = false }) {
	const body = {
		ownerPubkey: owner,
		marketId,
		isYes: side === 'yes',
		isBuy: true,
		depositAmount: String(Math.round(stakeUsd * MICRO)),
		depositMint: SETTLEMENT_MINT,
		maxBuyPriceUsd: String(Math.floor(maxPrice * 100) * 10_000),
		returnQuoteOnInsufficientFunds: quoteOnly,
	};
	return normalizeBuild(await write('/orders', { body }));
}

/** Sell `contracts` of an existing position, never below `minPrice`. */
export async function buildCloseOrder({ owner, positionId, marketId, side, contracts, minPrice }) {
	const body = {
		ownerPubkey: owner,
		positionPubkey: positionId,
		marketId,
		isYes: side === 'yes',
		isBuy: false,
		contractsDecimal: String(contracts),
		minSellPriceUsd: String(Math.max(10_000, priceMicro(Math.ceil(minPrice * 100) / 100))),
	};
	return normalizeBuild(await write('/orders', { body }));
}

/** Claim the payout of a resolved, winning position. */
export async function buildRedeem({ owner, positionId }) {
	const raw = await write(`/positions/${encodeURIComponent(positionId)}/claim`, { body: { ownerPubkey: owner } });
	return {
		transaction: raw.transaction || null,
		required_signers: raw.requiredSigners || [],
		context: raw.execution?.context || { type: 'claim_payout' },
		payout_usd: usd(raw.position?.payoutAmountUsd),
		contracts: Number(raw.position?.contractsDecimal ?? 0),
		quote: null,
	};
}

function normalizeBuild(raw) {
	const o = raw?.order || {};
	return {
		transaction: raw?.transaction || null,
		required_signers: raw?.requiredSigners || [],
		context: raw?.execution?.context || { type: 'create_order' },
		is_gasless: !!raw?.isGasless,
		order_id: o.orderPubkey || null,
		position_id: o.positionPubkey || null,
		quote: {
			contracts: Number(o.contractsDecimal ?? 0),
			cost_usd: usd(o.orderCostUsd),
			avg_price: prob(o.newAvgPriceUsd),
			max_price: prob(o.maxBuyPriceUsd),
			min_price: prob(o.minSellPriceUsd),
			payout_usd: usd(o.payoutUsd),
			fees_usd: usd(o.estimatedTotalFeeUsd),
			slippage_bps: o.slippageBps ?? null,
			max_slippage_bps: o.maxSlippageBps ?? null,
		},
	};
}

/** Submit an owner-signed transaction through the venue executor. */
export async function submit({ signedTransaction, context }) {
	const raw = await write('/execute', { body: { signedTransaction, context } });
	if (raw?.status === 'Success' && raw.signature) return { signature: raw.signature };
	throw new VenueError('execution_failed', raw?.error ? `The venue could not land the transaction: ${raw.error}` : 'The venue could not land the transaction.', {
		status: 502,
		detail: { signature: raw?.signature || null },
	});
}

export const venue = {
	id: VENUE_ID,
	label: VENUE_LABEL,
	chain: 'solana',
	settlement: { asset: 'USDC', mint: SETTLEMENT_MINT, decimals: 6 },
	listEvents,
	listCategories,
	getEvent,
	getMarket,
	getOrderbook,
	getPriceHistory,
	tradingStatus,
	listPositions,
	listFills,
	getOrderStatus,
	buildOpenOrder,
	buildCloseOrder,
	buildRedeem,
	submit,
};
