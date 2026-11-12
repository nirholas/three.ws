// `?miss=empty` on the Oracle and coin-intel single-coin reads. A coin the data
// brain has not observed is an expected answer for widgets with their own
// empty state (the coin3d chart card reads both for $THREE), so they
// opt into a 204 instead of a 404 that the browser prints to the console on
// every visit (console sweep 2026-11-12). Callers that do not opt in keep the
// 404 contract the MCP tools and SDK rely on.

import { describe, it, expect, vi } from 'vitest';

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { mcpIp: async () => ({ success: true }) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/oracle/store.js', () => ({
	readCoin: vi.fn(async () => null),
	scoreCoin: vi.fn(async () => null),
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
}));

const { default: oracleCoin } = await import('../api/oracle/coin.js');
const { default: coinIntel } = await import('../api/pump/coin-intel.js');

function call(handler, url) {
	return new Promise((resolve) => {
		const headers = {};
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader: (k, v) => {
				headers[k.toLowerCase()] = v;
			},
			getHeader: (k) => headers[k.toLowerCase()],
			writeHead(code, h = {}) {
				this.statusCode = code;
				for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
				return this;
			},
			end(body) {
				this.headersSent = true;
				resolve({ status: this.statusCode, headers, body: body ? String(body) : '' });
			},
		};
		handler({ method: 'GET', url, headers: { host: 'three.ws' } }, res);
	});
}

describe.each([
	['GET /api/oracle/coin', oracleCoin, `/api/oracle/coin?mint=${MINT}&network=mainnet`],
	['GET /api/pump/coin-intel', coinIntel, `/api/pump/coin-intel?mint=${MINT}&network=mainnet`],
])('%s for a coin not observed yet', (_name, handler, url) => {
	it('keeps the 404 for callers that do not opt in', async () => {
		const r = await call(handler, url);
		expect(r.status).toBe(404);
		expect(JSON.parse(r.body).error).toBe('not_found');
	});

	it('answers 204 with no body for ?miss=empty', async () => {
		const r = await call(handler, `${url}&miss=empty`);
		expect(r.status).toBe(204);
		expect(r.body).toBe('');
		expect(r.headers['cache-control']).toMatch(/max-age=/);
	});
});
