// The seed on the bring-your-own-key engines that take one.
//
// forge-controls.js records Tripo and Rodin as honoring the seed, and the page
// lets a caller type one for them. Before this suite the provider modules never
// put it on the wire, so "repeat this model" silently made a different model.
// Each test captures the request body the vendor receives (only fetch is
// stubbed) and checks the seed is there, or absent when none was asked for.

import { describe, it, expect, vi, afterEach } from 'vitest';

// The photo URL below is a fixture host; skip only its DNS lookup. The fetch
// itself still goes through the stub.
vi.mock('../../api/_lib/ssrf-guard.js', async (orig) => ({
	...(await orig()),
	assertSafePublicUrl: async () => {},
}));

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

const TIER = Object.freeze({ id: 'standard', polycount: 30_000, pbr: false, hd: false });

function captureTripo() {
	const bodies = [];
	globalThis.fetch = vi.fn(async (_url, opts) => {
		bodies.push(JSON.parse(opts.body));
		return new Response(JSON.stringify({ code: 0, data: { task_id: 'tripo-task-1' } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	});
	return bodies;
}

function captureRodin() {
	const forms = [];
	globalThis.fetch = vi.fn(async (url, opts) => {
		if (String(url).includes('/api/v2/rodin')) {
			forms.push(opts.body);
			return new Response(JSON.stringify({ uuid: 'rodin-uuid-1', jobs: { subscription_key: 'sub-1' } }), {
				status: 201,
				headers: { 'content-type': 'application/json' },
			});
		}
		// The reference picture an image build downloads first.
		return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
			status: 200,
			headers: { 'content-type': 'image/png' },
		});
	});
	return forms;
}

describe('tripo provider: seed', () => {
	it('sends model_seed on a text build', async () => {
		const { createTripoProvider } = await import('../../api/_providers/tripo.js');
		const bodies = captureTripo();
		await createTripoProvider('tsk_test_key_123456').textToGeometry({ prompt: 'a brass key', tier: TIER, seed: 7 });
		expect(bodies[0].model_seed).toBe(7);
	});

	it('sends model_seed and texture_seed on a photo build', async () => {
		const { createTripoProvider } = await import('../../api/_providers/tripo.js');
		const bodies = captureTripo();
		await createTripoProvider('tsk_test_key_123456').imageTo3d({
			imageUrl: 'https://cdn.example.com/ref.png',
			tier: TIER,
			seed: 0,
		});
		expect(bodies[0].model_seed).toBe(0);
		expect(bodies[0].texture_seed).toBe(0);
	});

	it('leaves both out when no seed was asked for', async () => {
		const { createTripoProvider } = await import('../../api/_providers/tripo.js');
		const bodies = captureTripo();
		await createTripoProvider('tsk_test_key_123456').textToGeometry({ prompt: 'a brass key', tier: TIER });
		expect(bodies[0]).not.toHaveProperty('model_seed');
		expect(bodies[0]).not.toHaveProperty('texture_seed');
	});
});

describe('rodin provider: seed', () => {
	it('sends the seed on a text build', async () => {
		const { createRodinProvider } = await import('../../api/_providers/rodin.js');
		const forms = captureRodin();
		await createRodinProvider('rodin-key').textToGeometry({ prompt: 'a brass key', tier: TIER, seed: 7 });
		expect(forms[0].get('seed')).toBe('7');
	});

	it('folds a seed past 65535 into Rodin\'s range so the same seed still repeats', async () => {
		const { createRodinProvider } = await import('../../api/_providers/rodin.js');
		const forms = captureRodin();
		await createRodinProvider('rodin-key').imageTo3d({
			imageUrl: 'https://cdn.example.com/ref.png',
			tier: TIER,
			seed: 70_000,
		});
		expect(forms[0].get('seed')).toBe(String(70_000 % 65_536));
	});

	it('leaves the seed out when none was asked for', async () => {
		const { createRodinProvider } = await import('../../api/_providers/rodin.js');
		const forms = captureRodin();
		await createRodinProvider('rodin-key').textToGeometry({ prompt: 'a brass key', tier: TIER });
		expect(forms[0].has('seed')).toBe(false);
	});
});
