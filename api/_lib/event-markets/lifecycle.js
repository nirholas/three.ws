// Event Markets lifecycle: lock at locks_at, resolve at or after resolves_at, retry
// while the source says "not yet", void on a documented timeout. Run by
// api/cron/event-markets-resolve.js every few minutes.
//
// Idempotent. Every write is guarded by the market's current status
// ('open'/'locked'), so a market that already settled is never a candidate and a
// concurrent tick that loses the race changes nothing. The status flip, the
// winner and the evidence land in ONE statement, so a settled market always
// carries the inputs that decided it. Points are scored from the resolved market
// by the rollup (rollup.js), whose ledger insert is unique per (market, account);
// a replay can never award a pick twice.

import { readFileSync } from 'node:fs';
import { sql } from '../db.js';
import { resolverFor } from './resolvers/index.js';

export const RESOLUTION = Object.freeze(
	JSON.parse(readFileSync(new URL('../../../data/event-market-resolution.json', import.meta.url), 'utf8')),
);

const HOUR = 3_600_000;

/** Hours after resolves_at at which an unresolved market is voided. */
export function timeoutHours(sourceKind, cfg = RESOLUTION) {
	return cfg.timeout_hours[sourceKind] ?? cfg.timeout_hours.custom;
}

/**
 * What to do with one resolver answer. PURE, so the policy is testable without a
 * database. `result` is a resolver return value (or `{ error }` when it threw).
 * @returns {{ action: 'resolve'|'void'|'wait', winnerOutcomeId?: string, reason?: string, evidence: object }}
 */
export function decide(market, result, now = Date.now(), cfg = RESOLUTION) {
	if (result && result.winnerOutcomeId) {
		return { action: 'resolve', winnerOutcomeId: result.winnerOutcomeId, evidence: result.evidence || {} };
	}
	if (result && result.void) {
		return { action: 'void', reason: result.reason || 'void', evidence: result.evidence || {} };
	}
	const reason = result?.pending ? result.reason || 'pending' : 'resolver_error';
	const deadline = new Date(market.resolves_at).getTime() + timeoutHours(market.source_kind, cfg) * HOUR;
	const evidence = { ...(result?.evidence || {}), ...(result?.error ? { error: String(result.error).slice(0, 200) } : {}) };
	if (now >= deadline) {
		return {
			action: 'void',
			reason: 'resolution_timeout',
			evidence: { ...evidence, last_pending_reason: reason, timeout_hours: timeoutHours(market.source_kind, cfg), deadline: new Date(deadline).toISOString() },
		};
	}
	return { action: 'wait', reason, evidence };
}

/** Lock every open market whose locks_at has passed. Returns the ids locked. */
export async function lockDue() {
	const rows = await sql`
		update event_markets set status = 'locked', updated_at = now()
		 where status = 'open' and locks_at <= now()
		returning id`;
	return rows.map((r) => r.id);
}

async function dueMarkets(limit) {
	const markets = await sql`
		select * from event_markets
		 where status in ('open', 'locked') and resolves_at <= now()
		 order by resolves_at, id
		 limit ${limit}`;
	if (!markets.length) return [];
	const outcomes = await sql`
		select id, market_id, label, ref_kind, ref_id, position
		  from event_market_outcomes where market_id = any(${markets.map((m) => m.id)}::uuid[])
		 order by market_id, position`;
	const byMarket = new Map();
	for (const o of outcomes) {
		if (!byMarket.has(o.market_id)) byMarket.set(o.market_id, []);
		byMarket.get(o.market_id).push(o);
	}
	return markets.map((m) => ({ ...m, outcomes: byMarket.get(m.id) || [] }));
}

/** Flip to resolved with the evidence, guarded by status. True when this call did it. */
async function writeResolved(market, winnerOutcomeId, evidence) {
	const rows = await sql`
		update event_markets m set status = 'resolved', winner_outcome_id = ${winnerOutcomeId}::uuid,
		       resolved_at = now(), resolution_source = 'auto', resolution_evidence = ${JSON.stringify(evidence)}::jsonb,
		       pending_reason = null, last_checked_at = now(), check_count = m.check_count + 1,
		       locks_at = greatest(m.opens_at + interval '1 millisecond', least(m.locks_at, now())), updated_at = now()
		 where m.id = ${market.id} and m.status in ('open', 'locked')
		   and exists (select 1 from event_market_outcomes o where o.id = ${winnerOutcomeId}::uuid and o.market_id = m.id)
		returning m.id`;
	return rows.length > 0;
}

/**
 * Void with the evidence and refund every live pick, in one statement. The pick
 * and log writes mirror voidMarket() in index.js.
 */
async function writeVoid(market, reason, evidence) {
	const rows = await sql`
		with m as (
			update event_markets set status = 'void', void_reason = ${reason}, resolved_at = now(), resolution_source = 'auto',
			       resolution_evidence = ${JSON.stringify(evidence)}::jsonb, pending_reason = null,
			       last_checked_at = now(), check_count = check_count + 1, updated_at = now()
			 where id = ${market.id} and status in ('open', 'locked') returning id
		), ref as (
			update event_market_picks p set status = 'refunded', updated_at = now()
			 where p.market_id in (select id from m) and p.status = 'live'
			returning p.market_id, p.outcome_id, p.account_id, p.points, p.agent_id
		), logged as (
			insert into event_market_pick_log (market_id, outcome_id, account_id, points, action)
			select market_id, outcome_id, account_id, points, 'void' from ref where agent_id is null
		)
		select (select count(*) from m)::int as voided`;
	return rows[0]?.voided > 0;
}

async function writePending(market, reason) {
	await sql`
		update event_markets set last_checked_at = now(), check_count = check_count + 1, pending_reason = ${reason}
		 where id = ${market.id} and status in ('open', 'locked')`;
}

/**
 * One lifecycle pass. `deps.resolverFor` is injectable for tests.
 * @returns {Promise<{ locked: number, checked: number, resolved: string[], voided: Array<{id:string,reason:string}>, pending: number, errors: string[] }>}
 */
export async function tickMarkets({ now = Date.now(), deps = {} } = {}) {
	const pick = deps.resolverFor || resolverFor;
	const report = { locked: 0, checked: 0, resolved: [], voided: [], pending: 0, errors: [] };
	report.locked = (await lockDue()).length;

	for (const market of await dueMarkets(RESOLUTION.batch_limit)) {
		report.checked += 1;
		const resolver = pick(market.source_kind);
		let result;
		if (!resolver) {
			result = { pending: true, reason: 'awaiting_admin', evidence: {} };
		} else {
			try {
				result = await resolver.resolve(market, { now, deps: deps.resolverDeps });
			} catch (err) {
				result = { error: err?.message || String(err) };
				report.errors.push(`${market.slug}: ${result.error}`);
			}
		}
		const d = decide(market, result, now);
		if (d.action === 'resolve') {
			if (await writeResolved(market, d.winnerOutcomeId, d.evidence)) report.resolved.push(market.id);
			else await writeVoid(market, 'winner_not_an_outcome', { ...d.evidence, winner_outcome_id: d.winnerOutcomeId }).then((ok) => ok && report.voided.push({ id: market.id, reason: 'winner_not_an_outcome' }));
		} else if (d.action === 'void') {
			if (await writeVoid(market, d.reason, d.evidence)) report.voided.push({ id: market.id, reason: d.reason });
		} else {
			await writePending(market, d.reason);
			report.pending += 1;
		}
	}
	return report;
}
