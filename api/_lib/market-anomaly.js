// Market anomaly detection: the pure engine. No DB, no network, no env, so every
// verdict is a deterministic function of the series it is handed and can be
// unit-tested on recorded data (tests/market-anomaly.test.js).
//
// This is the market-side sibling of api/_lib/wallet-anomaly.js (which scores a
// single agent's outbound spend). Three statistical detectors run over a time
// series, and a processor turns their agreement into a labelled anomaly:
//
//   modified z-score   median/MAD based (Iglewicz-Hoaglin), robust to the very
//                      outliers it is hunting; flags |M| >= 3.5
//   EWMA deviation     exponentially weighted mean and variance, so a series
//                      that has been drifting is judged against its recent
//                      regime rather than its whole history
//   rate of change     plain percent move over the window, the magnitude gate
//                      that keeps a statistically odd but economically tiny
//                      wiggle (a stablecoin supply moving 0.01%) from firing
//
// A processor fires when a statistical detector AND the magnitude gate agree.
// Sparse series are refused with a reason instead of scored (a z-score over six
// points is noise): see MIN_POINTS and the `skipped` result.
//
// Series are ascending arrays of { t: epoch ms, v: number }. Fetching them is
// api/_lib/market-anomaly-sources.js; persisting events is
// api/cron/market-anomalies.js.

export const MODIFIED_Z_THRESHOLD = 3.5;
export const EWMA_Z_THRESHOLD = 3;
export const EWMA_LAMBDA = 0.2;
const MAD_SCALE = 0.6745;
const MEAN_AD_SCALE = 1.253314;
/** Fewest history observations a z-score may be computed over. */
export const MIN_POINTS = 24;

export const SEVERITIES = Object.freeze(['medium', 'high', 'critical']);
const SEVERITY_RANK = Object.freeze({ medium: 1, high: 2, critical: 3 });

export const PROCESSORS = Object.freeze(['price', 'tvl', 'stablecoin_supply', 'stablecoin_peg', 'funding', 'open_interest']);

