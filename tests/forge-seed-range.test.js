// One seed, every engine it can reach.
//
// 2026-11-26: the Forge page sent a uint32 seed above 2147483647, the keyless
// image rung rejected it with a 400, and the rejection spent the only free slot.
// That one rung was fixed (commit b41786cd6). This file holds the whole chain to
// the same standard:
//   1. the API boundary accepts exactly the documented range (0..4294967295,
//      as a number or a digit string) and answers every other present value
//      with an error that names the range, instead of clamping it;
//   2. two different seeds can never share a cache key, even when an engine
//      folds them onto the same provider value;
//   3. every engine that is not protected receives a seed inside its own
//      accepted range, captured at the network boundary;
//   4. the protected self-hosted TRELLIS lane receives exactly what it received
//      before for a seed that already worked.
// The accepted range of each engine is documented in api/_lib/forge-seed.js.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetImageRungBreakers } from '../api/_lib/image-rung-breaker.js';

process.env.NVIDIA_API_KEY = 'nim-key';
process.env.HF_TOKEN = 'hf-token';
process.env.GCP_RECONSTRUCTION_KEY = 'test-bearer-key';
process.env.MODEL_TRELLIS_URL = 'https://trellis.worker.test';
process.env.MODEL_TRELLIS2_URL = 'https://trellis2.worker.test';
process.env.MODEL_PIXAL3D_URL = 'https://pixal3d.worker.test';
process.env.MODEL_ANIGEN_URL = 'https://anigen.worker.test';
process.env.MODEL_PARTCRAFTER_URL = 'https://partcrafter.worker.test';
process.env.MODEL_MODLY_URL = 'https://modly.worker.test';
process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan.worker.test';
process.env.GCP_TRIPOSG_URL = 'https://triposg.worker.test';
process.env.LIVEPEER_GATEWAY_URL = 'https://livepeer.gateway.test';
process.env.HF_RECONSTRUCT_SPACES = 'tencent/Hunyuan3D-2';
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.REPLICATE_API_TOKEN;
delete process.env.LIVEPEER_FEDERATION_ENABLED;
delete process.env.TEXT_TO_IMAGE_BUDGET_MS;

vi.mock('../api/_lib/provider-health.js', () => ({ providersInCooldown: async () => new Set(), markProviderCooldown: async () => {} }));
vi.mock('../api/_lib/forge-scale.js', () => ({ reserveProviderRateSlot: async () => ({ ok: true, waitMs: 0 }), SCALE_LIMITS: {} }));
vi.mock('../api/_lib/image-persist.js', async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, persistImageBytes: async () => 'https://cdn.test/img.png', persistImageBase64: async () => 'https://cdn.test/img.png' };
});
vi.mock('../api/_lib/r2.js', async (importOriginal) => ({
	...(await importOriginal()),
	putObject: async () => ({}),
}));

const { normalizeForgeOptions } = await import('../api/_lib/forge-options.js');
const { forgeResultCacheKey } = await import('../api/_lib/forge-cache.js');
const { SEED_MAX, POLLINATIONS_SEED_MAX, HUNYUAN_SPACE_SEED_MAX } = await import('../api/_lib/forge-seed.js');
const { textToImage } = await import('../api/_mcp3d/text-to-image.js');
const { livepeerTextToImage } = await import('../api/_providers/livepeer.js');
const { createNvidiaProvider } = await import('../api/_providers/nvidia.js');
const { createRegenProvider: createHfProvider } = await import('../api/_providers/huggingface.js');
const { createRegenProvider: createGcpProvider } = await import('../api/_providers/gcp.js');

const RANGE_MESSAGE = /0 to 4294967295/;

