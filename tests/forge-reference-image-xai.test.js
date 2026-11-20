/**
 * FORGE_REF_IMAGE_PROVIDER=xai puts Grok Imagine in front of the Vertex lane.
 * The contract under test: the flag is off by default, the xAI lane sends the
 * exact composition instruction the Vertex lane sends, and every xAI failure
 * (no key, 401, the 400 bad-key answer, 429, a moderation refusal) is logged
 * with its reason and falls through to the existing lane. The user's job never
 * fails because of this flag.
 *
 * The real xai-image.js runs here; only the network is doubled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';

process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
delete process.env.VERTEX_IMAGEN_ENABLED;
delete process.env.VERTEX_IMAGEN_MODEL;

const persisted = vi.hoisted(() => ({ b64: [] }));
const cooldowns = vi.hoisted(() => ({ marked: [] }));
const ladder = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../api/_lib/gcp-auth.js', () => ({ getGcpAccessToken: async () => 'tok' }));
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));
vi.mock('../api/_lib/image-persist.js', async (importOriginal) => ({
	...(await importOriginal()),
	persistImageBase64: async (b64) => {
		persisted.b64.push(b64);
		return 'https://cdn.test/ref.png';
	},
}));
vi.mock('../api/_lib/vision.js', () => ({ parseJsonLoose: (t) => JSON.parse(t) }));
vi.mock('../api/forge-enhance.js', () => ({ subjectNegativePrompt: () => 'blurry' }));
vi.mock('../api/_lib/ai-image-lanes.js', () => ({ isProviderRefusal: () => false }));
vi.mock('../api/_lib/provider-health.js', async (importOriginal) => ({
	...(await importOriginal()),
	providersInCooldown: async () => new Set(),
	markProviderCooldown: async (key, seconds, reason) => {
		cooldowns.marked.push({ key, seconds, reason });
	},
}));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: () => {} }));
vi.mock('../api/_lib/xai-usage.js', () => ({ recordXaiUsage: () => {} }));
vi.mock('../api/_mcp3d/text-to-image.js', async (importOriginal) => ({
	...(await importOriginal()),
	textToImage: async () => {
		ladder.calls += 1;
		return { imageUrl: 'https://cdn.test/ladder.png', model: 'nim/flux' };
	},
}));

const { generateReferenceImage, buildReferenceInstruction, referenceImageProvider, XAI_IMAGE_COOLDOWN_KEY } =
	await import('../api/_lib/forge-reference-image.js');
const { XAI_IMAGE_GENERATIONS_URL, XAI_IMAGINE_IMAGE_MODEL } = await import('../api/_lib/chat-models.js');
const { IMAGE_MODEL_PRIMARY } = await import('../api/_lib/image-model.js');
const { LIVE_NO_CREDENTIALS, LIVE_INCORRECT_KEY } = await import('./fixtures/xai/images-generations.js');

const PNG_1PX = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);
const VERTEX_IMAGE_OK = {
	candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }],
};

let xaiAnswer;
let vertexAnswer;
let xaiBodies;
let vertexCalls;
let warn;

function installFetch() {
	globalThis.fetch = vi.fn(async (url, init) => {
		const u = String(url);
		if (u === XAI_IMAGE_GENERATIONS_URL) {
			xaiBodies.push(JSON.parse(init.body));
			const [status, body] = xaiAnswer;
			return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' },
			});
		}
		const model = /models\/([^:]+):generateContent/.exec(u)?.[1];
		// QA scoring (a text model) answers 500 so every reference ships unscored
		// and only the image calls are counted.
		if (!model || !model.includes('image')) return new Response('{}', { status: 500 });
		vertexCalls.push(model);
		const [status, body] = vertexAnswer;
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	});
}

beforeEach(() => {
	ladder.calls = 0;
	persisted.b64 = [];
	cooldowns.marked = [];
	xaiBodies = [];
	vertexCalls = [];
	xaiAnswer = [200, { data: [{ b64_json: PNG_1PX.toString('base64'), mime_type: 'image/png' }], usage: { cost_in_usd_ticks: 400_000_000 } }];
	vertexAnswer = [200, VERTEX_IMAGE_OK];
	process.env.GROK_API_KEY = 'xai-test-key';
	installFetch();
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	delete process.env.FORGE_REF_IMAGE_PROVIDER;
	delete process.env.GROK_API_KEY;
	delete process.env.XAI_API_KEY;
	vi.restoreAllMocks();
});

const warned = () => warn.mock.calls.map((c) => c.join(' ')).join('\n');

describe('FORGE_REF_IMAGE_PROVIDER selection', () => {
	it('defaults to vertex and ignores unknown values', () => {
		expect(referenceImageProvider()).toBe('vertex');
		process.env.FORGE_REF_IMAGE_PROVIDER = 'midjourney';
		expect(referenceImageProvider()).toBe('vertex');
		process.env.FORGE_REF_IMAGE_PROVIDER = ' XAI ';
		expect(referenceImageProvider()).toBe('xai');
	});
});

describe('flag off', () => {
	it('never calls xAI, even with a key configured', async () => {
		const out = await generateReferenceImage('a brass telescope', { budgetMs: 20_000 });
		expect(xaiBodies).toHaveLength(0);
		expect(vertexCalls).toEqual([IMAGE_MODEL_PRIMARY]);
		expect(out.lane).toBe('vertex-reference');
	});
});

describe('flag on, xAI answers', () => {
	it('serves the xAI image with the same composition instruction the Vertex lane uses', async () => {
		process.env.FORGE_REF_IMAGE_PROVIDER = 'xai';
		const out = await generateReferenceImage('a brass telescope', { aspectRatio: '1:1', budgetMs: 20_000 });

		expect(xaiBodies).toHaveLength(1);
		expect(xaiBodies[0].model).toBe(XAI_IMAGINE_IMAGE_MODEL);
		expect(xaiBodies[0].prompt).toBe(buildReferenceInstruction('a brass telescope', 'blurry'));
		expect(xaiBodies[0].aspect_ratio).toBe('1:1');
		expect(vertexCalls).toHaveLength(0);
		expect(ladder.calls).toBe(0);
		expect(out).toMatchObject({ lane: 'xai-reference', model: `xai/${XAI_IMAGINE_IMAGE_MODEL}`, imageUrl: 'https://cdn.test/ref.png' });
		expect(Buffer.from(persisted.b64[0], 'base64').equals(PNG_1PX)).toBe(true);
	});

	it('transcodes a WebP answer to PNG before persisting it', async () => {
		process.env.FORGE_REF_IMAGE_PROVIDER = 'xai';
		const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#c0c0c0' } }).webp().toBuffer();
		xaiAnswer = [200, { data: [{ b64_json: webp.toString('base64'), mime_type: 'image/webp' }] }];
		await generateReferenceImage('a glass bottle', { budgetMs: 20_000 });
		const stored = Buffer.from(persisted.b64[0], 'base64');
		expect(stored.subarray(0, 4).toString('hex')).toBe('89504e47');
		expect((await sharp(stored).metadata()).width).toBe(4);
	});
});

describe('flag on, xAI fails: falls through to the existing lane with the reason logged', () => {
	it.each([
		['auth', LIVE_NO_CREDENTIALS.status, LIVE_NO_CREDENTIALS.body],
		['auth', LIVE_INCORRECT_KEY.status, LIVE_INCORRECT_KEY.body],
		['rate_limited', 429, '{"code":"resource-exhausted","error":"Too many requests"}'],
		['refused', 400, '{"code":"invalid-argument","error":"Generated image rejected by content moderation."}'],
	])('reason=%s on HTTP %i', async (reason, status, body) => {
		process.env.FORGE_REF_IMAGE_PROVIDER = 'xai';
		xaiAnswer = [status, body];
		const out = await generateReferenceImage('a brass telescope', { budgetMs: 20_000 });

		expect(xaiBodies).toHaveLength(1);
		expect(vertexCalls).toEqual([IMAGE_MODEL_PRIMARY]);
		expect(out.lane).toBe('vertex-reference');
		expect(warned()).toContain(`xai lane failed (reason=${reason}), falling through to the vertex lane`);
		const cooled = cooldowns.marked.filter((m) => m.key === XAI_IMAGE_COOLDOWN_KEY);
		if (reason === 'auth') expect(cooled).toEqual([expect.objectContaining({ reason: 'auth' })]);
		if (reason === 'rate_limited') expect(cooled).toEqual([expect.objectContaining({ reason: 'health' })]);
		if (reason === 'refused') expect(cooled).toEqual([]);
	});

	it('skips xAI without a request when no key is set (reason=no_key)', async () => {
		process.env.FORGE_REF_IMAGE_PROVIDER = 'xai';
		delete process.env.GROK_API_KEY;
		const out = await generateReferenceImage('a brass telescope', { budgetMs: 20_000 });
		expect(xaiBodies).toHaveLength(0);
		expect(out.lane).toBe('vertex-reference');
		expect(warned()).toContain('xai lane skipped (reason=no_key)');
	});

	it('still reaches the ladder when xAI and Vertex both fail', async () => {
		process.env.FORGE_REF_IMAGE_PROVIDER = 'xai';
		xaiAnswer = [LIVE_NO_CREDENTIALS.status, LIVE_NO_CREDENTIALS.body];
		vertexAnswer = [403, { error: { code: 403, message: 'There are issues with your billing account' } }];
		const out = await generateReferenceImage('a brass telescope', { budgetMs: 20_000 });
		expect(ladder.calls).toBe(1);
		expect(out.imageUrl).toBe('https://cdn.test/ladder.png');
		expect(warned()).toContain('xai lane failed (reason=auth)');
		expect(warned()).toContain('vertex lane failed, falling through');
	});
});
