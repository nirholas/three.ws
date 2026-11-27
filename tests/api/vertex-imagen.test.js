// Unit tests for the Vertex AI image-generation client.
//
// The Imagen `:predict` family is being retired (imagen-3.0-* shut down
// 2026-06-30; imagen-4.0-* by 2026-08-17), so the client now defaults to the
// live Gemini image model (IMAGE_MODEL_PRIMARY in api/_lib/image-model.js, the
// one place that id is resolved) via `:generateContent`, and
// only takes the legacy `:predict` shape for an explicit `imagen-*` override.
//
// These tests pin BOTH request/response shapes against the documented Vertex
// contract and the model-prefix router, without any live credentials: the GCP
// token mint is mocked and every HTTP call is a recorded-shape fixture (a test
// double for an external API, not product data). Live E2E is a separate, creds-
// gated step tracked in docs/gcp-credits.md.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../api/_lib/gcp-auth.js', () => ({
	getGcpAccessToken: vi.fn(async () => 'fake-access-token'),
}));

// The edit lane decodes caller-supplied source/mask URLs through the SSRF guard.
// Mocking it lets the tests assert that BOTH images take the guarded path (a bare
// fetch on the mask was a live SSRF hole) without reaching the network.
const { safeFetch } = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock('../../api/_lib/ssrf-guard.js', () => ({ fetchSafePublicUrl: safeFetch }));

import { generateImage, editImage, isConfigured } from '../../api/_mcp3d/vertex-imagen.js';
import { IMAGE_MODEL_PRIMARY } from '../../api/_lib/image-model.js';
import { resetVertexBreaker, vertexBreakerState } from '../../api/_lib/vertex-image-breaker.js';
import { REAL_PNG_B64, encodeTestImage } from '../_helpers/real-image.js';

// Every image this client returns is decoded and sanity-checked (real pixels,
// sane size, not blank), so the fixtures are real encoded images: a 512px
// gradient, as PNG and as JPEG, plus a flat frame and a thumbnail to reject.
const PNG_B64 = REAL_PNG_B64;
const JPEG_B64 = await encodeTestImage({ format: 'jpeg' });
const FLAT_B64 = await encodeTestImage({ flat: true });
const THUMB_B64 = await encodeTestImage({ width: 64, height: 64 });

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'VERTEX_IMAGEN_MODEL', 'VERTEX_IMAGEN_EDIT_MODEL'];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function stubFetch(responder) {
	const calls = [];
	globalThis.fetch = vi.fn(async (url, opts = {}) => {
		const call = { url: String(url), body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers };
		calls.push(call);
		return responder(call);
	});
	return calls;
}

// A Gemini image generateContent success: the image rides back as an
// inlineData part (base64 + mimeType), same as the live API.
function geminiImageResponse(b64 = PNG_B64, mime = 'image/png') {
	return new Response(
		JSON.stringify({
			candidates: [{ content: { parts: [{ inlineData: { mimeType: mime, data: b64 } }] }, finishReason: 'STOP' }],
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } },
	);
}

