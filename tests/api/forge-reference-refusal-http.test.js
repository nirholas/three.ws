// HTTP boundary for a provider-stated wait on the reference-image step.
//
// seedReferenceImage (api/forge.js) rethrows a refusal that carries the
// provider's own Retry-After instead of asking the same provider again. This
// suite drives a real text-prompt POST through the handler and pins what the
// page receives: HTTP 429, the provider's number in both the `retry-after`
// header and `retry_after` in the body (never the handler's default), and no
// second request to the standing text-to-image ladder.

import { describe, it, expect, vi, beforeAll } from 'vitest';

// POST /api/forge needs an account; this exercises what happens past that gate.
vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

const calls = vi.hoisted(() => ({ module: 0, ladder: 0 }));

// The keyless rung's refusal on 2026-11-26, as the ladder throws it.
vi.mock('../../api/_lib/forge-reference-image.js', () => ({
	generateReferenceImage: async () => {
		calls.module++;
		throw Object.assign(
			new Error('pollinations returned 402: FREE_LIMIT Free limit reached: 1 image every 45 seconds per IP'),
			{ code: 'rate_limited', providerStatus: 402, retryAfter: 45, queued: true },
		);
	},
}));
vi.mock('../../api/_mcp3d/text-to-image.js', async (importOriginal) => ({
	...(await importOriginal()),
	textToImage: async () => {
		calls.ladder++;
		return { imageUrl: 'https://cdn.test/ladder.png', model: 'pollinations/flux' };
	},
}));

// The native NIM text lane is a different provider, so the handler may still
// try it as a last resort. It is down here so the boundary under test is the
// one the user sees when nothing else can serve.
vi.mock('../../api/_providers/nvidia.js', () => ({
	createNvidiaProvider: () => ({
		textTo3d: async () => {
			throw Object.assign(new Error('NIM unavailable'), { code: 'provider_error', status: 502 });
		},
	}),
}));

// The free Hugging Face image-to-3D lane makes the text prompt go through the
// reference-image step. The request never reaches it; it is stubbed so a
// regression that did reach it could not call the network.
const hfSubmit = vi.hoisted(() => vi.fn(async () => ({ extJobId: 'hf-job' })));
vi.mock('../../api/_providers/huggingface.js', () => ({
	createRegenProvider: () => ({ submit: hfSubmit, status: async () => ({ status: 'queued' }) }),
}));

vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFree: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFreeTiered: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.45',
	};
});

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		NVIDIA_API_KEY: 'test-nvidia-key',
		HF_TOKEN: 'test-hf-token',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
	delete process.env.FORGE_REFERENCE_IMAGE;
});

const { default: handler } = await import('../../api/forge.js');

function makeReq(body) {
	return {
		method: 'POST',
		url: '/api/forge',
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester', 'x-vercel-ip-country': 'US' },
		on(event, cb) {
			if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
			if (event === 'end') cb();
		},
	};
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) {
			this.headers[String(name).toLowerCase()] = value;
		},
		getHeader(name) {
			return this.headers[String(name).toLowerCase()];
		},
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
}

describe('POST /api/forge when the image provider states its wait', () => {
	it("answers 429 with the provider's own retry_after and does not ask the ladder again", async () => {
		const res = makeRes();
		await handler(makeReq({ prompt: 'a red ceramic mug', tier: 'standard', path: 'image' }), res);

		expect(calls.module).toBe(1);
		expect(calls.ladder).toBe(0);
		expect(hfSubmit).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(429);
		expect(res.headers['retry-after']).toBe('45');
		expect(res.body).toMatchObject({ error: 'rate_limited', queued: true, retry_after: 45 });
		expect(res.body.message).toContain('45s');
	});
});
