/**
 * The second Hugging Face rung of the concept-image ladder went dead on the
 * router side: every request to router.huggingface.co/nscale/... now answers
 * 400 "Direct requests to /nscale are no longer supported", and HF no longer
 * maps FLUX.1-schnell to nscale at all (probed 2026-11-25; the live mappings
 * are fal-ai and wavespeed). The old fallbacks test mocked the retired nscale
 * protocol, so it kept passing while production paid a dead round trip on
 * every image that fal-ai could not serve.
 *
 * The fetch mock below answers the way the real router does today, including
 * WaveSpeed's submit-then-poll task protocol (mirrored from HF's own client,
 * huggingface.js packages/inference/src/providers/wavespeed.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NVIDIA_API_KEY = 'nim-key';
process.env.HF_TOKEN = 'hf-token';
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.REPLICATE_API_TOKEN;
delete process.env.LIVEPEER_FEDERATION_ENABLED;
delete process.env.TEXT_TO_IMAGE_BUDGET_MS;

vi.mock('../api/_lib/provider-health.js', () => ({ providersInCooldown: async () => new Set(), markProviderCooldown: async () => {}, AUTH_COOLDOWN_SECONDS: 300 }));
vi.mock('../api/_lib/forge-scale.js', () => ({ reserveProviderRateSlot: async () => ({ ok: true, waitMs: 0 }), SCALE_LIMITS: {} }));
vi.mock('../api/_providers/livepeer.js', () => ({ livepeerFederationEnabled: () => false, livepeerTextToImage: async () => { throw new Error('unused'); } }));
vi.mock('../api/_lib/image-persist.js', async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, persistImageBytes: async () => 'https://cdn.test/img.png', persistImageBase64: async () => 'https://cdn.test/img.png' };
});

const { textToImage, HF_IMAGE_PROVIDERS } = await import('../api/_mcp3d/text-to-image.js');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const bytes = (b, type) => new Response(b, { status: 200, headers: { 'content-type': type } });

const ROUTER = 'https://router.huggingface.co';
const OUTPUT_URL = 'https://d1q70pf5vjeyhc.cloudfront.net/predictions/t1/0.png';
const calls = [];
const state = {};

globalThis.fetch = vi.fn(async (url, init = {}) => {
	const u = String(url);
	calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
	if (u.includes('ai.api.nvidia.com')) return json(502, { error: 'gateway' });
	if (u.startsWith(`${ROUTER}/fal-ai/`)) {
		return json(402, { error: 'Purchase pre-paid credits to continue using Inference Providers.' });
	}
	// The router has refused provider-prefixed nscale paths since late 2026.
	if (u.startsWith(`${ROUTER}/nscale/`)) {
		return json(400, { error: 'Direct requests to /nscale are no longer supported. Use /v1/chat/completions for chat models.' });
	}
	if (u === `${ROUTER}/wavespeed/api/v3/wavespeed-ai/flux-schnell` && init.method === 'POST') {
		return json(200, {
			code: 200,
			message: 'success',
			data: { id: 't1', urls: { get: 'https://api.wavespeed.ai/api/v3/predictions/t1/result' }, status: 'created' },
		});
	}
	if (u === `${ROUTER}/wavespeed/api/v3/predictions/t1/result`) {
		state.polls = (state.polls || 0) + 1;
		return json(200, { code: 200, message: 'success', data: state.result(state.polls) });
	}
	if (u.startsWith('https://api.wavespeed.ai/')) throw new Error('polled WaveSpeed directly instead of through the HF router');
	if (u === OUTPUT_URL) return bytes(PNG, 'image/png');
	if (u.includes('image.pollinations.ai')) return bytes(JPG, 'image/jpeg');
	throw new Error(`unexpected fetch ${u}`);
});

beforeEach(() => {
	calls.length = 0;
	state.polls = 0;
	state.result = (n) => (n < 2 ? { id: 't1', status: 'processing', outputs: [] } : { id: 't1', status: 'completed', outputs: [OUTPUT_URL] });
});

describe('Hugging Face router image rungs', () => {
	it('only target providers HF still maps FLUX.1-schnell to', () => {
		const live = new Set(['fal-ai', 'wavespeed']);
		expect(HF_IMAGE_PROVIDERS.map((p) => p.id).filter((id) => !live.has(id))).toEqual([]);
	});

	it('serve the image from the second HF rung when fal-ai is out of credit', async () => {
		const out = await textToImage('a fox', { budgetMs: 20_000 });
		expect(out.model).toBe('hf/wavespeed/flux-schnell');
		expect(out.imageUrl).toBe('https://cdn.test/img.png');
		expect(calls.some((c) => c.url.includes('/nscale/'))).toBe(false);
		expect(calls.some((c) => c.url.includes('pollinations'))).toBe(false);
	});

	it('submit a WaveSpeed task with its own size format and poll it through the router with the HF token', async () => {
		await textToImage('a fox', { budgetMs: 20_000, aspectRatio: '1:1', seed: 7 });
		const submit = calls.find((c) => c.method === 'POST' && c.url.includes('/wavespeed/'));
		const body = JSON.parse(submit.body);
		expect(body.prompt).toContain('fox');
		expect(body.size).toMatch(/^\d+\*\d+$/);
		expect(body.seed).toBe(7);
		const polls = calls.filter((c) => c.url.endsWith('/predictions/t1/result'));
		expect(polls.length).toBe(2);
		for (const p of polls) expect(p.headers.authorization).toBe('Bearer hf-token');
	});

	it('fall through to the next lane when the WaveSpeed task fails', async () => {
		state.result = () => ({ id: 't1', status: 'failed', error: 'nsfw content detected', outputs: [] });
		const out = await textToImage('a fox', { budgetMs: 20_000 });
		expect(out.model).toBe('pollinations/flux');
	});
});
