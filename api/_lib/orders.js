/**
 * Programmable Orders Engine — data model, validated condition language, and the
 * owner-facing CRUD layer (trading-frontier/02).
 *
 * This module is the single source of truth for what a valid order IS. The HTTP
 * endpoint (api/agents/orders.js) and the evaluation worker (workers/agent-orders)
 * both import from here so the rules can never drift between "what you can create"
 * and "what fires". Trigger + condition evaluation are exported as PURE functions
 * (no I/O) so they are unit-testable and identical on both sides.
 *
 * Order types:
 *   limit       — fill at a target price/market-cap (buy on a dip, sell on a rise)
 *   stop        — fill when a level is breached (stop-loss sell / breakout buy)
 *   trailing    — fill on a % drawdown from the high-water mark (or run-up from the low)
 *   dca         — recurring buys/sells on a fixed interval, N slices
 *   twap        — slice ONE large order over time to cut price impact, N slices
 *   conditional — fill when a validated signal condition is true
 *
 * No arbitrary code in conditions — only a closed set of real signals + operators.
 */

import { randomUUID } from 'node:crypto';
import { validateSolanaAddress } from './agent-trade-guards.js';
import { sql, sqlValues } from './db.js';

export const ORDER_TYPES = Object.freeze(['limit', 'stop', 'trailing', 'dca', 'twap', 'conditional']);
export const ORDER_SIDES = Object.freeze(['buy', 'sell']);
export const TRIGGER_METRICS = Object.freeze(['price_sol', 'mcap_sol', 'mcap_usd']);
// Where an order may fill. 'launchpad' = the pump bonding curve, then the
// PumpSwap AMM once the coin graduates. 'aggregator' = the best route across
// every Solana venue (Jupiter), mainnet only, which is what opens the engine to
// any SPL token. 'auto' = the launchpad when the token trades there, otherwise
// the aggregator; the worker pins the resolved route on the order.
export const ORDER_VENUES = Object.freeze(['auto', 'launchpad', 'aggregator']);
export const GROUP_KINDS = Object.freeze(['ladder', 'oco']);
export const MAX_LADDER_LEGS = 10;

// The closed set of live signals a conditional trigger may reference. Each maps to
// a real, on-chain-or-derived value the worker computes per sweep (see
// workers/agent-orders/market.js). `kind` gates which operators are legal.
export const CONDITION_SIGNALS = Object.freeze({
	price_sol: { kind: 'number', label: 'Price (SOL/token)' },
	mcap_sol: { kind: 'number', label: 'Market cap (SOL)' },
	mcap_usd: { kind: 'number', label: 'Market cap (USD)' },
	price_change_pct: { kind: 'number', label: 'Price change since created (%)' },
	smart_money_score: { kind: 'number', label: 'Smart-money score (0–100)' },
	dev_dump: { kind: 'bool', label: 'Dev has dumped' },
	graduated: { kind: 'bool', label: 'Graduated to AMM' },
});

export const NUMBER_OPS = Object.freeze(['gt', 'gte', 'lt', 'lte', 'eq', 'ne']);
export const BOOL_OPS = Object.freeze(['is_true', 'is_false']);

const OP_LABEL = {
	gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', ne: '≠', is_true: 'is', is_false: 'is not',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(code, message) {
	return { ok: false, error: code, message };
}

function num(v) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function posNum(v) {
	const n = num(v);
	return n != null && n > 0 ? n : null;
}

// ── condition language ────────────────────────────────────────────────────────

/**
 * Validate a condition spec. Shape: `{ all: [leaf, …] }` or `{ any: [leaf, …] }`,
 * where each leaf is `{ signal, op, value }`. One level deep — no nested groups,
 * no expressions, no code. Returns { ok, spec } or { ok:false, error, message }.
 */
export function validateCondition(raw) {
	if (!raw || typeof raw !== 'object') return err('invalid_condition', 'a condition object is required');
	const mode = 'all' in raw ? 'all' : 'any' in raw ? 'any' : null;
	if (!mode) return err('invalid_condition', 'condition must have an "all" or "any" array');
	const leaves = raw[mode];
	if (!Array.isArray(leaves) || leaves.length === 0) return err('invalid_condition', `"${mode}" must be a non-empty array`);
	if (leaves.length > 8) return err('invalid_condition', 'a condition may have at most 8 clauses');

	const clean = [];
	for (const leaf of leaves) {
		if (!leaf || typeof leaf !== 'object') return err('invalid_condition', 'each clause must be an object');
		const signal = String(leaf.signal || '');
		const def = CONDITION_SIGNALS[signal];
		if (!def) return err('invalid_condition', `unknown signal "${signal}"`);
		const op = String(leaf.op || '');
		if (def.kind === 'bool') {
			if (!BOOL_OPS.includes(op)) return err('invalid_condition', `"${signal}" needs is_true or is_false`);
			clean.push({ signal, op });
		} else {
			if (!NUMBER_OPS.includes(op)) return err('invalid_condition', `"${signal}" needs one of ${NUMBER_OPS.join(', ')}`);
			const value = num(leaf.value);
			if (value == null) return err('invalid_condition', `"${signal}" ${op} needs a numeric value`);
			clean.push({ signal, op, value });
		}
	}
	return { ok: true, spec: { [mode]: clean } };
}

