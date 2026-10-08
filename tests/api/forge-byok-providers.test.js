// BYOK provider expansion — registry, backend registration, and the two new
// adapter contracts (Rodin async, Stability synchronous).
//
// No network and no mocked product data: global fetch is stubbed to model each
// vendor's real wire protocol (verified against their live API docs), and the
// R2 helper is mocked so the synchronous Stability persist doesn't touch object
// storage. Covers what unit tests can own; live behavior is exercised by BYOK
// keys in production.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

// The reference-image fetch is SSRF-checked (DNS-resolved) before it goes out;
// these fixtures use offline `.test` hosts, so the check is passed through here
// and covered on its own in tests/ssrf-hardening-guards.test.js.
vi.mock('../../api/_lib/ssrf-guard.js', async (importOriginal) => ({
	...(await importOriginal()),
	assertSafePublicUrl: async (u) => new URL(u),
}));

// R2 is mocked once for the whole file — only the Stability adapter reaches it.
vi.mock('../../api/_lib/r2.js', () => ({
	putObject: vi.fn(async () => ({})),
	publicUrl: (key) => `https://three.ws/cdn/${key}`,
}));

describe('forge-tiers — new BYOK backend registration', () => {
	it('registers Rodin as a geometry+image BYOK backend with poly control', async () => {
		const { BACKENDS } = await import('../../api/_lib/forge-tiers.js');
		const r = BACKENDS.rodin;
		expect(r).toBeTruthy();
		expect(r.byok).toBe('rodin');
		expect(r.provider).toBe('rodin');
		expect(r.paths).toEqual(['geometry', 'image']);
		expect(r.polyControl).toBe(true);
	});

	it('registers Stability as an image-only BYOK backend', async () => {
		const { BACKENDS } = await import('../../api/_lib/forge-tiers.js');
		const s = BACKENDS.stability;
		expect(s.byok).toBe('stability');
		expect(s.paths).toEqual(['image']);
	});

	it('registers Replicate BYOK pointing at the replicate provider + key', async () => {
		const { BACKENDS } = await import('../../api/_lib/forge-tiers.js');
		const rb = BACKENDS.replicate_byok;
		expect(rb.byok).toBe('replicate');
		expect(rb.provider).toBe('replicate');
		expect(rb.paths).toEqual(['image']);
	});

	it('treats every BYOK backend as configured (liveness depends on the key)', async () => {
		const { backendIsConfigured } = await import('../../api/_lib/forge-tiers.js');
		expect(backendIsConfigured('rodin')).toBe(true);
		expect(backendIsConfigured('stability')).toBe(true);
		expect(backendIsConfigured('replicate_byok')).toBe(true);
	});

	it('honors an explicit selection of each new backend on its path', async () => {
		const { resolveBackendId } = await import('../../api/_lib/forge-tiers.js');
		expect(resolveBackendId({ path: 'geometry', backend: 'rodin' })).toBe('rodin');
		expect(resolveBackendId({ path: 'image', backend: 'stability' })).toBe('stability');
		expect(resolveBackendId({ path: 'image', backend: 'replicate_byok' })).toBe('replicate_byok');
	});

	it('surfaces them in the public catalog with byok set', async () => {
		const { buildCatalog } = await import('../../api/_lib/forge-tiers.js');
		const cat = buildCatalog();
		for (const [id, key] of [['rodin', 'rodin'], ['stability', 'stability'], ['replicate_byok', 'replicate']]) {
			const b = cat.backends.find((x) => x.id === id);
			expect(b, id).toBeTruthy();
			expect(b.byok).toBe(key);
			expect(b.configured).toBe(true);
		}
	});
});

describe('byok-registry — shared dispatch table', () => {
	it('contains the geometry-style providers and excludes Replicate', async () => {
		const { BYOK_PROVIDER_FACTORIES } = await import('../../api/_providers/byok-registry.js');
		expect(Object.keys(BYOK_PROVIDER_FACTORIES).sort()).toEqual(
			['meshy', 'rodin', 'stability', 'tripo'],
		);
		expect(BYOK_PROVIDER_FACTORIES.replicate).toBeUndefined();
	});

	it('isByokGeometryBackend matches registry backends only', async () => {
		const { isByokGeometryBackend } = await import('../../api/_providers/byok-registry.js');
		const { BACKENDS } = await import('../../api/_lib/forge-tiers.js');
		expect(isByokGeometryBackend(BACKENDS.rodin)).toBe(true);
		expect(isByokGeometryBackend(BACKENDS.stability)).toBe(true);
		expect(isByokGeometryBackend(BACKENDS.replicate_byok)).toBe(false); // byok 'replicate', not in registry
		expect(isByokGeometryBackend(BACKENDS.trellis)).toBe(false); // not byok
	});
});

