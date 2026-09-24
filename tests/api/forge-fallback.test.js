/**
 * Resilience tests for the free-first routing and fallback in api/forge.js.
 *
 * Draft and Standard tier text prompts route DIRECTLY to the free NVIDIA NIM
 * lane — Replicate is never called for them unless NVIDIA itself fails. When
 * the paid Replicate lane IS invoked (e.g. by explicit backend selection or an
 * NVIDIA outage) and returns 429/5xx, a text prompt must NEVER dead-end: it
 * degrades to the free NVIDIA NIM lane so the default flow always returns a
 * model. These tests stub the provider boundaries and assert requests return a
 * finished model with provenance reporting the lane that actually ran
 * (backend:nvidia), so the routing is visible and never silent.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		REPLICATE_API_TOKEN: 'test-token',
		NVIDIA_API_KEY: 'test-nvidia-key',
		// Self-hosted Hunyuan3D worker wired → image→3D has a fallback target.
		GCP_HUNYUAN3D_URL: 'https://hunyuan3d.example.run.app',
		GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
		// The Hunyuan3D lane wraps its job id in a signed forge token (encodeJobToken),
		// which needs a signing secret — production always has one set.
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
});

// Self-hosted Hunyuan3D Cloud Run worker (the image→3D fallback) accepts the job
// and returns a poll handle, exactly like api/_providers/gcp.js.
const gcpSubmit = vi.fn(async () => ({ extJobId: 'gcpjob1234567890', viewsUsed: 1, multiview: false }));
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({ submit: gcpSubmit }),
}));

// Replicate (paid TRELLIS lane) is over-quota — every submit throws a 429 the
// same way api/_providers/replicate.js does on a non-ok response.
vi.mock('../../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({
		submit: vi.fn(async () => {
			throw Object.assign(new Error('replicate returned 429'), {
				code: 'provider_error',
				status: 502,
				providerStatus: 429,
			});
		}),
	}),
}));

// Free Hugging Face Spaces image→3D lane (fallback #2, after Hunyuan3D). Its
// submit() blocks and packs the GLB into extJobId; status() echoes it back. The
// real provider throws when HF_TOKEN is unset, so the mock mirrors that gating —
// the lane is only available on deployments that configure a token.
const hfSubmit = vi.fn(async () => ({ extJobId: 'hf-packed-job', rawStatus: 'completed' }));
const hfStatus = vi.fn(async () => ({ status: 'done', resultGlbUrl: 'https://cdn.example/hf.glb' }));
vi.mock('../../api/_providers/huggingface.js', () => ({
	createRegenProvider: () => {
		if (!process.env.HF_TOKEN) {
			throw Object.assign(new Error('HF_TOKEN env var is required'), {
				code: 'provider_unconfigured',
				status: 501,
			});
		}
		return { submit: hfSubmit, status: hfStatus };
	},
}));

// FLUX text-to-image (the standard-tier intermediate view) succeeds — the
// failure under test is the reconstruction submit, not image synthesis.
vi.mock('../../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
}));

// Free NVIDIA NIM lane completes synchronously with a durable GLB.
const nvidiaTextTo3d = vi.fn(async () => ({ taskId: null, resultGlbUrl: 'https://cdn.example/free.glb' }));
vi.mock('../../api/_providers/nvidia.js', () => ({
	createNvidiaProvider: () => ({ textTo3d: nvidiaTextTo3d }),
}));

// Store: no real DB. createCreation returns an id; materialize echoes a durable url.
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

// Vision pre-check is a no-op pass (irrelevant to text→3D anyway).
vi.mock('../../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
}));

// Rate limiter: deterministic success so the lane logic — not the limiter — is
// what the test exercises.
vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFree: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.9',
	};
});

const { default: handler } = await import('../../api/forge.js');

function makeReq(body) {
	return {
		method: 'POST',
		url: '/api/forge',
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester' },
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
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
}

describe('forge free-first fallback when the paid lane is over-quota', () => {
	it('routes a Standard text prompt directly to the free NVIDIA lane (no Replicate call)', async () => {
		const req = makeReq({ prompt: 'a red ceramic coffee mug', tier: 'standard', path: 'image' });
		const res = makeRes();
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.body.status).toBe('done');
		expect(res.body.backend).toBe('nvidia');
		expect(res.body.glb_url).toBe('https://cdn.example/free.glb');
		expect(nvidiaTextTo3d).toHaveBeenCalled();
	});

	it('degrades an image upload to the self-hosted Hunyuan3D worker (not NVIDIA — it is text-only)', async () => {
		nvidiaTextTo3d.mockClear();
		gcpSubmit.mockClear();
		const req = makeReq({
			image_urls: ['https://cdn.example/photo.png'],
			prompt: 'a mug',
			tier: 'standard',
			path: 'image',
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.body.status).toBe('queued');
		expect(res.body.backend).toBe('hunyuan3d');
		expect(gcpSubmit).toHaveBeenCalled();
		// NVIDIA is text-only — it must never be invoked for a photo upload.
		expect(nvidiaTextTo3d).not.toHaveBeenCalled();
		// Hunyuan3D is poly-aware: the tier budget the TRELLIS params omit is supplied.
		expect(gcpSubmit.mock.calls[0][0].params.target_polycount).toBeGreaterThan(0);
	});

	it('degrades an image upload to the free HuggingFace lane when no Hunyuan3D worker is wired but HF_TOKEN is set', async () => {
		const savedUrl = process.env.GCP_HUNYUAN3D_URL;
		delete process.env.GCP_HUNYUAN3D_URL;
		process.env.HF_TOKEN = 'test-hf-token';
		gcpSubmit.mockClear();
		nvidiaTextTo3d.mockClear();
		hfSubmit.mockClear();
		hfStatus.mockClear();
		try {
			const req = makeReq({
				image_urls: ['https://cdn.example/photo.png'],
				prompt: 'a mug',
				tier: 'standard',
				path: 'image',
				skip_validation: true,
			});
			const res = makeRes();
			await handler(req, res);

			// The HF Spaces lane blocks and returns the finished model synchronously,
			// so image→3D never dead-ends. Provenance reports the lane that ran.
			expect(res.statusCode).toBe(200);
			expect(res.body.status).toBe('done');
			expect(res.body.backend).toBe('huggingface');
			expect(res.body.glb_url).toBe('https://cdn.example/hf.glb');
			expect(hfSubmit).toHaveBeenCalled();
			// The Hunyuan3D worker wasn't wired, and NVIDIA is text-only — neither runs.
			expect(gcpSubmit).not.toHaveBeenCalled();
			expect(nvidiaTextTo3d).not.toHaveBeenCalled();
		} finally {
			process.env.GCP_HUNYUAN3D_URL = savedUrl;
			delete process.env.HF_TOKEN;
		}
	});

	it('surfaces the honest busy state for an image upload when neither Hunyuan3D nor HF_TOKEN is configured', async () => {
		const savedUrl = process.env.GCP_HUNYUAN3D_URL;
		delete process.env.GCP_HUNYUAN3D_URL;
		delete process.env.HF_TOKEN;
		gcpSubmit.mockClear();
		hfSubmit.mockClear();
		try {
			const req = makeReq({
				image_urls: ['https://cdn.example/photo.png'],
				prompt: 'a mug',
				tier: 'standard',
				path: 'image',
				skip_validation: true,
			});
			const res = makeRes();
			await handler(req, res);

			// No free reconstruct fallback exists → it does NOT fabricate a model; it
			// returns the honest busy state so the page can prompt a retry or Draft.
			expect(res.statusCode).toBe(429);
			expect(res.body.error).toBe('rate_limited');
			expect(gcpSubmit).not.toHaveBeenCalled();
			expect(hfSubmit).not.toHaveBeenCalled();
		} finally {
			process.env.GCP_HUNYUAN3D_URL = savedUrl;
		}
	});
});