/** @param {number} severity @param {string} min */
export function meetsSeverity(severity, min) {
	return (SEVERITY_RANK[severity] || 0) >= (SEVERITY_RANK[min] || 0);
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

export function median(values) {
	if (!values.length) return NaN;
	const s = [...values].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Modified z-score of `x` against `history`. Falls back to the mean absolute
 * deviation when more than half the history is identical (MAD = 0), the case
 * for a flat series. Returns null when the history has no spread at all, since
 * any deviation from a constant is infinitely surprising and not a usable score.
 * @param {number[]} history
 * @param {number} x
 * @returns {{ score: number, median: number, spread: number } | null}
 */
export function modifiedZScore(history, x) {
	const h = history.filter(finite);
	if (h.length < 2 || !finite(x)) return null;
	const med = median(h);
	const mad = median(h.map((v) => Math.abs(v - med)));
	if (mad > 0) return { score: (MAD_SCALE * (x - med)) / mad, median: med, spread: mad / MAD_SCALE };
	const meanAd = h.reduce((a, v) => a + Math.abs(v - med), 0) / h.length;
	if (meanAd > 0) return { score: (x - med) / (MEAN_AD_SCALE * meanAd), median: med, spread: MEAN_AD_SCALE * meanAd };
	return null;
}

/**
 * Deviation of `x` from the exponentially weighted mean of `history`, in units
 * of the exponentially weighted standard deviation.
 * @param {number[]} history
 * @param {number} x
 * @param {number} [lambda] weight on the newest observation, 0 to 1
 * @returns {{ score: number, mean: number, sigma: number } | null}
 */
export function ewmaDeviation(history, x, lambda = EWMA_LAMBDA) {
	const h = history.filter(finite);
	if (h.length < 2 || !finite(x)) return null;
	let mean = h[0];
	let variance = 0;
	for (let i = 1; i < h.length; i++) {
		const d = h[i] - mean;
		mean += lambda * d;
		variance = (1 - lambda) * (variance + lambda * d * d);
	}
	const sigma = Math.sqrt(variance);
	if (!(sigma > 0)) return null;
	return { score: (x - mean) / sigma, mean, sigma };
}

/** Percent change from `prev` to `now`; null when `prev` is not a positive base. */
export function rateOfChange(prev, now) {
	if (!finite(prev) || !finite(now) || prev <= 0) return null;
	return ((now - prev) / prev) * 100;
}

/**
 * Severity from the strongest statistical score and the size of the move.
 * Both must clear their rung; the lower of the two decides, so a huge z on a
 * 1% move stays "medium".
 */
export function classify(absScore, absChangePct, gates) {
	const [mid, hi, crit] = gates;
	const byScore = absScore >= 8 ? 3 : absScore >= 5 ? 2 : 1;
	const byMove = absChangePct >= crit ? 3 : absChangePct >= hi ? 2 : absChangePct >= mid ? 1 : 0;
	const rank = Math.min(byScore, byMove);
	return rank >= 3 ? 'critical' : rank === 2 ? 'high' : rank === 1 ? 'medium' : null;
}

/**
 * Rolling `lookback`-step returns of a series, in percent, newest last.
 * @param {{ t: number, v: number }[]} points
 * @param {number} lookback
 */
export function windowReturns(points, lookback) {
	const out = [];
	for (let i = lookback; i < points.length; i++) {
		const r = rateOfChange(points[i - lookback].v, points[i].v);
		if (r != null) out.push({ t: points[i].t, r });
	}
	return out;
}

/**
 * @typedef {Object} SeriesSpec
 * @property {string} processor     one of PROCESSORS
 * @property {string} subject       what the series describes (coin id, chain, symbol)
 * @property {string} metric        human metric name
 * @property {'returns'|'levels'} mode  score the window return, or the level itself
 * @property {number} [lookback]    steps per return window (returns mode)
 * @property {number} minChangePct  magnitude gate: smallest |move| (returns) or |level| (levels)
 * @property {[number, number, number]} severityGates  |move| rungs for medium, high, critical
 * @property {number} bucketMs      dedupe bucket: one event per series per bucket
 * @property {number} [minPoints]
 * @property {string} [unit]        'pct' for percent-valued levels, else ''
 */

/**
 * Run the detectors over one series.
 * @param {SeriesSpec} spec
 * @param {{ t: number, v: number }[]} rawPoints ascending
 * @returns {{ anomaly: object } | { skipped: string, have: number, need: number } | { anomaly: null }}
 */
export function detectSeries(spec, rawPoints) {
	const points = rawPoints.filter((p) => p && finite(p.t) && finite(p.v)).sort((a, b) => a.t - b.t);
	const lookback = spec.mode === 'returns' ? Math.max(1, spec.lookback || 1) : 0;
	const need = (spec.minPoints ?? MIN_POINTS) + lookback + 1;
	if (points.length < need) {
		return { skipped: 'insufficient_history', have: points.length, need };
	}

	let history;
	let x;
	let changePct;
	let baselineLevel;
	if (spec.mode === 'returns') {
		const rets = windowReturns(points, lookback);
		if (rets.length < (spec.minPoints ?? MIN_POINTS) + 1) {
			return { skipped: 'insufficient_history', have: rets.length, need: (spec.minPoints ?? MIN_POINTS) + 1 };
		}
		x = rets[rets.length - 1].r;
		history = rets.slice(0, -1).map((p) => p.r);
		changePct = x;
		baselineLevel = points[points.length - 1 - lookback].v;
	} else {
		x = points[points.length - 1].v;
		history = points.slice(0, -1).map((p) => p.v);
		changePct = null;
		baselineLevel = median(history);
	}

	const mz = modifiedZScore(history, x);
	const ew = ewmaDeviation(history, x);
	if (!mz && !ew) return { skipped: 'flat_history', have: points.length, need };

	const magnitude = spec.mode === 'returns' ? Math.abs(changePct) : Math.abs(x);
	if (magnitude < spec.minChangePct) return { anomaly: null };

	const mzHit = mz && Math.abs(mz.score) >= MODIFIED_Z_THRESHOLD;
	const ewHit = ew && Math.abs(ew.score) >= EWMA_Z_THRESHOLD;
	if (!mzHit && !ewHit) return { anomaly: null };

	const score = Math.max(mzHit ? Math.abs(mz.score) : 0, ewHit ? Math.abs(ew.score) : 0);
	const signed = (mzHit ? mz.score : ew.score) ?? 0;
	const severity = classify(score, magnitude, spec.severityGates);
	if (!severity) return { anomaly: null };

	const last = points[points.length - 1];
	return {
		anomaly: {
			processor: spec.processor,
			subject: spec.subject,
			metric: spec.metric,
			severity,
			direction: (spec.mode === 'returns' ? changePct : signed) >= 0 ? 'up' : 'down',
			value: last.v,
			baseline: baselineLevel,
			change_pct: round(changePct ?? x - baselineLevel, 3),
			score: round(score, 2),
			detectors: [mzHit && 'modified_z', ewHit && 'ewma', 'rate_of_change'].filter(Boolean),
			observed_at: new Date(last.t).toISOString(),
			event_key: `${spec.processor}:${spec.subject}:${spec.metric}:${Math.floor(last.t / spec.bucketMs)}`,
			summary: summarize(spec, last.v, baselineLevel, changePct, x),
		},
	};
}

function round(n, dp) {
	const f = 10 ** dp;
	return Math.round(n * f) / f;
}

const compact = (n) => {
	const a = Math.abs(n);
	if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
	if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
	if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
	return a >= 1 ? n.toFixed(2) : n.toPrecision(3);
};

function summarize(spec, value, baseline, changePct, level) {
	if (spec.mode === 'returns') {
		const dir = changePct >= 0 ? 'rose' : 'fell';
		return `${spec.subject} ${spec.metric} ${dir} ${Math.abs(changePct).toFixed(2)}% over the last ${spec.windowLabel || 'window'}, to ${compact(value)} (from ${compact(baseline)})`;
	}
	return `${spec.subject} ${spec.metric} at ${level.toFixed(4)}${spec.unit === 'pct' ? '%' : ''} against a typical ${baseline.toFixed(4)}${spec.unit === 'pct' ? '%' : ''}`;
}

// ── Processors: one per data source, each pure over the series it is given ──

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Hourly coin price series (CoinGecko 7d sparkline, 168 points). */
export const PRICE_SPEC = Object.freeze({
	processor: 'price', metric: 'price', mode: 'returns', lookback: 4, windowLabel: '4 hours',
	minChangePct: 4, severityGates: [4, 8, 15], bucketMs: 6 * HOUR,
});
/** Daily Solana DeFi TVL. */
export const TVL_SPEC = Object.freeze({
	processor: 'tvl', metric: 'TVL', mode: 'returns', lookback: 1, windowLabel: 'day',
	minChangePct: 5, severityGates: [5, 10, 20], bucketMs: DAY,
});
/** Daily Solana stablecoin circulating supply. */
export const STABLE_SUPPLY_SPEC = Object.freeze({
	processor: 'stablecoin_supply', metric: 'stablecoin supply', mode: 'returns', lookback: 1, windowLabel: 'day',
	minChangePct: 1.5, severityGates: [1.5, 4, 8], bucketMs: DAY,
});
/** Hourly perp funding, as the 8h-equivalent percent (api/_lib/hyperliquid.js units). */
export const FUNDING_SPEC = Object.freeze({
	processor: 'funding', metric: 'funding rate (8h)', mode: 'levels', unit: 'pct',
	minChangePct: 0.05, severityGates: [0.05, 0.1, 0.25], bucketMs: 8 * HOUR,
});
/** Open interest snapshots written by the cron itself. */
export const OPEN_INTEREST_SPEC = Object.freeze({
	processor: 'open_interest', metric: 'open interest', mode: 'returns', lookback: 4, windowLabel: 'hour',
	minChangePct: 10, severityGates: [10, 20, 40], bucketMs: 4 * HOUR,
});

/**
 * Stablecoin peg check: a point-in-time price has no series, so this is a plain
 * threshold on |price - 1|, severity by depth. Only USD-pegged assets with real
 * float are judged; a thin experimental coin trading at $0.97 is not news.
 * @param {{ symbol: string, price: number|null, peg_type: string|null, circulating_usd: number }} coin
 * @param {number} [now]
 */
export const PEG_MIN_CIRCULATING_USD = 10_000_000;
export function detectPegDeviation(coin, now = Date.now()) {
	if (!coin || coin.peg_type !== 'peggedUSD' || !finite(coin.price) || coin.price <= 0) return null;
	if (!(coin.circulating_usd >= PEG_MIN_CIRCULATING_USD)) return null;
	const devPct = (coin.price - 1) * 100;
	const abs = Math.abs(devPct);
	const severity = abs >= 3 ? 'critical' : abs >= 1 ? 'high' : abs >= 0.5 ? 'medium' : null;
	if (!severity) return null;
	const bucketMs = 12 * HOUR;
	return {
		processor: 'stablecoin_peg',
		subject: coin.symbol,
		metric: 'peg',
		severity,
		direction: devPct >= 0 ? 'up' : 'down',
		value: coin.price,
		baseline: 1,
		change_pct: round(devPct, 3),
		score: round(abs, 2),
		detectors: ['peg_threshold'],
		observed_at: new Date(now).toISOString(),
		event_key: `stablecoin_peg:${coin.symbol}:peg:${Math.floor(now / bucketMs)}`,
		summary: `${coin.symbol} is trading at $${coin.price.toFixed(4)}, ${abs.toFixed(2)}% ${devPct < 0 ? 'below' : 'above'} its $1 peg`,
	};
}

/**
 * Run a spec over many subjects' series. Returns the anomalies and a skip log
 * (one entry per series refused as too sparse or flat) so a thin source is
 * visible rather than silently scoring nothing.
 * @param {SeriesSpec} spec  spec without a subject
 * @param {{ subject: string, points: { t: number, v: number }[] }[]} seriesList
 */
export function detectMany(spec, seriesList) {
	const anomalies = [];
	const skipped = [];
	for (const s of seriesList) {
		const r = detectSeries({ ...spec, subject: s.subject }, s.points);
		if ('anomaly' in r) {
			if (r.anomaly) anomalies.push(r.anomaly);
		} else {
			skipped.push({ processor: spec.processor, subject: s.subject, reason: r.skipped, have: r.have, need: r.need });
		}
	}
	return { anomalies, skipped };
}
