// Forge-Off themed events: config validation, UTC day windows, gallery
// routing (window=day, event=<slug>&day=<n>), the event endpoint, and the
// event crown cron. Pure window math is tested directly; handlers run against
// a mocked store/db so no network is touched.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
	Object.assign(process.env, {
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
	});
});

const storeEnabledMock = vi.fn(() => true);
const listShowcaseMock = vi.fn(async () => []);
const countShowcaseMock = vi.fn(async () => 0);
const hashClientMock = vi.fn(() => 'hashed');
const sqlMock = vi.fn(async () => []);

vi.mock('../api/_lib/forge-store.js', () => ({
	forgeStoreEnabled: (...a) => storeEnabledMock(...a),
	listCreations: vi.fn(async () => []),
	listShowcase: (...a) => listShowcaseMock(...a),
	countShowcase: (...a) => countShowcaseMock(...a),
	hashClient: (...a) => hashClientMock(...a),
	forgeOffWeekStart: (ref = new Date()) => {
		const d = new Date(ref);
		const day = d.getUTCDay();
		d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
		d.setUTCHours(0, 0, 0, 0);
		return d;
	},
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: Object.assign((...a) => sqlMock(...a), { unsafe: vi.fn() }),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));

const ev = await import('../api/_lib/forge-off-events.js');
const gallery = (await import('../api/forge-gallery.js')).default;
const eventApi = (await import('../api/forge-off/event.js')).default;
const crown = (await import('../api/cron/forge-off-event-crown.js')).default;

function mkReq(url, headers = {}) {
	return { method: 'GET', url, headers, on() {}, destroy() {} };
}
function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(c) { if (c !== undefined) this.body += String(c); this.writableEnded = true; },
	};
}
const parsed = (r) => JSON.parse(r.body);

const SLUG = 'ibm-forge-off-open';

// The standings module reads finished models and their votes in two queries;
// answer each from fixed rows by what the SQL text selects.
function standingsDb({ entries = [], votes = [], winners = [] } = {}) {
	return async (strings) => {
		const text = strings.join('?').toLowerCase();
		if (text.includes('from forge_event_winners')) return winners;
		if (text.includes('from forge_votes')) return votes;
		if (text.includes('from forge_creations')) return entries;
		return [];
	};
}
const entryRow = (id, createdAt, extra = {}) => ({
	id, prompt: id, glb_url: `https://cdn.example.com/${id}.glb`, web_glb_url: null,
	preview_image_url: null, model_category: 'item', backend: 'trellis_selfhost',
	created_at: new Date(createdAt), client_key: `owner-${id}`, status: 'done',
	outcome: null, visibility: null, safety_status: 'clear', ...extra,
});
const voteRows = (id, n, at) =>
	Array.from({ length: n }, (_, i) => ({ creation_id: id, voter_key: `${id}-v${i}`, ip_hash: `${id}-ip${i}`, created_at: new Date(at) }));

beforeEach(() => {
	storeEnabledMock.mockReturnValue(true);
	listShowcaseMock.mockReset();
	listShowcaseMock.mockResolvedValue([]);
	countShowcaseMock.mockResolvedValue(0);
	sqlMock.mockReset();
	sqlMock.mockResolvedValue([]);
});

describe('event config', () => {
	it('loads the shipped config and every day is one UTC calendar day in order', () => {
		const e = ev.getEvent(SLUG);
		expect(e.days).toHaveLength(5);
		e.days.forEach((d, i) => {
			expect(d.index).toBe(i + 1);
			expect(d.start.getUTCHours()).toBe(0);
			expect(d.end.getTime() - d.start.getTime()).toBe(86_400_000);
		});
		expect(e.start.getTime()).toBe(e.days[0].start.getTime());
		expect(e.end.getTime()).toBe(e.days[4].end.getTime());
	});

	it('rejects malformed config at validation time', () => {
		const good = {
			slug: 'x-event', title: 'T', summary: 's',
			starts_at: '2026-01-05T00:00:00Z', ends_at: '2026-01-06T00:00:00Z',
			days: [{ date: '2026-01-05', theme: 't', surface: 'Forge', surface_href: '/forge' }],
			prizes_note: 'p',
		};
		expect(() => ev.validateEvents({ events: [good] })).not.toThrow();
		expect(() => ev.validateEvents({ events: [{ ...good, slug: 'Bad Slug' }] })).toThrow(/slug/);
		expect(() => ev.validateEvents({ events: [{ ...good, ends_at: '2026-01-04T00:00:00Z' }] })).toThrow(/ends_at/);
		expect(() => ev.validateEvents({ events: [{ ...good, days: [{ ...good.days[0], date: '2026-01-06' }] }] })).toThrow(/consecutive|starts_at/);
		expect(() => ev.validateEvents({ events: [{ ...good, days: [{ ...good.days[0], surface_href: 'https://evil.example' }] }] })).toThrow(/surface_href/);
		expect(() => ev.validateEvents({ events: [good, good] })).toThrow(/duplicate/);
		expect(() => ev.validateEvents({})).toThrow(/events/);
	});
});

