// The free-model audit's non-OpenRouter lanes (NVIDIA NIM, Kilo Code). Their
// catalogs are not authoritative, so the audit must only page ops for an id
// the model endpoint itself reports as gone (404/410), never for a catalog
// miss on a model that still answers, and never on our own outage.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { auditCatalogLane } from '../api/cron/free-model-audit.js';

const BASE = 'https://catalog.example/v1';
const ids = ['vendor/alive', 'vendor/unlisted-but-serving', 'vendor/retired'];

function respond(status, body = {}) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => vi.restoreAllMocks());

describe('auditCatalogLane', () => {
	it('flags only the catalog misses that answer 404/410 on a live call', async () => {
		const probed = [];
		globalThis.fetch = vi.fn(async (url, opts) => {
			if (String(url).endsWith('/models')) return respond(200, { data: [{ id: 'vendor/alive' }] });
			const { model, max_tokens } = JSON.parse(opts.body);
			probed.push(model);
			expect(max_tokens).toBe(1);
			return model === 'vendor/retired' ? respond(410) : respond(200);
		});
		const out = await auditCatalogLane({ lane: 'nvidia', base: BASE, key: 'k', ids });
		expect(out).toEqual({ lane: 'nvidia', checked: 3, live: 2, dead: ['vendor/retired'], status: 'dead_rungs' });
		// The listed id is never probed: the listing already vouched for it.
		expect(probed).toEqual(['vendor/unlisted-but-serving', 'vendor/retired']);
	});

	it('treats a busy or throttled model as alive, not retired', async () => {
		globalThis.fetch = vi.fn(async (url) => {
			if (String(url).endsWith('/models')) return respond(200, { data: [{ id: 'other/model' }] });
			return respond(429);
		});
		const out = await auditCatalogLane({ lane: 'kilo', base: BASE, key: null, ids });
		expect(out.status).toBe('ok');
		expect(out.dead).toEqual([]);
	});

	it('reports unknown and flags nothing when the catalog itself is unreachable', async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error('fetch failed: ECONNRESET');
		});
		const out = await auditCatalogLane({ lane: 'kilo', base: BASE, key: null, ids });
		expect(out).toEqual({ lane: 'kilo', checked: 3, live: 0, dead: [], status: 'unknown' });
	});

	it('sends no Authorization header on a keyless lane', async () => {
		const headers = [];
		globalThis.fetch = vi.fn(async (url, opts) => {
			headers.push(opts?.headers || {});
			return respond(200, { data: ids.map((id) => ({ id })) });
		});
		const out = await auditCatalogLane({ lane: 'kilo', base: BASE, key: null, ids });
		expect(out.status).toBe('ok');
		expect(headers.every((h) => !('authorization' in h))).toBe(true);
	});
});
