// The live override for public/event.json: merge rules, write-time validation, the
// API handler's auth, and every reader honouring it (API cache, game server, browser).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';

const STATIC = {
	id: 'test-meetup',
	name: 'Test Meetup',
	tagline: 'Tagline',
	startsAt: '2026-11-06T16:00:00Z',
	endsAt: '2026-11-06T17:00:00Z',
	link: '/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three',
	agenda: [{ atMin: 0, title: 'Doors', icon: 'x' }, { atMin: 55, title: 'Photo', icon: 'y' }],
};
const T = (iso) => Date.parse(iso);
const DURING = T('2026-11-06T16:30:00Z');

const { applyOverride, buildOverride } = await import('../api/_lib/event-override.js');
const { eventConfig, __resetEventConfig, refreshEventOverride } = await import('../api/_lib/event-config.js');
const { NO_EVENT_DOC } = await import('../scripts/check-event-window.mjs');

describe('applyOverride', () => {
	it('returns the static file when there is no override', () => {
		expect(applyOverride(STATIC, null)).toEqual({ doc: STATIC, applied: false });
	});

	it('a later endsAt extends the window', () => {
		const r = applyOverride(STATIC, { base_id: STATIC.id, patch: { endsAt: '2026-11-06T17:30:00Z' } });
		expect(r.applied).toBe(true);
		expect(r.doc.endsAt).toBe('2026-11-06T17:30:00Z');
		expect(r.doc.id).toBe(STATIC.id);
	});

	it('a cancelled override yields the no-event document', () => {
		const r = applyOverride(STATIC, { base_id: STATIC.id, cancelled: true });
		expect(r.doc).toEqual(NO_EVENT_DOC);
	});

	it('ignores an override written for a different event id', () => {
		const r = applyOverride(STATIC, { base_id: 'old-event', patch: { endsAt: '2026-11-06T18:00:00Z' } });
		expect(r.applied).toBe(false);
		expect(r.doc).toBe(STATIC);
	});

	it('ignores a stored override that fails validation (end before start, over the cap)', () => {
		const before = applyOverride(STATIC, { base_id: STATIC.id, patch: { endsAt: '2026-11-06T15:00:00Z' } });
		expect(before.applied).toBe(false);
		const huge = applyOverride(STATIC, { base_id: STATIC.id, patch: { endsAt: '2026-11-09T17:00:00Z' } });
		expect(huge.applied).toBe(false);
		expect(huge.doc).toBe(STATIC);
	});

	it('never lets a stored override change the id', () => {
		const r = applyOverride(STATIC, { base_id: STATIC.id, patch: { id: 'other', endsAt: '2026-11-06T17:30:00Z' } });
		expect(r.doc.id).toBe(STATIC.id);
	});
});

describe('buildOverride', () => {
	const build = (input, current = null, now = DURING) => buildOverride({ staticDoc: STATIC, current, input, now });

	it('accepts an extension and records the base id', () => {
		const r = build({ endsAt: '2026-11-06T17:30:00Z' });
		expect(r.ok).toBe(true);
		expect(r.value).toEqual({ base_id: STATIC.id, patch: { endsAt: '2026-11-06T17:30:00Z' } });
	});

	it('rejects end before start, an over-long window and bad fields', () => {
		expect(build({ endsAt: '2026-11-06T15:00:00Z' }).ok).toBe(false);
		expect(build({ endsAt: '2026-11-08T17:00:00Z' }).ok).toBe(false);
		expect(build({ endsAt: 'soon' }).ok).toBe(false);
		expect(build({ link: 'javascript:alert(1)' }).ok).toBe(false);
		expect(build({}).ok).toBe(false);
	});

	it('cannot rename the id: an id field is dropped, not stored', () => {
		const r = build({ id: 'hijack', name: 'Renamed' });
		expect(r.ok).toBe(true);
		expect(r.value.patch).toEqual({ name: 'Renamed' });
	});

	it('{ end: true } during the event ends it now, keeping the id (leaderboard stays readable)', () => {
		const r = build({ end: true });
		expect(r.ok).toBe(true);
		expect(r.doc.id).toBe(STATIC.id);
		expect(Date.parse(r.doc.endsAt)).toBe(Math.floor(DURING / 1000) * 1000);
	});

	it('{ end: true } before the start cancels into the no-event document', () => {
		const r = build({ end: true }, null, T('2026-11-06T10:00:00Z'));
		expect(r.doc).toEqual(NO_EVENT_DOC);
		expect(r.value.cancelled).toBe(true);
	});

	it('{ clear: true } clears; successive patches accumulate', () => {
		expect(build({ clear: true })).toMatchObject({ ok: true, clear: true, value: null });
		const first = build({ endsAt: '2026-11-06T17:30:00Z' });
		const second = build({ name: 'Longer' }, first.value);
		expect(second.value.patch).toEqual({ endsAt: '2026-11-06T17:30:00Z', name: 'Longer' });
	});

	it('refuses when the static file holds no event', () => {
		const r = buildOverride({ staticDoc: NO_EVENT_DOC, current: null, input: { endsAt: '2026-11-06T17:30:00Z' }, now: DURING });
		expect(r.ok).toBe(false);
	});
});

