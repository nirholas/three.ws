// Resolver: bounty. Winner = the submission the bounty's poster accepts on the
// community board. Reads bounties and bounty_submissions; the poster's resolve
// action is the only thing that sets the winner.
//
// Outcomes: ref_kind 'project' with the submission id as ref_id.

import { pending, voided, won, findOutcome, iso } from './common.js';

export const kind = 'bounty';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function describe() {
	return 'Resolves to the submission the bounty poster accepts. Nothing else decides it. If the poster never picks one before the market times out, or the bounty is removed, the market is void and picks are refunded.';
}

async function defaultDeps() {
	const { sql } = await import('../../db.js');
	return {
		async bounty(id) {
			const [b] = await sql`
				select id, title, status, expires_at, winner_submission_id, deleted_at, submission_count from bounties where id = ${id}
			`;
			return b || null;
		},
		async submission(id) {
			const [s] = await sql`select id, bounty_id, status, created_at from bounty_submissions where id = ${id}`;
			return s || null;
		},
	};
}

export async function resolve(market, { deps } = {}) {
	const d = deps || (await defaultDeps());
	const id = market.source_ref;
	if (!UUID_RE.test(String(id || ''))) return voided('invalid_source_ref', { source_ref: id ?? null });
	const b = await d.bounty(id);
	if (!b) return voided('source_missing', { bounty_id: id });
	const base = { bounty_id: b.id, title: b.title, status: b.status, expires_at: iso(b.expires_at), submissions: b.submission_count };
	if (b.deleted_at) return voided('event_cancelled', { ...base, deleted_at: iso(b.deleted_at) });
	if (b.status !== 'closed') return pending('awaiting_poster', base);
	if (!b.winner_submission_id) return voided('no_winner_recorded', base);

	const s = await d.submission(b.winner_submission_id);
	const evidence = { ...base, winner_submission_id: b.winner_submission_id, submission_status: s?.status ?? null, submitted_at: iso(s?.created_at) };
	const outcome = findOutcome(market.outcomes, ['project'], b.winner_submission_id);
	if (!outcome) return voided('winner_not_an_outcome', evidence);
	return won(outcome, evidence);
}
