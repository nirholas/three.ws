// Admin override of an Event Market result. The default path (lifecycle.js) never
// needs it: it exists for a disputed or wrong automatic result, and for `custom`
// markets that have no data source.
//
// Rules: a written reason of at least 20 characters is mandatory; the override is
// appended to event_market_overrides (who, why, what it replaced) and shown on the
// market page; the market, its picks, the score ledger rows it had produced and the
// override log row change in ONE statement, so a half-applied override cannot exist.
// A voided market is final (its picks were already refunded). Points only.

import { sql } from '../db.js';
import { EventMarketError } from './errors.js';

export const MIN_REASON = 20;
export const MAX_REASON = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate an override request. PURE. Throws EventMarketError(400). */
export function parseOverride(body) {
	const action = body?.action;
	if (action !== 'set_winner' && action !== 'void') {
		throw new EventMarketError(400, 'validation_error', "action must be 'set_winner' or 'void'.");
	}
	const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
	if (reason.length < MIN_REASON) {
		throw new EventMarketError(400, 'reason_required', `An override needs a written reason of at least ${MIN_REASON} characters.`);
	}
	if (reason.length > MAX_REASON) {
		throw new EventMarketError(400, 'validation_error', `The reason must be at most ${MAX_REASON} characters.`);
	}
	let winnerOutcomeId = null;
	if (action === 'set_winner') {
		winnerOutcomeId = String(body.winner_outcome_id || '').toLowerCase();
		if (!UUID_RE.test(winnerOutcomeId)) {
			throw new EventMarketError(400, 'outcome_not_found', 'winner_outcome_id must be the id of one of this market\'s outcomes.');
		}
	}
	return { action, reason: reason.slice(0, MAX_REASON), winnerOutcomeId };
}

/**
 * Apply an override. Returns the override row and how many score rows were reset
 * (the rollup re-scores them from the new result).
 */
export async function applyOverride(marketId, adminId, body) {
	const req = parseOverride(body);
	const [market] = await sql`select id, slug, status, winner_outcome_id, resolution_evidence from event_markets where id = ${marketId}`;
	if (!market) throw new EventMarketError(404, 'not_found', 'No market with that id.');
	if (market.status === 'draft') throw new EventMarketError(409, 'invalid_transition', 'A draft market has no result to override.');
	if (market.status === 'void') throw new EventMarketError(409, 'invalid_transition', 'A void market is final: its picks were already refunded.');
	if (req.action === 'set_winner' && market.status === 'resolved' && market.winner_outcome_id === req.winnerOutcomeId) {
		throw new EventMarketError(409, 'no_change', 'That outcome is already the winner.');
	}

	const evidence = JSON.stringify({
		override: true,
		action: req.action,
		previous_status: market.status,
		previous_winner_outcome_id: market.winner_outcome_id,
		previous_evidence: market.resolution_evidence ?? null,
	});
	const note = `Admin override: ${req.reason}`.slice(0, 280);
	const [row] = await sql`
		with m as (
			update event_markets set
			       status = ${req.action === 'void' ? 'void' : 'resolved'},
			       winner_outcome_id = ${req.action === 'void' ? null : req.winnerOutcomeId}::uuid,
			       void_reason = ${req.action === 'void' ? note : null},
			       resolved_at = now(), resolution_source = 'override', resolution_evidence = ${evidence}::jsonb,
			       pending_reason = null, locks_at = greatest(opens_at + interval '1 millisecond', least(locks_at, now())), updated_at = now()
			 where id = ${market.id} and status = ${market.status}
			   and (${req.action} = 'void' or exists (
			         select 1 from event_market_outcomes o where o.id = ${req.winnerOutcomeId}::uuid and o.market_id = ${market.id}))
			returning id
		), cleared as (
			delete from event_market_scores s where s.market_id in (select id from m) returning 1
		), refunded as (
			update event_market_picks p set status = 'refunded', updated_at = now()
			 where ${req.action} = 'void' and p.market_id in (select id from m) and p.status = 'live'
			returning p.market_id, p.outcome_id, p.account_id, p.points, p.agent_id
		), logged as (
			insert into event_market_pick_log (market_id, outcome_id, account_id, points, action)
			select market_id, outcome_id, account_id, points, 'void' from refunded where agent_id is null
		), ov as (
			insert into event_market_overrides (market_id, admin_id, action, reason, previous_status, previous_winner_id, new_winner_id, previous_evidence, rescored_picks)
			select m.id, ${adminId}, ${req.action}, ${req.reason}, ${market.status}, ${market.winner_outcome_id}::uuid,
			       ${req.winnerOutcomeId}::uuid, ${market.resolution_evidence == null ? null : JSON.stringify(market.resolution_evidence)}::jsonb,
			       (select count(*) from cleared)::int
			  from m
			returning id, created_at, rescored_picks
		)
		select * from ov`;
	if (!row) {
		const [now] = await sql`select status from event_markets where id = ${market.id}`;
		if (now && now.status !== market.status) {
			throw new EventMarketError(409, 'conflict', `The market changed to ${now.status} while the override was being applied. Reload and retry.`);
		}
		throw new EventMarketError(400, 'outcome_not_found', 'winner_outcome_id is not one of this market\'s outcomes.');
	}
	return { override_id: row.id, created_at: row.created_at, reset_scores: row.rescored_picks, slug: market.slug, action: req.action };
}

/** Overrides for the market page, newest first. Admin ids are not exposed. */
export async function listOverrides(marketId) {
	const rows = await sql`
		select id, action, reason, previous_status, previous_winner_id, new_winner_id, created_at
		  from event_market_overrides where market_id = ${marketId} order by created_at desc`;
	return rows.map((r) => ({
		id: r.id,
		action: r.action,
		reason: r.reason,
		previous_status: r.previous_status,
		previous_winner_outcome_id: r.previous_winner_id,
		new_winner_outcome_id: r.new_winner_id,
		at: new Date(r.created_at).toISOString(),
	}));
}