// A legacy Imagen :predict success: base64 under predictions[].bytesBase64Encoded.
function imagenPredictResponse(b64 = PNG_B64) {
	return new Response(JSON.stringify({ predictions: [{ bytesBase64Encoded: b64 }] }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

beforeEach(async () => {
	for (const k of ENV_KEYS) delete process.env[k];
	process.env.GOOGLE_CLOUD_PROJECT = 'demo-project';
	// Failure cases cool the shared Vertex breaker; each case starts closed.
	await resetVertexBreaker();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	for (const k of ENV_KEYS) {
		if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
		else process.env[k] = ORIGINAL_ENV[k];
	}
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe('vertex-imagen — default Gemini image path', () => {
	it('calls :generateContent with the documented image-modality body', async () => {
		const calls = stubFetch(() => geminiImageResponse());
		const result = await generateImage('a red teapot', { aspectRatio: '16:9' });

		expect(calls).toHaveLength(1);
		const { url, body, headers } = calls[0];
		// Endpoint: regional host + publisher model + :generateContent (NOT :predict).
		expect(url).toBe(
			'https://us-central1-aiplatform.googleapis.com/v1/projects/demo-project' +
				`/locations/us-central1/publishers/google/models/${IMAGE_MODEL_PRIMARY}:generateContent`,
		);
		expect(headers.authorization).toBe('Bearer fake-access-token');
		// Request shape: text prompt + IMAGE modality + aspect ratio in imageConfig.
		expect(body.contents[0].parts[0].text).toBe('a red teapot');
		expect(body.generationConfig.responseModalities).toEqual(['IMAGE']);
		expect(body.generationConfig.imageConfig.aspectRatio).toBe('16:9');

		// Response parse: inlineData → data URI carrying the real mime type + model tag.
		expect(result.imageUrl).toBe(`data:image/png;base64,${PNG_B64}`);
		expect(result.model).toBe(`vertex-ai/${IMAGE_MODEL_PRIMARY}`);
	});

	it('preserves the response mime type in the data URI', async () => {
		stubFetch(() => geminiImageResponse(JPEG_B64, 'image/jpeg'));
		const result = await generateImage('a teapot');
		expect(result.imageUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
	});

	it('accepts the wide Gemini aspect-ratio set and falls back to 1:1 for unknown', async () => {
		let calls = stubFetch(() => geminiImageResponse());
		await generateImage('x', { aspectRatio: '21:9' });
		expect(calls[0].body.generationConfig.imageConfig.aspectRatio).toBe('21:9');

		calls = stubFetch(() => geminiImageResponse());
		await generateImage('x', { aspectRatio: '7:3' }); // not a supported ratio
		expect(calls[0].body.generationConfig.imageConfig.aspectRatio).toBe('1:1');
	});

	it('throws with the finishReason when a safety block returns no image', async () => {
		stubFetch(
			() =>
				new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'blocked' }] }, finishReason: 'SAFETY' }] }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
		);
		await expect(generateImage('x')).rejects.toThrow(/no image data.*SAFETY/);
	});
});

describe('vertex-imagen — legacy Imagen :predict override', () => {
	beforeEach(() => {
		process.env.VERTEX_IMAGEN_MODEL = 'imagen-4.0-generate-001';
	});

	it('routes an imagen-* model to :predict with the instances/parameters body', async () => {
		const calls = stubFetch(() => imagenPredictResponse());
		const result = await generateImage('a red teapot', { aspectRatio: '4:3' });

		const { url, body } = calls[0];
		expect(url).toContain('/models/imagen-4.0-generate-001:predict');
		expect(body.instances[0].prompt).toBe('a red teapot');
		expect(body.parameters).toMatchObject({
			sampleCount: 1,
			aspectRatio: '4:3',
			addWatermark: false,
			safetySetting: 'block_some',
			personGeneration: 'allow_adult',
		});
		expect(result.imageUrl).toBe(`data:image/png;base64,${PNG_B64}`);
		expect(result.model).toBe('vertex-ai/imagen-4.0-generate-001');
	});
});

describe('vertex-imagen — location + error handling', () => {
	it('uses the un-prefixed host for the global location', async () => {
		process.env.GOOGLE_CLOUD_LOCATION = 'global';
		const calls = stubFetch(() => geminiImageResponse());
		await generateImage('x');
		expect(calls[0].url.startsWith('https://aiplatform.googleapis.com/v1/projects/demo-project/locations/global/')).toBe(true);
	});

	it('maps 429 to a retryable rate_limited error', async () => {
		stubFetch(() => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }));
		await expect(generateImage('x')).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 10 });
	});

	it('surfaces a 500 with providerStatus so the caller can fall back', async () => {
		stubFetch(() => new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }));
		await expect(generateImage('x')).rejects.toMatchObject({ providerStatus: 500 });
	});

	it('maps a network failure to provider_unreachable', async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error('ECONNRESET');
		});
		await expect(generateImage('x')).rejects.toMatchObject({ code: 'provider_unreachable' });
	});

	it('throws unconfigured when GOOGLE_CLOUD_PROJECT is missing', async () => {
		delete process.env.GOOGLE_CLOUD_PROJECT;
		expect(isConfigured()).toBe(false);
		await expect(generateImage('x')).rejects.toMatchObject({ code: 'unconfigured' });
	});
});

