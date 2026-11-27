// What a failure on the Hunyuan3D and Hugging Face lanes costs the next caller.
// An ordinary worker failure pauses the lane briefly, a Hugging Face chain
// failure pauses it for minutes, quota exhaustion for half an hour (see
// forge-hf-quota-cooldown.test.js), and a cold worker is given its documented
// spin-up allowance in the ETA instead of being treated as failed. An
// unreachable worker is skipped at once: its /health probe reads down (see
// forge-lane-health.test.js) and the health-aware resolver passes over it.

import { describe, it, expect, afterEach } from 'vitest';
import {
	laneCooldownKey,
	markLaneUnhealthy,
	HF_LANE_COOLDOWN_SECONDS,
	HF_QUOTA_COOLDOWN_SECONDS,
} from '../../api/_lib/forge-lane-health.js';
import { clearProviderCooldown, providerCooldownUntil } from '../../api/_lib/provider-health.js';
import {
	coldStartSecondsFor,
	estimateEtaSeconds,
	resolveBackendIdWithHealth,
} from '../../api/_lib/forge-tiers.js';

const secondsLeft = async (id) => ((await providerCooldownUntil(laneCooldownKey(id))) - Date.now()) / 1000;

afterEach(async () => {
	await clearProviderCooldown(laneCooldownKey('hunyuan3d'));
	await clearProviderCooldown(laneCooldownKey('huggingface'));
});

describe('failure windows', () => {
	it('an ordinary Hunyuan3D worker failure pauses the lane for about ninety seconds', async () => {
		await markLaneUnhealthy('hunyuan3d');
		const left = await secondsLeft('hunyuan3d');
		expect(left).toBeGreaterThan(80);
		expect(left).toBeLessThanOrEqual(90);
	});

	it('the windows grow with the cause: worker blip, chain failure, quota', () => {
		expect(HF_LANE_COOLDOWN_SECONDS).toBeGreaterThan(90);
		expect(HF_QUOTA_COOLDOWN_SECONDS).toBeGreaterThan(HF_LANE_COOLDOWN_SECONDS);
	});
});

describe('cold worker allowance', () => {
	it('Hunyuan3D has a spin-up allowance and the Spaces lane does not', () => {
		expect(coldStartSecondsFor('hunyuan3d')).toBe(75);
		expect(coldStartSecondsFor('huggingface')).toBe(0);
	});

	it('a cold Hunyuan3D worker widens the ETA by exactly its allowance, a warm one does not', () => {
		const tier = { id: 'standard' };
		const warm = estimateEtaSeconds({ backendId: 'hunyuan3d', tier, cold: false });
		const cold = estimateEtaSeconds({ backendId: 'hunyuan3d', tier, cold: true });
		expect(cold - warm).toBe(75);
	});
});

describe('an unreachable worker is skipped at once', () => {
	const prev = {};
	afterEach(() => {
		for (const [k, v] of Object.entries(prev)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it('routes a licensed caller past a Hunyuan3D lane the probe reads down', () => {
		for (const k of ['GCP_HUNYUAN3D_URL', 'GCP_RECONSTRUCTION_KEY', 'HF_TOKEN', 'MODEL_TRELLIS2_URL', 'MODEL_TRELLIS_URL']) {
			prev[k] = process.env[k];
		}
		process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		process.env.HF_TOKEN = 'hf_test';
		delete process.env.MODEL_TRELLIS2_URL;
		delete process.env.MODEL_TRELLIS_URL;
		const picked = resolveBackendIdWithHealth({
			path: 'image',
			tier: { id: 'standard' },
			userImages: true,
			health: { hunyuan3d: 'down' },
			country: 'US',
		});
		expect(picked).not.toBe('hunyuan3d');
	});
});