function compareNumber(op, a, b) {
	switch (op) {
		case 'gt': return a > b;
		case 'gte': return a >= b;
		case 'lt': return a < b;
		case 'lte': return a <= b;
		case 'eq': return a === b;
		case 'ne': return a !== b;
		default: return false;
	}
}

/**
 * Evaluate a (pre-validated) condition spec against a `signals` map of live
 * values. A signal that is null/undefined is treated as INDETERMINATE: it never
 * counts as satisfied and is reported in `missing` so the worker can stay honest
 * about data gaps (it must not fire on absent data). Pure — no I/O.
 *
 * @returns {{ fired: boolean, missing: string[] }}
 */
export function evaluateCondition(spec, signals) {
	const mode = 'all' in spec ? 'all' : 'any';
	const leaves = spec[mode];
	const missing = [];
	const results = leaves.map((leaf) => {
		const def = CONDITION_SIGNALS[leaf.signal];
		const v = signals?.[leaf.signal];
		if (v == null) { missing.push(leaf.signal); return false; }
		if (def.kind === 'bool') return leaf.op === 'is_true' ? v === true : v === false;
		const n = Number(v);
		if (!Number.isFinite(n)) { missing.push(leaf.signal); return false; }
		return compareNumber(leaf.op, n, leaf.value);
	});
	const fired = mode === 'all' ? results.every(Boolean) : results.some(Boolean);
	return { fired, missing };
}

/** Signals a condition spec references — so the worker only fetches what it needs. */
export function conditionSignals(spec) {
	const mode = 'all' in spec ? 'all' : 'any';
	return [...new Set((spec[mode] || []).map((l) => l.signal))];
}

// ── price-trigger logic (limit / stop / trailing) ─────────────────────────────

/**
 * Decide whether a price-driven order fires at the observed metric value, given
 * its tracked peak (for trailing). Pure. Returns true when the order should fire.
 *
 * - limit  buy : fire when value <= target  (patient entry on a dip)
 * - limit  sell: fire when value >= target  (take profit on a rise)
 * - stop   buy : fire when value >= target  (breakout entry)
 * - stop   sell: fire when value <= target  (stop-loss)
 * - trailing buy : fire when value >= trough * (1 + trail_pct/100)
 * - trailing sell: fire when value <= peak   * (1 - trail_pct/100)
 */
export function shouldFirePrice(order, value, peak) {
	if (!Number.isFinite(value)) return false;
	if (order.type === 'limit') {
		const t = Number(order.limit_price);
		return order.side === 'buy' ? value <= t : value >= t;
	}
	if (order.type === 'stop') {
		const t = Number(order.stop_price);
		return order.side === 'buy' ? value >= t : value <= t;
	}
	if (order.type === 'trailing') {
		const p = Number(peak);
		if (!Number.isFinite(p) || p <= 0) return false;
		const tp = Number(order.trail_pct) / 100;
		return order.side === 'sell' ? value <= p * (1 - tp) : value >= p * (1 + tp);
	}
	return false;
}

// ── order normalization / validation ──────────────────────────────────────────

function parseSizing(raw, side) {
	// Buys spend SOL; sells dispose tokens (raw base units) or a % of the holding.
	if (side === 'buy') {
		const size_sol = posNum(raw.size_sol);
		if (!size_sol) return err('invalid_size', 'a positive size_sol (SOL to spend per fill) is required for a buy');
		return { ok: true, sizing: { size_sol, size_tokens: null, sell_pct: null } };
	}
	const sell_pct = num(raw.sell_pct);
	const size_tokens = posNum(raw.size_tokens);
	if (sell_pct != null) {
		if (sell_pct <= 0 || sell_pct > 100) return err('invalid_size', 'sell_pct must be between 0 and 100');
		return { ok: true, sizing: { size_sol: null, size_tokens: null, sell_pct } };
	}
	if (size_tokens) return { ok: true, sizing: { size_sol: null, size_tokens, sell_pct: null } };
	return err('invalid_size', 'a sell needs size_tokens (base units) or sell_pct (0–100)');
}

function parseSchedule(raw, { minInterval, minSlices }) {
	const s = raw && typeof raw === 'object' ? raw : {};
	const interval_seconds = Math.round(num(s.interval_seconds) ?? 0);
	const slices = Math.round(num(s.slices) ?? 0);
	if (!(interval_seconds >= minInterval)) return err('invalid_schedule', `interval_seconds must be at least ${minInterval}`);
	if (!(slices >= minSlices)) return err('invalid_schedule', `slices must be at least ${minSlices}`);
	if (slices > 1000) return err('invalid_schedule', 'slices may be at most 1000');
	return { ok: true, schedule: { interval_seconds, slices, filled_slices: 0 } };
}

function parseExpiry(raw) {
	if (raw == null || raw === '') return null;
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) return undefined; // signals invalid
	return d.toISOString();
}

/**
 * Coerce + validate a raw order body into a clean, bounded order spec ready to
 * persist. Returns { ok, order } or { ok:false, error, message }. Does NOT touch
 * the DB or the chain — it only decides validity + shape.
 */
