// Auto-open: turn "an event exists" into "a market exists", with no human in the loop.
//
// For every event an adapter lists (sources/), this opens one market whose outcomes
// are the entrants, then keeps it in step with the event until picks lock:
//
//   no market yet   open one when the event has a defined winner, at least
//                   minEntrants entrants, and a lock time still in the future.
//                   Otherwise record why in event_market_skips.
//   open, pre-lock  add any entrant that joined since; existing outcomes and the
//                   picks on them are never touched.
//   locked or later never change outcomes.
//
// Idempotent on (source_kind, source_ref): the unique index is the guarantee, the
// lookup is the fast path. Opening writes an `event_market.opened` row to
// event_market_outbox in the same pass so announcements read it, never get called.

import { createHash } from 'node:crypto';
import { sql } from '../db.js';
import { eventMarketsAutoOpen } from './config-auto-open.js';
import { SOURCES } from './sources/index.js';
import { createMarket, EventMarketError, slugify } from './index.js';

export const OPENED_KIND = 'event_market.opened';

/** "Who wins X?" capped to the 140-character title limit. */
export function questionTitle(eventTitle) {
	const name = String(eventTitle || '').replace(/\s+/g, ' ').trim();
	const room = 140 - 'Who wins ?'.length;
	return `Who wins ${name.length > room ? `${name.slice(0, room - 3).trimEnd()}...` : name}?`;
}

/** Deterministic slug: readable title plus a hash of the event identity. */
export function marketSlug(event) {
	const tag = createHash('sha1').update(`${event.sourceKind}:${event.sourceRef}`).digest('hex').slice(0, 6);
	return `${slugify(`who wins ${event.title}`).slice(0, 56).replace(/-+$/, '')}-${tag}`;
}

/**
 * Decide what the cron does with one event that has no market yet.
 * Pure: returns { action: 'open' } or { action: 'skip', reason, detail }.
 */
export function planOpen(event, now, { force = false, cfg = eventMarketsAutoOpen } = {}) {
	if (!event.winnerDefined) {
		return { action: 'skip', reason: 'no_defined_winner', detail: event.noWinnerReason || 'the event has no defined winner' };
	}
	if (event.entrants.length < cfg.minEntrants) {
		return {
			action: 'skip',
			reason: 'too_few_entrants',
			detail: `${event.entrants.length} of ${cfg.minEntrants} entrants needed`,
		};
	}
	if (!force && event.lockAt <= now) {
		return { action: 'skip', reason: 'lock_passed', detail: `picks would have closed ${event.lockAt.toISOString()}` };
	}
	return { action: 'open' };
}

async function recordSkip(event, plan) {
	await sql`
		insert into event_market_skips (source_kind, source_ref, title, reason, detail)
		values (${event.sourceKind}, ${event.sourceRef}, ${event.title}, ${plan.reason}, ${plan.detail})
		on conflict (source_kind, source_ref) do update
			set title = excluded.title, reason = excluded.reason, detail = excluded.detail,
			    last_seen = now(), seen_count = event_market_skips.seen_count + 1`;
}

async function clearSkip(event) {
	await sql`delete from event_market_skips where source_kind = ${event.sourceKind} and source_ref = ${event.sourceRef}`;
}

async function findBySource(event) {
	const [row] = await sql`
		select id, slug, status, locks_at from event_markets
		where source_kind = ${event.sourceKind} and source_ref = ${event.sourceRef}`;
	return row || null;
}

/** Add entrants a pre-lock market does not have yet. Returns how many were added. */
async function addLateEntrants(marketId, event) {
	const have = await sql`select ref_kind, ref_id from event_market_outcomes where market_id = ${marketId}`;
	const known = new Set(have.map((o) => `${o.ref_kind}:${o.ref_id}`));
	const room = eventMarketsAutoOpen.maxOutcomes - have.length;
	const fresh = event.entrants.filter((e) => !known.has(`${e.refKind}:${e.refId}`)).slice(0, Math.max(room, 0));
	let added = 0;
	for (const e of fresh) {
		const rows = await sql`
			insert into event_market_outcomes (market_id, label, ref_kind, ref_id, image_url, position)
			values (${marketId}, ${String(e.label).slice(0, 80)}, ${e.refKind}, ${String(e.refId)}, ${e.imageUrl ?? null},
			        (select coalesce(max(position), -1) + 1 from event_market_outcomes where market_id = ${marketId}))
			on conflict (market_id, ref_kind, ref_id) where ref_id is not null do nothing
			returning id`;
		added += rows.length;
	}
	return added;
}

