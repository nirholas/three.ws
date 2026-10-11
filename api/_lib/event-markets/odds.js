// Implied odds from the crowd's points. Pure, no I/O.
//
// share(outcome) = (points + k) / (total + k * n), where k is the prior points per
// outcome and n the number of outcomes. With zero picks every share is 1 / n and
// the result says so (`even_prior: true`), so a market is never shown with an
// invented favourite. The prior fades as points arrive.

import { PRIOR_POINTS_PER_OUTCOME } from './config.js';

export const ODDS_METHOD = 'Each outcome\'s share of all points picked, smoothed with a small even prior so a single early pick cannot swing it to 100%. With no picks it is an even split.';

const round1 = (v) => Math.round(v * 1000) / 10;

/**
 * @param {Array<{id: string, points?: number, picks?: number}>} outcomes
 * @param {Array<{outcome_id: string, points: number}>|{prior?: number}} [picksOrOpts]
 *   Raw pick rows to aggregate onto the outcomes, or options. When pick rows are
 *   given, the outcomes' own points and picks are ignored.
 * @param {{prior?: number}} [opts]
 */
export function impliedOdds(outcomes, picksOrOpts, opts) {
	const picks = Array.isArray(picksOrOpts) ? picksOrOpts : null;
	const prior = (Array.isArray(picksOrOpts) ? opts : picksOrOpts)?.prior ?? PRIOR_POINTS_PER_OUTCOME;

	const tally = new Map(outcomes.map((o) => [o.id, { points: picks ? 0 : Number(o.points) || 0, picks: picks ? 0 : Number(o.picks) || 0 }]));
	if (picks) {
		for (const p of picks) {
			const t = tally.get(p.outcome_id);
			if (t) { t.points += Number(p.points) || 0; t.picks += 1; }
		}
	}

	const n = outcomes.length;
	const totalPoints = [...tally.values()].reduce((s, t) => s + t.points, 0);
	const totalPicks = [...tally.values()].reduce((s, t) => s + t.picks, 0);
	const denom = totalPoints + prior * n;
	return {
		even_prior: totalPoints === 0,
		prior_points_per_outcome: prior,
		method: ODDS_METHOD,
		total_points: totalPoints,
		total_picks: totalPicks,
		outcomes: outcomes.map((o) => {
			const t = tally.get(o.id);
			const share = denom > 0 ? (t.points + prior) / denom : n ? 1 / n : 0;
			return { outcome_id: o.id, points: t.points, picks: t.picks, share, percent: round1(share) };
		}),
	};
}
