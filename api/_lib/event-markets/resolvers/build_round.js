// Resolver: build_round. Winner = the first-place submission of a three.ws Build
// round once judging has closed. Reads program_rounds and program_submissions, the
// same rows the judges write.
//
// Rule (resolution_rule): { track_id? }  Rounds with several tracks must name one.
// Outcomes: ref_kind 'agent' (the entering agent's id) or 'project' (submission id).

import { pending, voided, won, findOutcome, iso, ruleOf } from './common.js';

export const kind = 'build_round';

export function describe(rule = {}) {
	const track = rule.track_id ? ` in the ${rule.track_id} track` : '';
	return `Resolves to the first-place submission${track} of the Build round once the round is closed and judging has recorded a winner. If several first places exist the higher judge score wins; if they are level, or the round closes with no winner recorded, the market is void and picks are refunded.`;
}

async function defaultDeps() {
	const { sql } = await import('../../db.js');
	return {
		async round(ref) {
			const [r] = await sql`select * from program_rounds where slug = ${ref} or id::text = ${ref} limit 1`;
			return r || null;
		},
		async winners(roundId) {
			return sql`
				select id, agent_id, track_id, title, score, placement, updated_at
				from program_submissions
				where round_id = ${roundId} and status = 'winner' and placement = 1
			`;
		},
	};
}

export async function resolve(market, { now = Date.now(), deps } = {}) {
	const d = deps || (await defaultDeps());
	if (!market.source_ref) return voided('invalid_source_ref', { source_ref: null });
	const round = await d.round(market.source_ref);
	if (!round) return voided('source_missing', { round: market.source_ref });
	const rule = ruleOf(market);
	const base = { round_id: round.id, slug: round.slug, status: round.status, ends_at: iso(round.ends_at), judging_ends_at: iso(round.judging_ends_at), track_id: rule.track_id || null };
	if (round.status !== 'closed') return pending(round.status === 'judging' ? 'judging' : 'round_running', base);

	let winners = await d.winners(round.id);
	if (rule.track_id) winners = winners.filter((w) => w.track_id === rule.track_id);
	const shown = winners.map((w) => ({ submission_id: w.id, agent_id: w.agent_id, track_id: w.track_id, title: w.title, score: w.score == null ? null : Number(w.score) }));
	const evidence = { ...base, first_places: shown };
	if (!winners.length) return voided('no_winner_recorded', evidence);

	const ranked = [...winners].sort((a, b) => Number(b.score ?? -Infinity) - Number(a.score ?? -Infinity));
	if (ranked[1] && Number(ranked[1].score ?? -Infinity) === Number(ranked[0].score ?? -Infinity)) return voided('tie', evidence);
	const w = ranked[0];
	const outcome = findOutcome(market.outcomes, ['agent'], w.agent_id) || findOutcome(market.outcomes, ['project'], w.id);
	if (!outcome) return voided('winner_not_an_outcome', evidence);
	return won(outcome, { ...evidence, winner: { submission_id: w.id, agent_id: w.agent_id } });
}