describe('rodin provider — async text→geometry', () => {
	const TIER = { id: 'standard', polycount: 30_000, pbr: false, hd: false };

	it('rejects construction without a key', async () => {
		const { createRodinProvider } = await import('../../api/_providers/rodin.js');
		expect(() => createRodinProvider('')).toThrowError(/key is required/i);
	});

	it('submits Gen-2 quad geometry and returns a poll handle (subKey in kind, uuid in taskId)', async () => {
		const { createRodinProvider } = await import('../../api/_providers/rodin.js');
		let captured;
		globalThis.fetch = vi.fn(async (url, opts) => {
			captured = { url: String(url), form: opts.body };
			return {
				ok: true,
				status: 201,
				json: async () => ({ uuid: 'task-uuid-1', jobs: { subscription_key: 'sub-key-1' } }),
			};
		});
		const gp = createRodinProvider('rodin-key');
		const out = await gp.textToGeometry({ prompt: 'a brass key', tier: TIER });

		expect(captured.url).toBe('https://api.hyper3d.com/api/v2/rodin');
		expect(captured.form.get('tier')).toBe('Gen-2');
		expect(captured.form.get('mesh_mode')).toBe('Quad');
		expect(captured.form.get('prompt')).toBe('a brass key');
		expect(Number(captured.form.get('quality_override'))).toBe(30_000);
		expect(out).toEqual({ kind: 'sub-key-1', taskId: 'task-uuid-1' });
	});

	it('maps 401 to an invalid_key error', async () => {
		const { createRodinProvider } = await import('../../api/_providers/rodin.js');
		globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
		const gp = createRodinProvider('bad');
		await expect(gp.textToGeometry({ prompt: 'x', tier: TIER })).rejects.toMatchObject({
			code: 'invalid_key',
		});
	});

	it('polls status, then resolves the GLB from the download list when Done', async () => {
		const { createRodinProvider } = await import('../../api/_providers/rodin.js');
		const calls = [];
		globalThis.fetch = vi.fn(async (url, opts) => {
			const u = String(url);
			calls.push(u);
			if (u.endsWith('/status')) {
				const body = JSON.parse(opts.body);
				expect(body.subscription_key).toBe('sub-key-1');
				return { ok: true, status: 200, json: async () => ({ jobs: [{ uuid: 'j1', status: 'Done' }] }) };
			}
			if (u.endsWith('/download')) {
				const body = JSON.parse(opts.body);
				expect(body.task_uuid).toBe('task-uuid-1');
				return {
					ok: true,
					status: 200,
					json: async () => ({
						list: [
							{ name: 'preview.webp', url: 'https://x/p.webp' },
							{ name: 'model.glb', url: 'https://x/model.glb' },
						],
					}),
				};
			}
			throw new Error(`unexpected url ${u}`);
		});
		const gp = createRodinProvider('rodin-key');
		const res = await gp.status({ kind: 'sub-key-1', taskId: 'task-uuid-1' });
		expect(res.status).toBe('done');
		expect(res.resultGlbUrl).toBe('https://x/model.glb');
		expect(calls.some((u) => u.endsWith('/download'))).toBe(true);
	});

	it('reports running while Generating (no download call yet)', async () => {
		const { createRodinProvider } = await import('../../api/_providers/rodin.js');
		const calls = [];
		globalThis.fetch = vi.fn(async (url) => {
			calls.push(String(url));
			return { ok: true, status: 200, json: async () => ({ jobs: [{ uuid: 'j1', status: 'Generating' }] }) };
		});
		const gp = createRodinProvider('rodin-key');
		const res = await gp.status({ kind: 'sub-key-1', taskId: 'task-uuid-1' });
		expect(res.status).toBe('running');
		expect(calls.some((u) => u.endsWith('/download'))).toBe(false);
	});
});

describe('stability provider — synchronous image→3D', () => {
	const TIER = { id: 'standard', polycount: 30_000, pbr: false, hd: false };

	it('exposes no textToGeometry (image-only)', async () => {
		const { createStabilityProvider } = await import('../../api/_providers/stability.js');
		const gp = createStabilityProvider('sk-test');
		expect(typeof gp.imageTo3d).toBe('function');
		expect(gp.textToGeometry).toBeUndefined();
	});

	it('persists the returned GLB to R2 and hands back a durable url (no taskId)', async () => {
		const { createStabilityProvider } = await import('../../api/_providers/stability.js');
		const r2 = await import('../../api/_lib/r2.js');
		globalThis.fetch = vi.fn(async (url, opts) => {
			const u = String(url);
			if (u === 'https://img.test/in.png') {
				return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1, 2, 3])]) };
			}
			// Stability endpoint — assert the multipart submit + binary accept header.
			expect(u).toBe('https://api.stability.ai/v2beta/3d/stable-fast-3d');
			expect(opts.headers.accept).toBe('model/gltf-binary');
			expect(opts.headers.authorization).toBe('Bearer sk-test');
			expect(opts.body.get('image')).toBeTruthy();
			return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([7, 7, 7, 7]).buffer };
		});
		const gp = createStabilityProvider('sk-test');
		const out = await gp.imageTo3d({ imageUrl: 'https://img.test/in.png', tier: TIER });

		expect(out.taskId).toBeNull();
		expect(out.resultGlbUrl).toMatch(/^https:\/\/three\.ws\/cdn\/forge\/stability\/.*\.glb$/);
		expect(r2.putObject).toHaveBeenCalledWith(
			expect.objectContaining({ contentType: 'model/gltf-binary' }),
		);
	});

	it('maps a 401 from Stability to invalid_key', async () => {
		const { createStabilityProvider } = await import('../../api/_providers/stability.js');
		globalThis.fetch = vi.fn(async (url) => {
			if (String(url).includes('img.test')) {
				return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1])]) };
			}
			return { ok: false, status: 401, json: async () => ({ errors: ['bad key'] }) };
		});
		const gp = createStabilityProvider('sk-bad');
		await expect(gp.imageTo3d({ imageUrl: 'https://img.test/in.png', tier: TIER })).rejects.toMatchObject({
			code: 'invalid_key',
		});
	});
});
