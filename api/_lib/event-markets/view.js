// Public shape of a market: what the REST reads and the MCP tools return.

import { impliedOdds, ODDS_METHOD } from './odds.js';
import { seasonFor } from './config.js';
import { describeRule } from './resolvers/index.js';

const RESOLUTION_BY_KIND = {
	arena_tournament: 'Resolves to the entrant ranked first in the tournament\'s final standings.',
	event_leaderboard: 'Resolves to the entrant ranked first on the event leaderboard when the event closes.',
	launch_cohort: 'Resolves to the cohort project that finishes first on the cohort\'s published ranking.',
	build_round: 'Resolves to the entrant the round\'s results name as the winner.',
	bounty: 'Resolves to the entrant whose submission the bounty owner accepts.',
	custom: 'Resolved by a three.ws admin from the event\'s published result.',
};

/** The resolution rule in plain words. An explicit rule.text always wins. */
export function describeResolution(sourceKind, rule) {
	const text = rule && typeof rule === 'object' && typeof rule.text === 'string' ? rule.text.trim() : '';
	if (text) return text;
	return describeRule({ source_kind: sourceKind, resolution_rule: rule }) || RESOLUTION_BY_KIND[sourceKind] || RESOLUTION_BY_KIND.custom;
}

/** Stored status folded with the clock: an open market past locks_at is locked. */
export function effectiveStatus(row, now = Date.now()) {
	if (row.status === 'open' && new Date(row.locks_at).getTime() <= now) return 'locked';
	return row.status;
}

const iso = (v) => (v == null ? null : new Date(v).toISOString());

/**
 * @param {object} market  event_markets row
 * @param {Array<object>} outcomes  rows with points and picks aggregates
 * @param {number} [now]
 */
export function marketView(market, outcomes, now = Date.now()) {
	const status = effectiveStatus(market, now);
	const odds = impliedOdds(outcomes.map((o) => ({ id: o.id, points: o.points, picks: o.picks })));
	const byId = new Map(odds.outcomes.map((o) => [o.outcome_id, o]));
	const winnerRow = market.winner_outcome_id ? outcomes.find((o) => o.id === market.winner_outcome_id) : null;
	const locksMs = new Date(market.locks_at).getTime();
	return {
		id: market.id,
		slug: market.slug,
		title: market.title,
		description: market.description || null,
		source_kind: market.source_kind,
		source_ref: market.source_ref || null,
		status,
		opens_at: iso(market.opens_at),
		locks_at: iso(market.locks_at),
		resolves_at: iso(market.resolves_at),
		seconds_to_lock: status === 'open' ? Math.max(0, Math.round((locksMs - now) / 1000)) : 0,
		resolution_rule: market.resolution_rule || {},
		resolution_text: describeResolution(market.source_kind, market.resolution_rule),
		season: seasonFor(market.locks_at).id,
		winner: winnerRow ? { outcome_id: winnerRow.id, label: winnerRow.label, ref_kind: winnerRow.ref_kind, ref_id: winnerRow.ref_id } : null,
		void_reason: market.status === 'void' ? market.void_reason || null : null,
		resolution: market.status === 'resolved' || market.status === 'void'
			? {
					source: market.resolution_source || null,
					resolved_at: iso(market.resolved_at),
					evidence: market.resolution_evidence ?? null,
				}
			: { pending_reason: market.pending_reason || null, last_checked_at: iso(market.last_checked_at), checks: market.check_count ?? 0 },
		pick_count: odds.total_picks,
		total_points: odds.total_points,
		odds: {
			even_prior: odds.even_prior,
			prior_points_per_outcome: odds.prior_points_per_outcome,
			method: ODDS_METHOD,
			note: odds.even_prior ? 'No picks yet. Showing an even split until the crowd weighs in.' : null,
		},
		outcomes: outcomes.map((o) => {
			const x = byId.get(o.id);
			return {
				id: o.id,
				label: o.label,
				ref_kind: o.ref_kind || null,
				ref_id: o.ref_id || null,
				image_url: o.image_url || null,
				position: o.position,
				picks: x.picks,
				points: x.points,
				share: x.share,
				percent: x.percent,
				is_winner: market.winner_outcome_id === o.id,
			};
		}),
		created_at: iso(market.created_at),
		updated_at: iso(market.updated_at),
	};
}

/** A list row: the same fields without per-outcome detail beyond label and odds. */
export function marketSummary(view) {
	const { outcomes, resolution_rule, ...rest } = view;
	return {
		...rest,
		outcomes: outcomes.map(({ id, label, image_url, percent, share, picks, is_winner }) => ({ id, label, image_url, percent, share, picks, is_winner })),
	};
}