// Every value the order names, plus the junk a paste or a client can produce.
const BOUNDARY = [
	{ raw: 0, seed: 0 },
	{ raw: 1, seed: 1 },
	{ raw: 2_147_483_647, seed: 2_147_483_647 },
	{ raw: 2_147_483_648, seed: 2_147_483_648 },
	{ raw: 4_294_967_295, seed: 4_294_967_295 },
	{ raw: 4_294_967_296, error: true },
	{ raw: 9_999_999_999, error: true },
	{ raw: -1, error: true },
	{ raw: 1.5, error: true },
	{ raw: Number.NaN, error: true },
	{ raw: Number.POSITIVE_INFINITY, error: true },
	{ raw: '123', seed: 123 },
	{ raw: ' 42 ', seed: 42 },
	{ raw: '0007', seed: 7 },
	{ raw: '4294967295', seed: 4_294_967_295 },
	{ raw: '4294967296', error: true },
	{ raw: '9'.repeat(400), error: true },
	{ raw: '-5', error: true },
	{ raw: '1.5', error: true },
	{ raw: '1e3', error: true },
	{ raw: '0x10', error: true },
	{ raw: '12abc', error: true },
	{ raw: true, error: true },
	{ raw: [5], error: true },
	{ raw: { n: 5 }, error: true },
	{ raw: undefined, seed: null },
	{ raw: null, seed: null },
	{ raw: '', seed: null },
	{ raw: '   ', seed: null },
];

// Seeds that pass the boundary: what every consumer below must handle.
const ACCEPTED = [0, 1, 2_147_483_647, 2_147_483_648, 4_294_967_295, 10_000_000, 10_000_001, 2_882_449_376];

describe('API boundary: normalizeForgeOptions seed', () => {
	it.each(BOUNDARY)('seed $raw', ({ raw, seed, error }) => {
		const o = normalizeForgeOptions(raw === undefined ? {} : { seed: raw });
		if (error) {
			expect(o.seed).toBeNull();
			const e = o.errors.find((x) => x.field === 'seed');
			expect(e).toBeTruthy();
			expect(e.message).toMatch(RANGE_MESSAGE);
		} else {
			expect(o.errors.filter((x) => x.field === 'seed')).toEqual([]);
			expect(o.seed).toBe(seed);
		}
	});

	it('echoes the canonical seed it accepted, never a clamped one', () => {
		for (const s of ACCEPTED) expect(normalizeForgeOptions({ seed: s }).seed).toBe(s);
	});
});

describe('cache key: two different seeds never share one', () => {
	const key = (seed) =>
		forgeResultCacheKey({
			path: 'text',
			tier: 'standard',
			backend: 'trellis_selfhost',
			prompt: 'a brass robot',
			options: normalizeForgeOptions({ seed }),
		});

	it('distinct inputs that pass the boundary always give distinct keys', () => {
		const inputs = [
			...ACCEPTED,
			// Pairs an engine folds onto one provider value.
			123, 123 + POLLINATIONS_SEED_MAX + 1,
			456, 456 + HUNYUAN_SPACE_SEED_MAX + 1,
		];
		const keys = new Map();
		for (const s of inputs) {
			const k = key(s);
			if (keys.has(k)) expect(keys.get(k)).toBe(s);
			keys.set(k, s);
		}
		expect(new Set([...keys.values()]).size).toBe(new Set(inputs).size);
	});

	it('seeds above the range are refused rather than merged into one entry', () => {
		// Before 2026-11-26 both clamped to 4294967295 and shared a cache key.
		const a = normalizeForgeOptions({ seed: 4_294_967_296 });
		const b = normalizeForgeOptions({ seed: 4_294_967_297 });
		expect(a.errors[0]?.field).toBe('seed');
		expect(b.errors[0]?.field).toBe('seed');
	});

	it('the same seed always gives the same key (a re-run hits the cache)', () => {
		for (const s of ACCEPTED) expect(key(s)).toBe(key(s));
		expect(key('2882449376')).toBe(key(2_882_449_376));
	});
});

