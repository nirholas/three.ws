/**
 * The Tencent lanes (hunyuan3d, huggingface, modly_hunyuan) through the real
 * forge handlers, api/forge.js and its ChatGPT clone api/gpt-forge.js, with only
 * the network edges stubbed.
 *
 * Three things are pinned, each against the same country table:
 *  - explicit selection: a caller in an excluded or unresolvable country who
 *    names a Tencent lane is refused with a reason and a list of lanes that do
 *    serve them, and neither the GCP worker nor the Hugging Face Spaces is
 *    ever contacted;
 *  - the default route: with no engine named, an excluded caller is routed to a
 *    lane outside the licence and still gets a queued job, while a licensed
 *    caller reaches the Tencent lane;
 *  - the handover: when the working lane (TRELLIS.2) cannot take the job, the
 *    request is handed to the next lane with the same images, a valid job token
 *    and the lane that actually serves it recorded, and an excluded caller is
 *    never handed to a Tencent lane.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

const ENV = {
	APP_ORIGIN: 'https://three.ws',
	GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
	NVIDIA_API_KEY: 'nvapi-test',
	JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
};
const LANE_ENV = {
	trellis2: ['MODEL_TRELLIS2_URL', 'https://trellis2.example.run.app'],
	hunyuan3d: ['GCP_HUNYUAN3D_URL', 'https://hunyuan.example.run.app'],
	modly: ['MODEL_MODLY_URL', 'https://modly.example.run.app'],
	huggingface: ['HF_TOKEN', 'hf_test'],
};
const ALL_VARS = [...Object.values(LANE_ENV).map(([k]) => k), 'MODEL_TRELLIS_URL', 'FORGE_SELFHOST_PRIMARY'];

// Wires exactly the named lanes on this deployment.
function wireLanes(...lanes) {
	for (const k of ALL_VARS) delete process.env[k];
	for (const id of lanes) {
		const [k, v] = LANE_ENV[id];
		process.env[k] = v;
	}
}

beforeAll(() => {
	Object.assign(process.env, ENV);
});

const gcpSubmit = vi.fn();
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({ submit: gcpSubmit }),
}));

// The Hugging Face Spaces provider. Counting its construction proves a request
// never reached the Spaces chain.
const hfSubmit = vi.fn();
const hfStatus = vi.fn();
const hfProviderFactory = vi.fn(() => {
	// The real module refuses to build without a token, and the handler treats
	// that as "lane not available on this deployment".
	if (!process.env.HF_TOKEN) {
		throw Object.assign(new Error('HF_TOKEN not set'), { code: 'provider_unconfigured' });
	}
	return { submit: hfSubmit, status: hfStatus };
});
vi.mock('../../api/_providers/huggingface.js', () => ({
	createRegenProvider: () => hfProviderFactory(),
}));

vi.mock('../../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
	synthesizeTurnaroundViews: vi.fn(async () => []),
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

vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ statusMap: {}, byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
	hfLaneCooling: vi.fn(async () => false),
	HF_LANE_COOLDOWN_SECONDS: 300,
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
const { TENCENT_LANES } = await import('../../api/_lib/forge-territory.js');

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
const photoBody = (backend, tier = 'standard') => ({
	image_urls: [PHOTO],
	tier,
	path: 'image',
	skip_validation: true,
	...(backend ? { backend } : {}),
});

// Every way the country can be excluded or unresolvable, as the request headers.
// Cloudflare and Vercel headers are forgeable by a caller (Cloud Run does not
// strip them), so they must never unlock a lane.
const EXCLUDED = [
	['Germany', { 'x-client-region': 'DE' }],
	['United Kingdom', { 'x-client-region': 'GB' }],
	['South Korea', { 'x-client-geo-location': 'KR,Seoul' }],
	['Reunion (EU soil)', { 'x-client-region': 'RE' }],
	['no geo header', {}],
	['forged Cloudflare header', { 'cf-ipcountry': 'US' }],
	['forged Vercel header', { 'x-vercel-ip-country': 'US' }],
];
const LICENSED = { 'x-client-region': 'US' };

const tencent = (id) => TENCENT_LANES.includes(id);

beforeEach(() => {
	gcpSubmit.mockReset();
	gcpSubmit.mockResolvedValue({ extJobId: 'gcpjob-01', viewsUsed: 1, multiview: false });
	hfSubmit.mockReset();
	hfSubmit.mockResolvedValue({ extJobId: 'hf-packed' });
	hfStatus.mockReset();
	hfStatus.mockResolvedValue({ resultGlbUrl: 'https://hf.example/model.glb' });
	hfProviderFactory.mockClear();
	markLaneUnhealthy.mockClear();
});

afterEach(() => {
	for (const k of ALL_VARS) delete process.env[k];
});

describe.each([
	['/api/forge', forgeHandler],
	['/api/gpt-forge', gptForgeHandler],
])('%s: Tencent lanes and the territory rule', (url, handler) => {
	describe('explicit selection', () => {
		describe.each(EXCLUDED)('%s', (_label, headers) => {
			it.each(['hunyuan3d', 'huggingface', 'modly_hunyuan'])(
				'refuses an explicit %s with region_restricted and never contacts the lane',
				async (lane) => {
					wireLanes('trellis2', 'hunyuan3d', 'modly', 'huggingface');
					process.env.MODEL_MODLY_URL = LANE_ENV.modly[1];
					const res = makeRes();
					await handler(makeReq(url, photoBody(lane), headers), res);

					expect(res.statusCode).toBe(403);
					expect(res.body.error).toBe('region_restricted');
					expect(res.body.backend).toBe(lane);
					// It tells the caller what they can use instead, and that is real.
					expect(res.body.retry_backends.length).toBeGreaterThan(0);
					expect(res.body.retry_backends.filter(tencent)).toEqual([]);
					expect(gcpSubmit).not.toHaveBeenCalled();
					expect(hfProviderFactory).not.toHaveBeenCalled();
				},
			);

			it('serves the same photo on the lane the refusal suggests', async () => {
				wireLanes('trellis2', 'hunyuan3d', 'modly', 'huggingface');
				const refused = makeRes();
				await handler(makeReq(url, photoBody('hunyuan3d'), headers), refused);
				const [suggested] = refused.body.retry_backends;

				const res = makeRes();
				await handler(makeReq(url, photoBody(suggested), headers), res);
				expect(res.statusCode).toBe(200);
				expect(res.body.backend).toBe(suggested);
				expect(tencent(res.body.backend)).toBe(false);
			});
		});

		it('submits Hunyuan3D in worker mode for a licensed caller and records the lane', async () => {
			wireLanes('trellis2', 'hunyuan3d');
			const res = makeRes();
			await handler(makeReq(url, photoBody('hunyuan3d', 'standard'), LICENSED), res);

			expect(res.statusCode).toBe(200);
			expect(res.body.backend).toBe('hunyuan3d');
			expect(gcpSubmit).toHaveBeenCalledTimes(1);
			const call = gcpSubmit.mock.calls[0][0];
			expect(call.mode).toBe('hunyuan');
			expect(call.sourceUrl).toBe(PHOTO);
			expect(decodeJobToken(res.body.job_id)).toMatchObject({ provider: 'gcp', taskId: 'gcpjob-01' });
		});

		it('serves an explicit Hugging Face pick for a licensed caller and records the lane', async () => {
			wireLanes('huggingface');
			const res = makeRes();
			await handler(makeReq(url, photoBody('huggingface'), LICENSED), res);

			expect(res.statusCode).toBe(200);
			expect(res.body.backend).toBe('huggingface');
			expect(res.body.status).toBe('done');
			expect(hfSubmit).toHaveBeenCalledTimes(1);
			expect(hfSubmit.mock.calls[0][0].params.images).toEqual([PHOTO]);
			expect(gcpSubmit).not.toHaveBeenCalled();
		});
	});

	describe('default route', () => {
		// TRELLIS.2 and self-host TRELLIS are absent, so the first lane in the free
		// order is Hunyuan3D: the only thing keeping an excluded caller off it is
		// the territory rule.
		it.each(EXCLUDED)('%s is routed outside the licence and still gets a queued job', async (_label, headers) => {
			wireLanes('hunyuan3d', 'modly', 'huggingface');
			const res = makeRes();
			await handler(makeReq(url, photoBody(null, 'standard'), headers), res);

			expect(res.statusCode).toBe(200);
			expect(tencent(res.body.backend)).toBe(false);
			expect(gcpSubmit).toHaveBeenCalledTimes(1);
			expect(['hunyuan', 'modly_hunyuan']).not.toContain(gcpSubmit.mock.calls[0][0].mode);
			expect(hfProviderFactory).not.toHaveBeenCalled();
			expect(decodeJobToken(res.body.job_id)).toMatchObject({ provider: 'gcp' });
		});

		it('a licensed caller reaches Hunyuan3D by default in the same deployment', async () => {
			wireLanes('hunyuan3d', 'modly', 'huggingface');
			const res = makeRes();
			await handler(makeReq(url, photoBody(null, 'standard'), LICENSED), res);

			expect(res.statusCode).toBe(200);
			expect(res.body.backend).toBe('hunyuan3d');
			expect(gcpSubmit.mock.calls[0][0].mode).toBe('hunyuan');
		});
	});

	describe('handover from the working lane', () => {
		const down = () => Object.assign(new Error('worker 503'), { code: 'provider_error', providerStatus: 503 });
		// TRELLIS.2 is the working lane and it is out; every other worker answers.
		const trellis2Down = () =>
			gcpSubmit.mockImplementation(async ({ mode }) => {
				if (mode === 'trellis2') throw down();
				return { extJobId: `gcpjob-${mode}`, viewsUsed: 1, multiview: false };
			});

		it.each(EXCLUDED)('%s: a TRELLIS.2 outage lands on a lane outside the licence', async (_label, headers) => {
			wireLanes('trellis2', 'hunyuan3d', 'modly', 'huggingface');
			trellis2Down();
			const res = makeRes();
			await handler(makeReq(url, photoBody('trellis2'), headers), res);

			expect(res.statusCode).toBe(200);
			expect(tencent(res.body.backend)).toBe(false);
			expect(res.body.backend).not.toBe('trellis2');
			// The cooled lane is recorded, the same photo went to the next lane,
			// and no Tencent worker or Space was contacted on the way.
			expect(markLaneUnhealthy).toHaveBeenCalledWith('trellis2');
			const modes = gcpSubmit.mock.calls.map(([c]) => c.mode);
			expect(modes).not.toContain('hunyuan');
			expect(modes).not.toContain('modly_hunyuan');
			expect(hfProviderFactory).not.toHaveBeenCalled();
			const served = gcpSubmit.mock.calls.at(-1)[0];
			expect(served.params.images ?? [served.sourceUrl]).toEqual([PHOTO]);
			expect(decodeJobToken(res.body.job_id)).toMatchObject({ provider: 'gcp', taskId: `gcpjob-${served.mode}` });
		});

		it('a licensed caller is handed from TRELLIS.2 to Hunyuan3D with the same photo and a valid job', async () => {
			wireLanes('trellis2', 'hunyuan3d');
			trellis2Down();
			const res = makeRes();
			await handler(makeReq(url, photoBody('trellis2', 'standard'), LICENSED), res);

			expect(res.statusCode).toBe(200);
			expect(res.body.backend).toBe('hunyuan3d');
			expect(res.body.status).toBe('queued');
			expect(markLaneUnhealthy).toHaveBeenCalledWith('trellis2');
			const served = gcpSubmit.mock.calls.at(-1)[0];
			expect(served.mode).toBe('hunyuan');
			expect(served.sourceUrl).toBe(PHOTO);
			expect(decodeJobToken(res.body.job_id)).toMatchObject({ provider: 'gcp', taskId: 'gcpjob-hunyuan' });
		});

		it('a licensed caller is handed to the Hugging Face Spaces when no worker is left', async () => {
			wireLanes('trellis2', 'huggingface');
			trellis2Down();
			const res = makeRes();
			await handler(makeReq(url, photoBody('trellis2', 'standard'), LICENSED), res);

			expect(res.statusCode).toBe(200);
			expect(res.body.backend).toBe('huggingface');
			expect(res.body.status).toBe('done');
			expect(res.body.glb_url).toBe('https://hf.example/model.glb');
			expect(hfSubmit.mock.calls[0][0].params.images).toEqual([PHOTO]);
		});

		it('an excluded caller with no lane outside the licence gets a retryable busy answer, not a Tencent job', async () => {
			wireLanes('trellis2', 'hunyuan3d', 'huggingface');
			trellis2Down();
			const res = makeRes();
			await handler(makeReq(url, photoBody('trellis2'), { 'x-client-region': 'DE' }), res);

			expect(gcpSubmit.mock.calls.map(([c]) => c.mode)).not.toContain('hunyuan');
			expect(hfProviderFactory).not.toHaveBeenCalled();
			expect(res.statusCode).toBeGreaterThanOrEqual(500);
			expect(res.body.retry_backends ?? []).not.toEqual(expect.arrayContaining(['hunyuan3d']));
		});
	});
});