describe('UTC day windows', () => {
	it('currentDayWindow is the UTC calendar day regardless of local offset', () => {
		const w = ev.currentDayWindow(new Date('2026-03-08T23:59:59-08:00'));
		expect(w.from.toISOString()).toBe('2026-03-09T00:00:00.000Z');
		expect(w.to.toISOString()).toBe('2026-03-10T00:00:00.000Z');
	});

	it('a DST change day is still exactly 24h', () => {
		for (const iso of ['2026-03-08T12:00:00Z', '2026-11-01T12:00:00Z', '2026-03-29T12:00:00Z']) {
			const w = ev.currentDayWindow(new Date(iso));
			expect(w.to.getTime() - w.from.getTime()).toBe(86_400_000);
		}
	});

	it('activeDay and eventPhase classify now against the event', () => {
		const e = ev.getEvent(SLUG);
		expect(ev.eventPhase(e, new Date('2026-11-08T23:59:59Z'))).toBe('upcoming');
		expect(ev.eventPhase(e, new Date('2026-11-09T00:00:00Z'))).toBe('live');
		expect(ev.activeDay(e, new Date('2026-11-11T10:00:00Z')).index).toBe(3);
		expect(ev.eventPhase(e, new Date('2026-11-14T00:00:00Z'))).toBe('ended');
		expect(ev.activeDay(e, new Date('2026-11-14T00:00:00Z'))).toBeNull();
	});

	it('closedDays lists days that have ended and not yet the live one', () => {
		const e = ev.getEvent(SLUG);
		expect(ev.closedDays(e, new Date('2026-11-11T10:00:00Z')).map((d) => d.index)).toEqual([1, 2]);
		expect(ev.closedDays(e, new Date('2026-11-20T00:00:00Z'))).toHaveLength(5);
	});
});

describe('GET /api/forge-gallery windows', () => {
	it('window=day passes the current UTC day bounds to the store', async () => {
		const res = mkRes();
		await gallery(mkReq('/api/forge-gallery?scope=community&sort=top&window=day'), res);
		expect(res.statusCode).toBe(200);
		const arg = listShowcaseMock.mock.calls[0][0];
		expect(arg.window).toBe('day');
		expect(arg.from.getUTCHours()).toBe(0);
		expect(arg.to.getTime() - arg.from.getTime()).toBe(86_400_000);
		expect(parsed(res).window).toBe('day');
	});

	it('event=<slug>&day=2 ranks that day by the contest rules, event alone the whole event', async () => {
		const e = ev.getEvent(SLUG);
		const d2 = e.days[1].start.getTime();
		sqlMock.mockImplementation(standingsDb({
			entries: [entryRow('day1', e.days[0].start.getTime() + 3_600_000), entryRow('day2a', d2 + 3_600_000), entryRow('day2b', d2 + 7_200_000)],
			votes: [...voteRows('day1', 9, d2), ...voteRows('day2a', 1, d2 + 9_000_000), ...voteRows('day2b', 2, d2 + 9_000_000)],
		}));
		let res = mkRes();
		await gallery(mkReq(`/api/forge-gallery?scope=community&sort=top&event=${SLUG}&day=2`), res);
		expect(res.statusCode).toBe(200);
		expect(parsed(res).creations.map((c) => [c.id, c.vote_count])).toEqual([['day2b', 2], ['day2a', 1]]);
		expect(parsed(res).window).toBe('event-day');
		res = mkRes();
		await gallery(mkReq(`/api/forge-gallery?scope=community&sort=top&event=${SLUG}`), res);
		expect(parsed(res).creations.map((c) => c.id)).toEqual(['day1', 'day2b', 'day2a']);
		expect(listShowcaseMock).not.toHaveBeenCalled();
	});

	it('event=<slug>&sort=fresh still reads the newest models through the showcase', async () => {
		const e = ev.getEvent(SLUG);
		const res = mkRes();
		await gallery(mkReq(`/api/forge-gallery?scope=community&event=${SLUG}&day=2`), res);
		const arg = listShowcaseMock.mock.calls.at(-1)[0];
		expect(arg.from.toISOString()).toBe(e.days[1].start.toISOString());
		expect(arg.to.toISOString()).toBe(e.days[1].end.toISOString());
	});

	it('unknown event is 404, malformed slug or day is 400', async () => {
		let res = mkRes();
		await gallery(mkReq('/api/forge-gallery?scope=community&event=no-such-event'), res);
		expect(res.statusCode).toBe(404);
		res = mkRes();
		await gallery(mkReq('/api/forge-gallery?scope=community&event=Bad%20Slug!'), res);
		expect(res.statusCode).toBe(400);
		res = mkRes();
		await gallery(mkReq(`/api/forge-gallery?scope=community&event=${SLUG}&day=9`), res);
		expect(res.statusCode).toBe(400);
		res = mkRes();
		await gallery(mkReq(`/api/forge-gallery?scope=community&event=${SLUG}&day=abc`), res);
		expect(res.statusCode).toBe(400);
	});

	it('all and week keep their previous output shape and pass no explicit bounds', async () => {
		for (const w of ['all', 'week']) {
			const res = mkRes();
			await gallery(mkReq(`/api/forge-gallery?scope=community&sort=top&window=${w}`), res);
			const arg = listShowcaseMock.mock.calls.at(-1)[0];
			expect(arg.window).toBe(w);
			expect(arg.from).toBeUndefined();
			expect(Object.keys(parsed(res)).sort()).toEqual(['creations', 'enabled', 'sort', 'total', 'window']);
		}
	});
});