export function normalizeOrder(raw) {
	if (!raw || typeof raw !== 'object') return err('invalid_order', 'an order object is required');

	const type = String(raw.type || '');
	if (!ORDER_TYPES.includes(type)) return err('invalid_type', `type must be one of ${ORDER_TYPES.join(', ')}`);
	const side = String(raw.side || '');
	if (!ORDER_SIDES.includes(side)) return err('invalid_side', 'side must be "buy" or "sell"');

	const mintCheck = validateSolanaAddress(raw.mint);
	if (!mintCheck.valid) return err('invalid_mint', `mint is not a valid Solana address (${mintCheck.reason})`);

	const slippage_bps = Math.max(1, Math.min(5000, Math.round(num(raw.slippage_bps) ?? 500)));
	const max_price_impact_pct = (() => { const n = num(raw.max_price_impact_pct); return n != null && n > 0 ? Math.min(100, n) : null; })();

	const expires_at = parseExpiry(raw.expires_at);
	if (expires_at === undefined) return err('invalid_expiry', 'expires_at must be a valid date/time');

	const trigger_metric = TRIGGER_METRICS.includes(raw.trigger_metric) ? raw.trigger_metric : 'mcap_usd';
	const network = raw.network === 'devnet' ? 'devnet' : 'mainnet';

	const venue = raw.venue == null || raw.venue === '' ? 'auto' : String(raw.venue);
	if (!ORDER_VENUES.includes(venue)) return err('invalid_venue', `venue must be one of ${ORDER_VENUES.join(', ')}`);
	if (venue === 'aggregator' && network !== 'mainnet') {
		return err('invalid_venue', 'the aggregator routes mainnet only; use venue "launchpad" or "auto" on devnet');
	}

	let price_band = null;
	if (raw.price_band != null) {
		if (type !== 'dca' && type !== 'twap') return err('invalid_band', 'price_band applies to dca and twap orders');
		const band = parseBand(raw.price_band, trigger_metric);
		if (!band.ok) return band;
		price_band = band.band;
	}

	const out = {
		type, side, mint: mintCheck.base58, symbol: typeof raw.symbol === 'string' ? raw.symbol.slice(0, 32) : null,
		network, venue, price_band,
		slippage_bps, max_price_impact_pct, expires_at: expires_at || null,
		trigger_metric,
		limit_price: null, stop_price: null, trail_pct: null,
		schedule: null, condition: null,
		size_sol: null, size_tokens: null, sell_pct: null,
	};

	// sizing (shared by all single-fill types and per-slice for dca; twap derives below)
	if (type !== 'twap') {
		const sz = parseSizing(raw, side);
		if (!sz.ok) return sz;
		Object.assign(out, sz.sizing);
	}

	if (type === 'limit') {
		const v = posNum(raw.limit_price);
		if (!v) return err('invalid_price', 'limit_price must be a positive number');
		out.limit_price = v;
	} else if (type === 'stop') {
		const v = posNum(raw.stop_price);
		if (!v) return err('invalid_price', 'stop_price must be a positive number');
		out.stop_price = v;
	} else if (type === 'trailing') {
		const v = num(raw.trail_pct);
		if (v == null || v <= 0 || v >= 100) return err('invalid_trail', 'trail_pct must be between 0 and 100');
		out.trail_pct = v;
	} else if (type === 'dca') {
		const sch = parseSchedule(raw.schedule, { minInterval: 60, minSlices: 1 });
		if (!sch.ok) return sch;
		out.schedule = sch.schedule;
	} else if (type === 'twap') {
		const sch = parseSchedule(raw.schedule, { minInterval: 30, minSlices: 2 });
		if (!sch.ok) return sch;
		out.schedule = sch.schedule;
		// TWAP slices ONE total order; derive per-slice size from the total.
		if (side === 'buy') {
			const total = posNum(raw.total_sol ?? raw.size_sol);
			if (!total) return err('invalid_size', 'a positive total_sol is required for a TWAP buy');
			out.size_sol = round8(total / sch.schedule.slices);
			out.schedule.total_sol = total;
		} else {
			const pct = num(raw.sell_pct);
			const totalTokens = posNum(raw.total_tokens ?? raw.size_tokens);
			if (pct != null) {
				if (pct <= 0 || pct > 100) return err('invalid_size', 'sell_pct must be between 0 and 100');
				out.sell_pct = round8(pct / sch.schedule.slices);
				out.schedule.total_pct = pct;
			} else if (totalTokens) {
				out.size_tokens = round8(totalTokens / sch.schedule.slices);
				out.schedule.total_tokens = totalTokens;
			} else {
				return err('invalid_size', 'a TWAP sell needs total_tokens (base units) or sell_pct (0–100)');
			}
		}
	} else if (type === 'conditional') {
		const cond = validateCondition(raw.condition);
		if (!cond.ok) return cond;
		out.condition = cond.spec;
	}

	return { ok: true, order: out };
}

function round8(n) {
	return Math.round(n * 1e8) / 1e8;
}

/**
 * A DCA/TWAP price band: a slice fires only while the metric sits inside
 * [min, max]. Either bound may be omitted. A slice outside the band is skipped
 * (consumed), not retried, so the schedule keeps its cadence.
 */
