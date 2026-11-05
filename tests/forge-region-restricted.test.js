// /forge dead-ended on a 403 region_restricted for every visitor.
//
// Production's load balancer sets no geo header, so every request resolves to
// an unknown country, which the territory rule treats as restricted (fail
// closed). The catalog still advertised the Tencent lanes (Hunyuan3D, the
// HuggingFace chain) as selectable, so picking one returned 403
// region_restricted with retry_backends, and the client had no branch for it:
// it showed a generic error and the next Generate hit the same 403.
//
// The fix has two halves, both pinned here:
//   1. GET /api/forge?territory tells this visitor which engines the server
//      will refuse, per request and never edge-cached (the catalog is shared
//      across visitors on the CDN, so it cannot carry this).
//   2. The client maps region_restricted to the lane_failed hop, so a refused
//      pick moves to an engine the server named instead of dead-ending.

import { describe, it, expect, beforeAll } from 'vitest';
import { Readable } from 'node:stream';
import { TENCENT_LANES } from '../api/_lib/forge-territory.js';
import { regionRestrictedError, parseTerritory } from '../src/forge-region.js';

let forge;

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '', _ended: false,
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; this._ended = true; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function getReq(url, headers = {}) {
	const r = Readable.from([]);
	r.method = 'GET';
	r.url = url;
	r.headers = { origin: 'http://localhost:3000', ...headers };
	return r;
}

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	forge = (await import('../api/forge.js')).default;
});

describe('GET /api/forge?territory', () => {
	it('names every Tencent lane as restricted when the country is unknown', async () => {
		const res = mockRes();
		await forge(getReq('/api/forge?territory=1'), res);
		expect(res.statusCode).toBe(200);
		expect(res.json.country_resolved).toBe(false);
		expect([...res.json.restricted_backends].sort()).toEqual([...TENCENT_LANES].sort());
	});

	it('restricts nothing for an allowed country and restricts Tencent lanes for the EU', async () => {
		const us = mockRes();
		await forge(getReq('/api/forge?territory=1', { 'x-client-region': 'US' }), us);
		expect(us.json).toMatchObject({ country_resolved: true, restricted_backends: [] });

		const de = mockRes();
		await forge(getReq('/api/forge?territory=1', { 'x-client-region': 'DE' }), de);
		expect(de.json.country_resolved).toBe(true);
		expect([...de.json.restricted_backends].sort()).toEqual([...TENCENT_LANES].sort());
	});

	it('is never cached at the edge, since the answer is per visitor', async () => {
		const res = mockRes();
		await forge(getReq('/api/forge?territory=1'), res);
		expect(res.getHeader('cache-control')).toMatch(/private|no-store/);
		expect(res.getHeader('cache-control')).not.toMatch(/s-maxage|public/);
	});
});

describe('client handling of region_restricted', () => {
	it('turns the 403 into a lane_failed hop onto the engines the server named', () => {
		const e = regionRestrictedError({
			error: 'region_restricted',
			backend: 'hunyuan3d',
			message: 'This engine is not available in your region.',
			retry_backends: ['nvidia', 'trellis_selfhost'],
		});
		expect(e).toBeInstanceOf(Error);
		expect(e.kind).toBe('lane_failed');
		expect(e.regionRestricted).toBe(true);
		expect(e.backend).toBe('hunyuan3d');
		expect(e.retryBackends).toEqual(['nvidia', 'trellis_selfhost']);
	});

	it('still returns a designed error when the server names no alternative', () => {
		const e = regionRestrictedError({ error: 'region_restricted', backend: 'huggingface' });
		expect(e.kind).toBe('region');
		expect(e.message).toMatch(/region/i);
	});

	it('ignores every other error', () => {
		expect(regionRestrictedError({ error: 'provider_busy' })).toBeNull();
		expect(regionRestrictedError(null)).toBeNull();
	});

	it('parses the territory answer defensively', () => {
		expect(parseTerritory({ restricted_backends: ['hunyuan3d', 7, ''] })).toEqual(new Set(['hunyuan3d']));
		expect(parseTerritory(null)).toEqual(new Set());
		expect(parseTerritory({ restricted_backends: 'hunyuan3d' })).toEqual(new Set());
	});

	it('is wired into both forge composers', async () => {
		const { readFileSync } = await import('node:fs');
		for (const file of ['../src/forge.js', '../src/forge-studio/forge.js']) {
			const src = readFileSync(new URL(file, import.meta.url), 'utf8');
			expect(src).toContain('regionRestrictedError(data)');
			expect(src).toContain('fetchRestrictedEngines(CLIENT_HEADERS)');
			expect(src).toContain('restrictedEngines.has(btn.dataset.backend)');
		}
		const helper = readFileSync(new URL('../src/forge-region.js', import.meta.url), 'utf8');
		expect(helper).toContain('/api/forge?territory=1');
	});
});
