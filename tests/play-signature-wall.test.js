// HTTP-level tests for /api/play/signature-wall: validation, the slur and link
// gates, idempotency per wallet and per guest session, the rate limit, inert
// markup, paging, and owner-only removal.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

// A small in-memory stand-in for the Upstash client, implementing exactly the
// commands the store uses with the same return shapes. The store, the handler,
// zod, the slur gate and the pass verification are all the real code.
function fakeRedis() {
	const hashes = new Map();
	const zsets = new Map();
	const strings = new Map();
	const h = (k) => (hashes.has(k) ? hashes.get(k) : hashes.set(k, new Map()).get(k));
	const z = (k) => (zsets.has(k) ? zsets.get(k) : zsets.set(k, new Map()).get(k));
	const sorted = (k) => [...z(k).entries()].sort((a, b) => a[1] - b[1]);
	return {
		async zcard(k) { return z(k).size; },
		async zrange(k, a, b, opts = {}) {
			const arr = sorted(k);
			if (opts.byScore) {
				const lo = String(a).startsWith('(') ? Number(String(a).slice(1)) : Number(a);
				const excl = String(a).startsWith('(');
				const hit = arr.filter(([, s]) => (excl ? s > lo : s >= lo)).map(([m]) => m);
				return hit.slice(opts.offset || 0, (opts.offset || 0) + (opts.count ?? hit.length));
			}
			const ids = arr.map(([m]) => m);
			if (opts.rev) ids.reverse();
			return ids.slice(a, b + 1);
		},
		async hmget(k, ...ids) { return Object.fromEntries(ids.map((id) => [id, h(k).get(id) ?? null])); },
		async hget(k, f) { return h(k).get(f) ?? null; },
		async hset(k, obj) { for (const [f, v] of Object.entries(obj)) h(k).set(f, v); return 1; },
		async hsetnx(k, f, v) { if (h(k).has(f)) return 0; h(k).set(f, v); return 1; },
		async hdel(k, f) { return h(k).delete(f) ? 1 : 0; },
		async zadd(k, { score, member }) { z(k).set(member, score); return 1; },
		async zrem(k, m) { return z(k).delete(m) ? 1 : 0; },
		async incr(k) { const n = (Number(strings.get(k)) || 0) + 1; strings.set(k, n); return n; },
		async set(k, v, opts = {}) { if (opts.nx && strings.has(k)) return null; strings.set(k, v); return 'OK'; },
		async get(k) { return strings.get(k) ?? null; },
		async del(k) { return strings.delete(k) ? 1 : 0; },
	};
}

let redis = fakeRedis();
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => redis }));

let signLimit = { success: true, limit: 20, remaining: 19, reset: Date.now() + 60_000 };
vi.mock('../api/_lib/rate-limit.js', () => ({
	clientIp: () => '203.0.113.9',
	limits: {
		publicIp: async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 }),
		sigwallSignIp: async () => signLimit,
	},
}));

process.env.CRON_SECRET = 'test-cron-secret';
process.env.HOLDER_PASS_SECRET = 'test-pass-secret';
process.env.PLAY_GATE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const { default: handler } = await import('../api/play/signature-wall.js');
const { signPlayPass } = await import('../api/_lib/play-pass.js');

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '', headersSent: false, writableEnded: false,
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; this.writableEnded = true; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function mockReq({ method = 'GET', query = {}, body = null, headers = {} } = {}) {
	const r = Readable.from(body != null ? [Buffer.from(JSON.stringify(body))] : []);
	r.method = method;
	r.url = '/api/play/signature-wall';
	r.query = query;
	r.headers = { origin: 'http://localhost:3204', 'content-type': 'application/json', ...headers };
	return r;
}

const call = async (opts) => { const res = mockRes(); await handler(mockReq(opts), res); return res; };
const SESSION = (n) => `session-${String(n).padStart(8, '0')}-abcdef`;
const sign = (body) => call({ method: 'POST', body });
const WALLET = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const passFor = (wallet) => signPlayPass({ wallet, mint: process.env.PLAY_GATE_MINT, balance: 5 });

beforeEach(() => {
	redis = fakeRedis();
	signLimit = { success: true, limit: 20, remaining: 19, reset: Date.now() + 60_000 };
});

