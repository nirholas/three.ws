// fetchModel must return as soon as it has an answer, even when the upstream
// never finishes its response body.
//
// Production regression (2026-10-08): /api/news/image held requests for the
// full 900 s Cloud Run limit (504) on publishers that answer 403 or a large PDF
// and then keep the socket open. fetchModel threw on the status or the
// content-length without reading the body, and its `finally` awaited
// `agent.close()`, which in undici waits for every in-flight request to finish.
// That request never finished, so the 6 s page timeout (already cleared by then)
// could not rescue it. The pinned agent is single-use, so it must be destroyed,
// not drained.
//
// The DNS/pin layer is swapped for a plain undici Agent so the test can reach a
// real loopback tarpit server; everything else is the production code path.

import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Agent } from 'undici';

vi.mock('../../api/_lib/ssrf.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		validatePublicUrl: (raw) => new URL(raw),
		resolvePublicHost: async () => [],
		pinnedAgent: () => new Agent(),
	};
});

const { fetchModel, FetchModelError } = await import('../../api/_lib/fetch-model.js');
const { disposeAgent } = await import('../../api/_lib/ssrf.js');

let server;
let base;

beforeAll(async () => {
	server = http.createServer((req, res) => {
		// Every route writes its head and one chunk, then holds the socket open
		// forever, like a WAF tarpit or a slow publisher.
		if (req.url === '/forbidden') {
			res.writeHead(403, { 'content-type': 'text/html' });
		} else if (req.url === '/huge') {
			res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(50 * 1024 * 1024) });
		} else if (req.url === '/redirect') {
			res.writeHead(301, { location: '/forbidden', 'content-type': 'text/html' });
		}
		res.write('<html>');
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
	server.closeAllConnections();
	server.close();
});

const QUICK_MS = 2000;

describe('fetchModel releases its connection on early exits', () => {
	it('rejects a non-2xx promptly instead of waiting for the body to end', async () => {
		const started = Date.now();
		await expect(fetchModel(`${base}/forbidden`, { timeoutMs: 6000 })).rejects.toMatchObject({
			code: 'upstream_error',
		});
		expect(Date.now() - started).toBeLessThan(QUICK_MS);
	}, 10_000);

	it('rejects an oversized content-length promptly', async () => {
		const started = Date.now();
		await expect(
			fetchModel(`${base}/huge`, { timeoutMs: 6000, maxBytes: 768 * 1024 }),
		).rejects.toBeInstanceOf(FetchModelError);
		expect(Date.now() - started).toBeLessThan(QUICK_MS);
	}, 10_000);

	it('follows a redirect whose body never ends', async () => {
		const started = Date.now();
		await expect(fetchModel(`${base}/redirect`, { timeoutMs: 6000 })).rejects.toMatchObject({
			code: 'upstream_error',
		});
		expect(Date.now() - started).toBeLessThan(QUICK_MS);
	}, 10_000);
});

describe('disposeAgent', () => {
	it('resolves while a response body is still open', async () => {
		const agent = new Agent();
		const res = await fetch(`${base}/forbidden`, { dispatcher: agent });
		expect(res.status).toBe(403);
		const started = Date.now();
		await disposeAgent(agent);
		expect(Date.now() - started).toBeLessThan(QUICK_MS);
	}, 10_000);

	it('accepts a missing agent', async () => {
		await expect(disposeAgent(null)).resolves.toBeUndefined();
	});
});