describe('GET /api/forge-off/event', () => {
	it('returns config, per-day top 3, the overall leader and the rules', async () => {
		const e = ev.getEvent(SLUG);
		const entries = [];
		const votes = [];
		for (const d of e.days.slice(0, 3)) {
			const t = d.start.getTime();
			entries.push(entryRow(`d${d.index}-a`, t + 3_600_000), entryRow(`d${d.index}-b`, t + 7_200_000));
			votes.push(...voteRows(`d${d.index}-a`, d.index === 2 ? 9 : 5, t + 9_000_000), ...voteRows(`d${d.index}-b`, 2, t + 9_000_000));
		}
		sqlMock.mockImplementation(standingsDb({ entries, votes }));
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
		const res = mkRes();
		try {
			await eventApi(mkReq(`/api/forge-off/event?slug=${SLUG}`), res);
		} finally {
			vi.useRealTimers();
		}
		expect(res.statusCode).toBe(200);
		const body = parsed(res);
		expect(body.slug).toBe(SLUG);
		expect(body.now).toBe('2026-11-11T10:00:00.000Z');
		expect(body.days).toHaveLength(5);
		expect(body.days[0].top.map((c) => [c.id, c.vote_count])).toEqual([['d1-a', 5], ['d1-b', 2]]);
		expect(body.days[0].closed).toBe(true);
		expect(body.days[2]).toMatchObject({ started: true, closed: false });
		expect(body.days[3]).toMatchObject({ started: false, closed: false, top: [] });
		expect(body.live_day).toBe(3);
		expect(body.phase).toBe('live');
		expect(body.days[0].theme).toMatch(/job wishes/);
		expect(body.overall.leader.id).toBe('d2-a');
		expect(body.overall.total_votes).toBe(5 + 2 + 9 + 2 + 5 + 2);
		expect(body.overall.entries).toBe(6);
		expect(body.rules.items.length).toBeGreaterThan(3);
		expect(body.rules.votes_per_network_per_entry).toBe(3);
	});

	it('board=day-<n> returns the full ranking of one board', async () => {
		const e = ev.getEvent(SLUG);
		const t = e.days[0].start.getTime();
		const entries = Array.from({ length: 30 }, (_, i) => entryRow(`e${String(i).padStart(2, '0')}`, t + i * 60_000));
		sqlMock.mockImplementation(standingsDb({ entries, votes: voteRows('e29', 1, t + 7_200_000) }));
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
		const res = mkRes();
		try {
			await eventApi(mkReq(`/api/forge-off/event?slug=${SLUG}&board=day-1`), res);
		} finally {
			vi.useRealTimers();
		}
		const body = parsed(res);
		expect(body).toMatchObject({ board_key: 'day-1', closed: true, closes_at: e.days[0].end.toISOString() });
		expect(body.entries).toHaveLength(24);
		expect(body.entries[0].id).toBe('e29');
		expect(body.entries[1].id).toBe('e00');
	});

	it('404 for unknown slug, 400 for malformed slug or board', async () => {
		let res = mkRes();
		await eventApi(mkReq('/api/forge-off/event?slug=nope-nope'), res);
		expect(res.statusCode).toBe(404);
		res = mkRes();
		await eventApi(mkReq('/api/forge-off/event?slug=%00'), res);
		expect(res.statusCode).toBe(400);
		res = mkRes();
		await eventApi(mkReq('/api/forge-off/event?slug='), res);
		expect(res.statusCode).toBe(400);
		for (const b of ['day-9', 'day-x', 'week']) {
			res = mkRes();
			await eventApi(mkReq(`/api/forge-off/event?slug=${SLUG}&board=${b}`), res);
			expect(res.statusCode).toBe(400);
		}
	});

	it('without a slug, picks the live or next event and never an ended one', async () => {
		const at = async (iso) => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date(iso));
			const res = mkRes();
			try {
				await eventApi(mkReq('/api/forge-off/event'), res);
			} finally {
				vi.useRealTimers();
			}
			return parsed(res);
		};
		expect((await at('2026-11-01T00:00:00Z'))).toMatchObject({ slug: SLUG, phase: 'upcoming' });
		expect((await at('2026-11-11T10:00:00Z'))).toMatchObject({ slug: SLUG, phase: 'live' });
		const after = await at('2026-11-14T00:00:00Z');
		expect(after).toMatchObject({ slug: null, phase: 'none' });
		expect(after.events.find((x) => x.slug === SLUG)).toMatchObject({ phase: 'ended', winner: null });
		expect(ev.pickDefaultEvent(new Date('2026-11-13T23:59:59.999Z')).slug).toBe(SLUG);
		expect(ev.pickDefaultEvent(new Date('2026-11-14T00:00:00Z'))).toBeNull();
	});

	it('a failed standings read is a 503 the page can retry, not an empty board', async () => {
		sqlMock.mockRejectedValue(new Error('connection refused'));
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
		const res = mkRes();
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await eventApi(mkReq(`/api/forge-off/event?slug=${SLUG}`), res);
		} finally {
			vi.useRealTimers();
			spy.mockRestore();
		}
		expect(res.statusCode).toBe(503);
		expect(parsed(res).error).toBe('standings_unavailable');
	});
});

