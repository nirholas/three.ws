// Statistics for the LLM evals: percentiles, seeded bootstrap confidence
// intervals for a rate and for a paired difference, and cost per 1,000 calls.
// Seeded so a regenerated report prints the same intervals for the same data.

export function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function mean(values) {
	return values.length ? values.reduce((s, v) => s + v, 0) / values.length : NaN;
}

/** Nearest-rank percentile (p in 0..100) of a list of numbers. */
export function percentile(values, p) {
	const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!xs.length) return NaN;
	const rank = Math.ceil((p / 100) * xs.length);
	return xs[Math.min(xs.length - 1, Math.max(0, rank - 1))];
}

function quantileSorted(sorted, q) {
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

/**
 * Percentile bootstrap of the mean: { mean, lo, hi } for a (1 - alpha) interval.
 * Values are per-item scores (1/0 for pass/fail, 0/0.5/1 for pairwise wins).
 */
export function bootstrapMean(values, { iters = 4000, alpha = 0.05, seed = 7 } = {}) {
	const n = values.length;
	if (!n) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
	const rand = mulberry32(seed);
	const means = new Array(iters);
	for (let i = 0; i < iters; i++) {
		let s = 0;
		for (let j = 0; j < n; j++) s += values[Math.floor(rand() * n)];
		means[i] = s / n;
	}
	means.sort((a, b) => a - b);
	return { mean: mean(values), lo: quantileSorted(means, alpha / 2), hi: quantileSorted(means, 1 - alpha / 2), n };
}

/**
 * Paired bootstrap of mean(b - a) over items both lanes answered. `a` and `b`
 * are aligned arrays (same item at the same index). A tie is excluded when the
 * interval does not contain 0.
 */
export function pairedBootstrapDiff(a, b, opts = {}) {
	if (a.length !== b.length) throw new Error('paired arrays differ in length');
	return bootstrapMean(a.map((v, i) => b[i] - v), opts);
}

/** True when an interval excludes `tie` on the winning side. */
export function excludesTie(ci, tie = 0) {
	return Number.isFinite(ci.lo) && ci.lo > tie;
}

/** USD per 1,000 calls from per-call costs in micro-USD; null when any cost is unknown. */
export function costPer1k(costsMicroUsd) {
	if (!costsMicroUsd.length || costsMicroUsd.some((c) => c === null || c === undefined || !Number.isFinite(c))) return null;
	return (mean(costsMicroUsd) * 1000) / 1_000_000;
}
