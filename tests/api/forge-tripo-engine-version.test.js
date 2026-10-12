// Tripo submit responses name the exact model version the job ran on (work
// order 084-partners-01, task 5: attribution). The version is a deployment-
// wide setting (TRIPO_MODEL_VERSION, or the provider's default), read live at
// response-build time rather than stored per row. Mirrors the harness in
// tests/forge-high-gate-tripo-house.test.js: a stubbed fetch models Tripo's
// real v3 wire protocol instead of touching the network.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';

let forge;
const ORIGINAL_FETCH = globalThis.fetch;

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '', _ended: false,
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; this._ended = true; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function mockReq({ body = null, headers = {} } = {}) {
	const chunks = body != null ? [Buffer.from(JSON.stringify(body))] : [];
	const r = Readable.from(chunks);
	r.method = 'POST';
	r.url = '/api/forge';
	r.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', ...headers };
	return r;
}

beforeEach(async () => {
	vi.resetModules();
	process.env.NODE_ENV = 'development';
	process.env.APP_ORIGIN = 'https://three.ws';
	process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
	delete process.env.TRIPO_API_KEY;
	delete process.env.TRIPO_MODEL_VERSION;
	delete process.env.HOLDER_PASS_SECRET;
	globalThis.fetch = vi.fn(async () => ({
		ok: true,
		status: 200,
		json: async () => ({ code: 0, data: { task_id: 'task-submitted-1' } }),
	}));
	forge = (await import('../../api/forge.js')).default;
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	delete process.env.TRIPO_MODEL_VERSION;
	vi.restoreAllMocks();
});

describe('POST /api/forge: Tripo submit response names the engine version', () => {
	it('names the default model version on a queued job', async () => {
		const res = await (async () => {
			const r = mockRes();
			await forge(
				mockReq({
					body: { prompt: 'a brass telescope', tier: 'high', backend: 'tripo' },
					headers: { 'x-forge-provider-key': 'caller-own-key' },
				}),
				r,
			);
			return r;
		})();
		expect(res.json?.backend).toBe('tripo');
		expect(res.json?.status).toBe('queued');
		expect(res.json?.engine_version).toBe('v3.1-20260211');
	});

	it('reflects an operator override via TRIPO_MODEL_VERSION', async () => {
		process.env.TRIPO_MODEL_VERSION = 'v3.2-beta';
		vi.resetModules();
		forge = (await import('../../api/forge.js')).default;
		const res = await (async () => {
			const r = mockRes();
			await forge(
				mockReq({
					body: { prompt: 'a brass telescope', tier: 'high', backend: 'tripo' },
					headers: { 'x-forge-provider-key': 'caller-own-key' },
				}),
				r,
			);
			return r;
		})();
		expect(res.json?.engine_version).toBe('v3.2-beta');
	});

	it('never names an engine version for a non-Tripo backend', async () => {
		const res = await (async () => {
			const r = mockRes();
			globalThis.fetch = vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({ result: 'meshy-task-1' }),
			}));
			await forge(
				mockReq({
					body: { prompt: 'a brass telescope', tier: 'high', backend: 'meshy' },
					headers: { 'x-forge-provider-key': 'caller-own-key' },
				}),
				r,
			);
			return r;
		})();
		expect(res.json?.backend).toBe('meshy');
		expect(res.json?.engine_version).toBeUndefined();
	});
});