// ---- network boundary --------------------------------------------------------

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const json = (status, body, headers = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const bytes = (b, type) => new Response(b, { status: 200, headers: { 'content-type': type } });
const sse = (output) =>
	new Response(`event: complete\ndata: ${JSON.stringify(output)}\n\n`, {
		status: 200,
		headers: { 'content-type': 'text/event-stream' },
	});

const sent = [];
const ORIGINAL_FETCH = globalThis.fetch;
beforeEach(async () => {
	// Every rung starts with a closed breaker: the breaker keeps its state in
	// the shared cache, which outlives a single test.
	await resetImageRungBreakers();
	sent.length = 0;
	globalThis.fetch = vi.fn(async (url, init = {}) => {
		const u = String(url);
		const body = typeof init.body === 'string' ? init.body : null;
		sent.push({ url: u, body });
		if (u.includes('ai.api.nvidia.com/v1/genai/microsoft/trellis')) return json(202, {}, { 'nvcf-reqid': 'req-1' });
		if (u.includes('ai.api.nvidia.com')) return json(502, { error: 'gateway' });
		if (u.includes('router.huggingface.co')) return json(503, {});
		if (u.includes('image.pollinations.ai')) return bytes(PNG, 'image/png');
		if (u.includes('livepeer.gateway.test')) return json(200, { images: [{ url: 'https://livepeer.gateway.test/out.png', seed: 1 }] });
		if (u.includes('.hf.space/call/generation_all/')) return sse([{ url: 'https://files.test/out.glb' }]);
		if (u.includes('.hf.space/call/generation_all')) return json(200, { event_id: 'evt-1' });
		if (u.includes('.worker.test')) return json(200, { task_id: 't1', status: 'queued' });
		if (u.includes('files.test') || u.includes('example.test')) return bytes(PNG, 'image/png');
		return json(404, { error: `unrouted ${u}` });
	});
});
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
});

const bodiesTo = (needle) => sent.filter((r) => r.url.includes(needle) && r.body).map((r) => JSON.parse(r.body));

describe('image rungs receive a seed inside their range', () => {
	it.each(ACCEPTED)('seed %i: NIM FLUX gets none, fal and wavespeed get it as is, Pollinations gets it folded', async (seed) => {
		await textToImage('a fox', { budgetMs: 20_000, seed });
		for (const b of bodiesTo('ai.api.nvidia.com')) expect(b).not.toHaveProperty('seed');
		const fal = bodiesTo('router.huggingface.co/fal-ai');
		const wave = bodiesTo('router.huggingface.co/wavespeed');
		expect(fal.length).toBeGreaterThan(0);
		expect(wave.length).toBeGreaterThan(0);
		for (const b of [...fal, ...wave]) expect(b.seed).toBe(seed);
		const poll = sent.filter((r) => r.url.includes('image.pollinations.ai')).map((r) => Number(new URL(r.url).searchParams.get('seed')));
		expect(poll.length).toBeGreaterThan(0);
		for (const p of poll) {
			expect(Number.isInteger(p)).toBe(true);
			expect(p).toBeGreaterThanOrEqual(0);
			expect(p).toBeLessThanOrEqual(POLLINATIONS_SEED_MAX);
			expect(p).toBe(seed % (POLLINATIONS_SEED_MAX + 1));
		}
	});

	it.each(ACCEPTED)('seed %i: the AI Runner image gateway gets it as is', async (seed) => {
		await livepeerTextToImage('a fox', { seed }).catch(() => {});
		const [b] = bodiesTo('livepeer.gateway.test/text-to-image');
		expect(b.seed).toBe(seed);
	});
});

