// /api/tty must fetch remote models through the pinned, per-hop validated
// fetcher. The avatar branch hands the handler a stored model_url that never
// passed the SSRF guard, so a loopback model_url must be refused without the
// server ever connecting to it, and the response must not echo internals.

import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';

vi.mock('../api/_lib/avatars.js', () => ({ getAvatar: vi.fn() }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	clientIp: () => '203.0.113.9',
	limits: { ttyIp: async () => ({ success: true, limit: 10 }) },
}));

import { getAvatar } from '../api/_lib/avatars.js';
import handler from '../api/tty.js';

let server;
afterEach(async () => {
	if (server) await new Promise((r) => server.close(r));
	server = null;
});

function fakeRes() {
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		write(c) { this.body += c; return true; },
		end(c) { if (c) this.body += c; this.done = true; },
		on() {},
	};
	return res;
}

describe('/api/tty avatar model_url SSRF', () => {
	it('never connects to a loopback model_url and does not leak the error detail', async () => {
		let hits = 0;
		server = http.createServer((_req, res) => { hits += 1; res.end('x'); });
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		const { port } = server.address();
		getAvatar.mockResolvedValue({ name: 'a', model_url: `http://127.0.0.1:${port}/m.glb` });

		const req = { url: '/api/tty?avatar=11111111-1111-1111-1111-111111111111', headers: {}, method: 'GET', on() {} };
		const res = fakeRes();
		await handler(req, res);

		expect(hits).toBe(0);
		expect(res.statusCode).toBeGreaterThanOrEqual(400);
		expect(res.body).not.toMatch(/127\.0\.0\.1|private|fetch/i);
	});
});