function parseBand(raw, defaultMetric) {
	if (!raw || typeof raw !== 'object') return err('invalid_band', 'price_band must be an object with min and/or max');
	const min = raw.min == null || raw.min === '' ? null : posNum(raw.min);
	const max = raw.max == null || raw.max === '' ? null : posNum(raw.max);
	if (raw.min != null && raw.min !== '' && min == null) return err('invalid_band', 'price_band.min must be a positive number');
	if (raw.max != null && raw.max !== '' && max == null) return err('invalid_band', 'price_band.max must be a positive number');
	if (min == null && max == null) return err('invalid_band', 'price_band needs a min, a max, or both');
	if (min != null && max != null && min >= max) return err('invalid_band', 'price_band.min must be below price_band.max');
	const metric = raw.metric == null ? defaultMetric : String(raw.metric);
	if (!TRIGGER_METRICS.includes(metric)) return err('invalid_band', `price_band.metric must be one of ${TRIGGER_METRICS.join(', ')}`);
	return { ok: true, band: { min, max, metric } };
}

// Fields every leg of a group shares with the group body.
function groupBase(raw) {
	return {
		mint: raw.mint, symbol: raw.symbol, network: raw.network, venue: raw.venue,
		slippage_bps: raw.slippage_bps, max_price_impact_pct: raw.max_price_impact_pct,
		expires_at: raw.expires_at, trigger_metric: raw.trigger_metric,
	};
}

/**
 * A ladder: several limit orders on one token placed in one call, each at its
 * own level. A sell ladder takes profit in steps (each leg's sell_pct is a share
 * of the bag as it is when the ladder is placed, and the legs may add up to at
 * most 100); a buy ladder scales in on the way down (each leg spends its own
 * size_sol).
 *
 * Body: { mint, side?, trigger_metric?, venue?, slippage_bps?, expires_at?,
 *         legs: [{ price, sell_pct | size_tokens | size_sol }, ...] }
 * Returns { ok, kind:'ladder', orders } with the legs sorted in fill order.
 */
export function normalizeLadder(raw) {
	if (!raw || typeof raw !== 'object') return err('invalid_order', 'a ladder object is required');
	const side = raw.side === 'buy' ? 'buy' : 'sell';
	const legs = Array.isArray(raw.legs) ? raw.legs : null;
	if (!legs || legs.length < 2) return err('invalid_ladder', 'a ladder needs at least 2 legs');
	if (legs.length > MAX_LADDER_LEGS) return err('invalid_ladder', `a ladder may have at most ${MAX_LADDER_LEGS} legs`);
	const orders = [];
	for (const [i, leg] of legs.entries()) {
		if (!leg || typeof leg !== 'object') return err('invalid_ladder', `leg ${i + 1} must be an object`);
		const r = normalizeOrder({
			...groupBase(raw), type: 'limit', side,
			limit_price: leg.price ?? leg.limit_price,
			size_sol: leg.size_sol, size_tokens: leg.size_tokens, sell_pct: leg.sell_pct,
		});
		if (!r.ok) return { ...r, message: `leg ${i + 1}: ${r.message}` };
		orders.push(r.order);
	}
	const prices = orders.map((o) => o.limit_price);
	if (new Set(prices).size !== prices.length) return err('invalid_ladder', 'each ladder leg needs its own price');
	if (side === 'sell') {
		const total = orders.reduce((a, o) => a + (o.sell_pct ?? 0), 0);
		if (total > 100 + 1e-9) return err('invalid_ladder', `the legs sell ${round8(total)}% of the bag; the total may be at most 100%`);
	}
	// Fill order: a sell ladder fills lowest price first, a buy ladder highest first.
	orders.sort((a, b) => (side === 'sell' ? a.limit_price - b.limit_price : b.limit_price - a.limit_price));
	return { ok: true, kind: 'ladder', orders };
}

/**
 * Normalize any order request body into the legs it places. `kind` selects the
 * shape: 'ladder' (normalizeLadder), 'oco' (normalizeOco), or a single order
 * (normalizeOrder, the default). Every surface that places orders (HTTP, MCP,
 * the wallet hub) goes through this one door.
 *
 * @returns {{ ok:true, kind:'single'|'ladder'|'oco', orders:object[] } | { ok:false, error:string, message:string }}
 */
export function normalizeOrderRequest(raw, kind = raw?.kind) {
	if (kind === 'ladder') return normalizeLadder(raw);
	if (kind === 'oco') return normalizeOco(raw);
	if (kind != null && kind !== 'single') return err('invalid_kind', 'kind must be single, ladder or oco');
	const r = normalizeOrder(raw);
	return r.ok ? { ok: true, kind: 'single', orders: [r.order] } : r;
}

/**
 * An OCO pair: two orders on one token where the first to fill cancels the
 * other. For a sell, a take-profit limit above and a stop-loss below (or a
 * trailing stop with trail_pct); for a buy, a dip-buy limit below and a
 * breakout stop above. Both legs carry the same size, since only one ever fills.
 *
 * Body: { mint, side?, trigger_metric?, venue?, take_profit, stop_loss | trail_pct,
 *         sell_pct | size_tokens | size_sol, ... }
 * Returns { ok, kind:'oco', orders: [limitLeg, stopLeg] }.
 */
