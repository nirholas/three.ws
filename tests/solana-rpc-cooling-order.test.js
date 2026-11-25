import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRotatingFetch, markEndpointCooldown } from '../api/_lib/solana/connection.js';

// When every lane is cooling, the rotating fetch forgives cooldowns (pass 2) so
// a just-recovered node still gets exercised. It walked the lanes in config
// order, and the paid lanes come first. On 2026-11-25 Helius sat on a 6h
// "max usage reached" park and Alchemy on its monthly capacity cap, while the
// keyless tail was only on a 10m rate-limit window. A non-money read may spend
// just 3 lane attempts, so pass 2 spent all of them on quota-dead paid lanes and
// never reached a free lane that had likely recovered. Forgiving a cooldown
// must start with the lane whose cooldown ends soonest.

const resp = (body, status = 200) =>
	new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let seq = 0;
const lanes = (n) => {
	seq += 1;
	return Array.from({ length: n }, (_, i) => `https://cool-order-${seq}-${i}.test/`);
};
const readBody = () => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [`THREEsynthetic${++seq}`] });

describe('rotating fetch: every lane cooling', () => {
	let origFetch;
	let warn;
	beforeEach(() => {
		origFetch = global.fetch;
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		global.fetch = origFetch;
		warn.mockRestore();
	});

	it('tries the lane closest to recovery before quota-dead lanes listed ahead of it', async () => {
		const eps = lanes(5);
		markEndpointCooldown(eps[0], 429, '{"code":-32429,"message":"max usage reached"}');
		markEndpointCooldown(eps[1], 429, 'Monthly capacity limit exceeded');
		markEndpointCooldown(eps[2], 429, 'request limit reached');
		markEndpointCooldown(eps[3], 429, 'Too many requests');
		markEndpointCooldown(eps[4], 429, 'Too many requests');
		const spy = vi.fn(async (url) => resp({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: 7 } }));
		global.fetch = spy;
		const out = await makeRotatingFetch(eps)(null, { method: 'POST', body: readBody() });
		expect((await out.json()).result.value).toBe(7);
		expect(String(spy.mock.calls[0][0])).toBe(eps[3]);
		expect(spy.mock.calls.map((c) => String(c[0]))).not.toContain(eps[0]);
	});
});
