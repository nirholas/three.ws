// Rodin (Hyper3D) BYOK provider (api/_providers/rodin.js): wire contract for
// the poly-budget override. Rodin's submit is multipart/form-data, so the
// target is read back off the posted FormData rather than a JSON body.
//
// global fetch is stubbed to model Rodin's real wire protocol (verified
// against their published API shapes); no network and no mocked product data.

import { describe, it, expect, vi, afterEach } from 'vitest';

// imageTo3d downloads the caller's reference image via fetchUpstreamPublic,
// which SSRF-checks the URL with a real DNS lookup (assertSafePublicUrl),
// irrelevant to the poly-budget override this file tests, and unreachable in
// a sandboxed test run. Stub just that one export; fetchUpstream (the submit
// call every test here actually exercises) stays real, driven by the
// global fetch mock, same as every other provider test in this suite.
vi.mock('../../api/_lib/upstream-fetch.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		fetchUpstreamPublic: vi.fn(async () => ({
			ok: true,
			status: 200,
			blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
		})),
	};
});

import { createRodinProvider } from '../../api/_providers/rodin.js';

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

const TIER = { id: 'standard', polycount: 30_000, pbr: false };

describe('rodin provider: construction', () => {
	it('refuses to construct without an API key', () => {
		expect(() => createRodinProvider('')).toThrowError(/key is required/i);
	});
});

describe('rodin provider: text→geometry poly override', () => {
	it('honors an explicit targetPolycount over the tier default', async () => {
		let form;
		globalThis.fetch = vi.fn(async (url, opts) => {
			form = opts.body;
			return {
				ok: true,
				status: 200,
				json: async () => ({ uuid: 'task-uuid', jobs: { subscription_key: 'sub-key' } }),
			};
		});

		const provider = createRodinProvider('rodin_test');
		const out = await provider.textToGeometry({ prompt: 'a brass telescope', tier: TIER, targetPolycount: 95_000 });

		expect(form.get('quality_override')).toBe('95000');
		expect(out).toEqual({ kind: 'sub-key', taskId: 'task-uuid' });
	});

	it('falls back to the tier polycount when no override is supplied', async () => {
		let form;
		globalThis.fetch = vi.fn(async (url, opts) => {
			form = opts.body;
			return {
				ok: true,
				status: 200,
				json: async () => ({ uuid: 'task-uuid', jobs: { subscription_key: 'sub-key' } }),
			};
		});

		const provider = createRodinProvider('rodin_test');
		await provider.textToGeometry({ prompt: 'x', tier: TIER });

		expect(form.get('quality_override')).toBe('30000');
	});

	it('clamps an overridden targetPolycount into Rodin\'s accepted 1,000-200,000 window', async () => {
		let form;
		globalThis.fetch = vi.fn(async (url, opts) => {
			form = opts.body;
			return {
				ok: true,
				status: 200,
				json: async () => ({ uuid: 'task-uuid', jobs: { subscription_key: 'sub-key' } }),
			};
		});

		const provider = createRodinProvider('rodin_test');
		await provider.textToGeometry({ prompt: 'x', tier: TIER, targetPolycount: 5_000_000 });

		expect(form.get('quality_override')).toBe('200000');
	});
});

describe('rodin provider: image→3D poly override', () => {
	it('honors targetPolycount on the image path too', async () => {
		let capturedForm;
		globalThis.fetch = vi.fn(async (url, opts) => {
			capturedForm = opts.body;
			return {
				ok: true,
				status: 200,
				json: async () => ({ uuid: 'img-uuid', jobs: { subscription_key: 'img-sub' } }),
			};
		});

		const provider = createRodinProvider('rodin_test');
		await provider.imageTo3d({
			imageUrl: 'https://cdn.example.com/reference.png',
			tier: { ...TIER, pbr: true },
			targetPolycount: 40_000,
		});

		expect(capturedForm.get('quality_override')).toBe('40000');
	});
});