describe('POST /api/play/signature-wall: validation', () => {
	it('signs as a guest and returns display text only', async () => {
		const res = await sign({ name: '  Ada  ', line: 'gm   from the plaza', session: SESSION(1) });
		expect(res.statusCode).toBe(201);
		expect(res.json.signature).toMatchObject({ name: 'Ada', line: 'gm from the plaza', verified: false, no: 1 });
		expect(res.json.total).toBe(1);
		expect(Object.keys(res.json.signature).sort()).toEqual(['id', 'line', 'name', 'no', 'ts', 'verified']);
	});

	it('requires a name', async () => {
		const res = await sign({ name: '   ', session: SESSION(2) });
		expect(res.statusCode).toBe(400);
		expect(res.json.error).toBe('name_required');
	});

	it('requires a session or a pass', async () => {
		const res = await sign({ name: 'Ada' });
		expect(res.statusCode).toBe(400);
		expect(res.json.error).toBe('validation_error');
	});

	it('caps the name at 24 and the line at 80 characters', async () => {
		const res = await sign({ name: 'N'.repeat(60), line: 'L'.repeat(300), session: SESSION(3) });
		expect(res.statusCode).toBe(201);
		expect(Array.from(res.json.signature.name)).toHaveLength(24);
		expect(Array.from(res.json.signature.line)).toHaveLength(80);
	});

	it('strips control and zero-width characters', async () => {
		const res = await sign({ name: 'A\u200bd\u0007a', line: 'hi\u202ethere', session: SESSION(4) });
		expect(res.json.signature.name).toBe('A d a');
		expect(res.json.signature.line).not.toMatch(/\u202e/);
	});

	it('rejects a hate slur in the name', async () => {
		const res = await sign({ name: 'nigger', session: SESSION(5) });
		expect(res.statusCode).toBe(400);
		expect(res.json.error).toBe('not_allowed');
	});

	it('rejects a hate slur in the line, including a leetspeak spelling', async () => {
		const res = await sign({ name: 'Ada', line: 'you are a N1GG3R', session: SESSION(6) });
		expect(res.statusCode).toBe(400);
		expect(res.json.error).toBe('not_allowed');
		expect((await call({})).json.total).toBe(0);
	});

	it('does not flag innocent look-alikes', async () => {
		const res = await sign({ name: 'Spicy Scunthorpe', line: 'kikel-jina69 was here', session: SESSION(7) });
		expect(res.statusCode).toBe(201);
	});

	it('rejects links and contract addresses', async () => {
		for (const [i, line] of ['buy at https://evil.example/x', 'visit www.scam.xyz', 'gm pump.fun', 'CA FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'].entries()) {
			const res = await sign({ name: 'Ada', line, session: SESSION(10 + i) });
			expect(res.statusCode).toBe(400);
			expect(res.json.error).toBe('no_links');
		}
	});

	it('stores markup verbatim as inert text, never as HTML', async () => {
		const res = await sign({ name: '<b>Ada</b>', line: '<img src=x onerror=alert(1)>', session: SESSION(20) });
		expect(res.statusCode).toBe(201);
		expect(res.json.signature.name).toBe('<b>Ada</b>');
		expect(res.getHeader('content-type')).toMatch(/application\/json/);
		expect(res.getHeader('x-content-type-options')).toBe('nosniff');
		const list = await call({});
		expect(list.json.signatures[0].line).toBe('<img src=x onerror=alert(1)>');
	});

	it('refuses a forged or expired pass', async () => {
		const res = await sign({ name: 'Ada', playPass: 'x'.repeat(64) });
		expect(res.statusCode).toBe(401);
		expect(res.json.error).toBe('pass_invalid');
	});
});

