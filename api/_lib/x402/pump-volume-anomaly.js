// api/_lib/x402/pump-volume-anomaly.js
//
// Pump.fun volume-anomaly detector — the data engine behind the
// `pump_volume_anomaly` topic of POST /api/x402/crypto-intel.
//
// "Abnormal trading volume in the last hour" is defined cross-sectionally: across
// the set of currently-live pump.fun coins, we measure each coin's USD trade
// volume in the trailing window (default 1 h) and compare the busiest coin to the
// MEDIAN of its peers. A coin whose last-hour volume is a large multiple of the
// median active coin is a genuine statistical outlier — the attention/volume
// spike a sniper or oracle wants to know about before price catches up.
//
// Every byte is live: the candidate set comes from pump.fun's currently-live
// board (frontend-api-v3) and per-coin volume is summed from the coin's trades
// decoded from Solana (fetchPumpTrades; pump.fun retired its HTTP trade feeds
// on 2026-11-25). No mocks, no synthetic coins.
//
// The pure scoring functions (summarizeWindowUsd, median, scoreVolumeAnomaly,
// buildAnomalySignal) take plain data so they are unit-testable without network;
// detectPumpVolumeAnomaly() wires them to the live feeds.

import { fetchPumpTrades } from '../pump-feed-fetch.js';

const PUMP_FRONTEND_BASE =
	process.env.PUMP_FRONTEND_BASE || 'https://frontend-api-v3.pump.fun';
const UA = 'three.ws-x402-pump-volume/1';

// Tunables (env-overridable so production can adjust sensitivity without a deploy).
export const DEFAULTS = {
	candidates: Number(process.env.PUMP_ANOMALY_CANDIDATES || 24), // coins to scan
	tradeLimit: Number(process.env.PUMP_ANOMALY_TRADE_LIMIT || 100), // trades/coin
	windowSec: Number(process.env.PUMP_ANOMALY_WINDOW_SEC || 3600), // trailing 1 h
	ratioThreshold: Number(process.env.PUMP_ANOMALY_RATIO || 3), // anomaly when ratio ≥ this
	minUsd: Number(process.env.PUMP_ANOMALY_MIN_USD || 250), // absolute volume floor
	concurrency: Number(process.env.PUMP_ANOMALY_CONCURRENCY || 6),
	fetchTimeoutMs: Number(process.env.PUMP_ANOMALY_TIMEOUT_MS || 6000),
};

// ── pure helpers ─────────────────────────────────────────────────────────────

function num(v) {
	const n = typeof v === 'string' ? parseFloat(v) : v;
	return Number.isFinite(n) ? n : null;
}

