// laneAfterHfFailure: where an auto-routed forge request goes after the free
// HuggingFace Spaces lane could not serve it.
//
// Production 2026-09-18: forge_avatar answered "Could not generate the model"
// because the health-aware router picked HuggingFace (every self-host lane read
// 'down': Hunyuan3D in a 90 s cooldown after one failed job, self-host TRELLIS
// with a failed model load), the Spaces were GPU-quota-dead, and the HF branch
// returned a 502 with no failover while our own Hunyuan3D worker was healthy.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { laneAfterHfFailure } from '../../api/_lib/forge-tiers.js';

const ENV = ['GCP_HUNYUAN3D_URL', 'GCP_RECONSTRUCTION_KEY', 'NVIDIA_API_KEY'];

describe('laneAfterHfFailure', () => {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
		for (const k of ENV) delete process.env[k];
	});
	afterEach(() => {
		for (const k of ENV) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it('fails over to the self-hosted Hunyuan3D worker when it is configured', () => {
		process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'k';
		process.env.NVIDIA_API_KEY = 'nv';
		expect(laneAfterHfFailure({country: 'US' })).toBe('hunyuan3d');
		expect(laneAfterHfFailure({ userImages: true, country: 'US' })).toBe('hunyuan3d');
	});

	it('sends a text prompt to the free NVIDIA lane when no self-host worker is wired', () => {
		process.env.NVIDIA_API_KEY = 'nv';
		expect(laneAfterHfFailure({ userImages: false, country: 'US' })).toBe('nvidia');
	});

	it('never sends a photo to the text-only NVIDIA lane', () => {
		process.env.NVIDIA_API_KEY = 'nv';
		expect(laneAfterHfFailure({ userImages: true, country: 'US' })).toBeNull();
	});

	it('keeps an explicitly chosen HuggingFace engine on its designed busy state', () => {
		process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'k';
		expect(laneAfterHfFailure({ explicit: true, country: 'US' })).toBeNull();
	});

	it('has nowhere to go when nothing else is configured', () => {
		expect(laneAfterHfFailure({country: 'US' })).toBeNull();
	});
});
