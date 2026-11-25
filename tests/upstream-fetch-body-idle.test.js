// fetchUpstream's per-attempt timeout is an AbortSignal handed to fetch, and a
// fetch signal keeps governing the response BODY after the headers arrive. The
// streaming proxies (/cdn/<key> and /api/avatars/:id/glb reading the public
// bucket domain) used a 20s timeout, so a 6.8 MB GLB that r2.dev was throttling
// to a trickle was cut off at exactly 20s mid-stream, after the 200 and its
// content-length were already on the wire. Cloud Run then logged a 503
// "malformed response": 24 truncated model downloads on 2026-11-25.
//
// `bodyIdleMs` lets a streaming caller say what it means: the timeout bounds
// the wait for the headers, and the body is cut only when it stops moving for
// that long.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { fetchUpstream } from '../api/_lib/upstream-fetch.js';

let server;
let base;

beforeAll(async () => {
	server = http.createServer((req, res) => {
		if (req.url === '/trickle') {
			// Headers at once, then 12 chunks 100ms apart: 1.2s of steady progress.
			res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '1200' });
			let sent = 0;
			const tick = setInterval(() => {
				res.write(Buffer.alloc(100, sent));
				if (++sent === 12) {
					clearInterval(tick);
					res.end();
				}
			}, 100);
			req.on('close', () => clearInterval(tick));
			return;
		}
		if (req.url === '/stall') {
			// Headers and one chunk, then nothing.
			res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '1000' });
			res.write(Buffer.alloc(100, 1));
			return;
		}
		if (req.url === '/slow-headers') {
			const t = setTimeout(() => res.end('late'), 2_000);
			req.on('close', () => clearTimeout(t));
			return;
		}
		res.writeHead(404).end();
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
	server.closeAllConnections?.();
	await new Promise((r) => server.close(r));
});

async function drain(res) {
	return Buffer.from(await res.arrayBuffer()).length;
}

describe('fetchUpstream body idle timeout', () => {
	it('lets a body that keeps moving outlast the header timeout', async () => {
		const res = await fetchUpstream(`${base}/trickle`, {}, { timeoutMs: 500, attempts: 1, bodyIdleMs: 400 });
		expect(await drain(res)).toBe(1200);
	});

	it('cuts a body that stops moving for bodyIdleMs', async () => {
		const res = await fetchUpstream(`${base}/stall`, {}, { timeoutMs: 500, attempts: 1, bodyIdleMs: 300 });
		const started = Date.now();
		const err = await drain(res).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(Date.now() - started).toBeLessThan(1_500);
	});

	it('still bounds the wait for headers by timeoutMs', async () => {
		const started = Date.now();
		const err = await fetchUpstream(`${base}/slow-headers`, {}, { timeoutMs: 300, attempts: 1, bodyIdleMs: 5_000 }).catch((e) => e);
		expect(err?.name).toBe('TimeoutError');
		expect(Date.now() - started).toBeLessThan(1_500);
	});

	it('keeps the whole-attempt timeout when bodyIdleMs is not given', async () => {
		const res = await fetchUpstream(`${base}/trickle`, {}, { timeoutMs: 500, attempts: 1 });
		const err = await drain(res).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
	});
});
