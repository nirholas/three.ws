// Event Markets points rules, read from data/event-markets.json so the docs, the
// API errors and the UI quote the numbers the code enforces.

import { readFileSync } from 'node:fs';

const RAW = JSON.parse(readFileSync(new URL('../../../data/event-markets.json', import.meta.url), 'utf8'));

export const POINTS = Object.freeze({
	minPick: RAW.points.min_pick,
	maxPickPerMarket: RAW.points.max_pick_per_market,
	seasonBudget: RAW.points.season_budget,
	seasonBudgetOverrides: Object.freeze({ ...RAW.points.season_budget_overrides }),
});

export const PRIOR_POINTS_PER_OUTCOME = RAW.odds.prior_points_per_outcome;

/**
 * The season a market belongs to: the UTC calendar quarter of its lock time.
 * @param {string|number|Date} at
 */
export function seasonFor(at) {
	const d = new Date(at);
	const year = d.getUTCFullYear();
	const q = Math.floor(d.getUTCMonth() / 3);
	const id = `${year}-Q${q + 1}`;
	return {
		id,
		starts_at: new Date(Date.UTC(year, q * 3, 1)).toISOString(),
		ends_at: new Date(Date.UTC(year, q * 3 + 3, 1)).toISOString(),
		budget: POINTS.seasonBudgetOverrides[id] ?? POINTS.seasonBudget,
	};
}

/** The pick limits in the shape the API returns to clients. */
export function pointRules() {
	return { min_pick: POINTS.minPick, max_pick_per_market: POINTS.maxPickPerMarket };
}
