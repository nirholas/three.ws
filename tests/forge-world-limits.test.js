// In-world forge abuse limits on POST /api/forge. Forge-in-world submits carry a
// `world` id; beyond the lane's per-IP limits the server enforces, per request:
//
//   * a per-player cooldown (one generation per FORGE_WORLD_PLAYER_COOLDOWN_S),
//   * a per-world concurrency cap (at most FORGE_WORLD_SLOTS admitted per world
//     inside one draft-job lifetime), so one crowded world cannot flood the lane.
//
// Both answer 429 with a Retry-After, the JSON `retry_after`, and the `scope`
// that tripped, so the client can say "wait N s" from the response instead of
// inventing progress. A submit with no `world` (the /forge page) is untouched.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

let forge;
let n = 0;

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}
function mockReq({ body, client, ip }) {
	const r = Readable.from([Buffer.from(JSON.stringify(body))]);
	r.method = 'POST';
	r.url = '/api/forge';
	r.headers = {
		origin: 'http://localhost:3000',
		'content-type': 'application/json',
		'x-forge-client': client,
		'x-forwarded-for': ip,
	};
	return r;
}
// Every test gets its own world, players and IPs so the in-memory limiters never leak across cases.
const fresh = () => {
	n += 1;
	return { world: `w:synthetic-${n}`, ip: `10.9.${n}.1` };
};
const submit = (client, world, ip) => {
	const res = mockRes();
	return forge(mockReq({ body: { prompt: 'a brass telescope', tier: 'draft', path: 'image', ...(world ? { world } : {}) }, client, ip }), res).then(() => res);
};

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	// No lane keys: an admitted submit lands on a designed downstream state, never a real vendor call.
	delete process.env.REPLICATE_API_TOKEN;
	delete process.env.NVIDIA_API_KEY;
	delete process.env.HF_TOKEN;
	forge = (await import('../api/forge.js')).default;
});

describe('POST /api/forge in-world limits', () => {
	let ctx;
	beforeEach(() => { ctx = fresh(); });

	it('answers 429 with a retry hint for a second in-world submit inside the cooldown', async () => {
		const first = await submit('player-a', ctx.world, ctx.ip);
		expect(first.statusCode).not.toBe(429);
		const second = await submit('player-a', ctx.world, ctx.ip);
		expect(second.statusCode).toBe(429);
		expect(second.json).toMatchObject({ error: 'rate_limited', scope: 'player' });
		expect(second.json.retry_after).toBeGreaterThan(0);
		expect(Number(second.getHeader('retry-after'))).toBeGreaterThan(0);
	});

	it('answers 429 scope:world once a world has its concurrent generations in flight', async () => {
		for (let i = 0; i < 4; i += 1) {
			const ok = await submit(`${ctx.world}-p${i}`, ctx.world, ctx.ip);
			expect(ok.statusCode).not.toBe(429);
		}
		const over = await submit(`late-${ctx.world}`, ctx.world, ctx.ip);
		expect(over.statusCode).toBe(429);
		expect(over.json).toMatchObject({ error: 'rate_limited', scope: 'world' });
		expect(over.json.retry_after).toBeGreaterThan(0);
	});

	it('does not burn the player cooldown when the world is full', async () => {
		for (let i = 0; i < 4; i += 1) await submit(`${ctx.world}-p${i}`, ctx.world, ctx.ip);
		const refused = await submit(`late-${ctx.world}`, ctx.world, ctx.ip);
		expect(refused.json.scope).toBe('world');
		// A different world admits the same player straight away: the refusal above did not start their cooldown.
		const other = fresh();
		const retry = await submit(`late-${ctx.world}`, other.world, ctx.ip);
		expect(retry.statusCode).not.toBe(429);
	});

	it('keeps worlds independent of each other', async () => {
		const a = fresh();
		const b = fresh();
		for (let i = 0; i < 4; i += 1) await submit(`a-${i}`, a.world, a.ip);
		const inB = await submit('b-0', b.world, b.ip);
		expect(inB.statusCode).not.toBe(429);
	});

	it('leaves a submit with no world (the /forge page) to the lane limits alone', async () => {
		const ip = fresh().ip;
		await submit('page-user', null, ip);
		const again = await submit('page-user', null, ip);
		expect(again.json?.scope).toBeUndefined();
	});

	it('rejects a malformed world id instead of keying a limiter on it', async () => {
		const res = await submit('player-z', 'bad world id with spaces!', ctx.ip);
		expect(res.statusCode).toBe(400);
		expect(res.json.error).toBe('invalid_world');
	});
});
