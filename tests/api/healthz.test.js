// Smoke test for /api/healthz. Stays free of any DB/RPC dependencies — this
// endpoint is the canary that uptime probes will hit, so it must stay green
// even when downstream systems are degraded.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));

import healthz from '../../api/healthz.js';

function makeReq({ method = 'GET' } = {}) { return { url: '/api/healthz', method, headers: {} }; }
function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; },
	};
}

describe('GET /api/healthz', () => {
	it('returns 200 with status=ok and uptime fields', async () => {
		const res = makeRes();
		await healthz(makeReq(), res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res._body);
		expect(body.status).toBe('ok');
		expect(body.service).toBe('3d-agent');
		expect(typeof body.uptime).toBe('number');
		expect(typeof body.uptimeMs).toBe('number');
		expect(body.monitor.running).toBe(true);
	});

	it('rejects non-GET methods', async () => {
		const res = makeRes();
		await healthz(makeReq({ method: 'POST' }), res);
		expect(res.statusCode).toBe(405);
	});

	it('cache-control allows brief edge caching', async () => {
		const res = makeRes();
		await healthz(makeReq(), res);
		expect(res.getHeader('cache-control')).toMatch(/max-age=/);
	});
});