describe('eventConfig() with a live override', () => {
	beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
	afterEach(() => vi.restoreAllMocks());

	it('equals the static file when no override exists', async () => {
		__resetEventConfig(async () => null, STATIC);
		await refreshEventOverride();
		expect(eventConfig(DURING)).toMatchObject({ id: STATIC.id, endsAt: T(STATIC.endsAt) });
	});

	it('serves the extended end once the override has loaded', async () => {
		__resetEventConfig(async () => ({ base_id: STATIC.id, patch: { endsAt: '2026-11-06T17:30:00Z' } }), STATIC);
		await refreshEventOverride();
		expect(eventConfig(DURING).endsAt).toBe(T('2026-11-06T17:30:00Z'));
	});

	it('an override naming the no-event state ends the event', async () => {
		__resetEventConfig(async () => ({ base_id: STATIC.id, cancelled: true }), STATIC);
		await refreshEventOverride();
		expect(eventConfig(DURING)).toBeNull();
	});

	it('ignores an invalid stored override', async () => {
		__resetEventConfig(async () => ({ base_id: STATIC.id, patch: { endsAt: '2026-11-06T15:00:00Z' } }), STATIC);
		await refreshEventOverride();
		expect(eventConfig(DURING).endsAt).toBe(T(STATIC.endsAt));
	});

	it('a failed override read falls back to the static file and keeps the last good override', async () => {
		let n = 0;
		__resetEventConfig(async () => {
			if (n++ === 0) return { base_id: STATIC.id, patch: { endsAt: '2026-11-06T17:30:00Z' } };
			throw new Error('db down');
		}, STATIC);
		await refreshEventOverride();
		expect(eventConfig(DURING).endsAt).toBe(T('2026-11-06T17:30:00Z'));
		await refreshEventOverride();
		expect(eventConfig(DURING).endsAt).toBe(T('2026-11-06T17:30:00Z'));

		__resetEventConfig(async () => { throw new Error('db down'); }, STATIC);
		await refreshEventOverride();
		expect(eventConfig(DURING).endsAt).toBe(T(STATIC.endsAt));
	});
});

describe('game server reader (multiplayer/src/event-window.js)', () => {
	let mod;
	beforeEach(async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		mod = await import('../multiplayer/src/event-window.js');
		mod.__setEventWindowCache(null, 0);
	});
	afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

	const ok = (doc) => ({ ok: true, status: 200, json: async () => doc });

	it('reads /api/event-config first, so an extended end moves the gate', async () => {
		const fetchMock = vi.fn(async (url) => ok({ ...STATIC, endsAt: '2026-11-06T17:30:00Z' }));
		vi.stubGlobal('fetch', fetchMock);
		const win = await mod.refreshEventWindow(DURING);
		expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/event-config$/);
		expect(win.endsAt).toBe(T('2026-11-06T17:30:00Z'));
		expect(mod.isEventLive(win, T('2026-11-06T17:10:00Z'))).toBe(true);
	});

	it('falls back to /event.json when the API is unreachable', async () => {
		const fetchMock = vi.fn(async (url) => {
			if (String(url).endsWith('/api/event-config')) throw new Error('ECONNREFUSED');
			return ok(STATIC);
		});
		vi.stubGlobal('fetch', fetchMock);
		const win = await mod.refreshEventWindow(DURING);
		expect(win.endsAt).toBe(T(STATIC.endsAt));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('stays closed on a cold start when both sources fail', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
		const win = await mod.refreshEventWindow(DURING);
		expect(win).toBeNull();
		expect(mod.isEventLive(win, DURING)).toBe(false);
	});

	it('a no-event answer from the API closes the gate', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ok(NO_EVENT_DOC)));
		expect(await mod.refreshEventWindow(DURING)).toBeNull();
	});
});

