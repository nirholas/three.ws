// seedReferenceImage (api/forge.js) asks the reference-image module for the
// picture a text prompt is reconstructed from, and on any failure makes one more
// attempt on the standing text-to-image ladder so the step never dead-ends.
//
// 2026-11-26 production outage: the keyless rung was the only one serving. It
// allows one image per 45 s per IP and answers a second request 402 with
// `Retry-After: 45`; a refused request also spends the slot. The module's own
// fallthrough had already run that same ladder, so the "one more attempt" was a
// second request inside the window: certain to be refused, and it pushed the
// window out for the retry the user was told to make. A provider that states
// its wait must be believed, not asked again in the same breath.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({ module: 0, ladder: 0, moduleImpl: null, ladderImpl: null }));

vi.mock('../../api/_lib/forge-reference-image.js', () => ({
	generateReferenceImage: async (...args) => {
		calls.module++;
		return calls.moduleImpl(...args);
	},
}));
vi.mock('../../api/_mcp3d/text-to-image.js', async (importOriginal) => ({
	...(await importOriginal()),
	textToImage: async (...args) => {
		calls.ladder++;
		return calls.ladderImpl(...args);
	},
}));

const forge = await import('../../api/forge.js');
// The ChatGPT surfaces are served by a clone of the same handler.
const gptForge = await import('../../api/gpt-forge.js');

const refusal = () =>
	Object.assign(new Error('pollinations returned 402: FREE_LIMIT Free limit reached: 1 image every 45 seconds per IP'), {
		code: 'rate_limited',
		providerStatus: 402,
		retryAfter: 45,
		queued: true,
	});

beforeEach(() => {
	calls.module = 0;
	calls.ladder = 0;
	calls.ladderImpl = async () => ({ imageUrl: 'https://cdn.test/ladder.png', model: 'pollinations/flux' });
	delete process.env.FORGE_REFERENCE_IMAGE;
});

describe.each([
	['api/forge.js', forge.seedReferenceImage],
	['api/gpt-forge.js', gptForge.seedReferenceImage],
])('seedReferenceImage in %s', (_file, seedReferenceImage) => {
	it('returns the reference module image without touching the standing ladder', async () => {
		calls.moduleImpl = async () => ({ imageUrl: 'https://cdn.test/ref.png', model: 'vertex/gemini-image' });
		const out = await seedReferenceImage({ prompt: 'a fox', aspect: '1:1', seed: 7 });
		expect(out).toEqual({ imageUrl: 'https://cdn.test/ref.png', model: 'vertex/gemini-image', referenceModule: true });
		expect(calls.ladder).toBe(0);
	});

	it('does not ask a provider again that just stated how long to wait', async () => {
		calls.moduleImpl = async () => {
			throw refusal();
		};
		const err = await seedReferenceImage({ prompt: 'a fox', aspect: '1:1', seed: 7 }).catch((e) => e);
		expect(calls.module).toBe(1);
		expect(calls.ladder).toBe(0);
		expect(err.code).toBe('rate_limited');
		expect(err.retryAfter).toBe(45);
		expect(err.queued).toBe(true);
	});

	it('still makes the standing-ladder attempt when the module itself is broken', async () => {
		calls.moduleImpl = async () => {
			throw new TypeError('generateReferenceImage is not wired');
		};
		const out = await seedReferenceImage({ prompt: 'a fox', aspect: '1:1', seed: 7 });
		expect(out).toEqual({ imageUrl: 'https://cdn.test/ladder.png', model: 'pollinations/flux', referenceModule: false });
		expect(calls.ladder).toBe(1);
	});

	// A ladder that ran out of time has stated no provider wait: the second pass
	// runs with the stalled lane cooling and is the recovery on a slow day.
	it('still makes the standing-ladder attempt after a timeout with no stated wait', async () => {
		calls.moduleImpl = async () => {
			throw Object.assign(new Error('pollinations timed out'), { code: 'rate_limited' });
		};
		const out = await seedReferenceImage({ prompt: 'a fox', aspect: '1:1', seed: 7 });
		expect(out.model).toBe('pollinations/flux');
		expect(calls.ladder).toBe(1);
	});

	it('goes straight to the standing ladder when the reference module is switched off', async () => {
		process.env.FORGE_REFERENCE_IMAGE = 'off';
		calls.moduleImpl = async () => ({ imageUrl: 'https://cdn.test/ref.png', model: 'vertex/gemini-image' });
		const out = await seedReferenceImage({ prompt: 'a fox', aspect: '1:1', seed: 7 });
		expect(calls.module).toBe(0);
		expect(out.referenceModule).toBe(false);
	});
});
