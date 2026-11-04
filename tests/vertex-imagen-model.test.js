/**
 * The MCP Vertex image client (api/_mcp3d/vertex-imagen.js) and the image-lane
 * health probe (api/_lib/ai-image-lanes.js) resolve the Gemini image model from
 * api/_lib/image-model.js, so they default to the successor of the retired
 * `gemini-2.5-flash-image` and fall back to it only when the primary is not
 * served (404 / model not found), never on a 429 or a 403.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/gcp-auth.js', () => ({
	getGcpAccessToken: async () => 'tok',
	gcpAuthConfigured: () => true,
}));

const { generateImage, editImage } = await import('../api/_mcp3d/vertex-imagen.js');
const { imageLaneHealth } = await import('../api/_lib/ai-image-lanes.js');
const { IMAGE_MODEL_PRIMARY, IMAGE_MODEL_FALLBACK, imageModelChain, isModelNotFound } = await import(
	'../api/_lib/image-model.js'
);

const IMAGE_OK = {
	candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }],
};
const NOT_FOUND = [404, { error: { code: 404, message: 'Publisher Model was not found or your project does not have access to it.' } }];

let answers;
let calls;
beforeEach(() => {
	process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
	delete process.env.VERTEX_IMAGEN_MODEL;
	delete process.env.VERTEX_IMAGEN_EDIT_MODEL;
	calls = [];
	globalThis.fetch = vi.fn(async (url) => {
		const m = /models\/([^:]+):(\w+)/.exec(String(url));
		if (!m) return new Response('{}', { status: 200 });
		calls.push(`${m[1]}:${m[2]}`);
		const [status, body] = answers[m[1]] || [500, { error: { message: 'unexpected model' } }];
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	});
});
afterEach(() => {
	delete process.env.GOOGLE_CLOUD_PROJECT;
});

describe('image model resolution', () => {
	it('chains the primary then the retired id, and honours overrides', () => {
		expect(imageModelChain()).toEqual([IMAGE_MODEL_PRIMARY, IMAGE_MODEL_FALLBACK]);
		process.env.VERTEX_IMAGEN_MODEL = IMAGE_MODEL_FALLBACK;
		expect(imageModelChain()).toEqual([IMAGE_MODEL_FALLBACK]);
		process.env.VERTEX_IMAGEN_MODEL = 'imagen-4.0-generate-001';
		expect(imageModelChain()).toEqual(['imagen-4.0-generate-001']);
	});

	it('classifies only a missing model as not found', () => {
		expect(isModelNotFound(404, '')).toBe(true);
		expect(isModelNotFound(400, 'Model gemini-x does not exist')).toBe(true);
		expect(isModelNotFound(400, 'imageSize is not a valid field')).toBe(false);
		expect(isModelNotFound(429, 'model not found')).toBe(false);
		expect(isModelNotFound(403, 'billing')).toBe(false);
	});
});

describe('vertex-imagen generateImage', () => {
	it('uses the successor model by default', async () => {
		answers = { [IMAGE_MODEL_PRIMARY]: [200, IMAGE_OK] };
		const out = await generateImage('a mug');
		expect(out.model).toBe(`vertex-ai/${IMAGE_MODEL_PRIMARY}`);
		expect(calls).toEqual([`${IMAGE_MODEL_PRIMARY}:generateContent`]);
	});

	it('falls back to the retired id on a 404', async () => {
		answers = { [IMAGE_MODEL_PRIMARY]: NOT_FOUND, [IMAGE_MODEL_FALLBACK]: [200, IMAGE_OK] };
		const out = await generateImage('a mug');
		expect(out.model).toBe(`vertex-ai/${IMAGE_MODEL_FALLBACK}`);
		expect(calls).toEqual([`${IMAGE_MODEL_PRIMARY}:generateContent`, `${IMAGE_MODEL_FALLBACK}:generateContent`]);
	});

	it('does not fall back on a 429', async () => {
		answers = { [IMAGE_MODEL_PRIMARY]: [429, { error: { message: 'Resource exhausted' } }], [IMAGE_MODEL_FALLBACK]: [200, IMAGE_OK] };
		await expect(generateImage('a mug')).rejects.toMatchObject({ code: 'rate_limited' });
		expect(calls).toEqual([`${IMAGE_MODEL_PRIMARY}:generateContent`]);
	});
});

describe('vertex-imagen editImage', () => {
	it('falls back to the retired id on a 404', async () => {
		answers = { [IMAGE_MODEL_PRIMARY]: NOT_FOUND, [IMAGE_MODEL_FALLBACK]: [200, IMAGE_OK] };
		const out = await editImage('data:image/png;base64,aGVsbG8=', 'make it blue');
		expect(out.model).toBe(`vertex-ai/${IMAGE_MODEL_FALLBACK}`);
	});
});

describe('image lane health probe', () => {
	it('probes the model the lane will actually call', async () => {
		answers = { [IMAGE_MODEL_PRIMARY]: [200, {}] };
		const health = await imageLaneHealth();
		const vertex = health.vertex || health.lanes?.vertex || Object.values(health).find((v) => v?.model);
		expect(vertex?.model).toBe(IMAGE_MODEL_PRIMARY);
		expect(calls).toContain(`${IMAGE_MODEL_PRIMARY}:countTokens`);
	});

	it('reports the fallback as the served model when the primary is not found', async () => {
		answers = { [IMAGE_MODEL_PRIMARY]: NOT_FOUND, [IMAGE_MODEL_FALLBACK]: [200, {}] };
		const health = await imageLaneHealth();
		const vertex = health.vertex || health.lanes?.vertex || Object.values(health).find((v) => v?.model);
		expect(vertex?.status).toBe('ok');
		expect(vertex?.model).toBe(IMAGE_MODEL_FALLBACK);
	});
});