describe('GET /api/cron/forge-off-event-crown', () => {
	it('crowns nothing when no event has a closed day', async () => {
		const res = mkRes();
		await crown(mkReq('/api/cron/forge-off-event-crown?now=2026-01-01T00:00:00Z'), res);
		expect(res.statusCode).toBe(200);
		expect(parsed(res).crowned).toEqual([]);
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('crowns each closed day with its theme and the overall once the event ends', async () => {
		const e = ev.getEvent(SLUG);
		const entries = e.days.map((d) => entryRow(`c${d.index}`, d.start.getTime() + 3_600_000));
		const votes = e.days.flatMap((d) => voteRows(`c${d.index}`, d.index === 4 ? 6 : 4, d.start.getTime() + 7_200_000));
		sqlMock.mockImplementation(standingsDb({ entries, votes }));
		const res = mkRes();
		await crown(mkReq('/api/cron/forge-off-event-crown?dry_run=1&now=2026-11-14T00:07:00Z'), res);
		const body = parsed(res);
		expect(body.dry_run).toBe(true);
		const keys = body.crowned.map((c) => c.board_key);
		expect(keys).toEqual(['day-1', 'day-2', 'day-3', 'day-4', 'day-5', 'overall']);
		expect(body.crowned[0].theme).toMatch(/job wishes/);
		expect(body.crowned.at(-1)).toMatchObject({ creation_id: 'c4', votes: 6 });
		expect(sqlMock.mock.calls.some(([strings]) => strings.join('').includes('insert into'))).toBe(false);
	});

	it('skips boards that are already crowned without re-ranking them', async () => {
		const winners = ['day-1', 'day-2', 'day-3', 'day-4', 'day-5', 'overall'].map((board_key) => ({
			event_slug: SLUG, board_key, creation_id: null, votes: 1,
		}));
		sqlMock.mockImplementation(standingsDb({ winners }));
		const res = mkRes();
		await crown(mkReq('/api/cron/forge-off-event-crown?now=2026-11-20T00:07:00Z'), res);
		expect(parsed(res)).toMatchObject({ ok: true, crowned: [], deferred: [] });
		expect(sqlMock).toHaveBeenCalledTimes(1);
	});

	it('rejects a malformed now override', async () => {
		const res = mkRes();
		await crown(mkReq('/api/cron/forge-off-event-crown?now=garbage'), res);
		expect(res.statusCode).toBe(400);
	});
});
