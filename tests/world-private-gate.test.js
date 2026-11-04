// HTTP-level tests for the Silver `worlds.private` perk on /api/world/*.
//
// A world is public by default. Making one private is a hold-only $THREE perk
// (Silver+, proven by a signed tier pass, no RPC). A private world answers 404
// (never 403, so existence never leaks) to anyone who is not its owner, an
// invitee or the game server. Lapsing below Silver never locks an owner out of
// their world; it only blocks creating a NEW private one.
//
// Storage is the real world-store orchestration over an in-memory backend with
// the production compare-and-set contract. Identity is injected at the auth
// boundary (x-test-user = session account, Bearer svc = the game server).

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { signTierPass } from '../api/_lib/three-tier.js';
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
const WALLET = 'THREEsynthetic1111111111111111111111111111';
const silver = () => signTierPass({ wallet: WALLET, level: 2, tierId: 'silver', usd: 120 });
const bronze = () => signTierPass({ wallet: WALLET, level: 1, tierId: 'bronze', usd: 30 });

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '', _ended: false,
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; this._ended = true; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function mockReq(action, { body = null, query = '', user = null, headers = {}, service = false } = {}) {
	const get = action === 'load';
	const chunks = body != null ? [Buffer.from(JSON.stringify(body))] : [];
	const r = Readable.from(chunks);
	r.method = get ? 'GET' : 'POST';
	r.url = `/api/world/${action}${query}`;
	r.headers = {
		origin: 'http://localhost:3000',
		...(get ? {} : { 'content-type': 'application/json' }),
		...(user ? { 'x-test-user': USERS[user] ?? user } : {}),
		...(service ? { authorization: 'Bearer svc' } : {}),
		...headers,
	};
	return r;
}

async function call(action, opts) {
	const res = mockRes();
	await handler(mockReq(action, opts), res);
	return res;
}

const load = (worldId, opts = {}) => call('load', { ...opts, query: `?worldId=${encodeURIComponent(worldId)}` });
const save = (worldId, extra = {}, opts = {}) =>
	call('save', { ...opts, body: { worldId, doc: { objects: [] }, ifMatch: '*', ...extra } });

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	delete process.env.HOLDER_PASS_SECRET;
	handler = (await import('../api/world/[action].js')).default;
});

beforeEach(() => {
	backend.rows.clear();
	backend.blobs.clear();
});

describe('POST /api/world/save: the private-world create gate', () => {
	it('blocks a signed-in Member from creating a private world with 402 three_hold_required', async () => {
		const res = await save('w1', { visibility: 'private' }, { user: 'alice' });
		expect(res.statusCode).toBe(402);
		expect(res.json.error).toBe('three_hold_required');
		expect(res.json.feature).toBe('worlds.private');
		expect(res.json.required).toMatchObject({ level: 2, id: 'silver' });
		expect(res.json.pay_per_use).toBeNull();
		expect(backend.rows.has('w1')).toBe(false);
	});

	it('answers an anonymous private create with the sign-in 402 and an anonymous plain write with 401', async () => {
		const res = await save('w1', { visibility: 'private' });
		expect(res.statusCode).toBe(402);
		expect(res.json).toMatchObject({ error: 'three_hold_required', feature: 'worlds.private', reason: 'sign_in' });
		const plain = await save('w1');
		expect(plain.statusCode).toBe(401);
		expect(backend.rows.has('w1')).toBe(false);
	});

	it('blocks a Bronze pass (below Silver)', async () => {
		const res = await save('w1', { visibility: 'private' }, { user: 'alice', headers: { 'x-three-tier-pass': bronze() } });
		expect(res.statusCode).toBe(402);
		expect(res.json.held).toMatchObject({ level: 1 });
	});

	it('lets a Silver holder create a private world', async () => {
		const res = await save('w1', { visibility: 'private' }, { user: 'alice', headers: { 'x-three-tier-pass': silver() } });
		expect(res.statusCode).toBe(200);
		expect(res.json.visibility).toBe('private');
		expect(backend.rows.get('w1').visibility).toBe('private');
	});

	it('rejects an unknown visibility value', async () => {
		const res = await save('w1', { visibility: 'secret' }, { user: 'alice' });
		expect(res.statusCode).toBe(400);
	});

	it('a save that omits visibility preserves the stored value', async () => {
		await save('w1', { visibility: 'private' }, { user: 'alice', headers: { 'x-three-tier-pass': silver() } });
		const res = await save('w1', { doc: { objects: [{ id: 'a' }] } }, { user: 'alice' });
		expect(res.statusCode).toBe(200);
		expect(res.json.visibility).toBe('private');
		expect(backend.rows.get('w1').visibility).toBe('private');
	});

	it('a holder who lapsed below Silver keeps saving their private world but cannot make a new one', async () => {
		await save('w1', { visibility: 'private' }, { user: 'alice', headers: { 'x-three-tier-pass': silver() } });
		const again = await save('w1', { visibility: 'private' }, { user: 'alice' });
		expect(again.statusCode).toBe(200);
		const fresh = await save('w2', { visibility: 'private' }, { user: 'alice' });
		expect(fresh.statusCode).toBe(402);
		const own = await load('w1', { user: 'alice' });
		expect(own.statusCode).toBe(200);
	});

	it('going public never needs a tier', async () => {
		await save('w1', { visibility: 'private' }, { user: 'alice', headers: { 'x-three-tier-pass': silver() } });
		const res = await save('w1', { visibility: 'public' }, { user: 'alice' });
		expect(res.statusCode).toBe(200);
		expect(res.json.visibility).toBe('public');
	});

	it('the game server may write any world without a tier', async () => {
		const res = await save('w1', { visibility: 'private' }, { service: true });
		expect(res.statusCode).toBe(200);
		expect(backend.rows.get('w1').visibility).toBe('private');
	});
});

