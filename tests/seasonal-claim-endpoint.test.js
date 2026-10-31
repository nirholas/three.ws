// The Halloween claim, end to end through the HTTP boundary.
//
// api/seasonal/[id].js over api/_lib/seasonal-drops.js, with the database and
// Redis replaced by small in-memory stand-ins that behave like the real stores
// for the statements the claim runs: user_badges is unique on (user_id, code)
// and `on conflict do nothing` returns no row for a repeat, and the grant
// ledger is a set. That lets these tests prove the promises the page makes:
// one claim grants all four gifts, a repeat changes nothing, a Redis outage is
// reported and heals on the next call, and the window is enforced by the server.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ badges: new Map(), fail: false }));
const kv = vi.hoisted(() => ({ sets: new Map(), down: false }));
const session = vi.hoisted(() => ({ user: null, sameSite: true }));

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...values) => {
		const text = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
		if (db.fail) return Promise.reject(new Error('database unavailable'));
		if (text.startsWith('select unlocked_at from user_badges')) {
			const [userId, code] = values;
			const at = db.badges.get(`${userId}:${code}`);
			return Promise.resolve(at ? [{ unlocked_at: at }] : []);
		}
		if (text.startsWith('insert into user_badges')) {
			const [userId, code] = values;
			const key = `${userId}:${code}`;
			if (db.badges.has(key)) return Promise.resolve([]);
			const at = new Date();
			db.badges.set(key, at);
			return Promise.resolve([{ unlocked_at: at }]);
		}
		return Promise.reject(new Error(`unexpected statement in test: ${text}`));
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false, isStoragePressured: () => false };
});

vi.mock('../api/_lib/redis.js', () => ({
	getRedis: () =>
		kv.down
			? {
					sadd: () => Promise.reject(new Error('redis down')),
					expire: () => Promise.resolve(1),
				}
			: {
					sadd: (key, ...ids) => {
						const s = kv.sets.get(key) || new Set();
						ids.forEach((id) => s.add(id));
						kv.sets.set(key, s);
						return Promise.resolve(ids.length);
					},
					expire: () => Promise.resolve(1),
				},
}));

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: () => Promise.resolve(session.user),
	isSameSiteOrigin: () => session.sameSite,
}));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		authedReadIp: () => Promise.resolve({ success: true }),
		dropClaimUser: () => Promise.resolve({ success: true }),
	},
	clientIp: () => '203.0.113.7',
}));

const { default: handler } = await import('../api/seasonal/[id].js');
const { HALLOWEEN_2026, userGrantKey } = await import('../api/_lib/seasonal-drops.js');

const START = Date.parse(HALLOWEEN_2026.startsAt);
const END = Date.parse(HALLOWEEN_2026.endsAt);
const USER = { id: '7d1f6f2c-0c0b-4d3e-9a51-2f1a4c8e9b10', username: 'moonlit' };
const WEARABLES = ['pumpkin-cap-halloween-2026', 'aura-witchlight-halloween-2026'];

function mkReq(method, id = HALLOWEEN_2026.id) {
	return { method, url: `/api/seasonal/${id}`, query: { id }, headers: { origin: 'https://three.ws' }, on() {}, destroy() {} };
}

function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete this.headers[k.toLowerCase()];
		},
		writeHead(status, hdrs = {}) {
			this.statusCode = status;
			Object.entries(hdrs).forEach(([k, v]) => this.setHeader(k, v));
			return this;
		},
		end(b) {
			this.body = b;
			this.writableEnded = true;
			this.headersSent = true;
		},
	};
}

async function call(method, id) {
	const res = mkRes();
	await handler(mkReq(method, id), res);
	return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined, headers: res.headers };
}

beforeEach(() => {
	db.badges.clear();
	db.fail = false;
	kv.sets.clear();
	kv.down = false;
	session.user = USER;
	session.sameSite = true;
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(START + 6 * 3600e3);
});
afterEach(() => vi.useRealTimers());

