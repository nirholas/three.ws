import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRotatingFetch, readAttemptCap } from '../api/_lib/solana/connection.js';

// Measured 2026-11-12 from the live spend ledger: holders plus security made
// about 7 provider calls per request against 2.69 modeled logical reads,
// because once every lane was cooling, the cooldown-forgiving pass walked the
// whole chain (11 lanes) for every routine read. A non-money read now stops
// after a bounded number of lane attempts and falls back to last-good or a
// clean error; money callers (fresh, sends, simulations) still walk every lane.

const resp = (body, status = 200) =>
	new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});

let seq = 0;
// Unique hosts per test: cooldowns are module-global, so a shared host would
// carry one test's verdict into the next.
const lanes = (n) => {
	seq += 1;
	return Array.from({ length: n }, (_, i) => `https://cap-${seq}-${i}.test/`);
};
// A unique read per call so the fresh-read cache and coalescing never answer it.
const readBody = (method = 'getBalance') =>
	JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [`THREEsynthetic${++seq}`] });

describe('rotating fetch: lane attempts per non-money read are capped', () => {
	let origFetch;
	const origCap = process.env.RPC_READ_MAX_ATTEMPTS;
	beforeEach(() => {
		origFetch = global.fetch;
		delete process.env.RPC_READ_MAX_ATTEMPTS;
	});
	afterEach(() => {
		global.fetch = origFetch;
		if (origCap === undefined) delete process.env.RPC_READ_MAX_ATTEMPTS;
		else process.env.RPC_READ_MAX_ATTEMPTS = origCap;
	});

	it('defaults to 3 and reads RPC_READ_MAX_ATTEMPTS, ignoring junk', () => {
		expect(readAttemptCap()).toBe(3);
		process.env.RPC_READ_MAX_ATTEMPTS = '5';
		expect(readAttemptCap()).toBe(5);
		process.env.RPC_READ_MAX_ATTEMPTS = '0';
		expect(readAttemptCap()).toBe(3);
		process.env.RPC_READ_MAX_ATTEMPTS = 'lots';
		expect(readAttemptCap()).toBe(3);
	});

	it('stops a failing read after 3 lanes instead of walking all 8', async () => {
		const eps = lanes(8);
		const spy = vi.fn(async () => resp('bad gateway', 502));
		global.fetch = spy;
		await expect(makeRotatingFetch(eps)(null, { method: 'POST', body: readBody() })).rejects.toThrow();
		expect(spy).toHaveBeenCalledTimes(3);
	});

	it('caps the cooldown-forgiving pass too, the shape that burned the quota', async () => {
		const eps = lanes(8);
		const spy = vi.fn(async () => resp('rate limited', 429));
		global.fetch = spy;
		const rf = makeRotatingFetch(eps);
		// Cool every lane with uncapped money traffic first.
		await expect(rf(null, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: ['x'] }) })).rejects.toThrow();
		expect(spy).toHaveBeenCalledTimes(8);
		spy.mockClear();
		// Every lane is cooling now, so pass 1 has nothing and pass 2 forgives
		// cooldowns: that pass is still bounded for a routine read.
		await expect(rf(null, { method: 'POST', body: readBody() })).rejects.toThrow();
		expect(spy).toHaveBeenCalledTimes(3);
	});

	it('honours RPC_READ_MAX_ATTEMPTS', async () => {
		process.env.RPC_READ_MAX_ATTEMPTS = '5';
		const eps = lanes(8);
		const spy = vi.fn(async () => resp('bad gateway', 502));
		global.fetch = spy;
		await expect(makeRotatingFetch(eps)(null, { method: 'POST', body: readBody() })).rejects.toThrow();
		expect(spy).toHaveBeenCalledTimes(5);
	});

	it('still answers from a later lane inside the cap', async () => {
		const eps = lanes(8);
		const spy = vi.fn(async (url) => (url === eps[2] ? resp({ jsonrpc: '2.0', id: 1, result: { value: 7 } }) : resp('bad gateway', 502)));
		global.fetch = spy;
		const out = await makeRotatingFetch(eps)(null, { method: 'POST', body: readBody() });
		expect((await out.json()).result).toEqual({ value: 7 });
		expect(spy).toHaveBeenCalledTimes(3);
	});

	// Reproduced 2026-11-25 against production's chain: /api/crypto/holders for
	// $THREE answered 503 while two Tatum lanes answered getTokenLargestAccounts in
	// ~120ms. PublicNode (403), api.mainnet-beta (429) and LeoRPC (-32603) refused
	// in turn, used the whole budget of 3, and the healthy lanes behind them were
	// never asked. A lane the fleet believed healthy that answers with an explicit
	// refusal benches itself on the spot, so it is new information, not a retry,
	// and must not spend the read's budget.
	it('does not let explicit refusals from believed-healthy lanes spend the budget', async () => {
		const eps = lanes(6);
		const spy = vi.fn(async (url) => {
			if (url === eps[0]) return resp('blocked parameter', 403);
			if (url === eps[1]) return resp('Too many requests', 429);
			if (url === eps[2]) return resp({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } });
			return resp({ jsonrpc: '2.0', id: 1, result: { value: [{ address: 'THREEsyntheticHolder', amount: '9' }] } });
		});
		global.fetch = spy;
		const out = await makeRotatingFetch(eps)(null, { method: 'POST', body: readBody('getTokenLargestAccounts') });
		expect((await out.json()).result.value[0].amount).toBe('9');
		expect(spy).toHaveBeenCalledTimes(4);
	});

	it('still counts slow or opaque failures after free refusals, so the read stays bounded', async () => {
		const eps = lanes(8);
		const spy = vi.fn(async (url) => (url === eps[0] || url === eps[1] ? resp('Too many requests', 429) : resp('bad gateway', 502)));
		global.fetch = spy;
		await expect(makeRotatingFetch(eps)(null, { method: 'POST', body: readBody() })).rejects.toThrow();
		// 2 free refusals, then the budget of 3 on lanes that failed opaquely.
		expect(spy).toHaveBeenCalledTimes(5);
	});

	it('still arms the exhausted-chain breaker when every lane refused for free', async () => {
		const eps = lanes(4);
		const spy = vi.fn(async () => resp('Too many requests', 429));
		global.fetch = spy;
		const rf = makeRotatingFetch(eps);
		await expect(rf(null, { method: 'POST', body: readBody() })).rejects.toThrow(/429/);
		expect(spy).toHaveBeenCalledTimes(4);
		spy.mockClear();
		// Inside the breaker window the next read short-circuits without a call.
		await expect(rf(null, { method: 'POST', body: readBody() })).rejects.toThrow(/429/);
		expect(spy).toHaveBeenCalledTimes(0);
	});

	it('never caps a money caller: a fresh connection walks every lane', async () => {
		const eps = lanes(8);
		const spy = vi.fn(async () => resp('bad gateway', 502));
		global.fetch = spy;
		await expect(makeRotatingFetch(eps, { fresh: true })(null, { method: 'POST', body: readBody() })).rejects.toThrow();
		expect(spy).toHaveBeenCalledTimes(8);
	});

	it('never caps a send or a simulation', async () => {
		for (const method of ['sendTransaction', 'simulateTransaction']) {
			const eps = lanes(6);
			const spy = vi.fn(async () => resp('bad gateway', 502));
			global.fetch = spy;
			const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: ['x'] });
			await expect(makeRotatingFetch(eps)(null, { method: 'POST', body })).rejects.toThrow();
			expect(spy).toHaveBeenCalledTimes(6);
		}
	});

	it('bounds the transport re-sweep by the same cap', async () => {
		const eps = lanes(8);
		const spy = vi.fn(async () => {
			throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
		});
		global.fetch = spy;
		await expect(makeRotatingFetch(eps)(null, { method: 'POST', body: readBody() })).rejects.toThrow();
		// 3 in the passes, then at most 3 in the one egress re-sweep.
		expect(spy).toHaveBeenCalledTimes(6);
	});
});