describe('POST /api/play/signature-wall: idempotency', () => {
	it('lets a wallet sign once, ever, and returns the existing signature on a repeat', async () => {
		const first = await sign({ name: 'Ada', line: 'first', playPass: passFor(WALLET) });
		expect(first.statusCode).toBe(201);
		expect(first.json.signature.verified).toBe(true);
		const second = await sign({ name: 'Ada again', playPass: passFor(WALLET) });
		expect(second.statusCode).toBe(409);
		expect(second.json.error).toBe('already_signed');
		expect(second.json.existing.id).toBe(first.json.signature.id);
		expect((await call({})).json.total).toBe(1);
	});

	it('keeps concurrent signs from one wallet to a single record', async () => {
		const results = await Promise.all(
			Array.from({ length: 6 }, (_, i) => sign({ name: `Ada ${i}`, playPass: passFor(WALLET) })),
		);
		expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
		expect(results.filter((r) => r.statusCode === 409)).toHaveLength(5);
		expect((await call({})).json.total).toBe(1);
	});

	it('lets a guest session sign once but a different session sign again', async () => {
		expect((await sign({ name: 'G1', session: SESSION(30) })).statusCode).toBe(201);
		const again = await sign({ name: 'G1 again', session: SESSION(30) });
		expect(again.statusCode).toBe(409);
		expect(again.json.error).toBe('already_signed');
		expect((await sign({ name: 'G2', session: SESSION(31) })).statusCode).toBe(201);
	});

	it('does not burn the claim when validation fails', async () => {
		expect((await sign({ name: 'nigger', session: SESSION(32) })).statusCode).toBe(400);
		expect((await sign({ name: 'Fine', session: SESSION(32) })).statusCode).toBe(201);
	});

	it('never exposes the wallet address in any response', async () => {
		await sign({ name: 'Ada', playPass: passFor(WALLET) });
		const list = await call({});
		expect(JSON.stringify(list.json)).not.toContain(WALLET);
	});
});

describe('POST /api/play/signature-wall: rate limit', () => {
	it('answers 429 with retry-after when the IP is over its limit', async () => {
		signLimit = { success: false, limit: 20, remaining: 0, reset: Date.now() + 30_000 };
		const res = await sign({ name: 'Ada', session: SESSION(40) });
		expect(res.statusCode).toBe(429);
		expect(res.json.error).toBe('rate_limited');
		expect(res.getHeader('retry-after')).toBeTruthy();
		signLimit = { success: true, limit: 20, remaining: 19, reset: Date.now() + 60_000 };
		expect((await call({})).json.total).toBe(0);
	});
});

describe('GET /api/play/signature-wall', () => {
	async function seed(n) {
		for (let i = 1; i <= n; i++) await sign({ name: `Name ${i}`, line: `line ${i}`, session: SESSION(100 + i) });
	}

	it('reports an empty wall honestly', async () => {
		const res = await call({});
		expect(res.statusCode).toBe(200);
		expect(res.json).toEqual({ total: 0, signatures: [] });
	});

	it('pages newest first by offset', async () => {
		await seed(25);
		const p0 = await call({ query: { offset: '0', limit: '10' } });
		expect(p0.json.total).toBe(25);
		expect(p0.json.signatures.map((s) => s.no)).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
		const p2 = await call({ query: { offset: '20', limit: '10' } });
		expect(p2.json.signatures.map((s) => s.no)).toEqual([5, 4, 3, 2, 1]);
	});

	it('returns only newer signatures for a since cursor, oldest first', async () => {
		await seed(5);
		const res = await call({ query: { since: '3' } });
		expect(res.json.signatures.map((s) => s.no)).toEqual([4, 5]);
	});

	it('rejects malformed paging and ids', async () => {
		expect((await call({ query: { offset: '-1' } })).statusCode).toBe(400);
		expect((await call({ query: { since: 'abc' } })).statusCode).toBe(400);
		expect((await call({ query: { id: '../x' } })).statusCode).toBe(400);
	});
});

describe('DELETE /api/play/signature-wall (moderation)', () => {
	it('refuses a missing or wrong secret and removes with the right one', async () => {
		const created = await sign({ name: 'Mod me', session: SESSION(50) });
		const id = created.json.signature.id;
		expect((await call({ method: 'DELETE', query: { id } })).statusCode).toBe(401);
		expect((await call({ method: 'DELETE', query: { id }, headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
		expect((await call({})).json.total).toBe(1);

		const ok = await call({ method: 'DELETE', query: { id }, headers: { authorization: 'Bearer test-cron-secret' } });
		expect(ok.statusCode).toBe(200);
		expect(ok.json).toMatchObject({ ok: true, removed: true, total: 0 });
		expect((await call({})).json.signatures).toEqual([]);
	});

	it('404s on an unknown id and keeps the author from signing again', async () => {
		const auth = { authorization: 'Bearer test-cron-secret' };
		expect((await call({ method: 'DELETE', query: { id: 'doesnotexist1' }, headers: auth })).statusCode).toBe(404);
		const created = await sign({ name: 'Once', session: SESSION(51) });
		await call({ method: 'DELETE', query: { id: created.json.signature.id }, headers: auth });
		const again = await sign({ name: 'Twice', session: SESSION(51) });
		expect(again.statusCode).toBe(409);
		expect(again.json.existing).toBeNull();
	});
});
