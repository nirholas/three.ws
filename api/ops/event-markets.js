// /api/ops/event-markets: the owner's view of Event Markets auto-open.
//
//   GET   every event the sources list now, with its market (or the reason it has
//         none), plus the skip log and the latest markets. Admin session required.
//   POST  { action: 'open', source_kind, source_ref, locks_in_minutes? }
//             open a market for one event by hand: bypasses the lock-time and
//             entrant-count skips only when the event still has two entrants and a
//             defined winner. A past lock gets a fresh lock window.
//         { action: 'void', market_id }
//             void a market. Points are a per-market allowance, so nothing is owed back.
//
// Read-only except the two POST actions; points only, nothing here moves funds.

import { cors, json, method, wrap, error, rateLimited, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireAdmin } from '../_lib/admin.js';
import { isSameSiteOrigin } from '../_lib/auth.js';
import { SOURCES } from '../_lib/event-markets/sources/index.js';
import { openForEvent, planOpen } from '../_lib/event-markets/auto-open.js';
import { voidMarket, EventMarketError } from '../_lib/event-markets/index.js';
import { sql } from '../_lib/db.js';

export const maxDuration = 30;

async function gatherEvents(now) {
	const events = [];
	const errors = [];
	for (const source of SOURCES) {
		try {
			events.push(...(await source.listEvents(now)));
		} catch (err) {
			errors.push({ source_kind: source.sourceKind, message: err?.message || String(err) });
		}
	}
	return { events, errors };
}

async function report(now) {
	const { events, errors } = await gatherEvents(now);
	const [markets, skips] = await Promise.all([
		sql`select m.id, m.slug, m.title, m.source_kind, m.source_ref, m.status, m.locks_at, m.resolves_at,
		           (select count(*)::int from event_market_outcomes o where o.market_id = m.id) as outcome_count,
		           (select count(*)::int from event_market_picks p where p.market_id = m.id) as pick_count
		    from event_markets m order by m.created_at desc limit 100`,
		sql`select source_kind, source_ref, title, reason, detail, first_seen, last_seen, seen_count
		    from event_market_skips order by last_seen desc limit 100`,
	]);
	const bySource = new Map(markets.map((m) => [`${m.source_kind}:${m.source_ref}`, m]));
	const skipBy = new Map(skips.map((s) => [`${s.source_kind}:${s.source_ref}`, s]));
	return {
		generated_at: now.toISOString(),
		events: events.map((e) => {
			const key = `${e.sourceKind}:${e.sourceRef}`;
			const plan = planOpen(e, now);
			return {
				source_kind: e.sourceKind,
				source_ref: e.sourceRef,
				title: e.title,
				starts_at: e.startsAt,
				ends_at: e.endsAt,
				lock_at: e.lockAt,
				entrant_count: e.entrants.length,
				market: bySource.get(key) || null,
				skip: skipBy.get(key) || null,
				blocker: plan.action === 'skip' ? { reason: plan.reason, detail: plan.detail } : null,
			};
		}),
		markets,
		skips,
		source_errors: errors,
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const now = new Date();
	try {
		if (req.method === 'GET') {
			return json(res, 200, await report(now), { 'cache-control': 'private, no-store' });
		}
		if (!isSameSiteOrigin(req)) return error(res, 403, 'forbidden', 'cross-site requests are not allowed');
		const body = await readJson(req);

		if (body.action === 'open') {
			const { events } = await gatherEvents(now);
			const event = events.find((e) => e.sourceKind === body.source_kind && e.sourceRef === body.source_ref);
			if (!event) return error(res, 404, 'not_found', 'that event is not listed by any source right now');
			const mins = Number(body.locks_in_minutes);
			const locksAt = Number.isFinite(mins) && mins >= 5 && mins <= 7 * 1440 ? new Date(now.getTime() + mins * 60_000) : null;
			const result = await openForEvent(event, { now, force: true, locksAt });
			if (result.result === 'skipped') return error(res, 409, result.reason, result.detail);
			return json(res, 200, { ok: true, ...result });
		}

		if (body.action === 'void') {
			const voided = await voidMarket(String(body.market_id || ''), 'Voided by an admin');
			return json(res, 200, { ok: true, slug: voided.market.slug, status: voided.market.status, refunded_picks: voided.refunded_picks });
		}

		return error(res, 400, 'validation_error', "action must be 'open' or 'void'");
	} catch (err) {
		if (err instanceof EventMarketError) return error(res, err.status, err.code, err.message);
		if (err?.code === '42P01') {
			return error(res, 503, 'migration_pending', 'Event Markets tables are missing: apply the pending event market migrations (npm run db:status)');
		}
		throw err;
	}
});
