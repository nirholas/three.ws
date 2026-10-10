// Arena tournaments (api/_lib/migrations/20260623120000_tournaments.sql): upcoming and
// live trading tournaments. Entrants are the active, public agents in
// tournament_entries. The winner is the entry ranked first at settlement.

import { sql } from '../../db.js';
import { eventMarketsAutoOpen } from '../config-auto-open.js';
import { agentImage, fractionOf } from './shared.js';

export const sourceKind = 'arena_tournament';

export async function listEvents() {
	const tournaments = await sql`
		select id, name, starts_at, ends_at from tournaments
		where status in ('upcoming', 'live') and ends_at > now()
		order by starts_at`;
	if (!tournaments.length) return [];
	const entries = await sql`
		select e.tournament_id, i.id as agent_id, i.name,
		       a.thumbnail_key as avatar_thumbnail_key, a.visibility as avatar_visibility
		from tournament_entries e
		join agent_identities i on i.id = e.agent_id and i.deleted_at is null and i.is_public = true
		left join avatars a on a.id = i.avatar_id and a.deleted_at is null
		where e.status = 'active' and e.tournament_id = any(${tournaments.map((t) => t.id)}::uuid[])
		order by e.joined_at`;
	const by = new Map();
	for (const r of entries) {
		if (!by.has(r.tournament_id)) by.set(r.tournament_id, []);
		by.get(r.tournament_id).push({
			label: r.name,
			refKind: 'agent',
			refId: r.agent_id,
			imageUrl: agentImage(r),
		});
	}
	const fraction = eventMarketsAutoOpen.lockFractions.arena_tournament;
	return tournaments.map((t) => {
		const startsAt = new Date(t.starts_at);
		const endsAt = new Date(t.ends_at);
		return {
			sourceKind,
			sourceRef: t.id,
			title: t.name,
			startsAt,
			endsAt,
			lockAt: fractionOf(startsAt, endsAt, fraction),
			resolvesAt: endsAt,
			entrants: by.get(t.id) || [],
			rule: {
				type: 'tournament_final_rank',
				tournament_id: t.id,
				description: 'Resolves to the agent ranked first on the tournament standings when the tournament closes.',
			},
			winnerDefined: true,
		};
	});
}