describe('vertex-imagen — editImage routing', () => {
	it('sends the source image as an inlineData part on the Gemini edit path', async () => {
		const calls = stubFetch(() => geminiImageResponse());
		const src = `data:image/png;base64,${Buffer.from('source').toString('base64')}`;
		const result = await editImage(src, 'make it blue');

		const { url, body } = calls[0];
		expect(url).toContain(`/models/${IMAGE_MODEL_PRIMARY}:generateContent`);
		expect(body.contents[0].parts[0].text).toBe('make it blue');
		expect(body.contents[0].parts[1].inlineData.data).toBe(Buffer.from('source').toString('base64'));
		expect(result.model).toBe(`vertex-ai/${IMAGE_MODEL_PRIMARY}`);
	});

	it('declares the source image its real mime type, not a hardcoded PNG', async () => {
		const calls = stubFetch(() => geminiImageResponse());
		await editImage(`data:image/jpeg;base64,${Buffer.from('jpg-source').toString('base64')}`, 'rotate it');
		expect(calls[0].body.contents[0].parts[1].inlineData.mimeType).toBe('image/jpeg');
	});

	it('carries the fetched content-type through for an http(s) source', async () => {
		safeFetch.mockResolvedValueOnce(
			new Response(Buffer.from('webp-bytes'), { status: 200, headers: { 'content-type': 'image/webp' } }),
		);
		const calls = stubFetch(() => geminiImageResponse());
		await editImage('https://cdn.example.com/ref.webp', 'rotate it');

		expect(safeFetch).toHaveBeenCalledWith('https://cdn.example.com/ref.webp', expect.objectContaining({ signal: expect.anything() }));
		const part = calls[0].body.contents[0].parts[1].inlineData;
		expect(part.mimeType).toBe('image/webp');
		expect(part.data).toBe(Buffer.from('webp-bytes').toString('base64'));
	});

	it('rejects a non-base64 data: URI instead of forwarding garbage to Vertex', async () => {
		const calls = stubFetch(() => geminiImageResponse());
		await expect(editImage('data:image/svg+xml,%3Csvg/%3E', 'x')).rejects.toMatchObject({
			code: 'bad_source_image',
		});
		expect(calls).toHaveLength(0);
	});

	it('surfaces an unreachable source image instead of editing an error body', async () => {
		safeFetch.mockResolvedValueOnce(new Response('nope', { status: 404 }));
		const calls = stubFetch(() => geminiImageResponse());
		await expect(editImage('https://cdn.example.com/gone.png', 'x')).rejects.toThrow(/upstream 404/);
		expect(calls).toHaveLength(0);
	});

	it('refuses a source image past the inline size cap', async () => {
		safeFetch.mockResolvedValueOnce(
			new Response('x', { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(64 * 1024 * 1024) } }),
		);
		stubFetch(() => geminiImageResponse());
		await expect(editImage('https://cdn.example.com/huge.png', 'x')).rejects.toMatchObject({
			code: 'source_image_too_large',
		});
	});

	it('routes the legacy :predict mask through the SSRF guard, not a bare fetch', async () => {
		process.env.VERTEX_IMAGEN_EDIT_MODEL = 'imagen-3.0-capability-001';
		safeFetch.mockResolvedValueOnce(
			new Response(Buffer.from('mask-bytes'), { status: 200, headers: { 'content-type': 'image/png' } }),
		);
		const calls = stubFetch(() => imagenPredictResponse());
		const src = `data:image/png;base64,${Buffer.from('source').toString('base64')}`;
		await editImage(src, 'inpaint', { maskUrl: 'https://cdn.example.com/mask.png' });

		// The only guarded fetch is the mask (the source is an inline data: URI),
		// and the raw fetch stub saw the Vertex call alone.
		expect(safeFetch).toHaveBeenCalledTimes(1);
		expect(safeFetch.mock.calls[0][0]).toBe('https://cdn.example.com/mask.png');
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain(':predict');
		const instance = calls[0].body.instances[0];
		expect(instance.editConfig.editMode).toBe('inpainting-insert');
		expect(instance.mask.image.bytesBase64Encoded).toBe(Buffer.from('mask-bytes').toString('base64'));
	});
});