/** Parse a swap-API trade timestamp (ISO string or epoch s/ms) → ms, or null. */
function tradeTimeMs(t) {
	const raw = t?.timestamp ?? t?.ts ?? null;
	if (raw == null) return null;
	if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw; // s → ms
	const parsed = Date.parse(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Sum the USD volume of trades that fall within [nowMs - windowSec, nowMs].
 * Pure — caller supplies nowMs so it is deterministic under test.
 * @returns {{ usd: number, count: number }}
 */
export function summarizeWindowUsd(trades, nowMs, windowSec = DEFAULTS.windowSec) {
	if (!Array.isArray(trades)) return { usd: 0, count: 0 };
	const floor = nowMs - windowSec * 1000;
	let usd = 0;
	let count = 0;
	for (const t of trades) {
		const tMs = tradeTimeMs(t);
		if (tMs == null || tMs < floor || tMs > nowMs) continue;
		// swap-api reports the per-trade USD notional directly on amountUsd. Only
		// real USD figures count toward the volume sum — a trade without one is
		// skipped rather than guessed from mismatched units.
		const v = num(t.amountUsd ?? t.usd_amount);
		if (v == null || v <= 0) continue;
		usd += v;
		count += 1;
	}
	return { usd, count };
}

/** Median of a numeric array (0 for empty). Pure. */
export function median(nums) {
	const xs = (nums || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
	if (!xs.length) return 0;
	const mid = Math.floor(xs.length / 2);
	return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function round(n, dp = 2) {
	if (!Number.isFinite(n)) return null;
	const f = 10 ** dp;
	return Math.round(n * f) / f;
}

/**
 * Score a set of per-coin last-window volume samples into an anomaly verdict.
 * @param {Array<{mint:string,name?:string,symbol?:string,window_usd:number,trade_count?:number}>} samples
 * @param {object} [opts] { ratioThreshold, minUsd }
 * @returns {{
 *   anomaly: boolean, mint: string|null, name: string|null, symbol: string|null,
 *   volume_ratio: number|null, top_window_usd: number|null, baseline_usd: number|null,
 *   candidates: number, active: number, trade_count: number|null, reason?: string
 * }}
 */
export function scoreVolumeAnomaly(samples, opts = {}) {
	const ratioThreshold = opts.ratioThreshold ?? DEFAULTS.ratioThreshold;
	const minUsd = opts.minUsd ?? DEFAULTS.minUsd;

	const list = Array.isArray(samples) ? samples : [];
	const active = list
		.filter((s) => s && Number.isFinite(s.window_usd) && s.window_usd > 0)
		.sort((a, b) => b.window_usd - a.window_usd);

	const base = {
		anomaly: false,
		mint: null,
		name: null,
		symbol: null,
		volume_ratio: null,
		top_window_usd: null,
		baseline_usd: null,
		candidates: list.length,
		active: active.length,
		trade_count: null,
	};

	// Need a population to compare against — one lone trader is not an "anomaly".
	if (active.length < 3) {
		return { ...base, reason: 'insufficient_active_coins' };
	}

	const top = active[0];
	const rest = active.slice(1).map((s) => s.window_usd);
	// Robust baseline: median of the peer coins. Fall back to the mean, then to the
	// smallest positive peer, so a degenerate distribution can't divide by zero.
	let baseline = median(rest);
	if (!(baseline > 0)) baseline = rest.reduce((a, b) => a + b, 0) / rest.length;
	if (!(baseline > 0)) baseline = Math.min(...rest.filter((v) => v > 0));
	if (!(baseline > 0)) return { ...base, reason: 'no_peer_baseline' };

	const ratio = top.window_usd / baseline;
	const anomaly = ratio >= ratioThreshold && top.window_usd >= minUsd;

	return {
		anomaly,
		mint: top.mint || null,
		name: top.name || null,
		symbol: top.symbol || null,
		volume_ratio: round(ratio),
		top_window_usd: round(top.window_usd),
		baseline_usd: round(baseline),
		candidates: list.length,
		active: active.length,
		trade_count: Number.isFinite(top.trade_count) ? top.trade_count : null,
	};
}

/**
 * Turn an anomaly score into the crypto-intel signal envelope (topic / signal /
 * headline / rationale / confidence). Pure. A volume spike is an attention signal,
 * so it maps to 'bullish'; a quiet market maps to 'neutral'.
 */
export function buildAnomalySignal(score, windowSec = DEFAULTS.windowSec) {
	const mins = Math.round(windowSec / 60);
	const label = score.symbol || score.name || (score.mint ? `${score.mint.slice(0, 4)}…` : 'a coin');
	const usd = (n) => `$${Math.round(n || 0).toLocaleString('en-US')}`;

	if (score.anomaly) {
		const ratio = score.volume_ratio;
		// High conviction once the spike is a large multiple of the peer median.
		const highConviction = ratio > 5;
		const confidence = Math.min(0.96, 0.6 + Math.min(ratio / 25, 0.36));
		return {
			signal: 'bullish',
			conviction: highConviction ? 'high' : 'normal',
			headline:
				`${label} volume anomaly — ${ratio}× peer median ` +
				`(${usd(score.top_window_usd)} in last ${mins}m)`,
			rationale:
				`Across ${score.active} actively-trading pump.fun coins, ${label} traded ` +
				`${usd(score.top_window_usd)} in the last ${mins} minutes — ${ratio}× the ` +
				`${usd(score.baseline_usd)} median of its peers. A volume spike of this ` +
				`magnitude typically precedes a price/attention move; treat as a fresh ` +
				`${highConviction ? 'high-conviction ' : ''}momentum candidate.`,
			confidence: round(confidence, 4),
		};
	}

	return {
		signal: 'neutral',
		conviction: 'none',
		headline: `No abnormal pump.fun volume in the last ${mins}m`,
		rationale:
			`Scanned ${score.candidates} candidate coins (${score.active} actively trading). ` +
			(score.reason === 'insufficient_active_coins'
				? 'Too few active coins to establish a baseline this window.'
				: `The busiest coin's volume sits within normal range of the peer median ` +
					`(ratio ${score.volume_ratio ?? 'n/a'}). No outlier worth acting on.`),
		confidence: 0.5,
	};
}

// ── live fetch layer ─────────────────────────────────────────────────────────

function defaultFetchJson(timeoutMs) {
	return async (url) => {
		const ctrl = new AbortController();
		const tid = setTimeout(() => ctrl.abort(), timeoutMs);
		try {
			const r = await fetch(url, {
				signal: ctrl.signal,
				headers: { accept: 'application/json', 'user-agent': UA },
			});
			if (!r.ok) return null;
			return await r.json();
		} catch {
			return null;
		} finally {
			clearTimeout(tid);
		}
	};
}

/** Run fn over items with bounded concurrency, preserving order. */
async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let cursor = 0;
	const workerCount = Math.max(1, Math.min(limit, items.length));
	const workers = Array.from({ length: workerCount }, async () => {
		for (;;) {
			const idx = cursor++;
			if (idx >= items.length) break;
			out[idx] = await fn(items[idx], idx);
		}
	});
	await Promise.all(workers);
	return out;
}

/** Pull the live candidate coin set (currently-live board, newest-trade fallback). */
async function fetchCandidates(fetchJson, limit) {
	const n = Math.min(100, Math.max(3, limit));
	const live = await fetchJson(
		`${PUMP_FRONTEND_BASE}/coins/currently-live?offset=0&limit=${n}&includeNsfw=false`,
	);
	let list = Array.isArray(live) ? live : Array.isArray(live?.coins) ? live.coins : [];
	if (list.length < 3) {
		// Fallback: most-recently-traded coins are the next-best "active" proxy.
		const recent = await fetchJson(
			`${PUMP_FRONTEND_BASE}/coins?offset=0&limit=${n}&sort=last_trade_timestamp&order=DESC&includeNsfw=false`,
		);
		const r = Array.isArray(recent) ? recent : Array.isArray(recent?.coins) ? recent.coins : [];
		if (r.length > list.length) list = r;
	}
	return list
		.filter((c) => c && c.mint)
		.map((c) => ({ mint: c.mint, name: c.name || null, symbol: c.symbol || null }));
}

/**
 * Detect the top pump.fun volume anomaly in the trailing window, live.
 *
 * @param {object} [opts] overrides for DEFAULTS, plus:
 *   nowMs       — clock injection (defaults to Date.now())
 *   fetchJson   — (url)=>Promise<json|null> injection for tests
 * @returns {Promise<object>} full intel envelope (topic/signal/headline/.../anomaly/mint/volume_ratio)
 * @throws {Error & {status:503}} when no live candidate data could be fetched (so the
 *   paid endpoint returns 503 BEFORE settlement and the buyer is never charged).
 */
export async function detectPumpVolumeAnomaly(opts = {}) {
	const cfg = { ...DEFAULTS, ...opts };
	const fetchJson = opts.fetchJson || defaultFetchJson(cfg.fetchTimeoutMs);
	const nowMs = opts.nowMs ?? Date.now();

	const candidates = await fetchCandidates(fetchJson, cfg.candidates);
	if (!candidates.length) {
		throw Object.assign(new Error('pump.fun live feed is temporarily unavailable'), {
			status: 503,
			code: 'data_unavailable',
		});
	}

	const samples = await mapLimit(candidates, cfg.concurrency, async (c) => {
		const feed = await fetchPumpTrades(c.mint, { limit: cfg.tradeLimit });
		const trades = feed?.rows || [];
		const { usd, count } = summarizeWindowUsd(trades, nowMs, cfg.windowSec);
		return { ...c, window_usd: usd, trade_count: count };
	});

	// If every trade read failed (Solana RPC down) we have no signal to
	// sell — surface as 503 so the buyer is not charged for an empty verdict.
	if (!samples.some((s) => s.trade_count > 0)) {
		throw Object.assign(new Error('pump.fun trade feed is temporarily unavailable'), {
			status: 503,
			code: 'data_unavailable',
		});
	}

	const score = scoreVolumeAnomaly(samples, cfg);
	const sig = buildAnomalySignal(score, cfg.windowSec);

	return {
		topic: 'pump_volume_anomaly',
		anomaly: score.anomaly,
		mint: score.mint,
		volume_ratio: score.volume_ratio,
		token_name: score.name,
		token_symbol: score.symbol,
		top_window_usd: score.top_window_usd,
		baseline_usd: score.baseline_usd,
		window_sec: cfg.windowSec,
		candidates_scanned: score.candidates,
		active_coins: score.active,
		signal: sig.signal,
		conviction: sig.conviction,
		headline: sig.headline,
		rationale: sig.rationale,
		confidence: sig.confidence,
		ts: new Date(nowMs).toISOString(),
	};
}

/**
 * Lift a pump_volume_anomaly response into the x402_autonomous_log.signal_data /
 * oracle_intel_signals shape. Shared by the registry entry's extractSignal so the
 * autonomous log and the oracle dedup always agree. High-conviction spikes
 * (anomaly && ratio > 5) are tagged so the sniper gate can prioritise them.
 */
export function classifyVolumeAnomaly(r) {
	const o = r || {};
	const ratio = num(o.volume_ratio);
	const highConviction = o.anomaly === true && ratio != null && ratio > 5;
	return {
		topic: 'pump_volume_anomaly',
		anomaly: o.anomaly === true,
		mint: o.mint || null,
		volume_ratio: ratio,
		conviction: highConviction ? 'high' : o.anomaly === true ? 'normal' : 'none',
		signal: typeof o.signal === 'string' ? o.signal : o.anomaly === true ? 'bullish' : 'neutral',
		headline: typeof o.headline === 'string' ? o.headline : null,
		// Bump confidence for high-conviction spikes so the oracle row the sniper
		// reads reflects the escalation the task calls for.
		confidence: highConviction
			? Math.max(0.85, num(o.confidence) ?? 0)
			: num(o.confidence),
		token_symbol: o.token_symbol || null,
		top_window_usd: num(o.top_window_usd),
		baseline_usd: num(o.baseline_usd),
	};
}
