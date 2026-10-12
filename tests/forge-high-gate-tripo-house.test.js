// Tripo house-key lane: the $THREE High-tier gate must track who actually
// pays for the job, not the backend's static `byok` flag.
//
//   • TRIPO_API_KEY unset              -> byte-for-byte today's BYOK behavior
//     (needs_key, never the hold gate), same as every other BYOK backend.
//   • TRIPO_API_KEY set, no caller key -> the house key pays: gated exactly
//     like a platform backend (402 three_hold_required with no pass).
//   • TRIPO_API_KEY set, caller supplies their own key -> the caller's key
//     still wins and stays exempt from the gate (needs_key/dispatch path,
//     never 402).
//
// Mirrors the harness in tests/forge-high-gate.test.js.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';

let forge;
const ORIGINAL_FETCH = globalThis.fetch;
const priorKey = process.env.TRIPO_API_KEY;

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
	delete process.env.HOLDER_PASS_SECRET;
	// Any dispatch past the gate hits this stub instead of the real network:
	// a fast, deterministic 401 so a non-gated request still resolves quickly.
	globalThis.fetch = vi.fn(async () => ({
		ok: false,
		status: 401,
		json: async () => ({ code: 1000, message: 'invalid key' }),
	}));
	forge = (await import('../api/forge.js')).default;
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	if (priorKey === undefined) delete process.env.TRIPO_API_KEY;
	else process.env.TRIPO_API_KEY = priorKey;
	vi.restoreAllMocks();
});

describe('POST /api/forge: Tripo house-key lane vs the $THREE gate', () => {
	it('TRIPO_API_KEY unset: High + tripo behaves exactly like any other BYOK backend', async () => {
		delete process.env.TRIPO_API_KEY;
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope', tier: 'high', backend: 'tripo' } }), res);
		expect(res.statusCode).not.toBe(402);
		expect(res.json?.error).not.toBe('three_hold_required');
		expect(res.json?.error).toBe('needs_key');
	});

	it('TRIPO_API_KEY set, no caller key: High + tripo is hold-gated like a platform lane', async () => {
		process.env.TRIPO_API_KEY = 'house-key-for-test';
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope', tier: 'high', backend: 'tripo' } }), res);
		expect(res.statusCode).toBe(402);
		expect(res.json.error).toBe('three_hold_required');
	});

	it('TRIPO_API_KEY set, caller supplies their own key: the caller key still wins, no gate', async () => {
		process.env.TRIPO_API_KEY = 'house-key-for-test';
		const res = mockRes();
		await forge(
			mockReq({
				body: { prompt: 'a brass telescope', tier: 'high', backend: 'tripo' },
				headers: { 'x-forge-provider-key': 'caller-own-key' },
			}),
			res,
		);
		expect(res.statusCode).not.toBe(402);
		expect(res.json?.error).not.toBe('three_hold_required');
	});

	it('TRIPO_API_KEY set: the High tier default backend for the geometry path becomes tripo', async () => {
		process.env.TRIPO_API_KEY = 'house-key-for-test';
		const { resolveBackendId } = await import('../api/_lib/forge-tiers.js');
		expect(resolveBackendId({ path: 'geometry', tier: 'high' })).toBe('tripo');
		expect(resolveBackendId({ path: 'geometry', tier: 'draft' })).not.toBe('tripo');
		expect(resolveBackendId({ path: 'geometry', tier: 'standard' })).not.toBe('tripo');
	});

	it('TRIPO_API_KEY unset: the High tier default backend for the geometry path stays meshy', async () => {
		delete process.env.TRIPO_API_KEY;
		const { resolveBackendId } = await import('../api/_lib/forge-tiers.js');
		expect(resolveBackendId({ path: 'geometry', tier: 'high' })).toBe('meshy');
	});

	it('catalog surfaces house_key_available only when TRIPO_API_KEY is set', async () => {
		delete process.env.TRIPO_API_KEY;
		const mod1 = await import('../api/_lib/forge-tiers.js');
		const catOff = mod1.buildCatalog();
		expect(catOff.backends.find((b) => b.id === 'tripo').house_key_available).toBe(false);

		vi.resetModules();
		process.env.TRIPO_API_KEY = 'house-key-for-test';
		const mod2 = await import('../api/_lib/forge-tiers.js');
		const catOn = mod2.buildCatalog();
		expect(catOn.backends.find((b) => b.id === 'tripo').house_key_available).toBe(true);
	});
});