export function normalizeOco(raw) {
	if (!raw || typeof raw !== 'object') return err('invalid_order', 'an OCO object is required');
	const side = raw.side === 'buy' ? 'buy' : 'sell';
	const sizing = { size_sol: raw.size_sol, size_tokens: raw.size_tokens, sell_pct: raw.sell_pct };
	const limitPrice = posNum(raw.take_profit ?? raw.limit_price);
	if (!limitPrice) return err('invalid_oco', side === 'sell' ? 'take_profit (the limit level) is required' : 'limit_price (the dip-buy level) is required');
	const limitLeg = normalizeOrder({ ...groupBase(raw), ...sizing, type: 'limit', side, limit_price: limitPrice });
	if (!limitLeg.ok) return { ...limitLeg, message: `limit leg: ${limitLeg.message}` };

	let stopLeg;
	if (raw.trail_pct != null && raw.stop_loss == null && raw.stop_price == null) {
		stopLeg = normalizeOrder({ ...groupBase(raw), ...sizing, type: 'trailing', side, trail_pct: raw.trail_pct });
	} else {
		const stopPrice = posNum(raw.stop_loss ?? raw.stop_price);
		if (!stopPrice) return err('invalid_oco', 'stop_loss (the stop level) or trail_pct is required');
		if (side === 'sell' && stopPrice >= limitPrice) return err('invalid_oco', 'a sell OCO needs the stop below the take-profit');
		if (side === 'buy' && stopPrice <= limitPrice) return err('invalid_oco', 'a buy OCO needs the breakout stop above the dip-buy limit');
		stopLeg = normalizeOrder({ ...groupBase(raw), ...sizing, type: 'stop', side, stop_price: stopPrice });
	}
	if (!stopLeg.ok) return { ...stopLeg, message: `stop leg: ${stopLeg.message}` };
	return { ok: true, kind: 'oco', orders: [limitLeg.order, stopLeg.order] };
}

// ── human-readable description ────────────────────────────────────────────────

function metricLabel(metric, value) {
	if (value == null) return '—';
	if (metric === 'mcap_usd') return `$${fmt(value)} mcap`;
	if (metric === 'mcap_sol') return `${fmt(value)} SOL mcap`;
	return `${value} SOL/token`;
}

function fmt(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return String(n);
	if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
	if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
	return String(v);
}

function sizeLabel(o) {
	if (o.side === 'buy') return `${o.size_sol} SOL`;
	if (o.sell_pct != null) return `${o.sell_pct}% of the holding`;
	// size_tokens is raw base units, not whole tokens; label it as what it is so
	// the readback can't be misread as a 1e6x larger sell on a 6-decimal mint.
	return `${o.size_tokens} base units`;
}

/** A plain-language readback of an order — what it does, in one line. */
export function describeOrder(o) {
	const sym = o.symbol ? `$${o.symbol}` : `${String(o.mint).slice(0, 4)}…`;
	const verb = o.side === 'buy' ? 'Buy' : 'Sell';
	switch (o.type) {
		case 'limit':
			return `${verb} ${sizeLabel(o)} of ${sym} when it reaches ${metricLabel(o.trigger_metric, o.limit_price)} (limit ${o.side}).`;
		case 'stop':
			return o.side === 'sell'
				? `Stop-loss: sell ${sizeLabel(o)} of ${sym} if it falls to ${metricLabel(o.trigger_metric, o.stop_price)}.`
				: `Breakout: buy ${sizeLabel(o)} of ${sym} once it breaks ${metricLabel(o.trigger_metric, o.stop_price)}.`;
		case 'trailing':
			return o.side === 'sell'
				? `Trailing stop: sell ${sizeLabel(o)} of ${sym} after a ${o.trail_pct}% drop from its high.`
				: `Trailing entry: buy ${sizeLabel(o)} of ${sym} after a ${o.trail_pct}% bounce from its low.`;
		case 'dca': {
			const every = humanInterval(o.schedule?.interval_seconds);
			return `DCA: ${verb.toLowerCase()} ${sizeLabel(o)} of ${sym} every ${every}, ${o.schedule?.slices}× total${bandLabel(o.price_band)}.`;
		}
		case 'twap': {
			const every = humanInterval(o.schedule?.interval_seconds);
			const total = o.side === 'buy' ? `${o.schedule?.total_sol} SOL` : (o.schedule?.total_pct != null ? `${o.schedule.total_pct}%` : `${o.schedule?.total_tokens} base units`);
			return `TWAP: ${verb.toLowerCase()} ${total} of ${sym} sliced over ${o.schedule?.slices} fills, one every ${every}${bandLabel(o.price_band)}.`;
		}
		case 'conditional':
			return `${verb} ${sizeLabel(o)} of ${sym} when ${describeCondition(o.condition)}.`;
		default:
			return `${verb} ${sym}.`;
	}
}

function bandLabel(band) {
	if (!band) return '';
	const m = band.metric || 'mcap_usd';
	if (band.min != null && band.max != null) return `, only between ${metricLabel(m, band.min)} and ${metricLabel(m, band.max)}`;
	if (band.max != null) return `, only at or below ${metricLabel(m, band.max)}`;
	return `, only at or above ${metricLabel(m, band.min)}`;
}

