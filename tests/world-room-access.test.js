// Private worlds in the realtime room (Silver `worlds.private`).
//
// The HTTP read gate (tests/world-private-gate.test.js) keeps a private world's
// document away from strangers, but the same document is also served by the
// multiplayer room for that coin, together with the voxel builds the room keeps
// in its own store. These tests lock the room half of the perk:
//
//   1. The room reads the world with its service token, so a private world
//      boots with its real build instead of an empty plaza whose saves 409
//      forever (the bug this file was written to reproduce).
//   2. The API mints a short-lived world-access pass only for the owner and the
//      invitees of a private world, and the room verifies it byte-for-byte.
//   3. The room refuses a join to a private world without a valid pass for an
//      account that is still allowed in, and evicts anyone who loses access
//      while they are inside.
//   4. The browser asks for that pass through one helper.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { makeWorldBackend } from './helpers/world-memory-backend.js';

const backend = makeWorldBackend();

vi.mock('../api/_lib/world-store.js', async (importActual) => {
	const actual = await importActual();
	const store = actual.createWorldStore(backend);
	return { ...actual, ...store };
});
vi.mock('../api/_lib/account-auth.js', () => ({
	resolveAccount: async (req) => {
		const id = req.headers['x-test-user'];
		return id ? { userId: id, source: 'session' } : null;
	},
}));
vi.mock('../api/_lib/world-service-auth.js', () => ({
	verifyWorldServiceToken: async (token) => (token === 'svc' ? { svc: 'world' } : null),
}));
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, limits: { ...actual.limits, prefsWrite: async () => ({ success: true }), publicIp: async () => ({ success: true }) } };
});
const USERS = { alice: 'u-alice', bob: 'u-bob', carol: 'u-carol' };
vi.mock('../api/_lib/world-invites.js', () => ({
	resolveInvitee: async (handle) => {
		const name = String(handle).replace(/^@/, '').toLowerCase();
		return USERS[name] ? { id: USERS[name], username: name } : null;
	},
	describeInvitees: async (ids) => ids.map((id) => ({ id, username: Object.keys(USERS).find((k) => USERS[k] === id) ?? null })),
}));

let handler;

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '', _ended: false,
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; this._ended = true; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function mockReq(action, { body = null, query = '', user = null, service = false } = {}) {
	const get = action === 'load';
	const r = Readable.from(body != null ? [Buffer.from(JSON.stringify(body))] : []);
	r.method = get ? 'GET' : 'POST';
	r.url = `/api/world/${action}${query}`;
	r.headers = {
		origin: 'http://localhost:3000',
		...(get ? {} : { 'content-type': 'application/json' }),
		...(user ? { 'x-test-user': USERS[user] ?? user } : {}),
		...(service ? { authorization: 'Bearer svc' } : {}),
	};
	return r;
}

async function call(action, opts) {
	const res = mockRes();
	await handler(mockReq(action, opts), res);
	return res;
}

const accessPass = (worldId, opts = {}) => call('access-pass', { ...opts, body: { worldId } });
const loadAccess = (worldId, opts = {}) =>
	call('load', { ...opts, query: `?worldId=${encodeURIComponent(worldId)}&fields=access` });

// A private world owned by alice with bob invited, written straight to the
// store so these tests do not depend on the Silver gate (covered elsewhere).
async function seedPrivateWorld(worldId) {
	const store = await import('../api/_lib/world-store.js');
	await store.saveWorld({ worldId, doc: { objects: [{ id: 'p1', x: 1, y: 0, z: 1 }] }, ifMatch: null, writer: 'u-alice', owner: 'u-alice' });
	await store.setWorldAccess({ worldId, visibility: 'private', invite: ['u-bob'] });
}

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	delete process.env.HOLDER_PASS_SECRET;
	delete process.env.MULTIPLAYER_SHARED_SECRET;
	handler = (await import('../api/world/[action].js')).default;
});

beforeEach(() => {
	backend.rows.clear();
	backend.blobs.clear();
});

