// The backtest: what this basket would have done, and what the rebalancing did to it.
//
// Pure functions over price series. No network, no clock, no randomness, so the
// whole thing is unit-testable and a given set of inputs always produces the
// same answer.
//
// The output that matters is not the headline return, it is the COMPARISON. A
// rebalancing portfolio is a specific claim: that periodically selling what rose
// and buying what fell beats leaving the basket alone. That claim is true for
// some baskets and false for others, and it is the one thing a person choosing a
// rebalance schedule actually needs to see. So every backtest runs the same
// basket twice, once rebalanced on its published schedule and once never
// rebalanced, and reports the difference.
//
// Prior art, and what this is NOT: it is not a strategy optimiser and it does
// not search for a schedule. It answers one question about one published
// manifest. Nothing here is fitted to the data.

/** Trading costs are not modelled; a backtest that ignores them says so. */
export const COST_MODEL = 'none';

/**
 * The days on which every supplied series has a price.
 *
 * A basket is only backtestable across the window where all of its covered legs
 * have real observations. Taking the union instead and carrying prices forward
 * would manufacture flat stretches for a token that simply was not being
 * recorded, and those show up as fake stability rather than as missing data.
 */
export function commonDays(seriesByAddress) {
	const lists = Object.values(seriesByAddress).map((s) => new Set(s.map((p) => p.day)));
	if (!lists.length) return [];
	const [first, ...rest] = lists;
	return [...first].filter((day) => rest.every((s) => s.has(day))).sort();
}

/** Index a series by day for O(1) lookup during the walk. */
function byDay(series) {
	const m = new Map();
	for (const p of series) m.set(p.day, p.priceUsd);
	return m;
}

/**
 * Largest peak-to-trough fall in a value series, as a positive percentage.
 * Zero for a series that only ever rises.
 */
export function maxDrawdownPct(values) {
	let peak = -Infinity;
	let worst = 0;
	for (const v of values) {
		if (v > peak) peak = v;
		if (peak > 0) {
			const dd = ((peak - v) / peak) * 100;
			if (dd > worst) worst = dd;
		}
	}
	return worst;
}

/** Annualised standard deviation of daily returns, in percent. */
export function volatilityPct(values) {
	if (values.length < 3) return null;
	const rets = [];
	for (let i = 1; i < values.length; i++) {
		if (values[i - 1] > 0) rets.push(values[i] / values[i - 1] - 1);
	}
	if (rets.length < 2) return null;
	const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
	const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
	return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

/**
 * Walk a basket through a price history.
 *
 * @param {object} args
 * @param {Array<{address:string,weightBps:number}>} args.legs Covered constituents, weights renormalised to these legs.
 * @param {Record<string, Array<{day:string,priceUsd:number}>>} args.series Daily closes per address.
 * @param {number} args.rebalanceDays Days between rebalances. 0 means never.
 * @param {number} [args.startValueUsd]
 */
export function walk({ legs, series, rebalanceDays, startValueUsd = 10_000 }) {
	const days = commonDays(series);
	if (days.length < 2) return { days: [], values: [], rebalances: 0 };

	const prices = {};
	for (const [addr, s] of Object.entries(series)) prices[addr] = byDay(s);

	const totalBps = legs.reduce((a, l) => a + l.weightBps, 0) || 1;
	const target = new Map(legs.map((l) => [l.address, l.weightBps / totalBps]));

	// Units are set once at the start, and reset at each rebalance to whatever
	// the current total value implies at target weights. Between rebalances the
	// basket simply drifts, which is the behaviour being measured.
	let units = new Map();
	const allocate = (value, day) => {
		const next = new Map();
		for (const l of legs) {
			const p = prices[l.address].get(day);
			next.set(l.address, p > 0 ? (value * target.get(l.address)) / p : 0);
		}
		return next;
	};

	const valueOn = (day) => {
		let v = 0;
		for (const l of legs) v += (units.get(l.address) || 0) * (prices[l.address].get(day) || 0);
		return v;
	};

	units = allocate(startValueUsd, days[0]);
	const values = [startValueUsd];
	let rebalances = 0;
	let sinceRebalance = 0;

	for (let i = 1; i < days.length; i++) {
		const day = days[i];
		sinceRebalance++;
		let v = valueOn(day);
		if (rebalanceDays > 0 && sinceRebalance >= rebalanceDays) {
			units = allocate(v, day);
			rebalances++;
			sinceRebalance = 0;
			v = valueOn(day);
		}
		values.push(v);
	}

	return { days, values, rebalances };
}

/**
 * Run the basket both ways and summarise.
 *
 * `legs` are the constituents that actually have history; the caller decides
 * which those are and reports the rest as uncovered. Weights are renormalised
 * across the covered legs so the simulated basket is fully invested, and the
 * covered fraction is reported so nobody reads a 40%-covered backtest as if it
 * described the whole portfolio.
 */
export function backtest({ legs, series, rebalanceDays, startValueUsd = 10_000 }) {
	const rebalanced = walk({ legs, series, rebalanceDays, startValueUsd });
	const held = walk({ legs, series, rebalanceDays: 0, startValueUsd });

	if (rebalanced.days.length < 2) {
		return {
			ok: false,
            reason: 'not enough overlapping history to run a backtest',
			days: rebalanced.days,
		};
	}

	const summarise = (run) => {
		const start = run.values[0];
		const end = run.values[run.values.length - 1];
		return {
			startValueUsd: start,
			endValueUsd: end,
			totalReturnPct: start > 0 ? (end / start - 1) * 100 : null,
			maxDrawdownPct: maxDrawdownPct(run.values),
			volatilityPct: volatilityPct(run.values),
			rebalances: run.rebalances,
			series: run.days.map((day, i) => ({ day, valueUsd: run.values[i] })),
		};
	};

	const r = summarise(rebalanced);
	const h = summarise(held);

	return {
		ok: true,
		costModel: COST_MODEL,
		windowDays: rebalanced.days.length,
		from: rebalanced.days[0],
		to: rebalanced.days[rebalanced.days.length - 1],
		rebalanced: r,
		heldWithoutRebalancing: h,
		// The number the schedule is actually judged on.
		rebalancingAddedPct: r.totalReturnPct != null && h.totalReturnPct != null ? r.totalReturnPct - h.totalReturnPct : null,
	};
}
