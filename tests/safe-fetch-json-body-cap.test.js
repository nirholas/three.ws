// safeFetchJson relays a buyer's call to an agent-owner-controlled upstream.
// Its response body is bounded instead of buffered whole.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({
	lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

// safeFetchJson sends through undici's own fetch (pinnedFetch); route it to the
// global each case stubs with its response.
vi.mock('undici', async (importOriginal) => ({
	...(await importOriginal()),
	fetch: (...args) => globalThis.fetch(...args),
}));

const { safeFetchJson } = await import('../api/_lib/ssrf.js');

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('safeFetchJson response cap', () => {
	it('rejects a body larger than maxResponseBytes without reading it all', async () => {
		let pulls = 0;
		const body = new ReadableStream({
			pull(controller) {
				pulls++;
				controller.enqueue(new Uint8Array(1024).fill(120));
				if (pulls > 100000) controller.close();
			},
		});
		globalThis.fetch = async () => new Response(body, { status: 200 });
		await expect(
			safeFetchJson('https://upstream.example.test/x', { maxResponseBytes: 4096, allowHttp: false }),
		).rejects.toMatchObject({ code: 'response_too_large' });
		expect(pulls).toBeLessThan(20);
	});

	it('parses a JSON body within the cap', async () => {
		globalThis.fetch = async () =>
			new Response(JSON.stringify({ a: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
		const out = await safeFetchJson('https://upstream.example.test/x', { allowHttp: false });
		expect(out.data).toEqual({ a: 1 });
	});
});
