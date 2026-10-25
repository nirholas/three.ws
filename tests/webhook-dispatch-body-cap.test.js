// A webhook endpoint is developer-controlled. Delivery must not buffer an
// unbounded response body: it keeps the first 1 KiB and cancels the stream.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../api/_lib/ssrf.js', () => ({
	validatePublicUrl: vi.fn((url) => new URL(url)),
	resolvePublicHost: vi.fn(async () => ['93.184.216.34']),
	pinnedAgent: vi.fn(() => undefined),
	disposeAgent: vi.fn(async () => {}),
	SsrfError: class SsrfError extends Error {},
}));

const { deliver } = await import('../api/_lib/webhook-dispatch.js');

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('webhook delivery response body', () => {
	it('stops reading an endless body after the 1 KiB cap and cancels the stream', async () => {
		let pulls = 0;
		let cancelled = false;
		const body = new ReadableStream({
			pull(controller) {
				pulls++;
				controller.enqueue(new Uint8Array(512).fill(97));
				if (pulls > 100000) controller.close();
			},
			cancel() {
				cancelled = true;
			},
		});
		globalThis.fetch = async () => new Response(body, { status: 200 });
		const out = await deliver('https://hooks.example.test/in', 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'evt_1', '{}');
		expect(out.statusCode).toBe(200);
		expect(out.responseBody.length).toBe(1024);
		expect(cancelled).toBe(true);
		expect(pulls).toBeLessThan(20);
	});

	it('returns a short body whole', async () => {
		globalThis.fetch = async () => new Response('ok', { status: 500 });
		const out = await deliver('https://hooks.example.test/in', 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'evt_2', '{}');
		expect(out).toMatchObject({ statusCode: 500, responseBody: 'ok', error: 'http_500' });
	});
});