describe('POST /api/world/access-pass', () => {
	it('needs no pass for a public or never-saved world', async () => {
		const fresh = await accessPass('w-none', { user: 'carol' });
		expect(fresh.statusCode).toBe(200);
		expect(fresh.json).toMatchObject({ worldId: 'w-none', visibility: 'public', pass: null });

		const store = await import('../api/_lib/world-store.js');
		await store.saveWorld({ worldId: 'w-pub', doc: { objects: [] }, ifMatch: null, writer: 'u-alice', owner: 'u-alice' });
		const pub = await accessPass('w-pub');
		expect(pub.statusCode).toBe(200);
		expect(pub.json).toMatchObject({ visibility: 'public', pass: null });
	});

	it('mints a pass the room verifies for the owner and for an invitee', async () => {
		await seedPrivateWorld('w-priv');
		const { verifyWorldAccessPass } = await import('../multiplayer/src/world-access-pass.js');

		const owner = await accessPass('w-priv', { user: 'alice' });
		expect(owner.statusCode).toBe(200);
		expect(owner.json.visibility).toBe('private');
		expect(typeof owner.json.pass).toBe('string');
		expect(verifyWorldAccessPass(owner.json.pass)).toMatchObject({ worldId: 'w-priv', account: 'u-alice' });
		expect(owner.json.expiresAt).toBeGreaterThan(Date.now() / 1000);

		const invitee = await accessPass('w-priv', { user: 'bob' });
		expect(invitee.statusCode).toBe(200);
		expect(verifyWorldAccessPass(invitee.json.pass)).toMatchObject({ worldId: 'w-priv', account: 'u-bob' });
	});

	it('answers 404 to a stranger and to an anonymous caller, so existence never leaks', async () => {
		await seedPrivateWorld('w-priv');
		for (const opts of [{ user: 'carol' }, {}]) {
			const res = await accessPass('w-priv', opts);
			expect(res.statusCode).toBe(404);
			expect(res.json.error).toBe('not_found');
			expect(res.json.pass).toBeUndefined();
		}
	});

	it('rejects a missing or malformed world id', async () => {
		const res = await call('access-pass', { user: 'alice', body: { worldId: '../etc' } });
		expect(res.statusCode).toBe(400);
	});
});

describe('GET /api/world/load?fields=access', () => {
	it('gives the game server visibility, owner and invitee ids without the document', async () => {
		await seedPrivateWorld('w-priv');
		const res = await loadAccess('w-priv', { service: true });
		expect(res.statusCode).toBe(200);
		expect(res.json).toMatchObject({ worldId: 'w-priv', visibility: 'private', ownerId: 'u-alice', invitees: ['u-bob'] });
		expect(res.json).not.toHaveProperty('doc');
	});

	it('keeps the same read rule: a stranger gets 404', async () => {
		await seedPrivateWorld('w-priv');
		const res = await loadAccess('w-priv', { user: 'carol' });
		expect(res.statusCode).toBe(404);
	});

	it('reports a public world as public with no invitee list', async () => {
		const store = await import('../api/_lib/world-store.js');
		await store.saveWorld({ worldId: 'w-pub', doc: { objects: [] }, ifMatch: null, writer: 'u-alice', owner: 'u-alice' });
		const res = await loadAccess('w-pub');
		expect(res.statusCode).toBe(200);
		expect(res.json).toMatchObject({ visibility: 'public' });
		expect(res.json).not.toHaveProperty('doc');
		expect(res.json).not.toHaveProperty('invitees');
	});
});