export function describeCondition(spec) {
	if (!spec) return 'a condition is met';
	const mode = 'all' in spec ? 'all' : 'any';
	const join = mode === 'all' ? ' and ' : ' or ';
	return (spec[mode] || []).map((l) => {
		const def = CONDITION_SIGNALS[l.signal];
		if (def?.kind === 'bool') return `${def.label.toLowerCase()} ${l.op === 'is_true' ? 'is true' : 'is false'}`;
		return `${def?.label || l.signal} ${OP_LABEL[l.op] || l.op} ${fmt(l.value)}`;
	}).join(join);
}

export function humanInterval(seconds) {
	const s = Number(seconds) || 0;
	if (s % 86400 === 0 && s >= 86400) return `${s / 86400} day${s === 86400 ? '' : 's'}`;
	if (s % 3600 === 0 && s >= 3600) return `${s / 3600} hour${s === 3600 ? '' : 's'}`;
	if (s % 60 === 0 && s >= 60) return `${s / 60} min`;
	return `${s}s`;
}

// ── persistence (CRUD) ────────────────────────────────────────────────────────

/** Shape a DB row for the API: numeric strings → numbers, attach a readback. */
export function shapeOrder(row) {
	if (!row) return null;
	const o = {
		id: row.id, agent_id: row.agent_id, network: row.network, mint: row.mint, symbol: row.symbol,
		type: row.type, side: row.side,
		size_sol: numOrNull(row.size_sol), size_tokens: numOrNull(row.size_tokens), sell_pct: numOrNull(row.sell_pct),
		trigger_metric: row.trigger_metric,
		limit_price: numOrNull(row.limit_price), stop_price: numOrNull(row.stop_price),
		trail_pct: numOrNull(row.trail_pct), peak_price: numOrNull(row.peak_price),
		reference_price: numOrNull(row.reference_price),
		schedule: row.schedule || null, next_fire_at: row.next_fire_at, condition: row.condition || null,
		slippage_bps: row.slippage_bps, max_price_impact_pct: numOrNull(row.max_price_impact_pct),
		expires_at: row.expires_at, status: row.status,
		filled_sol: numOrNull(row.filled_sol) || 0, filled_tokens: numOrNull(row.filled_tokens) || 0,
		fill_count: row.fill_count || 0,
		last_eval_at: row.last_eval_at, last_price: numOrNull(row.last_price), last_error: row.last_error,
		created_at: row.created_at, updated_at: row.updated_at, cancelled_at: row.cancelled_at,
		venue: row.venue || 'auto', route: row.route || null, price_band: row.price_band || null,
		group_id: row.group_id || null, group_kind: row.group_kind || null, group_leg: row.group_leg ?? null,
		last_skip_code: row.last_skip_code || null, last_skip_detail: row.last_skip_detail || null,
		last_skip_at: row.last_skip_at || null, skip_count: row.skip_count || 0, hold_until: row.hold_until || null,
		cancel_reason: row.cancel_reason || null, last_fire_at: row.last_fire_at || null,
		consecutive_failures: row.consecutive_failures || 0, last_error_code: row.last_error_code || null,
		paused_at: row.paused_at || null, resumed_at: row.resumed_at || null,
		chain_id: row.chain_id ?? null, quote_mint: row.quote_mint || null,
		amount_in_raw: row.amount_in_raw || null, delegation_id: row.delegation_id || null,
	};
	o.readback = describeOrder(o);
	return o;
}

