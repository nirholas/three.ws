/**
 * The Modly lanes through the real forge handlers: api/forge.js and its
 * ChatGPT clone api/gpt-forge.js.
 *
 * tests/api/forge-modly.test.js pins the registry, routing and wire contract in
 * isolation. These tests drive a full POST through each handler with only the
 * network edges stubbed, so the wiring between them is what is under test: an
 * explicit Modly pick reaches the gcp provider in Modly's mode with the tier's
 * face budget, a worker outage cools the lane and retries the same request on
 * TRELLIS.2, a licence-restricted territory is refused with a reason, and a
 * deployment without the worker URL answers 501 naming the lane.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		// Both self-host image workers wired: Modly and the TRELLIS.2 retry target.
		MODEL_MODLY_URL: 'https://modly.example.run.app',
		MODEL_TRELLIS2_URL: 'https://trellis2.example.run.app',
		GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
		// Satisfies the handler's global text-to-3D configured guard.
		NVIDIA_API_KEY: 'nvapi-test',
		// The lane wraps its job id in a signed forge token (encodeJobToken).
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
});

// The self-host GCP worker accepts the job and returns a poll handle. Tests
// override it once to simulate a cold, failing or unconfigured worker.
const gcpSubmit = vi.fn(async () => ({ extJobId: 'gcpjob-modly-01', viewsUsed: 1, multiview: false }));
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({ submit: gcpSubmit }),
}));

vi.mock('../../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
	synthesizeTurnaroundViews: vi.fn(async () => []),
}));

// Store: no real DB. createCreation returns an id; failures are recorded.
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

// Lane health: report everything unknown (fail-open), as a deployment with no
// telemetry would. markLaneUnhealthy is asserted on the failover path.
vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ statusMap: {}, byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
	laneCooldownKey: (id) => `forge-lane:${id}`,
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
		},
		clientIp: () => '203.0.113.9',
	};
});

const { default: forgeHandler } = await import('../../api/forge.js');
const { default: gptForgeHandler } = await import('../../api/gpt-forge.js');
const { markLaneUnhealthy } = await import('../../api/_lib/forge-lane-health.js');
const { decodeJobToken } = await import('../../api/_lib/forge-job-token.js');

function makeReq(url, body, headers = {}) {
	return {
		method: 'POST',
		url,
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester', ...headers },
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

const PHOTO = 'https://cdn.example/photo.png';

function photoBody(backend, tier = 'standard') {
	return { image_urls: [PHOTO], tier, path: 'image', backend, skip_validation: true };
}

beforeEach(() => {
	gcpSubmit.mockReset();
	gcpSubmit.mockResolvedValue({ extJobId: 'gcpjob-modly-01', viewsUsed: 1, multiview: false });
	markLaneUnhealthy.mockClear();
});

describe.each([
	['/api/forge', forgeHandler],
	['/api/gpt-forge', gptForgeHandler],
])('%s: Modly lanes', (url, handler) => {
	it('an explicit modly pick submits Modly mode with the tier face budget', async () => {
		const res = makeRes();
		await handler(makeReq(url, photoBody('modly')), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('modly');
		expect(res.body.status).toBe('queued');
		expect(gcpSubmit).toHaveBeenCalledTimes(1);
		const call = gcpSubmit.mock.calls[0][0];
		expect(call.mode).toBe('modly');
		expect(call.sourceUrl).toBe(PHOTO);
		expect(call.params.images).toEqual([PHOTO]);
		expect(call.params.tier).toBe('standard');
		expect(call.params.target_polycount).toBe(30000);
		// The job handle polls back through the gcp provider.
		expect(decodeJobToken(res.body.job_id)).toMatchObject({ provider: 'gcp', taskId: 'gcpjob-modly-01' });
	});

	it('an explicit modly_hunyuan pick submits its own mode in a licensed territory', async () => {
		const res = makeRes();
		// The Tencent lanes fail closed on an unknown territory, so the edge
		// country header is what admits this request.
		await handler(makeReq(url, photoBody('modly_hunyuan', 'draft'), { 'cf-ipcountry': 'US' }), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('modly_hunyuan');
		const call = gcpSubmit.mock.calls[0][0];
		expect(call.mode).toBe('modly_hunyuan');
		expect(call.params.tier).toBe('draft');
	});

	it('a worker outage cools the Modly lane and retries the same views on TRELLIS.2', async () => {
		gcpSubmit.mockRejectedValueOnce(Object.assign(new Error('worker 503'), { code: 'provider_error', providerStatus: 503 }));
		const res = makeRes();
		await handler(makeReq(url, photoBody('modly')), res);

		expect(res.statusCode).toBe(200);
		expect(markLaneUnhealthy).toHaveBeenCalledWith('modly');
		expect(gcpSubmit).toHaveBeenCalledTimes(2);
		expect(gcpSubmit.mock.calls[0][0].mode).toBe('modly');
		const retry = gcpSubmit.mock.calls[1][0];
		expect(retry.mode).toBe('trellis2');
		expect(retry.params.images).toEqual([PHOTO]);
		expect(res.body.backend).toBe('trellis2');
	});

	it('refuses modly_hunyuan where the Tencent licence excludes the territory', async () => {
		const res = makeRes();
		await handler(makeReq(url, photoBody('modly_hunyuan'), { 'cf-ipcountry': 'DE' }), res);

		expect(res.statusCode).toBe(403);
		expect(res.body.error).toBe('region_restricted');
		expect(res.body.backend).toBe('modly_hunyuan');
		expect(res.body.retry_backends).not.toContain('modly_hunyuan');
		expect(gcpSubmit).not.toHaveBeenCalled();
	});

	it('serves the TripoSG lane in the same territory', async () => {
		const res = makeRes();
		await handler(makeReq(url, photoBody('modly'), { 'cf-ipcountry': 'DE' }), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('modly');
	});

	it('answers 501 naming the lane when the worker URL is not set', async () => {
		gcpSubmit.mockRejectedValueOnce(Object.assign(new Error('MODEL_MODLY_URL unset'), { code: 'mode_unconfigured' }));
		const res = makeRes();
		await handler(makeReq(url, photoBody('modly')), res);

		expect(res.statusCode).toBe(501);
		expect(res.body.error).toBe('backend_unconfigured');
		expect(res.body.backend).toBe('modly');
		expect(res.body.message).toContain('Modly TripoSG (self-host)');
		expect(markLaneUnhealthy).not.toHaveBeenCalled();
	});
});
