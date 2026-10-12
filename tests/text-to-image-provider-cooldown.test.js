/**
 * Root cause of the 2026-10-12 /api/3d/generate 502 storm: the Vertex image
 * lane (billing dunning hold, 403 on every call) and the two HF-routed
 * providers (fal-ai/nscale, 402 "no remaining credits") had no circuit
 * breaker, unlike NIM FLUX. Every single request re-paid the full timeout of
 * each known-dead lane before ever reaching keyless Pollinations, which often
 * blew the shared ladder budget and surfaced as a 502 instead of a served
 * image. This pins that an auth/billing fault (401/402/403) parks the lane
 * for AUTH_COOLDOWN_SECONDS so the next request skips straight past it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NVIDIA_API_KEY = 'nim-test-key';
process.env.HF_TOKEN = 'hf-token';
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
delete process.env.REPLICATE_API_TOKEN;
delete process.env.LIVEPEER_FEDERATION_ENABLED;
delete process.env.TEXT_TO_IMAGE_BUDGET_MS;
delete process.env.VERTEX_IMAGEN_FIRST;

vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));
vi.mock('../api/_lib/forge-scale.js', () => ({ reserveProviderRateSlot: async () => ({ ok: true, waitMs: 0 }), SCALE_LIMITS: {} }));
vi.mock('../api/_providers/livepeer.js', () => ({ livepeerFederationEnabled: () => false, livepeerTextToImage: async () => { throw new Error('unused'); } }));

const vertex = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../api/_mcp3d/vertex-imagen.js', () => ({
	isConfigured: () => true,
	generateImage: async () => {
		vertex.calls++;
		throw Object.assign(new Error('Vertex AI image generation returned 403: Lightning dunning decision is deny'), {
			providerStatus: 403,
		});
	},
}));

const persisted = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../api/_lib/image-persist.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		persistImageBytes: async () => { persisted.calls++; return `https://cdn.test/img-${persisted.calls}.png`; },
		persistImageBase64: async () => { persisted.calls++; return `https://cdn.test/img-${persisted.calls}.png`; },
	};
});

// Not mocking ../api/_lib/provider-health.js: the whole point of this test is
// to exercise the REAL cooldown read/write against the in-memory cache
// fallback (getRedis -> null), the same way tests/forge-reference-image-budget
// .test.js already does for the Vertex-budget regression.

const { textToImage, VERTEX_IMAGE_COOLDOWN_KEY } = await import('../api/_mcp3d/text-to-image.js');
const { clearProviderCooldown } = await import('../api/_lib/provider-health.js');

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const bytes = (b, type) => new Response(b, { status: 200, headers: { 'content-type': type } });

const lane = {};
const hits = [];
globalThis.fetch = vi.fn(async (url) => {
	const u = String(url);
	hits.push(u);
	if (u.includes('ai.api.nvidia.com')) return lane.nim();
	if (u.includes('router.huggingface.co/fal-ai')) return lane.fal();
	if (u.includes('router.huggingface.co/nscale')) return lane.nscale();
	if (u.includes('image.pollinations.ai')) return lane.pollinations();
	throw new Error(`unexpected fetch ${u}`);
});

beforeEach(async () => {
	hits.length = 0;
	vertex.calls = 0;
	persisted.calls = 0;
	lane.nim = () => json(502, { error: 'gateway' });
	lane.fal = () => json(402, { error: 'You have no remaining credits.' });
	lane.nscale = () => json(402, { error: 'You have no remaining credits.' });
	lane.pollinations = () => bytes(JPG, 'image/jpeg');
	// Each test starts with every breaker clear: these keys live in the real
	// (in-memory, since getRedis -> null) shared cache, so a cooldown one test
	// sets would otherwise leak into the next.
	await Promise.all([
		clearProviderCooldown(VERTEX_IMAGE_COOLDOWN_KEY),
		clearProviderCooldown('forge-hf-image-fal-ai'),
		clearProviderCooldown('forge-hf-image-nscale'),
	]);
});

describe('a billing-hold Vertex lane cools down after one auth fault', () => {
	it('tries Vertex once, then skips it on the next request while the cooldown holds', async () => {
		const first = await textToImage('a fox', { budgetMs: 20_000 });
		expect(first.model).toBe('pollinations/flux');
		expect(vertex.calls).toBe(1);

		const second = await textToImage('a fox', { budgetMs: 20_000 });
		expect(second.model).toBe('pollinations/flux');
		// Without the breaker this would be 2: the known-dead Vertex lane would be
		// re-dialed (and re-timed-out) on every single request.
		expect(vertex.calls).toBe(1);
	});
});

describe('an out-of-credit HF provider cools down after one 402, independently of its sibling', () => {
	it('tries fal-ai once, then skips it (not nscale) on the next request', async () => {
		lane.nscale = () => json(200, { data: [{ b64_json: Buffer.from(JPG).toString('base64') }] });

		const first = await textToImage('a fox', { budgetMs: 20_000 });
		expect(first.model).toBe('hf/nscale/flux-schnell');
		expect(hits.filter((u) => u.includes('fal-ai'))).toHaveLength(1);
		expect(hits.filter((u) => u.includes('nscale'))).toHaveLength(1);

		hits.length = 0;
		const second = await textToImage('a fox', { budgetMs: 20_000 });
		expect(second.model).toBe('hf/nscale/flux-schnell');
		// Without the breaker fal-ai would be re-dialed (and re-fail) every request.
		expect(hits.filter((u) => u.includes('fal-ai'))).toHaveLength(0);
		expect(hits.filter((u) => u.includes('nscale'))).toHaveLength(1);
	});
});
