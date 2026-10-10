// Build program rounds (program_rounds / program_submissions). Entrants are the
// distinct agents with a live submission. Submissions arrive through the round, so
// picks stay open until submissions close (ends_at) and resolve once judging ends.
// A round with no published judging criteria has no defined winner and is skipped.

import { sql } from '../../db.js';
import { agentImage } from './shared.js';

export const sourceKind = 'build_round';

export async function listEvents() {
	const rounds = await sql`
		select id, slug, title, starts_at, ends_at, judging_ends_at, criteria
		from program_rounds
		where status = 'open' and ends_at > now()
		order by starts_at`;
	if (!rounds.length) return [];
	const subs = await sql`
		select distinct on (s.round_id, s.agent_id)
		       s.round_id, i.id as agent_id, i.name,
		       a.thumbnail_key as avatar_thumbnail_key, a.visibility as avatar_visibility
		from program_submissions s
		join agent_identities i on i.id = s.agent_id and i.deleted_at is null and i.is_public = true
		left join avatars a on a.id = i.avatar_id and a.deleted_at is null
		where s.status in ('submitted', 'shortlisted', 'winner')
		  and s.round_id = any(${rounds.map((r) => r.id)}::uuid[])
		order by s.round_id, s.agent_id, s.created_at`;
	const by = new Map();
	for (const r of subs) {
		if (!by.has(r.round_id)) by.set(r.round_id, []);
		by.get(r.round_id).push({ label: r.name, refKind: 'agent', refId: r.agent_id, imageUrl: agentImage(r) });
	}
	return rounds.map((r) => {
		const startsAt = new Date(r.starts_at);
		const endsAt = new Date(r.ends_at);
		const judged = Array.isArray(r.criteria) && r.criteria.length > 0;
		return {
			sourceKind,
			sourceRef: r.id,
			title: r.title,
			startsAt,
			endsAt,
			lockAt: endsAt,
			resolvesAt: r.judging_ends_at ? new Date(r.judging_ends_at) : endsAt,
			entrants: by.get(r.id) || [],
			rule: {
				type: 'build_round_top_score',
				round_id: r.id,
				slug: r.slug,
				description: 'Resolves to the agent whose submission the judges score highest when judging closes.',
			},
			winnerDefined: judged,
			noWinnerReason: judged ? undefined : 'the round publishes no judging criteria, so no winner can be read from it',
		};
	});
}