function numOrNull(v) {
	if (v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/**
 * List an agent's orders (newest first), optionally filtered by status set. The
 * EVM DCA schedules share the table but not the Solana book: they appear only
 * when network 'evm' is asked for (api/_lib/dca-unified.js reads them).
 */
export async function listOrders(agentId, { network = null, statuses = null, limit = 100 } = {}) {
	const lim = Math.min(200, Math.max(1, Number(limit) || 100));
	const rows = await sql`
		SELECT * FROM orders
		WHERE agent_id = ${agentId}
		  AND (network = ${network} OR (${network}::text IS NULL AND network <> 'evm'))
		  AND (${statuses}::text[] IS NULL OR status = ANY(${statuses}::text[]))
		ORDER BY created_at DESC
		LIMIT ${lim}
	`;
	return rows.map(shapeOrder);
}

/** A single order (owner-scoped). */
export async function getOrder(agentId, orderId) {
	if (!UUID_RE.test(orderId)) return null;
	const [row] = await sql`SELECT * FROM orders WHERE id = ${orderId} AND agent_id = ${agentId}`;
	return shapeOrder(row);
}

/** Recent fills for an order. */
export async function listFills(orderId, { limit = 50 } = {}) {
	const lim = Math.min(200, Math.max(1, Number(limit) || 50));
	const rows = await sql`
		SELECT id, slice_index, side, trigger_reason, trigger_price, sol_amount, token_amount,
		       price_impact_pct, venue, signature, custody_event_id, status, detail, created_at
		FROM order_fills WHERE order_id = ${orderId}
		ORDER BY created_at DESC LIMIT ${lim}
	`;
	return rows.map((r) => ({
		...r,
		trigger_price: numOrNull(r.trigger_price),
		sol_amount: numOrNull(r.sol_amount),
		token_amount: numOrNull(r.token_amount),
		price_impact_pct: numOrNull(r.price_impact_pct),
	}));
}

/**
 * Persist a validated order. `normalized` is the output of normalizeOrder.order;
 * `route` is the venue route resolved at placement (null lets the worker resolve
 * it on the first sweep). Returns the shaped row.
 */
export async function createOrder(agentId, userId, normalized, { route = null } = {}) {
	const [row] = await sql`
		INSERT INTO orders (${orderInsertColumns()})
		VALUES ${sqlValues([orderInsertRow(agentId, userId, normalized, { route })])}
		RETURNING *
	`;
	const order = shapeOrder(row);
	await recordOrderEvent(order, 'placed', { detail: order.readback, meta: route ? { route } : null });
	return order;
}

// The column list orderInsertRow fills, in order.
const orderInsertColumns = () => sql`
	agent_id, user_id, network, mint, symbol, type, side, size_sol, size_tokens,
	sell_pct, trigger_metric, limit_price, stop_price, trail_pct, schedule,
	next_fire_at, condition, slippage_bps, max_price_impact_pct, expires_at, status,
	venue, route, price_band, group_id, group_kind, group_leg`;

// One VALUES row for orderInsertColumns(). Schedule-driven orders (dca/twap)
// get next_fire_at = now so the first slice fires on the next sweep.
function orderInsertRow(agentId, userId, o, { route = null, group = null } = {}) {
	const scheduled = o.type === 'dca' || o.type === 'twap';
	return [
		agentId, userId, o.network, o.mint, o.symbol, o.type, o.side,
		o.size_sol, o.size_tokens, o.sell_pct, o.trigger_metric,
		o.limit_price, o.stop_price, o.trail_pct,
		sql`${o.schedule ? JSON.stringify(o.schedule) : null}::jsonb`,
		scheduled ? sql`now()` : null,
		sql`${o.condition ? JSON.stringify(o.condition) : null}::jsonb`,
		o.slippage_bps, o.max_price_impact_pct, o.expires_at, 'active',
		o.venue || 'auto', route,
		sql`${o.price_band ? JSON.stringify(o.price_band) : null}::jsonb`,
		group ? sql`${group.id}::uuid` : null, group?.kind ?? null, group?.leg ?? null,
	];
}

/**
 * Persist a ladder or an OCO pair (normalizeLadder / normalizeOco output) as
 * one atomic multi-row INSERT: every leg shares a group_id and carries its leg
 * number, so either the whole group rests or none of it does. The worker reads
 * the group back to re-base ladder legs and to cancel OCO siblings on a fill.
 */
export async function createOrderGroup(agentId, userId, group, { route = null } = {}) {
	if (!GROUP_KINDS.includes(group?.kind)) throw new Error(`unknown order group kind: ${group?.kind}`);
	const id = randomUUID();
	const rows = group.orders.map((o, i) => orderInsertRow(agentId, userId, o, { route, group: { id, kind: group.kind, leg: i + 1 } }));
	const inserted = await sql`
		INSERT INTO orders (${orderInsertColumns()})
		VALUES ${sqlValues(rows)}
		RETURNING *
	`;
	const orders = inserted.map(shapeOrder).sort((a, b) => a.group_leg - b.group_leg);
	for (const o of orders) {
		await recordOrderEvent(o, 'placed', { detail: o.readback, meta: { group_id: id, group_kind: group.kind, leg: o.group_leg } });
	}
	return { group_id: id, kind: group.kind, orders };
}

/** Every leg of a group (owner-scoped), in leg order. */
export async function getOrderGroup(agentId, groupId) {
	if (!UUID_RE.test(groupId)) return [];
	const rows = await sql`
		SELECT * FROM orders WHERE agent_id = ${agentId} AND group_id = ${groupId}::uuid
		ORDER BY group_leg ASC
	`;
	return rows.map(shapeOrder);
}

/**
 * Append one lifecycle row (placed, skip, fire, fail, cancel, expire, pause,
 * resume) to agent_order_events. Never throws: a lost history row must not
 * block an owner action or a fill.
 */
export async function recordOrderEvent(order, kind, { code = null, detail = null, meta = null } = {}) {
	try {
		await sql`
			INSERT INTO agent_order_events (order_id, agent_id, kind, code, detail, meta)
			VALUES (${order.id}, ${order.agent_id}, ${kind}, ${code}, ${detail ? String(detail).slice(0, 280) : null},
			        ${meta ? JSON.stringify(meta) : null}::jsonb)
		`;
	} catch { /* history is best-effort */ }
}

/**
 * Owner edit: pause/resume (status active↔paused via cancel is separate), or
 * patch trigger params on an order that hasn't filled. Only a bounded set of
 * fields can change; type/side/mint are immutable (delete + recreate instead).
 */
export async function updateOrder(agentId, orderId, patch) {
	const current = await getOrder(agentId, orderId);
	if (!current) return null;
	if (['filled', 'cancelled', 'expired'].includes(current.status)) {
		return { error: 'immutable', message: `a ${current.status} order can’t be edited` };
	}

	const sets = [];
	if ('limit_price' in patch && current.type === 'limit') {
		const v = posNum(patch.limit_price);
		if (!v) return { error: 'invalid_price', message: 'limit_price must be positive' };
		sets.push(sql`limit_price = ${v}`);
	}
	if ('stop_price' in patch && current.type === 'stop') {
		const v = posNum(patch.stop_price);
		if (!v) return { error: 'invalid_price', message: 'stop_price must be positive' };
		sets.push(sql`stop_price = ${v}`);
	}
	if ('trail_pct' in patch && current.type === 'trailing') {
		const v = num(patch.trail_pct);
		if (v == null || v <= 0 || v >= 100) return { error: 'invalid_trail', message: 'trail_pct must be 0–100' };
		sets.push(sql`trail_pct = ${v}`);
	}
	if ('slippage_bps' in patch) {
		sets.push(sql`slippage_bps = ${Math.max(1, Math.min(5000, Math.round(num(patch.slippage_bps) ?? current.slippage_bps)))}`);
	}
	if ('expires_at' in patch) {
		const e = parseExpiry(patch.expires_at);
		if (e === undefined) return { error: 'invalid_expiry', message: 'expires_at must be a valid date/time' };
		sets.push(sql`expires_at = ${e}`);
	}
	if ('price_band' in patch) {
		if (current.type !== 'dca' && current.type !== 'twap') return { error: 'invalid_band', message: 'price_band applies to dca and twap orders' };
		if (patch.price_band == null) {
			sets.push(sql`price_band = NULL`);
		} else {
			const band = parseBand(patch.price_band, current.trigger_metric);
			if (!band.ok) return { error: band.error, message: band.message };
			sets.push(sql`price_band = ${JSON.stringify(band.band)}::jsonb`);
		}
	}
	let lifecycle = null;
	if ('paused' in patch) {
		// Pause parks the order in a non-evaluated 'paused' state without losing fill
		// progress; resume returns it to 'partial' (if it has fills) or 'active'.
		if (patch.paused === true && current.status !== 'paused') {
			sets.push(sql`status = 'paused'`, sql`paused_at = now()`);
			lifecycle = 'pause';
		} else if (patch.paused === false && current.status === 'paused') {
			sets.push(sql`status = ${current.fill_count > 0 ? 'partial' : 'active'}`, sql`resumed_at = now()`, sql`hold_until = NULL`);
			lifecycle = 'resume';
		}
	}
	if (!sets.length) return current;

	let setClause = sets[0];
	for (let i = 1; i < sets.length; i++) setClause = sql`${setClause}, ${sets[i]}`;
	const [row] = await sql`
		UPDATE orders SET ${setClause}, updated_at = now()
		WHERE id = ${orderId} AND agent_id = ${agentId}
		RETURNING *
	`;
	const order = shapeOrder(row);
	if (order && lifecycle) await recordOrderEvent(order, lifecycle, { detail: 'by the owner' });
	return order;
}

/**
 * Cancel an order instantly. Idempotent; a filled order can't be cancelled.
 * Cancelling one leg of an OCO pair cancels the pair (the protection is one
 * unit); a ladder leg cancels alone so the owner can drop a single level.
 */
export async function cancelOrder(agentId, orderId, { reason = 'owner' } = {}) {
	if (!UUID_RE.test(orderId)) return null;
	const [row] = await sql`
		UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now(), cancel_reason = ${reason}
		WHERE id = ${orderId} AND agent_id = ${agentId}
		  AND status NOT IN ('filled', 'cancelled', 'expired')
		RETURNING *
	`;
	if (row) {
		const order = shapeOrder(row);
		await recordOrderEvent(order, 'cancel', { code: reason });
		if (order.group_kind === 'oco' && order.group_id) {
			const siblings = await sql`
				UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now(), cancel_reason = 'oco_sibling_cancelled'
				WHERE agent_id = ${agentId} AND group_id = ${order.group_id}::uuid AND id <> ${order.id}
				  AND status NOT IN ('filled', 'cancelled', 'expired')
				RETURNING *
			`;
			for (const sib of siblings) await recordOrderEvent(shapeOrder(sib), 'cancel', { code: 'oco_sibling_cancelled' });
		}
		return order;
	}
	// Already terminal (or not found) — return current state so cancel is idempotent.
	return getOrder(agentId, orderId);
}

/** Cancel every active/partial order for an agent (kill switch). Returns count. */
export async function cancelAllOrders(agentId, network = null) {
	const rows = await sql`
		UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now(), cancel_reason = 'cancel_all'
		WHERE agent_id = ${agentId}
		  AND (${network}::text IS NULL OR network = ${network})
		  AND status IN ('active', 'partial', 'firing', 'paused')
		RETURNING id
	`;
	return rows.length;
}

/** Owner-facing summary across an agent's orders. */
export async function ordersSummary(agentId, network) {
	const [agg] = await sql`
		SELECT
			COUNT(*)::int AS total,
			COUNT(*) FILTER (WHERE status IN ('active','partial','firing'))::int AS active,
			COUNT(*) FILTER (WHERE status = 'filled')::int AS filled,
			COALESCE(SUM(fill_count), 0)::int AS fills,
			COALESCE(SUM(filled_sol), 0)::float8 AS filled_sol
		FROM orders
		WHERE agent_id = ${agentId} AND (network = ${network} OR (${network}::text IS NULL AND network <> 'evm'))
	`;
	return {
		total: agg?.total || 0,
		active: agg?.active || 0,
		filled: agg?.filled || 0,
		lifetime_fills: agg?.fills || 0,
		lifetime_filled_sol: Number(agg?.filled_sol || 0),
	};
}
