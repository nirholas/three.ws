// Bounty board (bounties / bounty_submissions). Entrants are one submission per
// submitter. The owner picks the winning submission, so the market resolves to
// bounties.winner_submission_id. Picks stay open until the bounty expires.

import { sql } from '../../db.js';
import { eventMarketsAutoOpen } from '../config-auto-open.js';

export const sourceKind = 'bounty';

export async function listEvents() {
	const bounties = await sql`
		select id, title, created_at, expires_at from bounties
		where status = 'open' and deleted_at is null and expires_at > now()
		order by expires_at`;
	if (!bounties.length) return [];
	const subs = await sql`
		select distinct on (bounty_id, user_id) id, bounty_id, username, media_url, media_type
		from bounty_submissions
		where status <> 'rejected' and bounty_id = any(${bounties.map((b) => b.id)}::uuid[])
		order by bounty_id, user_id, created_at`;
	const by = new Map();
	for (const s of subs) {
		if (!by.has(s.bounty_id)) by.set(s.bounty_id, []);
		by.get(s.bounty_id).push({
			label: s.username || `Entry ${by.get(s.bounty_id).length + 1}`,
			refKind: 'project',
			refId: s.id,
			imageUrl: s.media_type === 'image' ? s.media_url : null,
		});
	}
	const graceMs = eventMarketsAutoOpen.bountyResolveGraceDays * 86_400_000;
	return bounties.map((b) => {
		const expiresAt = new Date(b.expires_at);
		return {
			sourceKind,
			sourceRef: b.id,
			title: b.title,
			startsAt: new Date(b.created_at),
			endsAt: expiresAt,
			lockAt: expiresAt,
			resolvesAt: new Date(expiresAt.getTime() + graceMs),
			entrants: by.get(b.id) || [],
			rule: {
				type: 'bounty_winner_submission',
				bounty_id: b.id,
				description: 'Resolves to the entrant whose submission the bounty owner marks as the winner.',
			},
			winnerDefined: true,
		};
	});
}
