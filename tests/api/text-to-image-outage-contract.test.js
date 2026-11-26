/**
 * The outage contract of the text-to-image ladder (api/_mcp3d/text-to-image.js).
 *
 * On 2026-11-26 five of the six rungs were dead at once: Vertex answered 403
 * (billing hold), both Hugging Face providers 402 (credits exhausted), NVIDIA
 * FLUX hung to its timeout, Replicate had no token. Only the keyless rung
 * served. These tests pin, at the network boundary, how each rung must fail:
 * cheaply (a known-dead rung costs the next request nothing), correctly (the
 * ladder always falls through to the keyless rung) and recoverably (one probe
 * after the cooldown, a success closes the breaker).
 *
 * The breaker is real (api/_lib/image-rung-breaker.js over the in-memory cache
 * and the real provider-health module). Only the network, the Vertex client,
 * object storage, the Replicate rate gate and the Livepeer lane are stood in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const vertexState = vi.hoisted(() => ({ configured: false, generate: null }));
vi.mock('../../api/_mcp3d/vertex-imagen.js', () => ({
	isConfigured: () => vertexState.configured,
	generateImage: (...a) => vertexState.generate(...a),
}));
vi.mock('../../api/_lib/forge-scale.js', () => ({
	reserveProviderRateSlot: async () => ({ ok: true, waitMs: 0 }),
	SCALE_LIMITS: {},
}));
const livepeer = vi.hoisted(() => ({ enabled: false, run: null }));
vi.mock('../../api/_providers/livepeer.js', () => ({
	livepeerFederationEnabled: () => livepeer.enabled,
	livepeerTextToImage: (...a) => livepeer.run(...a),
}));
const persisted = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../api/_lib/image-persist.js', async (importOriginal) => {
	const real = await importOriginal();
	const store = async () => `https://cdn.test/img-${++persisted.calls}.png`;
	return { ...real, persistImageBytes: store, persistImageBase64: store };
});

const { textToImage, laneTimeoutMs, keylessReserveMs, ladderBudgetMs } = await import('../../api/_mcp3d/text-to-image.js');
const breaker = await import('../../api/_lib/image-rung-breaker.js');
const { resetImageRungBreakers, describeImageLadder, imageLadderRungs, IMAGE_RUNG_KEYS, LONG_COOLDOWN_SECONDS, SHORT_COOLDOWN_SECONDS } = breaker;
const { providersInCooldown } = await import('../../api/_lib/provider-health.js');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const json = (status, body, headers = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const bytes = (b, type) => new Response(b, { status: 200, headers: { 'content-type': type } });
const nimOk = () => json(200, { artifacts: [{ base64: Buffer.from(JPG).toString('base64'), finishReason: 'SUCCESS' }] });
// A request the provider accepts and never answers: settles only when the
// lane's own deadline aborts it, exactly like the NVIDIA gateway on 2026-11-26.
const hang = (init) =>
	new Promise((_, reject) => {
		const signal = init?.signal;
		const fail = () => reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }));
		if (signal?.aborted) return fail();
		signal?.addEventListener('abort', fail, { once: true });
	});

const ENV = ['NVIDIA_API_KEY', 'HF_TOKEN', 'GOOGLE_CLOUD_PROJECT', 'REPLICATE_API_TOKEN', 'VERTEX_IMAGEN_FIRST', 'VERTEX_IMAGEN_ENABLED', 'LIVEPEER_FEDERATION_ENABLED', 'TEXT_TO_IMAGE_BUDGET_MS'];
const ORIGINAL_ENV = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const ORIGINAL_FETCH = globalThis.fetch;

// Per-test behavior by host, and every host the ladder touched.
const lane = {};
let hits = [];
const hitsOn = (host) => hits.filter((u) => u.includes(host)).length;

function routeFetch() {
	globalThis.fetch = vi.fn(async (url, init) => {
		const u = String(url);
		hits.push(u);
		if (u.includes('ai.api.nvidia.com')) return lane.nim(init);
		if (u.includes('router.huggingface.co/fal-ai')) return lane.fal(init);
		if (u.includes('fal.media')) return lane.falImage(init);
		if (u.includes('router.huggingface.co/wavespeed')) return lane.wavespeed(init);
		if (u.includes('image.pollinations.ai')) return lane.pollinations(init);
		if (u.includes('api.replicate.com')) return lane.replicate(init);
		throw new Error(`unexpected fetch ${u}`);
	});
}

function vertexFails(err) {
	vertexState.configured = true;
	process.env.GOOGLE_CLOUD_PROJECT = 'demo-project';
	vertexState.generate = vi.fn(async () => {
		throw err;
	});
}

const billingHold = () =>
	Object.assign(new Error('This API method requires billing to be enabled. issues with your billing account'), { providerStatus: 403 });

beforeEach(async () => {
	for (const k of ENV) delete process.env[k];
	vertexState.configured = false;
	vertexState.generate = vi.fn(async () => {
		throw new Error('vertex must not be called in this test');
	});
	livepeer.enabled = false;
	livepeer.run = null;
	persisted.calls = 0;
	hits = [];
	lane.nim = () => json(502, { error: 'gateway' });
	lane.fal = () => json(503, {});
	lane.falImage = () => bytes(JPG, 'image/jpeg');
	lane.wavespeed = () => json(503, {});
	lane.pollinations = () => bytes(JPG, 'image/jpeg');
	lane.replicate = () => json(201, { id: 'pred', status: 'succeeded', output: ['https://replicate.delivery/out.png'] });
	routeFetch();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
	await resetImageRungBreakers();
});

afterEach(async () => {
	vi.useRealTimers();
	globalThis.fetch = ORIGINAL_FETCH;
	for (const k of ENV) {
		if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
		else process.env[k] = ORIGINAL_ENV[k];
	}
	vi.restoreAllMocks();
	await resetImageRungBreakers();
});

// Freeze the wall clock so a cooldown's edge can be stepped over exactly.
// Only Date is faked: the lanes' own abort timers stay real.
function freezeClock() {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
}
const advance = (seconds) => vi.setSystemTime(Date.now() + seconds * 1000);

describe('a billing or credits refusal opens a long cooldown and costs the next requests nothing', () => {
	it('Vertex 403 (billing hold): parked for the long cooldown, the keyless rung serves, the next request never calls Vertex', async () => {
		freezeClock();
		vertexFails(billingHold());
		const first = await textToImage('a fox', { budgetMs: 20_000 });
		expect(first.model).toBe('pollinations/flux');
		expect(vertexState.generate).toHaveBeenCalledTimes(1);

		advance(LONG_COOLDOWN_SECONDS - 1);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(vertexState.generate).toHaveBeenCalledTimes(1);

		advance(2);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(vertexState.generate).toHaveBeenCalledTimes(2);
	});

	it('NIM 403: parked for the long cooldown, not the short one', async () => {
		freezeClock();
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		lane.nim = () => json(403, { detail: 'Authorization failed' });
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(1);

		advance(SHORT_COOLDOWN_SECONDS + 5);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(1);

		advance(LONG_COOLDOWN_SECONDS);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(2);
	});

	it('HF 402 (pre-paid credits exhausted): each provider parked for the long cooldown', async () => {
		freezeClock();
		process.env.HF_TOKEN = 'hf-test';
		lane.fal = () => json(402, { error: 'You have exceeded your monthly included credits. Purchase pre-paid credits.' });
		lane.wavespeed = () => json(402, { error: 'Purchase pre-paid credits.' });
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('huggingface')).toBe(2);

		advance(LONG_COOLDOWN_SECONDS - 1);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('huggingface')).toBe(2);
	});

	it('writes the legacy cooldown too, so the reference-image module skips Vertex as well', async () => {
		vertexFails(billingHold());
		await textToImage('a fox', { budgetMs: 20_000 });
		const cooling = await providersInCooldown([IMAGE_RUNG_KEYS.vertex]);
		expect(cooling.get(IMAGE_RUNG_KEYS.vertex)).toBe('auth');
	});
});

describe('a stated wait is honored exactly', () => {
	it('HF 429 with Retry-After 20: skipped at 19 s, tried again at 21 s', async () => {
		freezeClock();
		process.env.HF_TOKEN = 'hf-test';
		lane.fal = () => json(429, { error: 'rate limited' }, { 'retry-after': '20' });
		lane.wavespeed = () => json(400, { error: 'bad size' });
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('router.huggingface.co/fal-ai')).toBe(1);

		advance(19);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('router.huggingface.co/fal-ai')).toBe(1);

		advance(2);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('router.huggingface.co/fal-ai')).toBe(2);
	});

	it('NIM 429 with Retry-After as an HTTP date is honored to the second', async () => {
		freezeClock();
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		const at = new Date(Date.now() + 30_000).toUTCString();
		lane.nim = () => json(429, { detail: 'Too Many Requests' }, { 'retry-after': at });
		await textToImage('a fox', { budgetMs: 20_000 });
		advance(29);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(1);
		advance(2);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(2);
	});

	it('a 429 with no stated wait opens the short cooldown', async () => {
		freezeClock();
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		lane.nim = () => json(429, { detail: 'Too Many Requests' });
		await textToImage('a fox', { budgetMs: 20_000 });
		advance(SHORT_COOLDOWN_SECONDS - 1);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(1);
		advance(2);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(2);
	});

	it('the keyless rung: a 402 FREE_LIMIT with Retry-After 45 is not retried for 45 s, and the wait is counted down, not restarted', async () => {
		freezeClock();
		lane.pollinations = () =>
			json(402, { error: { code: 'FREE_LIMIT', message: 'Free limit reached: 1 image every 45 seconds per IP' } }, { 'retry-after': '45' });
		await expect(textToImage('a fox', { budgetMs: 20_000 })).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 45 });
		expect(hitsOn('pollinations')).toBe(1);

		advance(10);
		await expect(textToImage('a fox', { budgetMs: 20_000 })).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 35, queued: true });
		expect(hitsOn('pollinations')).toBe(1);

		advance(36);
		lane.pollinations = () => bytes(JPG, 'image/jpeg');
		const served = await textToImage('a fox', { budgetMs: 20_000 });
		expect(served.model).toBe('pollinations/flux');
		expect(hitsOn('pollinations')).toBe(2);
	});

	it('the keyless rung is never parked on a guess: a 500 there leaves it open for the next request', async () => {
		lane.pollinations = () => json(500, { error: 'upstream' });
		await expect(textToImage('a fox', { budgetMs: 20_000 })).rejects.toThrow(/pollinations returned 500/);
		lane.pollinations = () => bytes(JPG, 'image/jpeg');
		expect((await textToImage('a fox', { budgetMs: 20_000 })).model).toBe('pollinations/flux');
	});
});

describe('a timeout, a 5xx or a bad body opens a short cooldown', () => {
	it('HF timeout: short cooldown, the keyless rung still serves the same request', async () => {
		freezeClock();
		process.env.HF_TOKEN = 'hf-test';
		lane.fal = hang;
		lane.wavespeed = () => json(400, { error: 'bad size' });
		const out = await textToImage('a fox', { budgetMs: 5_000 });
		expect(out.model).toBe('pollinations/flux');
		advance(SHORT_COOLDOWN_SECONDS - 1);
		await textToImage('a fox', { budgetMs: 5_000 });
		expect(hitsOn('router.huggingface.co/fal-ai')).toBe(1);
		advance(2);
		lane.fal = () => json(500, {});
		await textToImage('a fox', { budgetMs: 5_000 });
		expect(hitsOn('router.huggingface.co/fal-ai')).toBe(2);
	}, 15_000);

	it('HF 5xx: short cooldown', async () => {
		freezeClock();
		process.env.HF_TOKEN = 'hf-test';
		lane.wavespeed = () => json(400, { error: 'bad size' });
		await textToImage('a fox', { budgetMs: 20_000 });
		advance(SHORT_COOLDOWN_SECONDS - 1);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('router.huggingface.co/fal-ai')).toBe(1);
		expect((await describeImageLadder()).find((r) => r.rung === 'hf:fal-ai')).toMatchObject({ state: 'open', last_failure_class: 'server', last_failure_status: 503 });
	});

	it('HF malformed body (200 without an image url): short cooldown', async () => {
		freezeClock();
		process.env.HF_TOKEN = 'hf-test';
		lane.fal = () => json(200, { unexpected: true });
		lane.wavespeed = () => json(400, { error: 'bad size' });
		await textToImage('a fox', { budgetMs: 20_000 });
		advance(SHORT_COOLDOWN_SECONDS - 1);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('router.huggingface.co/fal-ai')).toBe(1);
		expect((await describeImageLadder()).find((r) => r.rung === 'hf:fal-ai').last_failure_class).toBe('invalid');
	});

	it('an image that fails validation (an HTML page where the bytes should be): short cooldown', async () => {
		freezeClock();
		process.env.HF_TOKEN = 'hf-test';
		lane.fal = () => json(200, { images: [{ url: 'https://v3.fal.media/x.png' }] });
		lane.falImage = () => new Response('<html>not an image</html>', { status: 200, headers: { 'content-type': 'text/html' } });
		lane.wavespeed = () => json(400, { error: 'bad size' });
		const out = await textToImage('a fox', { budgetMs: 20_000 });
		expect(out.model).toBe('pollinations/flux');
		advance(SHORT_COOLDOWN_SECONDS - 1);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('router.huggingface.co/fal-ai')).toBe(1);
	});

	it('a refusal about this prompt (NIM content filter, an HF 400) parks nothing: the next prompt tries the rung again', async () => {
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		process.env.HF_TOKEN = 'hf-test';
		lane.nim = () => json(200, { artifacts: [{ base64: Buffer.from(JPG).toString('base64'), finishReason: 'CONTENT_FILTERED' }] });
		lane.fal = () => json(400, { error: 'prompt too long' });
		lane.wavespeed = () => json(422, { error: 'bad size' });
		await textToImage('a fox', { budgetMs: 20_000 });
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(2);
		expect(hitsOn('router.huggingface.co/fal-ai')).toBe(2);
		expect(hitsOn('router.huggingface.co/wavespeed')).toBe(2);
	});
});

describe('a rung with no credential is skipped without a network call', () => {
	it('with no keys at all, the only host the ladder touches is the keyless one', async () => {
		const out = await textToImage('a fox', { budgetMs: 20_000 });
		expect(out.model).toBe('pollinations/flux');
		expect(hits).toHaveLength(1);
		expect(hits[0]).toContain('image.pollinations.ai');
		expect(vertexState.generate).not.toHaveBeenCalled();
	});
});

describe('the ladder always falls through to the keyless rung', () => {
	it('Vertex as the only keyed rung: its 403 hands off instead of becoming the terminal error', async () => {
		vertexFails(billingHold());
		const out = await textToImage('a fox', { budgetMs: 20_000 });
		expect(out.model).toBe('pollinations/flux');
	});

	it('legacy order (VERTEX_IMAGEN_FIRST=0): NIM then Vertex fail, no Replicate token, the keyless rung serves', async () => {
		process.env.VERTEX_IMAGEN_FIRST = '0';
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		vertexFails(billingHold());
		lane.nim = () => json(500, {});
		const out = await textToImage('a fox', { budgetMs: 20_000 });
		expect(out.model).toBe('pollinations/flux');
		expect(vertexState.generate).toHaveBeenCalledTimes(1);
	});

	it('Livepeer enabled and failing with no Replicate token: the keyless rung serves', async () => {
		livepeer.enabled = true;
		livepeer.run = vi.fn(async () => {
			throw new Error('livepeer gateway certificate mismatch');
		});
		const out = await textToImage('a fox', { budgetMs: 20_000 });
		expect(out.model).toBe('pollinations/flux');
		expect(livepeer.run).toHaveBeenCalledTimes(1);
	});

	it('walks the rungs in the order the health endpoint reports', async () => {
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		process.env.HF_TOKEN = 'hf-test';
		vertexFails(billingHold());
		lane.pollinations = () => json(500, {});
		const err = await textToImage('a fox', { budgetMs: 20_000 }).catch((e) => e);
		const walked = err.ladder.map((a) => a.rung);
		const reported = imageLadderRungs().filter((r) => r.configured).map((r) => r.rung);
		expect(walked).toEqual(reported);
		expect(walked).toEqual(['vertex', 'nim', 'hf:fal-ai', 'hf:wavespeed', 'pollinations']);
	});
});

describe('the time budget leaves the keyless rung enough to finish', () => {
	it('2026-11-26: Vertex on a billing hold, NIM hanging, both HF providers out of credit; the keyless rung serves inside the budget, and the next request goes straight to it', async () => {
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		process.env.HF_TOKEN = 'hf-test';
		vertexFails(billingHold());
		lane.nim = hang;
		lane.fal = () => json(402, { error: 'Purchase pre-paid credits.' });
		lane.wavespeed = () => json(402, { error: 'Purchase pre-paid credits.' });
		let pollinationsSignal;
		lane.pollinations = (init) => {
			pollinationsSignal = init.signal;
			return bytes(JPG, 'image/jpeg');
		};

		const budgetMs = 10_000;
		const started = Date.now();
		const first = await textToImage('a fox', { budgetMs });
		expect(first.model).toBe('pollinations/flux');
		expect(Date.now() - started).toBeLessThan(budgetMs);
		expect(pollinationsSignal.aborted).toBe(false);
		expect(hitsOn('ai.api.nvidia.com')).toBe(1);
		expect(hitsOn('huggingface')).toBe(2);

		hits = [];
		const t1 = Date.now();
		const second = await textToImage('a fox', { budgetMs });
		expect(second.model).toBe('pollinations/flux');
		expect(hits).toEqual([expect.stringContaining('image.pollinations.ai')]);
		expect(vertexState.generate).toHaveBeenCalledTimes(1);
		expect(Date.now() - t1).toBeLessThan(1_000);
	}, 20_000);

	it('worst case: every rung ahead of the keyless one hangs to its deadline, and the keyless rung still gets its reserve', async () => {
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		process.env.HF_TOKEN = 'hf-test';
		vertexState.configured = true;
		process.env.GOOGLE_CLOUD_PROJECT = 'demo-project';
		vertexState.generate = vi.fn(
			(_p, { timeoutMs }) =>
				new Promise((_, reject) =>
					setTimeout(
						() => reject(Object.assign(new Error(`Vertex AI image generation unreachable: no response in ${timeoutMs}ms`), { code: 'provider_unreachable' })),
						timeoutMs,
					),
				),
		);
		lane.nim = hang;
		lane.fal = hang;
		lane.wavespeed = hang;
		const budgetMs = 10_000;
		const started = Date.now();
		let leftForKeyless;
		lane.pollinations = () => {
			leftForKeyless = budgetMs - (Date.now() - started);
			return bytes(JPG, 'image/jpeg');
		};
		const out = await textToImage('a fox', { budgetMs });
		expect(out.model).toBe('pollinations/flux');
		expect(leftForKeyless).toBeGreaterThanOrEqual(keylessReserveMs(budgetMs) - 250);
	}, 20_000);

	it('at every realistic budget, rungs that each burn their whole allowance still leave the keyless rung its reserve', () => {
		// The rungs ahead of the keyless one with their own ceilings, in ladder order.
		const ahead = [90_000, 30_000, 45_000, 45_000];
		for (const budgetMs of [5_000, 10_000, 20_000, 45_000, 60_000, 90_000, 120_000]) {
			const budget = ladderBudgetMs(budgetMs);
			const reserveMs = keylessReserveMs(budget);
			let remainingMs = budget;
			for (const ceiling of ahead) {
				if (remainingMs - reserveMs < Math.max(1_000, budget * 0.1)) continue;
				// Each lane enforces a 1 s floor on its own timer.
				remainingMs -= Math.max(1_000, laneTimeoutMs(ceiling, { budgetMs: budget, remainingMs, laneRemains: true, reserveMs }));
			}
			expect(remainingMs, `budget ${budget}`).toBeGreaterThanOrEqual(reserveMs);
			expect(reserveMs, `budget ${budget}`).toBeGreaterThanOrEqual(Math.min(8_000, budget * 0.5));
		}
	});
});

describe('a cooled rung recovers on its own', () => {
	it('when the cooldown ends, exactly one probe goes through, and its success closes the breaker', async () => {
		freezeClock();
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		lane.nim = () => json(500, { error: 'internal' });
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(1);

		advance(SHORT_COOLDOWN_SECONDS + 1);
		expect((await describeImageLadder()).find((r) => r.rung === 'nim').state).toBe('half_open');
		let release;
		const gate = new Promise((r) => (release = r));
		lane.nim = async () => {
			await gate;
			return nimOk();
		};
		const a = textToImage('a fox', { budgetMs: 20_000 });
		const b = textToImage('a fox', { budgetMs: 20_000 });
		// The loser of the probe lease does not wait for the probe: it serves now.
		expect((await b).model).toBe('pollinations/flux');
		release();
		expect((await a).model).toBe('black-forest-labs/flux.2-klein-4b');
		expect(hitsOn('ai.api.nvidia.com')).toBe(2);

		expect((await describeImageLadder()).find((r) => r.rung === 'nim')).toMatchObject({ state: 'closed', last_failure_class: null });
		lane.nim = nimOk;
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(3);
	});

	it('a failed probe re-opens the breaker for another cooldown', async () => {
		freezeClock();
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		lane.nim = () => json(500, { error: 'internal' });
		await textToImage('a fox', { budgetMs: 20_000 });
		advance(SHORT_COOLDOWN_SECONDS + 1);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(2);
		advance(SHORT_COOLDOWN_SECONDS - 1);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(hitsOn('ai.api.nvidia.com')).toBe(2);
		expect((await describeImageLadder()).find((r) => r.rung === 'nim')).toMatchObject({ state: 'open', consecutive_failures: 2 });
	});

	it('a breaker opened by another call site (the legacy cooldown key alone) is still skipped, then retried once it expires', async () => {
		freezeClock();
		vertexFails(billingHold());
		const { markProviderCooldown } = await import('../../api/_lib/provider-health.js');
		await markProviderCooldown(IMAGE_RUNG_KEYS.vertex, 30, 'auth');
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(vertexState.generate).not.toHaveBeenCalled();
		advance(31);
		await textToImage('a fox', { budgetMs: 20_000 });
		expect(vertexState.generate).toHaveBeenCalledTimes(1);
	});
});

describe('the final error is honest', () => {
	it('carries the shortest stated wait and names the rung that stated it', async () => {
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		process.env.HF_TOKEN = 'hf-test';
		lane.nim = () => json(429, { detail: 'busy' }, { 'retry-after': '30' });
		lane.fal = () => json(429, { error: 'busy' }, { 'retry-after': '12' });
		lane.wavespeed = () => json(402, { error: 'Purchase pre-paid credits.' });
		lane.pollinations = () => json(429, { error: 'busy' }, { 'retry-after': '45' });
		const err = await textToImage('a fox', { budgetMs: 20_000 }).catch((e) => e);
		expect(err).toMatchObject({ code: 'rate_limited', retryAfter: 12, queued: true });
		expect(err.ladderCause).toMatchObject({ rung: 'hf:fal-ai', failureClass: 'rate_limited', retryAfter: 12 });
		expect(err.ladder.map((a) => [a.rung, a.failureClass])).toEqual([
			['nim', 'rate_limited'],
			['hf:fal-ai', 'rate_limited'],
			['hf:wavespeed', 'credits'],
			['pollinations', 'rate_limited'],
		]);
	});

	it('a wait stated earlier and still running counts too: the next request reports what is left of it', async () => {
		freezeClock();
		process.env.HF_TOKEN = 'hf-test';
		lane.fal = () => json(429, { error: 'busy' }, { 'retry-after': '20' });
		lane.wavespeed = () => json(402, { error: 'Purchase pre-paid credits.' });
		lane.pollinations = () => json(500, {});
		await textToImage('a fox', { budgetMs: 20_000 }).catch(() => {});
		advance(5);
		const err = await textToImage('a fox', { budgetMs: 20_000 }).catch((e) => e);
		expect(err).toMatchObject({ code: 'rate_limited', retryAfter: 15 });
		expect(err.ladder.find((a) => a.rung === 'hf:fal-ai')).toMatchObject({ outcome: 'skipped', failureClass: 'rate_limited', retryAfter: 15 });
	});

	it('with no stated wait anywhere, the last real failure stays the error and the ladder rides along', async () => {
		process.env.HF_TOKEN = 'hf-test';
		lane.pollinations = () => json(500, {});
		const err = await textToImage('a fox', { budgetMs: 20_000 }).catch((e) => e);
		expect(err.message).toMatch(/pollinations returned 500/);
		expect(err.code).toBeUndefined();
		expect(err.ladderCause).toMatchObject({ rung: 'pollinations', failureClass: 'server' });
		expect(err.ladder).toHaveLength(3);
	});
});

describe('health tells the truth', () => {
	it('names every rung, its state, the last failure class and when it will be tried again', async () => {
		freezeClock();
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		vertexFails(billingHold());
		lane.nim = () => json(500, {});
		await textToImage('a fox', { budgetMs: 20_000 });

		const ladder = await describeImageLadder();
		expect(ladder.map((r) => r.rung)).toEqual(['vertex', 'nim', 'hf:fal-ai', 'hf:wavespeed', 'livepeer', 'pollinations', 'replicate']);
		const byRung = Object.fromEntries(ladder.map((r) => [r.rung, r]));
		expect(byRung.vertex).toMatchObject({
			configured: true,
			state: 'open',
			last_failure_class: 'auth',
			last_failure_status: 403,
			retry_at: new Date(Date.now() + LONG_COOLDOWN_SECONDS * 1000).toISOString(),
		});
		expect(byRung.nim).toMatchObject({ state: 'open', last_failure_class: 'server', retry_at: new Date(Date.now() + SHORT_COOLDOWN_SECONDS * 1000).toISOString() });
		expect(byRung['hf:fal-ai']).toMatchObject({ configured: false, state: 'unconfigured', retry_at: null });
		expect(byRung.pollinations).toMatchObject({ configured: true, state: 'closed', last_failure_class: null });
		expect(byRung.replicate).toMatchObject({ configured: false, state: 'unconfigured' });
	});

	it('the image health endpoint carries the ladder', async () => {
		lane.pollinations = () => bytes(JPG, 'image/jpeg');
		const { imageLaneHealth } = await import('../../api/_lib/ai-image-lanes.js');
		const health = await imageLaneHealth();
		expect(health.ladder.map((r) => r.rung)).toContain('pollinations');
		expect(health.ladder.find((r) => r.rung === 'pollinations').state).toBe('closed');
	});
});
