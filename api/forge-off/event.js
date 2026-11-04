// GET /api/forge-off/event?slug=<slug>
//
// One round trip for the /forge-off landing page: the event config, the phase
// (upcoming | live | ended), the live day, the top 3 of every day that has
// started, and the overall leader with the event-wide vote and entry totals.
// Votes are the same auth-free, one-per-browser votes as the weekly board
// (POST /api/forge-vote); this endpoint only reads.

import { cors, json, method, wrap, rateLimited, varyOn } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { hashClient, listShowcase, forgeStoreEnabled } from '../_lib/forge-store.js';
import {
	activeDay,
	eventPhase,
	getEvent,
	isValidSlug,
	pickDefaultEvent,
	publicEvent,
} from '../_lib/forge-off-events.js';

async function eventTotals(event) {
	try {
		const [row] = await sql`
			select coalesce(sum(vote_count), 0)::int as total_votes, count(*)::int as entries
			from forge_creations
			where status = 'done' and glb_url is not null
				and (outcome is null or outcome != 'rejected')
				and (visibility is null or visibility = 'public')
				and created_at >= ${event.start.toISOString()}::timestamptz
				and created_at < ${event.end.toISOString()}::timestamptz
		`;
		return { total_votes: Number(row?.total_votes) || 0, entries: Number(row?.entries) || 0 };
	} catch (err) {
		console.error('[forge-off/event] totals failed:', err?.message);
		return { total_votes: 0, entries: 0 };
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://localhost');
	const slugParam = (url.searchParams.get('slug') || '').trim();
	let event;
	if (slugParam) {
		if (!isValidSlug(slugParam)) {
			return json(res, 400, { error: 'invalid_slug', message: 'slug must be a lowercase slug.' });
		}
		event = getEvent(slugParam);
		if (!event) return json(res, 404, { error: 'unknown_event', message: 'No such Forge-Off event.' });
	} else if (url.searchParams.has('slug')) {
		return json(res, 400, { error: 'invalid_slug', message: 'slug must be a lowercase slug.' });
	} else {
		event = pickDefaultEvent();
		if (!event) return json(res, 404, { error: 'no_event', message: 'No Forge-Off event is configured.' });
	}

	if (!forgeStoreEnabled()) {
		return json(res, 200, { enabled: false, ...publicEvent(event), phase: eventPhase(event) });
	}

	const rawClient = req.headers['x-forge-client'];
	const hasClient = Array.isArray(rawClient) ? rawClient[0] : rawClient;
	const voterKey = hasClient ? hashClient(hasClient) : null;

	const now = new Date();
	const started = event.days.filter((d) => d.start <= now);
	const [dayTops, overallTop, totals] = await Promise.all([
		Promise.all(
			started.map((d) => listShowcase({ limit: 3, sort: 'top', voterKey, from: d.start, to: d.end })),
		),
		listShowcase({ limit: 1, sort: 'top', voterKey, from: event.start, to: event.end }),
		eventTotals(event),
	]);

	const pub = publicEvent(event);
	const live = activeDay(event, now);
	const days = pub.days.map((d) => {
		const i = started.findIndex((s) => s.index === d.index);
		return { ...d, started: i !== -1, top: i === -1 ? [] : dayTops[i] };
	});

	varyOn(res, 'x-forge-client');
	const headers = voterKey
		? { 'cache-control': 'private, no-store' }
		: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=120' };
	return json(
		res,
		200,
		{
			enabled: true,
			...pub,
			phase: eventPhase(event, now),
			now: now.toISOString(),
			live_day: live ? live.index : null,
			days,
			overall: {
				leader: overallTop[0] && overallTop[0].vote_count > 0 ? overallTop[0] : null,
				total_votes: totals.total_votes,
				entries: totals.entries,
			},
		},
		headers,
	);
});
