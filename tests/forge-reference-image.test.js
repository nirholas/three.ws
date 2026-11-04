/**
 * The forge reference-image lane moved off `gemini-2.5-flash-image` (Google
 * marked it deprecated, Gemini API shutdown 2026-10-02) onto its successor,
 * keeping the retired id as a one-step fallback. The fallback is only for "this
 * model is not served here" (404 / model not found): a 429 or a 403 billing
 * hold is a real answer from a model that exists, and retrying it on a second
 * model would double rate-limit pressure or burn the budget on a denial that
 * covers both ids alike.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
delete process.env.VERTEX_IMAGEN_ENABLED;
delete process.env.VERTEX_IMAGEN_MODEL;

vi.mock('../api/_lib/gcp-auth.js', () => ({ getGcpAccessToken: async () => 'tok' }));
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));
vi.mock('../api/_lib/image-persist.js', () => ({ persistImageBase64: async () => 'https://cdn.test/ref.png' }));
vi.mock('../api/_lib/vision.js', () => ({ parseJsonLoose: (t) => JSON.parse(t) }));
vi.mock('../api/forge-enhance.js', () => ({ subjectNegativePrompt: () => 'blurry' }));
vi.mock('../api/_lib/ai-image-lanes.js', () => ({ isProviderRefusal: () => false }));
// A 403 trips the shared Vertex cooldown (correct in production); each case
// here starts from a cool breaker so the order of the cases does not matter.
vi.mock('../api/_lib/provider-health.js', async (importOriginal) => ({
	...(await importOriginal()),
	providersInCooldown: async () => new Set(),
	markProviderCooldown: async () => {},
}));

const ladder = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../api/_mcp3d/text-to-image.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		textToImage: async () => {
			ladder.calls += 1;
			return { imageUrl: 'https://cdn.test/ladder.png', model: 'nim/flux' };
		},
	};
});

const { generateReferenceImage } = await import('../api/_lib/forge-reference-image.js');
const { IMAGE_MODEL_PRIMARY, IMAGE_MODEL_FALLBACK } = await import('../api/_lib/image-model.js');

const IMAGE_OK = {
	candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }],
};

// Vertex double: answers per model id. QA scoring (a text model) answers 500 so
// the reference ships unscored and only the image calls are counted.
let answers;
let imageCalls;
function installFetch() {
	globalThis.fetch = vi.fn(async (url) => {
		const model = /models\/([^:]+):generateContent/.exec(String(url))?.[1];
		if (!model || !model.includes('image')) return new Response('{}', { status: 500 });
		imageCalls.push(model);
		const [status, body] = answers[model] || [500, { error: { message: 'unexpected model' } }];
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	});
}

beforeEach(() => {
	ladder.calls = 0;
	imageCalls = [];
	installFetch();
});
afterEach(() => {
	delete process.env.VERTEX_IMAGEN_MODEL;
});

describe('forge reference image model currency', () => {
	it('defaults to the successor model, not the retired gemini-2.5-flash-image', async () => {
		expect(IMAGE_MODEL_PRIMARY).not.toBe('gemini-2.5-flash-image');
		answers = { [IMAGE_MODEL_PRIMARY]: [200, IMAGE_OK] };
		const out = await generateReferenceImage('a ceramic mug', { budgetMs: 20_000 });
		expect(imageCalls).toEqual([IMAGE_MODEL_PRIMARY]);
		expect(out.lane).toBe('vertex-reference');
		expect(out.model).toBe(`vertex-ai/${IMAGE_MODEL_PRIMARY}`);
	});

	it('falls through to the fallback model when the primary answers 404', async () => {
		answers = {
			[IMAGE_MODEL_PRIMARY]: [404, { error: { code: 404, message: `Publisher Model ${IMAGE_MODEL_PRIMARY} was not found` } }],
			[IMAGE_MODEL_FALLBACK]: [200, IMAGE_OK],
		};
		const out = await generateReferenceImage('a ceramic bowl', { budgetMs: 20_000 });
		expect(imageCalls).toEqual([IMAGE_MODEL_PRIMARY, IMAGE_MODEL_FALLBACK]);
		expect(out.lane).toBe('vertex-reference');
		expect(out.model).toBe(`vertex-ai/${IMAGE_MODEL_FALLBACK}`);
		expect(ladder.calls).toBe(0);
	});

	it('does not retry a 429 on the fallback model', async () => {
		answers = {
			[IMAGE_MODEL_PRIMARY]: [429, { error: { code: 429, message: 'Resource exhausted' } }],
			[IMAGE_MODEL_FALLBACK]: [200, IMAGE_OK],
		};
		const out = await generateReferenceImage('a ceramic vase', { budgetMs: 20_000 });
		expect(imageCalls).toEqual([IMAGE_MODEL_PRIMARY]);
		expect(out.lane).not.toBe('vertex-reference');
		expect(ladder.calls).toBe(1);
	});

	it('does not retry a 403 billing hold on the fallback model', async () => {
		answers = {
			[IMAGE_MODEL_PRIMARY]: [403, { error: { code: 403, message: 'There are issues with your billing account' } }],
			[IMAGE_MODEL_FALLBACK]: [200, IMAGE_OK],
		};
		await generateReferenceImage('a ceramic jug', { budgetMs: 20_000 });
		expect(imageCalls).toEqual([IMAGE_MODEL_PRIMARY]);
		expect(ladder.calls).toBe(1);
	});

	it('honours a VERTEX_IMAGEN_MODEL override as the primary', async () => {
		process.env.VERTEX_IMAGEN_MODEL = 'gemini-custom-image';
		answers = { 'gemini-custom-image': [200, IMAGE_OK] };
		const out = await generateReferenceImage('a ceramic teapot', { budgetMs: 20_000 });
		expect(imageCalls).toEqual(['gemini-custom-image']);
		expect(out.model).toBe('vertex-ai/gemini-custom-image');
	});
});