describe('multiplayer world persistence reads with its service token', () => {
	afterEach(() => vi.unstubAllGlobals());

	// The persistence API as the room sees it in production: a private world
	// answers 404 unless the request carries a valid service token.
	function stubPrivateWorldApi() {
		const calls = [];
		vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
			const auth = init.headers?.authorization || init.headers?.Authorization || '';
			calls.push({ url: String(url), method: init.method || 'GET', auth, body: init.body ? JSON.parse(init.body) : null });
			if (String(url).includes('/api/world/load')) {
				if (!auth.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
				return new Response(JSON.stringify({
					worldId: 'coin-priv', doc: { objects: [{ id: 'p1' }] }, version: 3, etag: 'etag-3',
					ownerId: 'u-alice', visibility: 'private', invitees: [{ id: 'u-bob', username: 'bob' }],
				}), { status: 200 });
			}
			return new Response(JSON.stringify({ etag: 'etag-4', version: 4 }), { status: 200 });
		}));
		return calls;
	}

	it('loads a private world with its build, its etag and its access list', async () => {
		const calls = stubPrivateWorldApi();
		const { worldPersistence } = await import('../multiplayer/src/persistence.js');
		const got = await worldPersistence.load('coin-priv');
		expect(calls[0].auth).toMatch(/^Bearer [\w-]+\.[\w-]+$/);
		const payload = JSON.parse(Buffer.from(calls[0].auth.slice(7).split('.')[0], 'base64url').toString('utf8'));
		expect(payload.svc).toBe('world');
		expect(got.doc).toEqual({ objects: [{ id: 'p1' }] });
		expect(got.etag).toBe('etag-3');
		expect(got.access).toEqual({ visibility: 'private', ownerId: 'u-alice', invitees: ['u-bob'] });
	});

	it('saves a private world against the etag it read instead of looping on 409', async () => {
		const calls = stubPrivateWorldApi();
		const { worldPersistence } = await import('../multiplayer/src/persistence.js');
		await worldPersistence.load('coin-priv-save');
		worldPersistence.save('coin-priv-save', () => ({ objects: [{ id: 'p1' }, { id: 'p2' }] }));
		await worldPersistence.flush('coin-priv-save');
		const post = calls.find((c) => c.method === 'POST');
		expect(post.body.ifMatch).toBe('etag-3');
	});

	it('reads only the access fields for the periodic re-check', async () => {
		const calls = [];
		vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
			calls.push({ url: String(url), auth: init.headers?.authorization || '' });
			return new Response(JSON.stringify({ visibility: 'private', ownerId: 'u-alice', invitees: ['u-bob'] }), { status: 200 });
		}));
		const { worldPersistence } = await import('../multiplayer/src/persistence.js');
		const access = await worldPersistence.loadAccess('coin-priv');
		expect(calls[0].url).toContain('fields=access');
		expect(calls[0].auth).toMatch(/^Bearer /);
		expect(access).toEqual({ visibility: 'private', ownerId: 'u-alice', invitees: ['u-bob'] });
	});

	it('returns null from the access read when the API is unreachable', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
		const { worldPersistence } = await import('../multiplayer/src/persistence.js');
		expect(await worldPersistence.loadAccess('coin-down')).toBeNull();
	});
});