describe('GET /api/seasonal/:id', () => {
	it('describes the drop to a signed-out visitor without caching it', async () => {
		session.user = null;
		const { status, body, headers } = await call('GET');
		expect(status).toBe(200);
		expect(body.phase).toBe('live');
		expect(body.gifts.map((g) => g.kind)).toEqual(['cosmetic', 'cosmetic', 'badge', 'wallpaper']);
		expect(body.claim).toEqual({ signedIn: false, claimed: false, claimedAt: null, username: null });
		expect(headers['cache-control']).toBe('private, no-store');
	});

	it('404s an unknown drop', async () => {
		expect((await call('GET', 'easter-2027')).status).toBe(404);
	});
});

describe('POST /api/seasonal/:id', () => {
	it('grants the badge and both wearables in one claim', async () => {
		const { status, body } = await call('POST');
		expect(status).toBe(200);
		expect(body.claim).toMatchObject({ signedIn: true, claimed: true, newlyClaimed: true, wearablesSynced: true, username: 'moonlit' });
		expect(db.badges.has(`${USER.id}:${HALLOWEEN_2026.badge}`)).toBe(true);
		expect([...kv.sets.get(userGrantKey(USER.id))]).toEqual(WEARABLES);

		const after = await call('GET');
		expect(after.body.claim).toMatchObject({ claimed: true, claimedAt: body.claim.claimedAt });
	});

	it('a second press changes nothing and keeps the original claim time', async () => {
		const first = await call('POST');
		vi.setSystemTime(START + 20 * 3600e3);
		const second = await call('POST');
		expect(second.status).toBe(200);
		expect(second.body.claim.newlyClaimed).toBe(false);
		expect(second.body.claim.claimedAt).toBe(first.body.claim.claimedAt);
		expect(db.badges.size).toBe(1);
	});

	it('reports wearables still syncing when Redis is down, and heals on the next call', async () => {
		kv.down = true;
		const first = await call('POST');
		expect(first.status).toBe(200);
		expect(first.body.claim).toMatchObject({ claimed: true, newlyClaimed: true, wearablesSynced: false });

		kv.down = false;
		const retry = await call('POST');
		expect(retry.body.claim).toMatchObject({ newlyClaimed: false, wearablesSynced: true });
		expect([...kv.sets.get(userGrantKey(USER.id))]).toEqual(WEARABLES);
	});

	it('lets an earlier claimer re-sync after the weekend, but grants nothing new to anyone else', async () => {
		await call('POST');
		kv.sets.clear();
		vi.setSystemTime(END + 30 * 86400e3);
		const resync = await call('POST');
		expect(resync.status).toBe(200);
		expect(resync.body.claim.wearablesSynced).toBe(true);
		expect(kv.sets.get(userGrantKey(USER.id)).size).toBe(2);

		session.user = { id: 'b0c3a1e2-5f6d-4e7a-8b9c-0d1e2f3a4b5c', username: 'latecomer' };
		const late = await call('POST');
		expect(late.status).toBe(410);
		expect(late.body.error).toBe('drop_closed');
		expect(db.badges.size).toBe(1);
	});

	it('refuses a claim before the window opens', async () => {
		vi.setSystemTime(START - 1);
		const { status, body } = await call('POST');
		expect(status).toBe(409);
		expect(body.error).toBe('drop_not_open');
		expect(db.badges.size).toBe(0);
	});

	it('asks a signed-out visitor to sign in', async () => {
		session.user = null;
		expect((await call('POST')).status).toBe(401);
	});

	it('blocks a cross-site claim', async () => {
		session.sameSite = false;
		expect((await call('POST')).status).toBe(403);
		expect(db.badges.size).toBe(0);
	});

	it('never reports a claim the database did not record', async () => {
		db.fail = true;
		const { status, body } = await call('POST');
		expect(status).toBeGreaterThanOrEqual(500);
		expect(body?.claim).toBeUndefined();
	});
});
