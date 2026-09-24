/**
 * Credit-exhaustion rescue + designed degradation for api/forge.js.
 *
 * The prod failure (TASK-4): the platform's paid Replicate account ran out of
 * credit, so the FLUX reference-image synthesis (textToImage) — the FIRST paid
 * step of a standard/high tier text→3D request — threw a billing/402 error.
 *
 * That billing error is NOT "upstream-unavailable" (it's a 402, not a 429/5xx),
 * so the last-resort free NIM TRELLIS text→mesh rescue used to be skipped and the
 * request dead-ended at the 503 — even though NIM TRELLIS is native text→mesh and
 * needs no FLUX intermediate at all, i.e. a perfectly healthy free lane was left
 * unused. These tests pin the corrected behavior:
 *
 *   1. FLUX synthesis out of credit + NIM TRELLIS healthy → the prompt is rescued
 *      on the free NIM lane (200, backend:nvidia). The paid reconstruct is never
 *      reached (the failure was at synthesis, before it).
 *   2. FLUX synthesis out of credit + NIM TRELLIS also down → a DESIGNED
 *      "temporarily unavailable" 503 (never a 500, never the vendor billing leak).
 *
 * The HF reconstruct lane is deliberately irrelevant here: it reconstructs the
 * SYNTHESIZED view, and synthesis is exactly what's broke — only a native
 * text→mesh lane can rescue this, which is the whole point of the fix.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		REPLICATE_API_TOKEN: 'test-token',
		NVIDIA_API_KEY: 'test-nvidia-key',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
	delete process.env.GCP_HUNYUAN3D_URL;
	delete process.env.GCP_RECONSTRUCTION_KEY;
	delete process.env.HF_TOKEN; // no free reconstruct lane — irrelevant to a synth failure
	delete process.env.FORGE_PREFER_FREE;
});

// Free NIM TRELLIS text→mesh lane. Default: HEALTHY, returns a finished GLB
// synchronously (no taskId) exactly like the real sync NVCF branch. A test can
// flip it to down to exercise the designed-503 path.
const nvidiaTextTo3d = vi.fn(async () => ({
	kind: 'trellis',
	taskId: null,
	resultGlbUrl: 'https://cdn.example/nim-rescue.glb',
}));
vi.mock('../../api/_providers/nvidia.js', () => ({
	createNvidiaProvider: () => ({ textTo3d: nvidiaTextTo3d }),
}));

// Mirror the prod symptom precisely: the cached lane-health snapshot has the
// free NVIDIA NIM lane marked DOWN (a cold/cooled NVCF gateway), so a standard
// text prompt is health-routed AROUND NIM to the paid image-intermediate
// (TRELLIS/FLUX) lane up front — which is exactly where the out-of-credit FLUX
// synthesis below detonates. NIM is then the LAST-RESORT rescue, not the first
// lane: with the gateway healthy again by the time the rescue runs, the prompt
// is recovered natively (no FLUX needed). Without this the request would resolve
// on NIM immediately and never reach paid synthesis at all.
const laneHealthSnapshot = vi.fn(async () => ({ byId: { nvidia: { id: 'nvidia', status: 'down' } }, statusMap: { nvidia: 'down' } }));
vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot,
	markLaneUnhealthy: vi.fn(async () => {}),
}));

// Pin the provider-health cooldown boundary to a clean state. The NIM-rescue in
// the credit-exhaustion path only fires when the free NIM lane is NOT in a
// recent-failure cooldown — exactly the scenario these tests model ("the gateway
// healthy again by the time the rescue runs"). That cooldown lives in the SHARED
// cache (Redis when configured, in-memory otherwise), so without stubbing it a
// sibling forge test that drove a NIM failure could leave NIM_TRELLIS cooling and
// suppress the rescue here — a cross-test flake, not a behavior change. Stubbing
// it makes this file hermetic; the cooldown router itself is covered by
// tests/api/forge-nim-cooldown.test.js. markProviderCooldown is a no-op so a
// failure inside one test never pins state for the next.
vi.mock('../../api/_lib/provider-health.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		providersInCooldown: vi.fn(async () => new Map()),
		markProviderCooldown: vi.fn(async () => {}),
	};
});

// FLUX reference-image synthesis is OUT OF CREDIT — the exact prod symptom. This
// throws the billing envelope textToImage tags (code:'billing', providerStatus:402),
// which is NOT upstream-unavailable.
const textToImage = vi.fn(async () => {
	throw Object.assign(new Error('image provider billing error'), {
		code: 'billing',
		providerStatus: 402,
		providerDetail:
			'You have insufficient credit to run this model. Go to https://replicate.com/account/billing to purchase credit.',
	});
});
vi.mock('../../api/_mcp3d/text-to-image.js', () => ({ textToImage }));

// Paid Replicate reconstruct. A module-level spy lets us assert it is NEVER
// reached — the failure is at synthesis, upstream of any reconstruct.
const replicateSubmit = vi.fn(async () => ({ extJobId: 'should-not-run' }));
vi.mock('../../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({ submit: replicateSubmit }),
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

vi.mock('../../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
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
		clientIp: () => '203.0.113.21',
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
		getHeader(name) {
			return this.headers[String(name).toLowerCase()];
		},
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
}

describe('forge credit-exhaustion rescue', () => {
	it('rescues a text prompt on the free NIM lane when paid FLUX synthesis is out of credit', async () => {
		nvidiaTextTo3d.mockClear();
		replicateSubmit.mockClear();
		textToImage.mockClear();

		// Standard tier text→3D with the NIM lane health-routed AROUND (snapshot
		// reports it down above), so the request reaches the paid FLUX synthesis —
		// which is dry — and must fail OVER to the native free NIM text→mesh lane
		// (healthy again by rescue time) rather than dead-end.
		const req = makeReq({ prompt: 'a red ceramic mug', tier: 'standard', path: 'image' });
		const res = makeRes();
		await handler(req, res);

		expect(textToImage).toHaveBeenCalled(); // paid synthesis attempted (and broke)
		expect(res.statusCode).toBe(200);
		expect(res.body.status).toBe('done');
		expect(res.body.backend).toBe('nvidia'); // provenance shows the lane that actually ran
		expect(res.body.glb_url).toBe('https://cdn.example/nim-rescue.glb');
		expect(nvidiaTextTo3d).toHaveBeenCalled();
		// The reconstruct lane was never reached — the failure was upstream of it.
		expect(replicateSubmit).not.toHaveBeenCalled();
	});

	it('returns a DESIGNED unavailable state (not a 500) when synthesis is out of credit AND the free NIM lane is also down', async () => {
		textToImage.mockClear();
		nvidiaTextTo3d.mockClear();
		// NIM rescue is down too — every lane is exhausted.
		nvidiaTextTo3d.mockRejectedValueOnce(
			Object.assign(new Error('TRELLIS gateway 503'), { code: 'provider_unreachable' }),
		);

		const req = makeReq({ prompt: 'a red ceramic mug', tier: 'standard', path: 'image' });
		const res = makeRes();
		await handler(req, res);

		expect(textToImage).toHaveBeenCalled();
		expect(nvidiaTextTo3d).toHaveBeenCalled(); // the rescue WAS attempted
		expect(res.statusCode).toBe(503); // honest, designed — never a 500
		expect(res.body.error).toBe('generation_unavailable');
		// The vendor's raw billing copy is never leaked to the buyer.
		expect(res.body.message).not.toMatch(/credit|replicate|billing|insufficient/i);
		expect(res.headers['retry-after']).toBe('30');
	});
});
