// Event Markets scoring: pure functions, no I/O. Every constant comes from
// data/event-market-scoring.json so the leaderboard page quotes the numbers the
// code actually uses. Formula and fairness checks: docs/event-markets.md.
//
// A correct call earns   stake * clamp(1 / p - 1, min_win_multiplier, max_win_multiplier)
// where p is the smoothed implied probability of the picked outcome at pick time.
// Calling a 90% favourite pays 0.11x the stake (floored at the minimum), calling a
// 10% upset pays 9x (capped at the maximum). A wrong call costs the stake. A
// season total never goes below zero: the running score is floored after every
// settled call in the order the markets settled.

import { readFileSync } from 'node:fs';

export const CONFIG = Object.freeze(
	JSON.parse(readFileSync(new URL('../../../data/event-market-scoring.json', import.meta.url), 'utf8')),
);

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));

/** Stake for a pick: the points placed, as a whole number of at least 1. The seam caps what can be placed. */
export function clampStake(points) {
	return Math.max(1, Math.round(n(points)));
}

/**
 * The implied probability scoring uses for a pick. Missing, zero or out-of-range
 * odds fall back to the even prior over `outcomeCount` outcomes (never a made-up
 * favourite), and a probability of 1 is accepted (a certain pick pays the floor).
 */
export function pickProbability(odds, outcomeCount = 2) {
	const p = Number(odds);
	if (Number.isFinite(p) && p > 0 && p <= 1) return p;
	return 1 / Math.max(2, Math.round(n(outcomeCount)) || 2);
}

/** Win multiplier for a pick made at probability `p`. */
export function winMultiplier(p, cfg = CONFIG.scoring) {
	const raw = 1 / Math.min(1, Math.max(1e-6, p)) - 1;
	return Math.min(cfg.max_win_multiplier, Math.max(cfg.min_win_multiplier, raw));
}

/**
 * Points a settled pick is worth. Correct: stake times the multiplier, rounded,
 * at least 1. Wrong: minus the stake.
 * @returns {number}
 */
export function scorePick({ correct, points, odds, outcomeCount = 2 }, cfg = CONFIG.scoring) {
	const stake = clampStake(points);
	if (!correct) return -stake;
	return Math.max(1, Math.round(stake * winMultiplier(pickProbability(odds, outcomeCount), cfg)));
}

// ── seasons ─────────────────────────────────────────────────────────────────

const SEASON_RE = /^(\d{4})-Q([1-4])$/;

/** A season is a UTC calendar quarter, keyed 'YYYY-Qn', the same season the points budget uses. */
export function seasonFor(at = Date.now()) {
	const d = new Date(ms(at));
	return seasonById(`${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`);
}

/** Parse 'YYYY-Qn' into bounds, or null. `ended` is relative to `now`. */
export function seasonById(id, now = Date.now()) {
	const m = SEASON_RE.exec(String(id || ''));
	if (!m) return null;
	const y = Number(m[1]);
	const q = Number(m[2]) - 1;
	const start = Date.UTC(y, q * 3, 1);
	const end = Date.UTC(y, q * 3 + 3, 1);
	return {
		id: m[0],
		label: `Q${q + 1} ${y}`,
		start: new Date(start).toISOString(),
		end: new Date(end).toISOString(),
		ended: ms(now) >= end,
	};
}

// ── stats ───────────────────────────────────────────────────────────────────

/**
 * Stats for one account over its ranked settled calls. Rows are
 * `{ market_id, correct, odds_at_pick, delta, settled_at }`; they are sorted here
 * by settled_at then market_id so the result never depends on read order.
 * PURE and deterministic, which is what makes a replayed rollup idempotent.
 */
export function computeStats(rows) {
	const sorted = [...rows].sort((a, b) => ms(a.settled_at) - ms(b.settled_at) || String(a.market_id).localeCompare(String(b.market_id)));
	let score = 0;
	let hits = 0;
	let oddsSum = 0;
	let run = 0;
	let longest = 0;
	let best = null;
	for (const r of sorted) {
		const delta = n(r.delta);
		score = Math.max(0, score + delta);
		oddsSum += n(r.odds_at_pick);
		if (r.correct) {
			hits += 1;
			run += 1;
			if (run > longest) longest = run;
			if (!best || delta > best.delta) best = { delta, market_id: r.market_id };
		} else {
			run = 0;
		}
	}
	return {
		calls: sorted.length,
		hits,
		score,
		avg_odds: sorted.length ? oddsSum / sorted.length : null,
		best_call_delta: best ? best.delta : 0,
		best_call_market: best ? best.market_id : null,
		current_streak: run,
		longest_streak: longest,
	};
}

/**
 * Order accounts and assign ranks. Higher score first, then more hits, then fewer
 * calls, then account id for a stable order; equal on all four share a rank.
 * `minCalls` filters out accounts that have not made enough calls to rank.
 */
export function rankAccounts(entries, { minCalls = 0 } = {}) {
	const eligible = entries.filter((e) => e.calls >= minCalls);
	eligible.sort((a, b) => b.score - a.score || b.hits - a.hits || a.calls - b.calls || String(a.account_id).localeCompare(String(b.account_id)));
	let rank = 0;
	let prev = null;
	return eligible.map((e, i) => {
		const tied = prev && prev.score === e.score && prev.hits === e.hits && prev.calls === e.calls;
		if (!tied) rank = i + 1;
		prev = e;
		return { ...e, rank };
	});
}

// ── badges ──────────────────────────────────────────────────────────────────

/**
 * Which pick badges a ranked call history has earned (season top 10 is awarded at
 * season end, see rollup.js). PURE.
 * @returns {string[]} badge codes
 */
export function pickBadgesFor(rows, cfg = CONFIG.badges) {
	if (!rows.length) return [];
	const codes = [];
	const stats = computeStats(rows);
	if (stats.hits > 0) codes.push('em_first_correct');
	if (rows.some((r) => r.correct && n(r.odds_at_pick) > 0 && n(r.odds_at_pick) < cfg.upset_probability_below)) codes.push('em_upset_call');
	if (stats.longest_streak >= cfg.streak_target) codes.push('em_streak_5');
	return codes;
}

// ── rewards ─────────────────────────────────────────────────────────────────

/** The reward tier a final season rank earns, or null. */
export function rewardForRank(rank, tiers = CONFIG.rewards.tiers) {
	return tiers.find((t) => rank >= t.from_rank && rank <= t.to_rank) || null;
}