// The breaker (api/_lib/vertex-image-breaker.js) is shared with the forge
// reference step; these pin that the text-to-image ladder's Vertex client
// honours it too, so a billing hold costs one call, not one per request.
describe('vertex-imagen: shared breaker', () => {
	const BILLING_HOLD = {
		error: {
			code: 403,
			message: 'There are issues with your billing account, please resolve / pay your outstanding balance for project: projects/93741856',
			status: 'PERMISSION_DENIED',
		},
	};

	it('after one billing 403, the next ten generate and edit calls make zero network calls', async () => {
		const calls = stubFetch(() => new Response(JSON.stringify(BILLING_HOLD), { status: 403 }));
		await expect(generateImage('x')).rejects.toMatchObject({ providerStatus: 403 });
		expect(calls).toHaveLength(1);
		for (let i = 0; i < 5; i++) {
			const t0 = performance.now();
			await expect(generateImage('x')).rejects.toMatchObject({ code: 'provider_cooling', vertexFailureKind: 'billing' });
			expect(performance.now() - t0).toBeLessThan(50);
			await expect(editImage(`data:image/png;base64,${PNG_B64}`, 'side view')).rejects.toMatchObject({ code: 'provider_cooling' });
		}
		expect(calls).toHaveLength(1);
		const state = await vertexBreakerState();
		expect(state).toMatchObject({ state: 'open', kind: 'billing', failures: 1 });
	});

	it('the cooling error carries no providerStatus, so a caller cannot mistake it for a fresh 403', async () => {
		stubFetch(() => new Response(JSON.stringify(BILLING_HOLD), { status: 403 }));
		await generateImage('x').catch(() => {});
		const err = await generateImage('x').catch((e) => e);
		expect(err.providerStatus).toBeUndefined();
		expect(err.retryAt).toMatch(/^\d{4}-/);
	});

	it('ignoreBreaker still tries a cooled lane when the caller has nothing behind it', async () => {
		const calls = stubFetch(() => new Response(JSON.stringify(BILLING_HOLD), { status: 403 }));
		await generateImage('x').catch(() => {});
		await expect(generateImage('x', { ignoreBreaker: true })).rejects.toMatchObject({ providerStatus: 403 });
		expect(calls).toHaveLength(2);
	});

	it('a safety block does not cool the lane', async () => {
		let calls = stubFetch(
			() => new Response(JSON.stringify({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }), { status: 200 }),
		);
		await expect(generateImage('x')).rejects.toThrow(/IMAGE_SAFETY/);
		expect((await vertexBreakerState()).state).toBe('closed');
		calls = stubFetch(() => geminiImageResponse());
		await generateImage('y');
		expect(calls).toHaveLength(1);
	});

	it('a 429 honours the stated RetryInfo delay', async () => {
		stubFetch(
			() =>
				new Response(
					JSON.stringify({
						error: {
							code: 429,
							message: 'Resource exhausted.',
							status: 'RESOURCE_EXHAUSTED',
							details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '21s' }],
						},
					}),
					{ status: 429 },
				),
		);
		await expect(generateImage('x')).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 21 });
		const state = await vertexBreakerState();
		expect(state.kind).toBe('quota');
		expect(Date.parse(state.next_probe_at) - Date.now()).toBeGreaterThan(19_000);
		expect(Date.parse(state.next_probe_at) - Date.now()).toBeLessThanOrEqual(21_000);
	});

	it('a success while half-open closes the breaker', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			stubFetch(() => new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 503 }));
			await generateImage('x').catch(() => {});
			vi.setSystemTime(Date.now() + 31_000);
			expect((await vertexBreakerState()).state).toBe('half_open');
			const calls = stubFetch(() => geminiImageResponse());
			await generateImage('x');
			expect(calls).toHaveLength(1);
			expect((await vertexBreakerState()).state).toBe('closed');
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('vertex-imagen: returned image validation', () => {
	it('rejects a flat single-colour frame without cooling the lane', async () => {
		stubFetch(() => geminiImageResponse(FLAT_B64));
		await expect(generateImage('x')).rejects.toMatchObject({ code: 'bad_image', reason: 'blank' });
		expect((await vertexBreakerState()).state).toBe('closed');
	});

	it('rejects a thumbnail', async () => {
		stubFetch(() => geminiImageResponse(THUMB_B64));
		await expect(generateImage('x')).rejects.toMatchObject({ code: 'bad_image', reason: 'dimensions' });
	});

	it('rejects bytes that do not decode as an image, on the edit path too', async () => {
		stubFetch(() => geminiImageResponse(Buffer.from('<html>502 Bad Gateway</html>'.repeat(4)).toString('base64')));
		await expect(editImage(`data:image/png;base64,${PNG_B64}`, 'side view')).rejects.toMatchObject({
			code: 'bad_image',
			reason: 'undecodable',
		});
	});
});
