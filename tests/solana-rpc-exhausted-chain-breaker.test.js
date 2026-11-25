import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRotatingFetch } from '../api/_lib/solana/connection.js';

// Measured 2026-11-25 on three-ws-api: with Helius at its monthly cap and the
// free lanes 429ing, every routine read still spent its 3-lane cap on lanes
// that had just refused the previous request, and logged
// "all 8 endpoints failed this request" each time (four within 40ms). Once a
// non-money read has exhausted the chain on rate-limit answers, later
// non-money reads for the same chain must back off briefly instead of
// re-hitting every lane.

const resp = (body, status = 200) =>
	new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});

let seq = 0;
const lanes = (n) => {
	seq += 1;
	return Array.from({ length: n }, (_, i) => `https://brk-${seq}-${i}.test/`);
};
const readBody = (method = 'getBalance') =>
	JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [`THREEsynthetic${++seq}`] });

describe('rotating fetch: exhausted-chain breaker', () => {
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

	it('does not re-hit any lane for the next reads after a rate-limited exhaustion', async () => {
		const eps = lanes(8);
		const spy = vi.fn(async () => resp('rate limited', 429));
		global.fetch = spy;
		const rf = makeRotatingFetch(eps);
		await expect(rf(null, { method: 'POST', body: readBody() })).rejects.toThrow(/429/);
		const first = spy.mock.calls.length;
		expect(first).toBeGreaterThan(0);
		for (let i = 0; i < 4; i++) {
			await expect(rf(null, { method: 'POST', body: readBody() })).rejects.toThrow(/429/);
		}
		expect(spy).toHaveBeenCalledTimes(first);
		// One warning for the window, not one per request.
		const exhausted = warn.mock.calls.filter((c) => String(c[0]).includes('endpoints failed this request'));
		expect(exhausted.length).toBe(1);
	});

	it('serves reads again once the window passes', async () => {
		vi.useFakeTimers();
		try {
			const eps = lanes(4);
			let ok = false;
			const spy = vi.fn(async () => (ok ? resp({ jsonrpc: '2.0', id: 1, result: { value: 1 } }) : resp('rate limited', 429)));
			global.fetch = spy;
			const rf = makeRotatingFetch(eps);
			await expect(rf(null, { method: 'POST', body: readBody() })).rejects.toThrow();
			ok = true;
			vi.setSystemTime(Date.now() + 11 * 60_000);
			const out = await rf(null, { method: 'POST', body: readBody() });
			expect((await out.json()).result).toEqual({ value: 1 });
		} finally {
			vi.useRealTimers();
		}
	});

	it('never blocks a money caller', async () => {
		const eps = lanes(4);
		let ok = false;
		const spy = vi.fn(async () => (ok ? resp({ jsonrpc: '2.0', id: 1, result: 'sig' }) : resp('rate limited', 429)));
		global.fetch = spy;
		await expect(makeRotatingFetch(eps)(null, { method: 'POST', body: readBody() })).rejects.toThrow();
		ok = true;
		const out = await makeRotatingFetch(eps, { fresh: true })(null, { method: 'POST', body: readBody() });
		expect((await out.json()).result).toBe('sig');
	});

	it('does not trip on a non-rate-limit failure (502)', async () => {
		const eps = lanes(4);
		const spy = vi.fn(async () => resp('bad gateway', 502));
		global.fetch = spy;
		const rf = makeRotatingFetch(eps);
		await expect(rf(null, { method: 'POST', body: readBody() })).rejects.toThrow();
		const first = spy.mock.calls.length;
		await expect(rf(null, { method: 'POST', body: readBody() })).rejects.toThrow();
		expect(spy.mock.calls.length).toBeGreaterThan(first);
	});
});