describe('browser reader (src/shared/event-config.js)', () => {
	afterEach(() => vi.unstubAllGlobals());
	const ok = (doc) => ({ ok: true, status: 200, json: async () => doc });

	it('prefers /api/event-config and falls back to /event.json', async () => {
		const { fetchEventDocument } = await import('../src/shared/event-config.js');
		const urls = [];
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			urls.push(url);
			if (url === '/api/event-config') return { ok: false, status: 502, json: async () => ({}) };
			return ok(STATIC);
		}));
		expect(await fetchEventDocument()).toEqual(STATIC);
		expect(urls).toEqual(['/api/event-config', '/event.json']);
	});

	it('returns null when neither source is readable', async () => {
		const { fetchEventDocument } = await import('../src/shared/event-config.js');
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
		expect(await fetchEventDocument()).toBeNull();
	});
});

describe('POST /api/event-config handler', () => {
	const store = { row: null, saved: null, cleared: false };
	let handler;
	const realEnv = { ...process.env };

	beforeEach(async () => {
		vi.resetModules();
		vi.doMock('../api/_lib/audit.js', () => ({ logAuditNow: vi.fn(async () => true), logAudit: vi.fn() }));
		vi.doMock('../api/_lib/rate-limit.js', () => ({ limits: { publicIp: async () => ({ success: true }) }, clientIp: () => '127.0.0.1' }));
		vi.doMock('../api/_lib/auth.js', () => ({ getSessionUser: async () => null }));
		vi.doMock('../api/_lib/event-override.js', async () => {
			const real = await vi.importActual('../api/_lib/event-override.js');
			return {
				...real,
				loadOverrideRow: async () => store.row,
				saveOverrideRow: async (v, actor) => { store.saved = { v, actor }; store.row = v; },
				clearOverrideRow: async () => { store.cleared = true; store.row = null; },
			};
		});
		store.row = null; store.saved = null; store.cleared = false;
		process.env.NODE_ENV = 'production';
		process.env.OPS_SECRET = 'test-ops-secret';
		const cfg = await import('../api/_lib/event-config.js');
		cfg.__resetEventConfig(async () => store.row, STATIC);
		handler = (await import('../api/event-config.js')).default;
	});
	afterEach(() => {
		process.env = { ...realEnv };
		vi.doUnmock('../api/_lib/event-override.js');
	});

	function call(method, body, headers = {}) {
		const payload = body === undefined ? '' : JSON.stringify(body);
		const req = Object.assign(Readable.from(payload ? [Buffer.from(payload)] : []), {
			method, url: '/api/event-config', headers: { 'content-type': 'application/json', host: 'localhost', ...headers },
		});
		return new Promise((resolve) => {
			const res = {
				statusCode: 200, _headers: {},
				setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
				getHeader(k) { return this._headers[k.toLowerCase()]; },
				end(b) { resolve({ status: this.statusCode, headers: this._headers, body: b ? JSON.parse(b) : null }); },
			};
			handler(req, res);
		});
	}

	it('refuses an unauthenticated write', async () => {
		const r = await call('POST', { endsAt: '2026-11-06T17:30:00Z' });
		expect([401, 403]).toContain(r.status);
		expect(store.saved).toBeNull();
	});

	it('refuses a wrong ops secret', async () => {
		const r = await call('POST', { clear: true }, { 'x-ops-secret': 'nope' });
		expect([401, 403]).toContain(r.status);
	});

	it('GET is public and serves the effective document', async () => {
		const r = await call('GET');
		expect(r.status).toBe(200);
		expect(r.headers['cache-control']).toBe('public, max-age=15');
		expect(r.body.id).toBe(STATIC.id);
	});

	it('an authorised extension is stored and then served by GET', async () => {
		const w = await call('POST', { endsAt: '2026-11-06T17:30:00Z' }, { 'x-ops-secret': 'test-ops-secret' });
		expect(w.status).toBe(200);
		expect(store.saved.actor).toBe('ops-secret');
		const r = await call('GET');
		expect(r.body.endsAt).toBe('2026-11-06T17:30:00Z');
	});

	it('rejects an invalid override at write time with 422 and stores nothing', async () => {
		const w = await call('POST', { endsAt: '2026-11-06T15:00:00Z' }, { 'x-ops-secret': 'test-ops-secret' });
		expect(w.status).toBe(422);
		expect(store.saved).toBeNull();
	});

	it('clear removes the override', async () => {
		const w = await call('POST', { clear: true }, { 'x-ops-secret': 'test-ops-secret' });
		expect(w.status).toBe(200);
		expect(store.cleared).toBe(true);
	});
});