describe('WalkRoom private-world join gate', () => {
	let WalkRoom;
	let signWorldAccessPass;
	let WORLD_PRIVATE_CLOSE_CODE;

	beforeAll(async () => {
		({ WalkRoom, WORLD_PRIVATE_CLOSE_CODE } = await import('../multiplayer/src/rooms/WalkRoom.js'));
		({ signWorldAccessPass } = await import('../api/_lib/world-access-pass.js'));
	});

	function makeRoom(access) {
		const room = Object.create(WalkRoom.prototype);
		room.clients = [];
		room._objKey = 'coin-priv';
		room._applyWorldAccess(access);
		return room;
	}
	const client = (sessionId, userData = {}) => ({ sessionId, userData, send: vi.fn(), leave: vi.fn() });
	const PRIVATE = { visibility: 'private', ownerId: 'u-alice', invitees: ['u-bob'] };

	it('admits anyone to a public world without a pass', () => {
		const room = makeRoom({ visibility: 'public', ownerId: 'u-alice', invitees: [] });
		expect(() => room._assertWorldAccess(client('s1'), {})).not.toThrow();
	});

	it('refuses a private world without a pass, with a typed world_private error', () => {
		const room = makeRoom(PRIVATE);
		expect(() => room._assertWorldAccess(client('s1'), {})).toThrow(/^world_private/);
		expect(() => room._assertWorldAccess(client('s1'), { worldPass: 'garbage.sig' })).toThrow(/^world_private/);
	});

	it('admits the owner and an invitee and binds the verified account to the session', async () => {
		const room = makeRoom(PRIVATE);
		const a = client('s1');
		room._assertWorldAccess(a, { worldPass: (await signWorldAccessPass({ worldId: 'coin-priv', account: 'u-alice' })).pass });
		expect(a.userData.worldAccount).toBe('u-alice');
		const b = client('s2');
		room._assertWorldAccess(b, { worldPass: (await signWorldAccessPass({ worldId: 'coin-priv', account: 'u-bob' })).pass });
		expect(b.userData.worldAccount).toBe('u-bob');
	});

	it('refuses a pass minted for another world', async () => {
		const room = makeRoom(PRIVATE);
		const { pass } = await signWorldAccessPass({ worldId: 'other-coin', account: 'u-alice' });
		expect(() => room._assertWorldAccess(client('s1'), { worldPass: pass })).toThrow(/^world_private/);
	});

	it('refuses a still-valid pass once its account is no longer invited', async () => {
		const room = makeRoom(PRIVATE);
		const { pass } = await signWorldAccessPass({ worldId: 'coin-priv', account: 'u-bob' });
		room._applyWorldAccess({ ...PRIVATE, invitees: [] });
		expect(() => room._assertWorldAccess(client('s1'), { worldPass: pass })).toThrow(/^world_private/);
	});

	it('gates spectators too: onAuth checks world access before seating anyone', () => {
		const room = makeRoom(PRIVATE);
		room._moderation = { active: () => null };
		expect(() => room.onAuth(client('s1'), { spectator: true })).toThrow(/^world_private/);
	});

	it('evicts everyone who lost access when the world turns private, and keeps the rest', () => {
		const room = makeRoom({ visibility: 'public', ownerId: 'u-alice', invitees: [] });
		const owner = client('s1', { worldAccount: 'u-alice' });
		const invitee = client('s2', { worldAccount: 'u-bob' });
		const stranger = client('s3', {});
		room.clients.push(owner, invitee, stranger);

		room._applyWorldAccess(PRIVATE);
		room._enforceWorldAccess();

		expect(owner.leave).not.toHaveBeenCalled();
		expect(invitee.leave).not.toHaveBeenCalled();
		expect(stranger.leave).toHaveBeenCalledWith(WORLD_PRIVATE_CLOSE_CODE, 'world_private');
		expect([1000, 4000, 4002, 4201, 4202, 4402, 4403]).not.toContain(WORLD_PRIVATE_CLOSE_CODE);
	});

	it('binds a pass sent mid-session so the owner who just went private is not evicted', async () => {
		const room = makeRoom({ visibility: 'public', ownerId: 'u-alice', invitees: [] });
		const owner = client('s1', {});
		room.clients.push(owner);
		const { pass } = await signWorldAccessPass({ worldId: 'coin-priv', account: 'u-alice' });
		expect(room._bindWorldPass(owner, pass)).toBe(true);
		room._applyWorldAccess(PRIVATE);
		room._enforceWorldAccess();
		expect(owner.leave).not.toHaveBeenCalled();
		expect(room._bindWorldPass(owner, 'forged.pass')).toBe(false);
	});
});

describe('browser: fetchWorldAccessPass', () => {
	it('returns the pass for a private world and null for a public one', async () => {
		const { fetchWorldAccessPass } = await import('../src/game/world-persist.js');
		const priv = vi.fn(async () => new Response(JSON.stringify({ visibility: 'private', pass: 'p.s', expiresAt: 1 }), { status: 200 }));
		expect(await fetchWorldAccessPass('coin-priv', { fetchImpl: priv })).toEqual({ visibility: 'private', pass: 'p.s', denied: false });
		const [url, init] = priv.mock.calls[0];
		expect(url).toBe('/api/world/access-pass');
		expect(init.method).toBe('POST');
		expect(init.credentials).toBe('same-origin');
		expect(JSON.parse(init.body)).toEqual({ worldId: 'coin-priv' });

		const pub = vi.fn(async () => new Response(JSON.stringify({ visibility: 'public', pass: null }), { status: 200 }));
		expect(await fetchWorldAccessPass('coin-pub', { fetchImpl: pub })).toEqual({ visibility: 'public', pass: null, denied: false });
	});

	it('reports a 404 as denied, never as an error', async () => {
		const { fetchWorldAccessPass } = await import('../src/game/world-persist.js');
		const nf = vi.fn(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
		expect(await fetchWorldAccessPass('coin-priv', { fetchImpl: nf })).toEqual({ visibility: 'private', pass: null, denied: true });
	});

	it('throws on a server error so the caller can retry', async () => {
		const { fetchWorldAccessPass } = await import('../src/game/world-persist.js');
		const boom = vi.fn(async () => new Response('{}', { status: 503 }));
		await expect(fetchWorldAccessPass('coin-priv', { fetchImpl: boom })).rejects.toThrow(/503/);
	});
});
