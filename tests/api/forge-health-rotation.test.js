// /api/forge?health=1 states, per platform lane, whether the router will use
// it: in rotation, cooling after a recent failure, or disabled (no env).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { probeForgeHealth, resetForgeHealthCache } from '../../api/_lib/forge-health.js';
import { markLaneUnhealthy } from '../../api/_lib/forge-lane-health.js';
import { clearProviderCooldown } from '../../api/_lib/provider-health.js';
import { laneCooldownKey } from '../../api/_lib/forge-lane-health.js';

const ENV = ['GCP_HUNYUAN3D_URL', 'GCP_RECONSTRUCTION_KEY', 'NVIDIA_API_KEY', 'HF_TOKEN', 'REPLICATE_API_TOKEN', 'OPENAI_API_KEY'];
const saved = {};
let savedFetch;

beforeEach(() => {
	for (const v of ENV) {
		saved[v] = process.env[v];
		delete process.env[v];
	}
	savedFetch = global.fetch;
	global.fetch = vi.fn(async (url) => {
		if (String(url).includes('world.three.ws')) {
			return new Response(JSON.stringify({ protected: true, blueprints: [] }), { status: 200 });
		}
		return new Response('{}', { status: 200 });
	});
	resetForgeHealthCache();
});

afterEach(async () => {
	for (const v of ENV) {
		if (saved[v] === undefined) delete process.env[v];
		else process.env[v] = saved[v];
	}
	global.fetch = savedFetch;
	await clearProviderCooldown(laneCooldownKey('hunyuan3d'));
	resetForgeHealthCache();
});

describe('forge health: lane rotation state', () => {
	it('marks a lane with no env as disabled and says why', async () => {
		const health = await probeForgeHealth({ force: true });
		expect(health.backends.hunyuan3d.rotation).toBe('disabled');
		expect(health.backends.hunyuan3d.rotation_reason).toMatch(/not set|environment/i);
	});

	it('marks a lane that just failed as cooling, and a configured idle lane as in rotation', async () => {
		process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan3d.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'k';
		let health = await probeForgeHealth({ force: true });
		expect(health.backends.hunyuan3d.rotation).toBe('in_rotation');

		await markLaneUnhealthy('hunyuan3d');
		resetForgeHealthCache();
		health = await probeForgeHealth({ force: true });
		expect(health.backends.hunyuan3d.rotation).toBe('cooling');
		expect(health.backends.hunyuan3d.rotation_reason).toMatch(/recent failure/i);
	});

	it('never marks a BYOK lane as part of platform rotation', async () => {
		const health = await probeForgeHealth({ force: true });
		expect(health.backends.meshy.rotation).toBe('byok');
	});
});
