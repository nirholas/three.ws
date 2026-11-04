// Forge-Off themed events: config validation, UTC day windows, gallery
// routing (window=day, event=<slug>&day=<n>), the event endpoint, and the
// event crown cron. Pure window math is tested directly; handlers run against
// a mocked store/db so no network is touched.

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

	it('event=<slug>&day=2 scopes to that day, event alone to the whole event', async () => {
		const e = ev.getEvent(SLUG);
		let res = mkRes();
		await gallery(mkReq(`/api/forge-gallery?scope=community&sort=top&event=${SLUG}&day=2`), res);
		let arg = listShowcaseMock.mock.calls.at(-1)[0];
		expect(arg.from.toISOString()).toBe(e.days[1].start.toISOString());
		expect(arg.to.toISOString()).toBe(e.days[1].end.toISOString());
		res = mkRes();
		await gallery(mkReq(`/api/forge-gallery?scope=community&sort=top&event=${SLUG}`), res);
		arg = listShowcaseMock.mock.calls.at(-1)[0];
		expect(arg.from.toISOString()).toBe(e.start.toISOString());
		expect(arg.to.toISOString()).toBe(e.end.toISOString());
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
	it('returns config, per-day top 3 and an overall leader', async () => {
		const mk = (id, votes) => ({ id, prompt: id, vote_count: votes, voted: false });
		listShowcaseMock.mockImplementation(async ({ from, limit }) => {
			if (limit === 3) return [mk(`d${from.getUTCDate()}-a`, 5), mk(`d${from.getUTCDate()}-b`, 2)];
			return [mk('overall-1', 9)];
		});
		sqlMock.mockResolvedValue([{ total_votes: 31, entries: 7 }]);
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
		expect(body.days).toHaveLength(5);
		expect(body.days[0].top).toHaveLength(2);
		expect(body.days[2].started).toBe(true);
		expect(body.days[3].started).toBe(false);
		expect(body.live_day).toBe(3);
		expect(body.phase).toBe('live');
		expect(body.days[0].theme).toMatch(/job wishes/);
		expect(body.overall.leader.id).toBe('overall-1');
		expect(body.overall.total_votes).toBe(31);
		expect(['upcoming', 'live', 'ended']).toContain(body.phase);
	});

	it('404 for unknown slug, 400 for malformed', async () => {
		let res = mkRes();
		await eventApi(mkReq('/api/forge-off/event?slug=nope-nope'), res);
		expect(res.statusCode).toBe(404);
		res = mkRes();
		await eventApi(mkReq('/api/forge-off/event?slug=%00'), res);
		expect(res.statusCode).toBe(400);
		res = mkRes();
		await eventApi(mkReq('/api/forge-off/event?slug='), res);
		expect(res.statusCode).toBe(400);
		res = mkRes();
		await eventApi(mkReq('/api/forge-off/event'), res);
		expect(res.statusCode).toBe(200);
		expect(parsed(res).slug).toBe(SLUG);
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
		sqlMock.mockImplementation(async () => [{
			id: 'c1', prompt: 'p', glb_url: 'g', preview_image_url: 'i', model_category: 'item', vote_count: 4,
		}]);
		const res = mkRes();
		await crown(mkReq('/api/cron/forge-off-event-crown?dry_run=1&now=2026-11-14T00:07:00Z'), res);
		const body = parsed(res);
		expect(body.dry_run).toBe(true);
		const keys = body.crowned.map((c) => c.board_key);
		expect(keys).toEqual(['day-1', 'day-2', 'day-3', 'day-4', 'day-5', 'overall']);
		expect(body.crowned[0].theme).toMatch(/job wishes/);
	});

	it('rejects a malformed now override', async () => {
		const res = mkRes();
		await crown(mkReq('/api/cron/forge-off-event-crown?now=garbage'), res);
		expect(res.statusCode).toBe(400);
	});
});