describe('3D lanes receive a seed inside their range', () => {
	it.each(ACCEPTED)('seed %i: NVIDIA TRELLIS NIM gets 1..4294967295 (0 means random there)', async (seed) => {
		await createNvidiaProvider().textTo3d({ prompt: 'a fox', tier: 'standard', seed }).catch(() => {});
		const [b] = bodiesTo('microsoft/trellis');
		expect(Number.isInteger(b.seed)).toBe(true);
		expect(b.seed).toBeGreaterThanOrEqual(1);
		expect(b.seed).toBeLessThanOrEqual(SEED_MAX);
		expect(b.seed).toBe(seed === 0 ? SEED_MAX : seed);
	});

	it('NVIDIA TRELLIS NIM: no seed sent when none was given', async () => {
		await createNvidiaProvider().textTo3d({ prompt: 'a fox', tier: 'standard' }).catch(() => {});
		const [b] = bodiesTo('microsoft/trellis');
		expect(b).not.toHaveProperty('seed');
	});

	it.each(ACCEPTED)('seed %i: Hunyuan3D-2 Space gets 0..10000000 with randomize_seed off', async (seed) => {
		await createHfProvider()
			.submit({ mode: 'reconstruct', sourceUrl: 'https://example.test/a.png', params: { images: ['https://example.test/a.png'], seed } })
			.catch(() => {});
		const [b] = bodiesTo('.hf.space/call/generation_all');
		const spaceSeed = b.data[8];
		const randomize = b.data[12];
		expect(Number.isInteger(spaceSeed)).toBe(true);
		expect(spaceSeed).toBeGreaterThanOrEqual(0);
		expect(spaceSeed).toBeLessThanOrEqual(HUNYUAN_SPACE_SEED_MAX);
		expect(spaceSeed).toBe(seed % (HUNYUAN_SPACE_SEED_MAX + 1));
		// A caller seed that the Space then re-randomizes is a seed thrown away.
		expect(randomize).toBe(false);
	});

	it('Hunyuan3D-2 Space: no seed keeps the Space defaults (1234, randomized)', async () => {
		await createHfProvider()
			.submit({ mode: 'reconstruct', sourceUrl: 'https://example.test/a.png', params: { images: ['https://example.test/a.png'] } })
			.catch(() => {});
		const [b] = bodiesTo('.hf.space/call/generation_all');
		expect(b.data[8]).toBe(1234);
		expect(b.data[12]).toBe(true);
	});

	const GPU_LANES = [
		{ mode: 'trellis2', host: 'trellis2.worker.test' },
		{ mode: 'pixal3d', host: 'pixal3d.worker.test' },
		{ mode: 'anigen', host: 'anigen.worker.test' },
		{ mode: 'partcrafter', host: 'partcrafter.worker.test' },
		{ mode: 'modly', host: 'modly.worker.test' },
		{ mode: 'hunyuan', host: 'hunyuan.worker.test' },
		// TripoSG: the sketch lane, and its photo pipeline (the last photo rung).
		{ mode: 'sketch', host: 'triposg.worker.test' },
		{ mode: 'triposg', host: 'triposg.worker.test' },
	];
	const GPU_CASES = GPU_LANES.flatMap((l) => ACCEPTED.map((seed) => ({ ...l, seed })));

	it.each(GPU_CASES)('$mode seed $seed: self-hosted worker gets the canonical uint32 seed', async ({ mode, host, seed }) => {
		await createGcpProvider()
			.submit({ mode, sourceUrl: 'https://example.test/a.png', params: { images: ['https://example.test/a.png'], seed, tier: 'standard' } })
			.catch(() => {});
		const [b] = bodiesTo(host);
		expect(b.seed).toBe(seed);
		expect(b.seed).toBeLessThanOrEqual(SEED_MAX);
	});
});

describe('protected lane: self-hosted TRELLIS (trellis_selfhost)', () => {
	// Pinned 2026-11-26 from the request the lane served at 95.2% success. The
	// body for a seed that already worked must stay byte-identical.
	const quality = { ss_steps: 25, slat_steps: 25, simplify: 0.95, texture_size: 1024 };

	it.each([12_345, 0, 2_147_483_647])('seed %i reaches the worker byte-identical', async (seed) => {
		await createGcpProvider()
			.submit({ mode: 'trellis', sourceUrl: 'https://example.test/a.png', params: { images: ['https://example.test/a.png'], seed, quality } })
			.catch(() => {});
		const [raw] = sent.filter((r) => r.url.includes('trellis.worker.test') && r.body).map((r) => r.body);
		expect(raw).toBe(
			JSON.stringify({ images: ['https://example.test/a.png'], body_type: 'neutral', quality, seed }),
		);
	});

	it.each([2_147_483_648, 4_294_967_295])('seed %i (upper uint32) reaches it unchanged, inside torch.manual_seed range', async (seed) => {
		await createGcpProvider()
			.submit({ mode: 'trellis', sourceUrl: 'https://example.test/a.png', params: { images: ['https://example.test/a.png'], seed, quality } })
			.catch(() => {});
		const [b] = bodiesTo('trellis.worker.test');
		expect(b.seed).toBe(seed);
	});

	it('a seed above uint32 can no longer reach it: the API boundary refuses it', () => {
		expect(normalizeForgeOptions({ seed: 4_294_967_296 }).seed).toBeNull();
	});
});
