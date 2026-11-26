/**
 * The Vertex reference-image lane steps aside instantly when Google refuses it
 * for a reason that will not clear on the next request (billing hold, missing
 * permission, exhausted quota, an outage), and comes back by itself.
 *
 * Measured 2026-11-26: the project was under a billing hold and Vertex answered
 * every image call with 403 "There are issues with your billing account...".
 * These tests pin what the forge reference step does with that answer and with
 * every other class of Vertex failure: which ones cool the lane, for how long,
 * how many network calls a request makes while it is cooled, and how a single
 * probe after the cooldown restores (or re-cools) the lane without a restart.
 *
 * Only the network boundary is stubbed: the GCP token mint, Vertex's HTTP
 * answers (recorded shapes of Google's real bodies), the R2 write, and the
 * fallthrough ladder (which has its own suites). The breaker state runs through
 * the real provider-health + cache modules on the in-memory backend.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { REAL_PNG_B64, encodeTestImage } from '../_helpers/real-image.js';

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.REDIS_URL;
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
delete process.env.VERTEX_IMAGEN_ENABLED;
delete process.env.VERTEX_IMAGEN_MODEL;
delete process.env.FORGE_REF_IMAGE_PROVIDER;

const token = vi.hoisted(() => ({ calls: 0, fail: null }));
vi.mock('../../api/_lib/gcp-auth.js', () => ({
	getGcpAccessToken: async () => {
		token.calls += 1;
		if (token.fail) throw token.fail;
		return 'tok';
	},
}));
vi.mock('../../api/_lib/redis.js', () => ({ getRedis: () => null }));
vi.mock('../../api/_lib/image-persist.js', async (importOriginal) => ({
	...(await importOriginal()),
	persistImageBase64: async () => 'https://cdn.test/ref.png',
}));
vi.mock('../../api/forge-enhance.js', () => ({ subjectNegativePrompt: () => 'blurry' }));

const ladder = vi.hoisted(() => ({ calls: 0, startedAt: 0, latencies: [] }));
vi.mock('../../api/_mcp3d/text-to-image.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		textToImage: async () => {
			ladder.calls += 1;
			ladder.latencies.push(performance.now() - ladder.startedAt);
			return { imageUrl: 'https://cdn.test/ladder.png', model: 'pollinations/flux' };
		},
	};
});

const { generateReferenceImage } = await import('../../api/_lib/forge-reference-image.js');
const { vertexBreakerState, resetVertexBreaker, classifyVertexFailure } = await import(
	'../../api/_lib/vertex-image-breaker.js'
);

// ── Real image fixtures (decodable PNGs, not placeholder bytes) ──────────────
const GOOD_PNG = REAL_PNG_B64;
const BLANK_PNG = await encodeTestImage({ flat: true });
const TINY_PNG = await encodeTestImage({ width: 16, height: 16 });

const imageBody = (b64) => ({
	candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64 } }] }, finishReason: 'STOP' }],
});

// Google's real answers, recorded shapes.
const BILLING_HOLD_403 = {
	error: {
		code: 403,
		message:
			'There are issues with your billing account, please resolve / pay your outstanding balance for project: projects/93741856',
		status: 'PERMISSION_DENIED',
	},
};
const BILLING_DISABLED_403 = {
	error: {
		code: 403,
		message:
			'This API method requires billing to be enabled. Please enable billing on project #93741856 by visiting https://console.developers.google.com/billing/enable?project=93741856 then retry.',
		status: 'PERMISSION_DENIED',
		details: [
			{
				'@type': 'type.googleapis.com/google.rpc.ErrorInfo',
				reason: 'BILLING_DISABLED',
				domain: 'googleapis.com',
				metadata: { service: 'aiplatform.googleapis.com', consumer: 'projects/93741856' },
			},
		],
	},
};
const PERMISSION_403 = {
	error: {
		code: 403,
		message: "Permission 'aiplatform.endpoints.predict' denied on resource '//aiplatform.googleapis.com/projects/test-project/locations/global/publishers/google/models/x' (or it may not exist).",
		status: 'PERMISSION_DENIED',
		details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'IAM_PERMISSION_DENIED' }],
	},
};
const QUOTA_429 = {
	error: {
		code: 429,
		message: 'Resource exhausted. Please try again later. Please refer to https://cloud.google.com/vertex-ai/generative-ai/docs/error-code-429 for more details.',
		status: 'RESOURCE_EXHAUSTED',
		details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }],
	},
};
const UNAVAILABLE_503 = { error: { code: 503, message: 'The service is currently unavailable.', status: 'UNAVAILABLE' } };
const SAFETY_BLOCK = { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] };
const PROMPT_BLOCK = { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } };

// Vertex double. `answer` decides each image call; QA scoring (a text model)
// answers 500 so a served image ships unscored and only image calls count.
let answer;
let imageCalls;
function installFetch() {
	globalThis.fetch = vi.fn(async (url) => {
		const model = /models\/([^:]+):generateContent/.exec(String(url))?.[1];
		if (!model || !model.includes('image')) return new Response('{}', { status: 500 });
		imageCalls += 1;
		const out = await answer(imageCalls);
		if (out instanceof Error) throw out;
		const [status, body, headers = {}] = out;
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
	});
}

async function run(prompt = 'a ceramic mug') {
	ladder.startedAt = performance.now();
	return generateReferenceImage(prompt, { budgetMs: 30_000 });
}

const MIN = 60_000;
let now;
function advance(ms) {
	now += ms;
	vi.setSystemTime(now);
}

beforeEach(async () => {
	now = Date.parse('2026-11-26T20:00:00Z');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(now);
	await resetVertexBreaker();
	token.calls = 0;
	token.fail = null;
	ladder.calls = 0;
	ladder.latencies = [];
	imageCalls = 0;
	installFetch();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('a billing hold (403) parks the Vertex lane after one call', () => {
	it('makes one Vertex call, then ten requests make zero calls and each falls through in under 50 ms', async () => {
		answer = () => [403, BILLING_HOLD_403];
		const first = await run();
		expect(imageCalls).toBe(1); // no model-chain retry, no re-roll of a denial
		expect(first.model).toBe('pollinations/flux');

		const tokenCallsAfterFirst = token.calls;
		for (let i = 0; i < 10; i++) {
			const out = await run(`prompt ${i}`);
			expect(out.imageUrl).toBe('https://cdn.test/ladder.png');
		}
		expect(imageCalls).toBe(1);
		expect(token.calls).toBe(tokenCallsAfterFirst);
		expect(ladder.calls).toBe(11);
		for (const ms of ladder.latencies.slice(1)) expect(ms).toBeLessThan(50);
	});

	it('names the billing class, the detail and the next probe time in the breaker state', async () => {
		answer = () => [403, BILLING_HOLD_403];
		await run();
		const state = await vertexBreakerState();
		expect(state.state).toBe('open');
		expect(state.kind).toBe('billing');
		expect(state.detail).toMatch(/billing account/);
		expect(state.failures).toBe(1);
		expect(Date.parse(state.next_probe_at)).toBe(now + 10 * MIN);
	});

	it('classifies the BILLING_DISABLED ErrorInfo body as billing too', async () => {
		answer = () => [403, BILLING_DISABLED_403];
		await run();
		expect((await vertexBreakerState()).kind).toBe('billing');
	});

	it('cools a missing IAM permission for the same long window', async () => {
		answer = () => [403, PERMISSION_403];
		await run();
		const state = await vertexBreakerState();
		expect(state.kind).toBe('permission');
		expect(Date.parse(state.next_probe_at)).toBe(now + 10 * MIN);
		await run();
		expect(imageCalls).toBe(1);
	});
});

describe('a safety block is about the prompt, not the provider', () => {
	it('falls through for that prompt and leaves the breaker closed', async () => {
		answer = () => [200, SAFETY_BLOCK];
		const out = await run('something the model refuses');
		expect(out.model).toBe('pollinations/flux');
		expect((await vertexBreakerState()).state).toBe('closed');

		answer = () => [200, imageBody(GOOD_PNG)];
		const next = await run('a ceramic mug');
		expect(next.lane).toBe('vertex-reference');
	});

	it('treats a promptFeedback blockReason the same way', async () => {
		answer = () => [200, PROMPT_BLOCK];
		await run('blocked prompt');
		expect((await vertexBreakerState()).state).toBe('closed');
		const calls = imageCalls;
		answer = () => [200, imageBody(GOOD_PNG)];
		await run('a ceramic mug');
		expect(imageCalls).toBe(calls + 1);
	});
});

describe('quota exhaustion honours the stated reset', () => {
	it('cools for exactly the RetryInfo delay, then probes', async () => {
		answer = () => [429, QUOTA_429];
		await run();
		expect(imageCalls).toBe(1);
		const state = await vertexBreakerState();
		expect(state.kind).toBe('quota');
		expect(Date.parse(state.next_probe_at)).toBe(now + 37_000);

		advance(30_000);
		await run();
		expect(imageCalls).toBe(1);

		advance(8_000);
		answer = () => [200, imageBody(GOOD_PNG)];
		const out = await run();
		expect(imageCalls).toBe(2);
		expect(out.lane).toBe('vertex-reference');
	});

	it('honours a Retry-After header when the body has no RetryInfo', async () => {
		answer = () => [429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }, { 'retry-after': '12' }];
		await run();
		expect(Date.parse((await vertexBreakerState()).next_probe_at)).toBe(now + 12_000);
	});
});

describe('outages cool the lane briefly instead of re-paying the timeout', () => {
	it('a 503 cools for 30 s', async () => {
		answer = () => [503, UNAVAILABLE_503];
		await run();
		const state = await vertexBreakerState();
		expect(state.kind).toBe('transient');
		expect(Date.parse(state.next_probe_at)).toBe(now + 30_000);
		await run();
		expect(imageCalls).toBe(1);
	});

	it('a timeout cools for 60 s', async () => {
		answer = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
		await run();
		const state = await vertexBreakerState();
		expect(state.kind).toBe('timeout');
		expect(Date.parse(state.next_probe_at)).toBe(now + 60_000);
		await run();
		expect(imageCalls).toBe(1);
	});
});

describe('recovery after the cooldown', () => {
	it('lets exactly one request probe; success closes the breaker', async () => {
		answer = () => [403, BILLING_HOLD_403];
		await run();
		advance(10 * MIN + 1_000);

		// Billing is restored. Five requests arrive together: one probes, the rest
		// fall through without touching Vertex while the probe is in flight.
		let release;
		const gate = new Promise((r) => { release = r; });
		answer = async () => {
			await gate;
			return [200, imageBody(GOOD_PNG)];
		};
		const inflight = Array.from({ length: 5 }, (_, i) => run(`p${i}`));
		await vi.waitFor(() => expect(ladder.calls).toBe(1 + 4));
		release();
		const results = await Promise.all(inflight);
		expect(imageCalls).toBe(2); // the original 403 plus one probe
		expect(results.filter((r) => r.lane === 'vertex-reference')).toHaveLength(1);
		expect((await vertexBreakerState()).state).toBe('closed');

		// Fully restored: every request goes to Vertex again.
		await run('after recovery');
		await run('after recovery 2');
		expect(imageCalls).toBe(4);
	});

	it('a failed probe doubles the cooldown, capped at 30 minutes', async () => {
		answer = () => [403, BILLING_HOLD_403];
		await run();
		advance(10 * MIN + 1_000);
		await run();
		expect(imageCalls).toBe(2);
		let state = await vertexBreakerState();
		expect(state.failures).toBe(2);
		expect(Date.parse(state.next_probe_at)).toBe(now + 20 * MIN);

		advance(20 * MIN + 1_000);
		await run();
		state = await vertexBreakerState();
		expect(Date.parse(state.next_probe_at)).toBe(now + 30 * MIN);

		advance(30 * MIN + 1_000);
		await run();
		state = await vertexBreakerState();
		expect(state.failures).toBe(4);
		expect(Date.parse(state.next_probe_at)).toBe(now + 30 * MIN);
		expect(imageCalls).toBe(4);
	});

	it('a safety block on the probe still proves Vertex answers and closes the breaker', async () => {
		answer = () => [503, UNAVAILABLE_503];
		await run();
		advance(31_000);
		answer = () => [200, SAFETY_BLOCK];
		await run();
		expect((await vertexBreakerState()).state).toBe('closed');
	});
});

describe('the access token', () => {
	it('a token mint failure is classified and cooled, so the next request does not mint again', async () => {
		token.fail = Object.assign(new Error('GCP metadata token refresh failed: fetch failed'), { code: 'metadata_unavailable' });
		await run();
		expect(token.calls).toBe(1);
		expect(imageCalls).toBe(0);
		const state = await vertexBreakerState();
		expect(state.kind).toBe('token');
		expect(Date.parse(state.next_probe_at)).toBe(now + 60_000);

		await run();
		expect(token.calls).toBe(1);
	});

	it('no credentials at all cools for the long window', async () => {
		token.fail = Object.assign(new Error('No GCP credentials found.'), { code: 'unconfigured' });
		await run();
		const state = await vertexBreakerState();
		expect(state.kind).toBe('unconfigured');
		expect(Date.parse(state.next_probe_at)).toBe(now + 10 * MIN);
	});
});

describe('a returned image is validated before it is used', () => {
	it('a blank image falls through to the ladder and does not cool the lane', async () => {
		answer = () => [200, imageBody(BLANK_PNG)];
		const out = await run();
		expect(out.model).toBe('pollinations/flux');
		expect((await vertexBreakerState()).state).toBe('closed');
	});

	it('a tiny image falls through', async () => {
		answer = () => [200, imageBody(TINY_PNG)];
		const out = await run();
		expect(out.model).toBe('pollinations/flux');
	});

	it('bytes that do not decode as an image fall through', async () => {
		answer = () => [200, imageBody(Buffer.from('<html>gateway error</html>').toString('base64'))];
		const out = await run();
		expect(out.model).toBe('pollinations/flux');
	});

	it('a real image is used', async () => {
		answer = () => [200, imageBody(GOOD_PNG)];
		const out = await run();
		expect(out.lane).toBe('vertex-reference');
		expect(ladder.calls).toBe(0);
	});
});

describe('classifyVertexFailure', () => {
	const err = (status, body, extra = {}) =>
		Object.assign(new Error(`Vertex returned ${status}`), { providerStatus: status, providerBody: body, ...extra });
	it('maps every class', () => {
		expect(classifyVertexFailure(err(403, BILLING_HOLD_403))).toBe('billing');
		expect(classifyVertexFailure(err(403, BILLING_DISABLED_403))).toBe('billing');
		expect(classifyVertexFailure(err(402, {}))).toBe('billing');
		expect(classifyVertexFailure(err(403, PERMISSION_403))).toBe('permission');
		expect(classifyVertexFailure(err(401, {}))).toBe('permission');
		expect(classifyVertexFailure(err(429, QUOTA_429))).toBe('quota');
		expect(classifyVertexFailure(err(404, { error: { message: 'Publisher Model not found.' } }))).toBe('model_not_found');
		expect(classifyVertexFailure(err(503, UNAVAILABLE_503))).toBe('transient');
		expect(classifyVertexFailure(err(500, {}))).toBe('transient');
		expect(classifyVertexFailure(new Error('Vertex reference image produced no image (finishReason: IMAGE_SAFETY)'))).toBe('safety');
		expect(classifyVertexFailure(err(400, { error: { message: 'The prompt violates our safety policy.' } }))).toBe('safety');
		expect(classifyVertexFailure(err(400, { error: { message: 'Invalid JSON payload.' } }))).toBe('bad_request');
		expect(classifyVertexFailure(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('timeout');
		expect(classifyVertexFailure(Object.assign(new Error('fetch failed'), { code: 'provider_unreachable' }))).toBe('transient');
		expect(classifyVertexFailure(Object.assign(new Error('blank'), { code: 'bad_image' }))).toBe('bad_image');
		expect(classifyVertexFailure(Object.assign(new Error('x'), { vertexStage: 'token', code: 'metadata_unavailable' }))).toBe('token');
		expect(classifyVertexFailure(Object.assign(new Error('x'), { vertexStage: 'token', code: 'unconfigured' }))).toBe('unconfigured');
	});
});
