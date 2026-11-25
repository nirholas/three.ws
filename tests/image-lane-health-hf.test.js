/**
 * The HF lane of imageLaneHealth (api/_lib/ai-image-lanes.js) read `ok`
 * whenever the token passed whoami, and listed its providers as a hardcoded
 * ['fal-ai', 'nscale']. On 2026-11-25 both were false at once: every
 * Inference Providers call answered 402 "Purchase pre-paid credits", and the
 * router refused /nscale/... outright with 400 "Direct requests to /nscale are
 * no longer supported". Health stayed green over a lane that could not serve.
 *
 * The probe now asks each rung the forge actually calls. The router checks
 * credit and route before it validates a body, so an empty POST costs nothing
 * and answers the two questions that matter: is there credit, and does the
 * route still exist. It also reads HF's provider mapping for FLUX.1-schnell so
 * a provider HF dropped is named even before a request fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.HF_TOKEN = 'hf-token';
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.NVIDIA_API_KEY;
delete process.env.REPLICATE_API_TOKEN;

vi.mock('../api/_lib/provider-health.js', () => ({
	providersInCooldown: async () => new Set(),
	markProviderCooldown: async () => {},
	AUTH_COOLDOWN_SECONDS: 300,
}));

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hf = {};
const calls = [];
globalThis.fetch = vi.fn(async (url, init = {}) => {
	const u = String(url);
	calls.push({ url: u, init });
	if (u.includes('huggingface.co/api/whoami')) return json(200, { name: 'three-ws' });
	if (u.includes('huggingface.co/api/models/black-forest-labs/FLUX.1-schnell')) return hf.mapping();
	if (u.startsWith('https://router.huggingface.co/fal-ai/')) return hf.fal();
	if (u.startsWith('https://router.huggingface.co/wavespeed/')) return hf.wavespeed();
	if (u.includes('pollinations')) return new Response(null, { status: 200 });
	throw new Error(`unexpected fetch ${u}`);
});

const { imageLaneHealth } = await import('../api/_lib/ai-image-lanes.js');
const { HF_IMAGE_PROVIDERS } = await import('../api/_mcp3d/text-to-image.js');

const CREDITS_402 = { error: 'Purchase pre-paid credits to continue using Inference Providers. Alternatively, subscribe to PRO to get monthly included credits.' };
const LIVE_MAPPING = {
	inferenceProviderMapping: {
		'fal-ai': { status: 'live', providerId: 'fal-ai/flux/schnell', task: 'text-to-image' },
		wavespeed: { status: 'live', providerId: 'wavespeed-ai/flux-schnell', task: 'text-to-image' },
	},
};

beforeEach(() => {
	calls.length = 0;
	hf.mapping = () => json(200, LIVE_MAPPING);
	// With credit, the empty body reaches the provider and is refused as invalid.
	hf.fal = () => json(422, { detail: [{ loc: ['body', 'prompt'], msg: 'field required' }] });
	hf.wavespeed = () => json(400, { code: 400, message: 'prompt is required' });
});

describe('HF image lane health', () => {
	it('lists the providers the forge actually calls, each reachable', async () => {
		const { lanes } = await imageLaneHealth();
		expect(lanes.hf.status).toBe('ok');
		expect(lanes.hf.providers.map((p) => p.id)).toEqual(HF_IMAGE_PROVIDERS.map((p) => p.id));
		expect(lanes.hf.providers.every((p) => p.status === 'ok')).toBe(true);
	});

	it('is down, naming the credit problem, when every provider answers 402', async () => {
		hf.fal = () => json(402, CREDITS_402);
		hf.wavespeed = () => json(402, CREDITS_402);
		const { lanes } = await imageLaneHealth();
		expect(lanes.hf.status).toBe('down');
		expect(lanes.hf.detail).toMatch(/pre-paid credits/);
	});

	it('names a provider HF no longer maps, and stays ok while a sibling serves', async () => {
		hf.mapping = () => json(200, { inferenceProviderMapping: { 'fal-ai': LIVE_MAPPING.inferenceProviderMapping['fal-ai'] } });
		hf.wavespeed = () => json(400, { error: 'Direct requests to /wavespeed are no longer supported. Use /v1/chat/completions for chat models.' });
		const { lanes } = await imageLaneHealth();
		expect(lanes.hf.status).toBe('ok');
		const ws = lanes.hf.providers.find((p) => p.id === 'wavespeed');
		expect(ws.status).toBe('down');
		expect(ws.mapped).toBe(false);
		expect(ws.detail).toMatch(/no longer supported/);
	});

	it('sends the probe body empty so it can never generate (and bill) an image', async () => {
		await imageLaneHealth();
		const posts = calls.filter((c) => c.url.startsWith('https://router.huggingface.co/'));
		expect(posts.length).toBe(HF_IMAGE_PROVIDERS.length);
		for (const p of posts) {
			expect(p.init.method).toBe('POST');
			expect(p.init.body).toBe('{}');
		}
	});
});