describe('GET /api/world/load: the private-world read gate', () => {
	beforeEach(async () => {
		await save('priv', { visibility: 'private', doc: { objects: [{ id: 'secret' }] } }, { user: 'alice', headers: { 'x-three-tier-pass': silver() } });
		await save('pub', { doc: { objects: [{ id: 'open' }] } }, { user: 'alice' });
	});

	it('answers 404 (not 403) to anonymous and to strangers', async () => {
		const anon = await load('priv');
		expect(anon.statusCode).toBe(404);
		expect(anon.json.error).toBe('not_found');
		const stranger = await load('priv', { user: 'bob' });
		expect(stranger.statusCode).toBe(404);
		expect(JSON.stringify(stranger.json)).not.toContain('secret');
	});

	it('serves the owner, with the invitee list', async () => {
		const res = await load('priv', { user: 'alice' });
		expect(res.statusCode).toBe(200);
		expect(res.json.doc.objects[0].id).toBe('secret');
		expect(res.json.visibility).toBe('private');
		expect(res.json.invitees).toEqual([]);
	});

	it('serves the game server', async () => {
		const res = await load('priv', { service: true });
		expect(res.statusCode).toBe(200);
		expect(res.json.doc.objects[0].id).toBe('secret');
	});

	it('leaves public worlds open to everyone and reports their visibility', async () => {
		const res = await load('pub');
		expect(res.statusCode).toBe(200);
		expect(res.json.visibility).toBe('public');
		expect(res.json.invitees).toBeUndefined();
	});

	it('an unsaved world is still an empty 200', async () => {
		const res = await load('nothing');
		expect(res.statusCode).toBe(200);
		expect(res.json.doc).toBeNull();
	});
});

describe('invites', () => {
	beforeEach(async () => {
		await save('priv', { visibility: 'private' }, { user: 'alice', headers: { 'x-three-tier-pass': silver() } });
	});

	it('an invitee reads the world but cannot write it, and does not see the invitee list', async () => {
		const inv = await call('invite', { user: 'alice', body: { worldId: 'priv', invitee: '@Bob' } });
		expect(inv.statusCode).toBe(200);
		expect(inv.json.invitees).toEqual([{ id: 'u-bob', username: 'bob' }]);

		const read = await load('priv', { user: 'bob' });
		expect(read.statusCode).toBe(200);
		expect(read.json.invitees).toBeUndefined();

		const write = await save('priv', { doc: { objects: [{ id: 'x' }] } }, { user: 'bob' });
		expect(write.statusCode).toBe(403);

		const carol = await load('priv', { user: 'carol' });
		expect(carol.statusCode).toBe(404);
	});

	it('uninvite revokes access', async () => {
		await call('invite', { user: 'alice', body: { worldId: 'priv', invitee: 'bob' } });
		const out = await call('uninvite', { user: 'alice', body: { worldId: 'priv', invitee: 'bob' } });
		expect(out.statusCode).toBe(200);
		expect(out.json.invitees).toEqual([]);
		expect((await load('priv', { user: 'bob' })).statusCode).toBe(404);
	});

	it('only the owner can invite', async () => {
		const res = await call('invite', { user: 'bob', body: { worldId: 'priv', invitee: 'bob' } });
		expect(res.statusCode).toBe(403);
	});

	it('requires sign-in, a saved world and a real username', async () => {
		expect((await call('invite', { body: { worldId: 'priv', invitee: 'bob' } })).statusCode).toBe(401);
		expect((await call('invite', { user: 'alice', body: { worldId: 'ghost', invitee: 'bob' } })).statusCode).toBe(404);
		const nobody = await call('invite', { user: 'alice', body: { worldId: 'priv', invitee: 'nobody' } });
		expect(nobody.statusCode).toBe(404);
		expect(nobody.json.error).toBe('invitee_not_found');
		const self = await call('invite', { user: 'alice', body: { worldId: 'priv', invitee: 'alice' } });
		expect(self.statusCode).toBe(400);
	});

	it('inviting twice keeps one entry', async () => {
		await call('invite', { user: 'alice', body: { worldId: 'priv', invitee: 'bob' } });
		const res = await call('invite', { user: 'alice', body: { worldId: 'priv', invitee: 'bob' } });
		expect(res.json.invitees).toHaveLength(1);
	});
});

describe('POST /api/world/visibility', () => {
	it('gates private, ungated for public, owner only', async () => {
		await save('w1', {}, { user: 'alice' });
		const member = await call('visibility', { user: 'alice', body: { worldId: 'w1', visibility: 'private' } });
		expect(member.statusCode).toBe(402);

		const ok = await call('visibility', {
			user: 'alice',
			headers: { 'x-three-tier-pass': silver() },
			body: { worldId: 'w1', visibility: 'private' },
		});
		expect(ok.statusCode).toBe(200);
		expect(ok.json.visibility).toBe('private');

		const notOwner = await call('visibility', { user: 'bob', body: { worldId: 'w1', visibility: 'public' } });
		expect(notOwner.statusCode).toBe(403);

		const down = await call('visibility', { user: 'alice', body: { worldId: 'w1', visibility: 'public' } });
		expect(down.statusCode).toBe(200);
		expect(down.json.visibility).toBe('public');
	});

	it('404s on a world that was never saved', async () => {
		const res = await call('visibility', { user: 'alice', body: { worldId: 'ghost', visibility: 'public' } });
		expect(res.statusCode).toBe(404);
	});
});
