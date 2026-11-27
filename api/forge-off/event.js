// GET /api/forge-off/event[?slug=<slug>][&board=day-<n>|overall]
//
// One round trip for the /forge-off page.
//
// Without `board`: the event config, its phase (upcoming | live | ended), the
// live day, the top 3 of every day that has started, the overall leader and
// totals, every crowned winner, the contest rules, and a summary of every
// event (with its overall winner) for the past-events list. `now` is the
// server clock, which the page uses to run its countdowns, so a visitor whose
// computer clock is wrong still sees the real deadline.
//
// With no slug and no live or upcoming event the answer is the "no event right
// now" view: { phase: 'none', slug: null, events, rules }. An ended event is
// only shown when asked for by slug.
//
// With `board`: the full ranking (up to 24) of one day or the overall board.
//
// Every board is ranked by the shared contest rules in
// api/_lib/forge-off-standings.js, the same code the crown runs, so a closed
// board shows exactly the standings the crown decided on. Votes are cast with
// POST /api/forge-vote; this endpoint only reads.

import { cors, json, method, wrap, rateLimited, varyOn } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { hashClient, forgeStoreEnabled } from '../_lib/forge-store.js';
import {
	activeDay,
	eventPhase,
	getEvent,
	isValidSlug,
	listEvents,
	pickDefaultEvent,
	publicEvent,
} from '../_lib/forge-off-events.js';
import {
	RULES,
	VOTES_PER_NETWORK_PER_ENTRY,
	isEligibleEntry,
	loadEventWinners,
	loadWindow,
	publicEntry,
	rankBoard,
	votedBy,
} from '../_lib/forge-off-standings.js';

const BOARD_RE = /^(?:day-(\d{1,2})|overall)$/;
const FULL_BOARD = 24;

function rulesPayload() {
	return { items: RULES, votes_per_network_per_entry: VOTES_PER_NETWORK_PER_ENTRY, time_zone: 'UTC' };
}

function eventSummaries(now, winners) {
	return listEvents()
		.map((e) => ({
			slug: e.slug,
			title: e.title,
			summary: e.summary,
			starts_at: e.start.toISOString(),
			ends_at: e.end.toISOString(),
			days: e.days.length,
			phase: eventPhase(e, now),
			winner: winners.get(`${e.slug}/overall`) || null,
		}))
		.sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://localhost');
	const now = new Date();
	const slugParam = (url.searchParams.get('slug') || '').trim();
	let event = null;
	if (slugParam) {
		if (!isValidSlug(slugParam)) {
			return json(res, 400, { error: 'invalid_slug', message: 'slug must be a lowercase slug.' });
		}
		event = getEvent(slugParam);
		if (!event) return json(res, 404, { error: 'unknown_event', message: 'No such Forge-Off event.' });
	} else if (url.searchParams.has('slug')) {
		return json(res, 400, { error: 'invalid_slug', message: 'slug must be a lowercase slug.' });
	} else {
		event = pickDefaultEvent(now);
	}

	const boardParam = url.searchParams.get('board');
	let board = null;
	if (boardParam !== null) {
		const m = BOARD_RE.exec(boardParam.trim());
		const day = m && m[1] ? event?.days.find((d) => d.index === Number(m[1])) : null;
		if (!event || !m || (m[1] && !day)) {
			return json(res, 400, {
				error: 'invalid_board',
				message: event ? `board must be overall or day-1 to day-${event.days.length}.` : 'board needs an event slug.',
			});
		}
		board = day
			? { key: `day-${day.index}`, from: day.start, to: day.end }
			: { key: 'overall', from: event.start, to: event.end };
	}

	if (!forgeStoreEnabled()) {
		if (!event) {
			return json(res, 200, { enabled: false, phase: 'none', slug: null, now: now.toISOString(), rules: rulesPayload(), events: eventSummaries(now, new Map()) });
		}
		return json(res, 200, { enabled: false, ...publicEvent(event), phase: eventPhase(event, now), now: now.toISOString(), rules: rulesPayload() });
	}

	const rawClient = req.headers['x-forge-client'];
	const hasClient = Array.isArray(rawClient) ? rawClient[0] : rawClient;
	const voterKey = hasClient ? hashClient(hasClient) : null;
	varyOn(res, 'x-forge-client');
	const headers = voterKey
		? { 'cache-control': 'private, no-store' }
		: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=120' };

	let winners;
	let window = { entries: [], votes: [] };
	try {
		[winners, window] = await Promise.all([
			loadEventWinners(listEvents().map((e) => e.slug)),
			event && event.start <= now ? loadWindow({ from: event.start, to: event.end }) : window,
		]);
	} catch (err) {
		console.error('[forge-off/event] standings read failed:', err?.message);
		return json(res, 503, {
			error: 'standings_unavailable',
			message: 'The leaderboard could not be read just now. Try again in a minute.',
		}, { 'cache-control': 'no-store', 'retry-after': '30' });
	}

	if (!event) {
		return json(res, 200, {
			enabled: true,
			phase: 'none',
			slug: null,
			now: now.toISOString(),
			rules: rulesPayload(),
			events: eventSummaries(now, winners),
		}, headers);
	}

	const { entries, votes } = window;
	const voted = votedBy(votes, voterKey);
	const rank = (from, to, limit) =>
		rankBoard(entries, votes, { from, to, closesAt: to })
			.slice(0, limit)
			.map((r) => publicEntry(r.entry, r.votes, voted));

	if (board) {
		return json(res, 200, {
			enabled: true,
			slug: event.slug,
			board_key: board.key,
			now: now.toISOString(),
			closes_at: board.to.toISOString(),
			closed: board.to <= now,
			winner: winners.get(`${event.slug}/${board.key}`) || null,
			entries: board.from <= now ? rank(board.from, board.to, FULL_BOARD) : [],
		}, headers);
	}

	const pub = publicEvent(event);
	const live = activeDay(event, now);
	const days = pub.days.map((d, i) => {
		const src = event.days[i];
		const started = src.start <= now;
		return {
			...d,
			started,
			closed: src.end <= now,
			top: started ? rank(src.start, src.end, 3) : [],
			winner: winners.get(`${event.slug}/day-${d.index}`) || null,
		};
	});
	const overall = rankBoard(entries, votes, { from: event.start, to: event.end, closesAt: event.end });
	const leader = overall[0] && overall[0].votes > 0 ? publicEntry(overall[0].entry, overall[0].votes, voted) : null;

	return json(res, 200, {
		enabled: true,
		...pub,
		phase: eventPhase(event, now),
		now: now.toISOString(),
		live_day: live ? live.index : null,
		days,
		overall: {
			leader,
			total_votes: overall.reduce((n, r) => n + r.votes, 0),
			entries: entries.filter(isEligibleEntry).length,
			winner: winners.get(`${event.slug}/overall`) || null,
		},
		rules: rulesPayload(),
		events: eventSummaries(now, winners),
	}, headers);
});
