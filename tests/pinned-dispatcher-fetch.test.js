// Every SSRF-guarded request pins its connection with an undici Agent
// (api/_lib/ssrf.js pinnedAgent). A dispatcher can only be driven by the fetch
// that belongs to the same undici. Node's global fetch is the undici bundled
// with the runtime (7.x on Node 24), and since the undici dependency moved to 8
// (2026-10-28) it rejected our Agent outright: every guarded call failed with
// "fetch failed", cause UND_ERR_INVALID_ARG "invalid onRequestStart method",
// before a single byte left the process. The paid x402 relay, webhook and alert
// delivery, payment probes and fetchModel all went through that path.
//
// The DNS/pin layer is swapped for a plain Agent from the same undici so the
// requests can reach a loopback server; the fetch each module uses is the
// production one.

import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Agent } from 'undici';

vi.mock('../api/_lib/ssrf.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		validatePublicUrl: (raw) => new URL(raw),
		assertPublicHttpsUrl: async (raw) => new URL(raw).href,
		resolvePublicHost: async () => [{ address: '127.0.0.1', family: 4 }],
		pinnedAgent: () => new Agent(),
	};
});

const { deliver } = await import('../api/_lib/webhook-dispatch.js');
const { guardedFetch } = await import('../api/_lib/pay/probe.js');
const { fetchUpstream } = await import('../api/_lib/upstream-fetch.js');

let server;
let base;
const seen = [];

beforeAll(async () => {
	server = http.createServer((req, res) => {
		seen.push(`${req.method} ${req.url}`);
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ ok: true, path: req.url }));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
	server.closeAllConnections();
	server.close();
});

describe('requests pinned with an undici Agent reach the upstream', () => {
	it('deliver (developer webhooks) posts to the receiver', async () => {
		const out = await deliver(`${base}/hook`, 'whsec_test', 'evt_1', JSON.stringify({ type: 'test' }));
		expect(out.error ?? null).toBeNull();
		expect(out.statusCode).toBe(200);
		expect(seen).toContain('POST /hook');
	});

	it('guardedFetch (payment probe) returns the upstream status', async () => {
		const res = await guardedFetch(`${base}/probe`, { timeoutMs: 5000 });
		expect(res.status).toBe(200);
		expect(res.text).toContain('/probe');
	});

	it('fetchUpstream honours a pinned dispatcher (alert delivery)', async () => {
		const agent = new Agent();
		try {
			const res = await fetchUpstream(`${base}/alert`, { method: 'POST', body: '{}', dispatcher: agent }, { timeoutMs: 5000, attempts: 1 });
			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({ path: '/alert' });
		} finally {
			await agent.destroy();
		}
	});
});
