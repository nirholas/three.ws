// A Hugging Face chain that fails because every Space is out of GPU quota will
// stay out of quota for hours, so one probe per five minutes is mostly wasted
// caller time. Quota exhaustion therefore pauses the lane for much longer than
// an ordinary failure, and a later short failure never shortens that pause.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRegenProvider } from '../../api/_providers/huggingface.js';
import {
	HF_LANE_COOLDOWN_SECONDS,
	HF_QUOTA_COOLDOWN_SECONDS,
	hfLaneCooling,
	markLaneUnhealthy,
	laneCooldownKey,
} from '../../api/_lib/forge-lane-health.js';
import { clearProviderCooldown, providerCooldownUntil } from '../../api/_lib/provider-health.js';

const ORIGINAL_FETCH = globalThis.fetch;
const saved = {};
const ENV = ['HF_TOKEN', 'HF_RECONSTRUCT_SPACES'];

// Emulates the Gradio queue API: POST /call/<api> hands back an event id, then
// GET /call/<api>/<id> streams either an error event or nothing useful.
function gradio(errorData) {
	return vi.fn(async (url, init = {}) => {
		if ((init.method || 'GET') === 'POST') {
			return new Response(JSON.stringify({ event_id: 'evt-1' }), { status: 200 });
		}
		return new Response(`event: error\ndata: ${errorData}\n\n`, {
			status: 200,
			headers: { 'content-type': 'text/event-stream' },
		});
	});
}

beforeEach(async () => {
	for (const k of ENV) saved[k] = process.env[k];
	process.env.HF_TOKEN = 'hf_test';
	process.env.HF_RECONSTRUCT_SPACES = 'tencent/Hunyuan3D-2.1:generation_all,tencent/Hunyuan3D-2:generation_all';
	await clearProviderCooldown(laneCooldownKey('huggingface'));
});
afterEach(async () => {
	for (const k of ENV) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
	await clearProviderCooldown(laneCooldownKey('huggingface'));
});

const submit = () =>
	createRegenProvider().submit({
		mode: 'reconstruct',
		sourceUrl: 'https://cdn.example/a.png',
		params: { images: ['https://cdn.example/a.png'] },
	});

describe('Hugging Face quota exhaustion cools the lane long', () => {
	it('uses a window well beyond the ordinary chain-failure pause', () => {
		expect(HF_QUOTA_COOLDOWN_SECONDS).toBeGreaterThanOrEqual(HF_LANE_COOLDOWN_SECONDS * 4);
	});

	it('flags the failure and pauses the lane for the quota window when every Space is out of quota', async () => {
		globalThis.fetch = gradio('null');
		const err = await submit().catch((e) => e);
		expect(err.code).toBe('all_providers_failed');
		expect(err.quotaExhausted).toBe(true);
		expect(await hfLaneCooling()).toBe(true);
		const until = await providerCooldownUntil(laneCooldownKey('huggingface'));
		const remaining = (until - Date.now()) / 1000;
		expect(remaining).toBeGreaterThan(HF_LANE_COOLDOWN_SECONDS * 2);
		expect(remaining).toBeLessThanOrEqual(HF_QUOTA_COOLDOWN_SECONDS);
	});

	it('does not flag or pause for a failure that is not quota', async () => {
		globalThis.fetch = gradio('"CUDA out of memory"');
		const err = await submit().catch((e) => e);
		expect(err.code).toBe('all_providers_failed');
		expect(err.quotaExhausted).toBeFalsy();
		expect(await hfLaneCooling()).toBe(false);
	});
});

describe('markLaneUnhealthy never shortens a standing pause', () => {
	it('keeps the longer window when a shorter failure lands after it', async () => {
		await markLaneUnhealthy('huggingface', HF_QUOTA_COOLDOWN_SECONDS);
		const before = await providerCooldownUntil(laneCooldownKey('huggingface'));
		await markLaneUnhealthy('huggingface', HF_LANE_COOLDOWN_SECONDS);
		const after = await providerCooldownUntil(laneCooldownKey('huggingface'));
		expect(after).toBeGreaterThanOrEqual(before);
	});

	it('still extends a pause when the new window is longer', async () => {
		await markLaneUnhealthy('huggingface', 60);
		const before = await providerCooldownUntil(laneCooldownKey('huggingface'));
		await markLaneUnhealthy('huggingface', 600);
		const after = await providerCooldownUntil(laneCooldownKey('huggingface'));
		expect(after).toBeGreaterThan(before);
	});
});