function toOutcome(e) {
	return { label: String(e.label).trim().slice(0, 80), ref_kind: e.refKind, ref_id: e.refId, image_url: e.imageUrl ?? null };
}

async function emitOpened(market, event) {
	await sql`
		insert into event_market_outbox (kind, market_id, payload)
		values (${OPENED_KIND}, ${market.id}, ${JSON.stringify({
			slug: market.slug,
			title: market.title,
			source_kind: event.sourceKind,
			source_ref: event.sourceRef,
			locks_at: market.locks_at,
			resolves_at: market.resolves_at,
			outcome_count: market.outcomes.length,
		})}::jsonb)
		on conflict (kind, market_id) do nothing`;
}

/**
 * Open the market for one event, or sync an existing one.
 * @returns {Promise<{ result: 'opened'|'synced'|'unchanged'|'skipped', slug?: string, added?: number, reason?: string }>}
 */
export async function openForEvent(event, { now = new Date(), force = false, locksAt = null } = {}) {
	const existing = await findBySource(event);
	if (existing) {
		await clearSkip(event);
		if (existing.status === 'open' && new Date(existing.locks_at) > now) {
			const added = await addLateEntrants(existing.id, event);
			return { result: added ? 'synced' : 'unchanged', slug: existing.slug, added };
		}
		return { result: 'unchanged', slug: existing.slug, added: 0 };
	}

	const plan = planOpen(event, now, { force });
	if (plan.action === 'skip') {
		await recordSkip(event, plan);
		return { result: 'skipped', reason: plan.reason, detail: plan.detail };
	}

	const lockTime = locksAt
		|| (event.lockAt > now ? event.lockAt : new Date(now.getTime() + eventMarketsAutoOpen.manualLockMinutes * 60_000));
	const resolvesAt = event.resolvesAt >= lockTime ? event.resolvesAt : lockTime;
	let market;
	try {
		market = await createMarket({
			title: questionTitle(event.title),
			slug: marketSlug(event),
			source_kind: event.sourceKind,
			source_ref: event.sourceRef,
			status: 'open',
			opens_at: now.toISOString(),
			locks_at: lockTime.toISOString(),
			resolves_at: resolvesAt.toISOString(),
			resolution_rule: { ...event.rule, starts_at: event.startsAt.toISOString(), ends_at: event.endsAt.toISOString() },
			outcomes: event.entrants.slice(0, eventMarketsAutoOpen.maxOutcomes).map(toOutcome),
		});
	} catch (err) {
		if (err instanceof EventMarketError && err.code === 'market_exists_for_source') {
			// A concurrent tick opened it between our lookup and our insert.
			const raced = await findBySource(event);
			if (raced) return { result: 'unchanged', slug: raced.slug, added: 0 };
		}
		throw err;
	}
	await emitOpened(market, event);
	await clearSkip(event);
	return { result: 'opened', slug: market.slug };
}

/** One pass over every source. A failing source is reported, never fatal to the rest. */
export async function runAutoOpen({ now = new Date(), sources = SOURCES } = {}) {
	const report = { opened: [], synced: [], skipped: [], errors: [], seen: 0 };
	for (const source of sources) {
		let events;
		try {
			events = await source.listEvents(now);
		} catch (err) {
			report.errors.push({ source_kind: source.sourceKind, message: err?.message || String(err) });
			continue;
		}
		for (const event of events) {
			report.seen += 1;
			try {
				const r = await openForEvent(event, { now });
				const row = { source_kind: event.sourceKind, source_ref: event.sourceRef, title: event.title, ...r };
				if (r.result === 'opened') report.opened.push(row);
				else if (r.result === 'synced') report.synced.push(row);
				else if (r.result === 'skipped') report.skipped.push(row);
			} catch (err) {
				report.errors.push({ source_kind: event.sourceKind, source_ref: event.sourceRef, message: err?.message || String(err) });
			}
		}
	}
	return report;
}
