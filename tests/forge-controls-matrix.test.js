// Every pre-generation control on /forge, on every lane: what the lane's
// outbound request actually does with it.
//
// api/_lib/forge-controls.js records, per lane, whether each control is
// applied (the request changes), ignored (the request is the same, so the page
// hides, disables or relabels the control and the API refuses an explicit
// combination that would only change the price) or rejected. This file holds
// the record to the wire: it posts through the real api/forge.js (and its clone
// api/gpt-forge.js) with the real gcp, Meshy, Tripo, Rodin and Stability
// providers, captures what each lane's server receives at globalThis.fetch,
// and fails the moment the record and the request disagree.
//
// Stubbed: the network (fetch), and the boundaries that would otherwise reach a
// database, a cache or the image-generation network (the store, rate limits,
// lane health, the photo validator, and the reference-picture module, whose
// arguments are captured so the aspect ratio can be checked where it is used).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-controls-user' }),
}));

const textToImage = vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' }));
vi.mock('../api/_mcp3d/text-to-image.js', () => ({
	textToImage: (...args) => textToImage(...args),
	synthesizeTurnaroundViews: vi.fn(async () => []),
}));

vi.mock('../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

vi.mock('../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ statusMap: {}, byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
	laneCooldownKey: (id) => `forge-lane:${id}`,
	HF_QUOTA_COOLDOWN_SECONDS: 60,
}));

vi.mock('../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../api/_lib/ssrf-guard.js', async (orig) => ({
	...(await orig()),
	assertSafePublicUrl: async () => {},
}));

// Object storage: the synchronous Stability lane parks its finished GLB here.
vi.mock('../api/_lib/r2.js', async (orig) => ({
	...(await orig()),
	putObject: async () => ({}),
	cdnUrl: (key) => `https://cdn.example/${key}`,
}));

vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFree: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFreeTiered: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.9',
	};
});

const WORKERS = {
	MODEL_TRELLIS_URL: 'https://trellis.worker.test',
	MODEL_TRELLIS2_URL: 'https://trellis2.worker.test',
	MODEL_PIXAL3D_URL: 'https://pixal3d.worker.test',
	MODEL_MODLY_URL: 'https://modly.worker.test',
	MODEL_ANIGEN_URL: 'https://anigen.worker.test',
	MODEL_PARTCRAFTER_URL: 'https://partcrafter.worker.test',
	GCP_HUNYUAN3D_URL: 'https://hunyuan.worker.test',
	GCP_TRIPOSG_URL: 'https://triposg.worker.test',
};

beforeAll(() => {
	Object.assign(process.env, WORKERS, {
		APP_ORIGIN: 'https://three.ws',
		GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
		NVIDIA_API_KEY: 'nvapi-test',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
		NODE_ENV: 'development',
	});
	delete process.env.HOLDER_PASS_SECRET;
	delete process.env.REPLICATE_API_TOKEN;
	delete process.env.HF_TOKEN;
	delete process.env.FORGE_DIRECTOR;
});

const { default: forgeHandler } = await import('../api/forge.js');
const { default: gptForgeHandler } = await import('../api/gpt-forge.js');
const { signTierPass } = await import('../api/_lib/three-tier.js');
const { BACKENDS } = await import('../api/_lib/forge-tiers.js');
const {
	LANE_CONTROLS,
	FORGE_CONTROLS,
	FORGE_ASPECT_RATIOS,
	CONTROL_APPLIED,
	CONTROL_IGNORED,
	CONTROL_REJECTED,
	ASPECT_REFERENCE,
} = await import('../api/_lib/forge-controls.js');
const { normalizeForgeOptions } = await import('../api/_lib/forge-options.js');

// ---------------------------------------------------------------- network

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ORIGINAL_FETCH = globalThis.fetch;
let sent = [];

function jsonRes(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
	sent = [];
	textToImage.mockClear();
	globalThis.fetch = vi.fn(async (url, opts = {}) => {
		const u = String(url);
		sent.push({ url: u, body: opts.body ?? null });
		if (u.includes('.worker.test')) return jsonRes(200, { task_id: 'task-1', status: 'queued' });
		if (u.includes('api.meshy.ai')) return jsonRes(200, { result: 'meshy-task-1' });
		if (u.includes('openapi.tripo3d.com')) return jsonRes(200, { code: 0, data: { task_id: 'tripo-task-1' } });
		if (u.includes('hyper3d.ai') || u.includes('/api/v2/rodin')) {
			return jsonRes(201, { uuid: 'rodin-uuid-1', jobs: { subscription_key: 'sub-1' } });
		}
		if (u.includes('api.stability.ai')) {
			return new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), { status: 200, headers: { 'content-type': 'model/gltf-binary' } });
		}
		if (u.includes('cdn.example')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
		return jsonRes(404, { error: `unrouted ${u}` });
	});
});
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
});

/** Every request a lane's server received, in order. */
function requestsTo(host) {
	return sent.filter((r) => r.url.includes(host) && r.body != null);
}

/** The one body a JSON lane received, as the raw string it was sent. */
function onlyJsonBodyTo(host) {
	const hits = requestsTo(host);
	expect(hits, `requests to ${host}`).toHaveLength(1);
	return hits[0].body;
}

/** A multipart lane's fields as a plain object (files left out). */
function formFields(form) {
	const out = {};
	for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v;
	return out;
}

// ---------------------------------------------------------------- handler

function makeReq(url, body, headers = {}) {
	return {
		method: 'POST',
		url,
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester', 'x-client-region': 'US', ...headers },
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
			try {
				this.body = body ? JSON.parse(body) : null;
			} catch {
				this.body = body;
			}
		},
	};
}

const WALLET = 'THREEsynthetic1111111111111111111111111111';
const HIGH_PASS = signTierPass({ wallet: WALLET, level: 1, tierId: 'bronze', usd: 30 });

async function post(body, { url = '/api/forge', handler = forgeHandler, headers = {} } = {}) {
	const res = makeRes();
	const passHeaders = body.tier === 'high' ? { 'x-three-tier-pass': HIGH_PASS } : {};
	await handler(makeReq(url, body, { ...passHeaders, ...headers }), res);
	return res;
}

// ---------------------------------------------------------------- lanes

const PHOTO = 'https://cdn.example/photo.png';
const SKETCH = 'https://cdn.example/sketch.png';
const GUIDANCE = 'weathered teal bronze with a chipped rim';

// The lanes a test can drive end to end through the handler. Each names the
// server it talks to, how its request is read, and the request a photo build
// sends (a sketch for TripoSG, the only path it serves).
const KEYS = {
	meshy: 'msy_controls_matrix_key_000000',
	tripo: 'tsk_controls_matrix_key_000000',
	rodin: 'rodin_controls_matrix_key_0000',
	stability: 'sk-controls-matrix-key-0000000',
};

const DRIVEN = {
	trellis_selfhost: { host: 'trellis.worker.test' },
	trellis2: { host: 'trellis2.worker.test' },
	pixal3d: { host: 'pixal3d.worker.test' },
	hunyuan3d: { host: 'hunyuan.worker.test' },
	modly: { host: 'modly.worker.test' },
	modly_hunyuan: { host: 'modly.worker.test' },
	anigen: { host: 'anigen.worker.test' },
	partcrafter: { host: 'partcrafter.worker.test' },
	triposg: { host: 'triposg.worker.test', sketch: true },
	meshy: { host: 'api.meshy.ai', byok: true },
	tripo: { host: 'openapi.tripo3d.com', byok: true },
	rodin: { host: 'rodin', byok: true, multipart: true },
	stability: { host: 'api.stability.ai', byok: true, multipart: true },
};

function photoBody(backend, extra = {}) {
	const lane = DRIVEN[backend];
	if (lane?.sketch) {
		return { path: 'sketch', image_urls: [SKETCH], prompt: 'a teapot', backend, skip_validation: true, ...extra };
	}
	return { path: 'image', image_urls: [PHOTO], backend, skip_validation: true, ...extra };
}

function keyHeaders(backend) {
	return DRIVEN[backend]?.byok ? { 'x-forge-provider-key': KEYS[backend] } : {};
}

/** Post one photo build and return what the lane's server received. */
async function laneRequest(backend, extra = {}) {
	const lane = DRIVEN[backend];
	const res = await post(photoBody(backend, extra), { headers: keyHeaders(backend) });
	expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(300);
	const hits = requestsTo(lane.host).filter((r) => !r.url.includes('cdn.example'));
	const submit = hits[hits.length - 1];
	expect(submit, `a request reached ${lane.host}`).toBeTruthy();
	return lane.multipart ? formFields(submit.body) : JSON.parse(submit.body);
}

// ---------------------------------------------------------------- the record

describe('the record covers every lane and every control', () => {
	it('names every registered backend, and nothing that is not one', () => {
		expect(Object.keys(LANE_CONTROLS).sort()).toEqual(Object.keys(BACKENDS).sort());
	});

	it.each(Object.entries(LANE_CONTROLS))('%s states every control with a known value', (_id, cells) => {
		expect(Object.keys(cells).sort()).toEqual([...FORGE_CONTROLS].sort());
		expect([CONTROL_APPLIED, CONTROL_IGNORED]).toContain(cells.tier);
		expect([CONTROL_APPLIED, CONTROL_IGNORED]).toContain(cells.seed);
		expect([ASPECT_REFERENCE, CONTROL_IGNORED]).toContain(cells.aspect_ratio);
		expect([CONTROL_APPLIED, CONTROL_IGNORED]).toContain(cells.guidance);
		expect([CONTROL_APPLIED, CONTROL_REJECTED]).toContain(cells.fill_other_sides);
	});

	it('only the Match my photo lane fills the other sides', () => {
		const filling = Object.entries(LANE_CONTROLS).filter(([, c]) => c.fill_other_sides === CONTROL_APPLIED);
		expect(filling.map(([id]) => id)).toEqual(['pixal3d']);
	});
});

// ---------------------------------------------------------------- tier

const tierApplied = Object.keys(DRIVEN).filter((id) => LANE_CONTROLS[id].tier === CONTROL_APPLIED);
const tierIgnored = Object.keys(LANE_CONTROLS).filter((id) => LANE_CONTROLS[id].tier === CONTROL_IGNORED);

describe('tier', () => {
	it.each(tierApplied)('%s: Draft, Standard and High send three different requests', async (backend) => {
		const bodies = [];
		for (const tier of ['draft', 'standard', 'high']) {
			sent = [];
			bodies.push(JSON.stringify(await laneRequest(backend, { tier })));
		}
		expect(new Set(bodies).size).toBe(3);
	});

	it.each(tierIgnored)('%s: an explicit Draft or High is refused with a 400 naming tier', async (backend) => {
		for (const tier of ['draft', 'high']) {
			const res = await post({ prompt: 'a teapot', backend, tier });
			expect(res.statusCode).toBe(400);
			expect(res.body.error).toBe('invalid_options');
			expect(res.body.errors.map((e) => e.field)).toContain('tier');
			expect(sent.filter((r) => !r.url.includes('cdn.example'))).toEqual([]);
		}
	});

	it.each(tierIgnored)('%s: Standard, the one quality it runs at, is accepted', (backend) => {
		const path = BACKENDS[backend].paths.includes('sketch') ? 'sketch' : 'image';
		expect(normalizeForgeOptions({ backend, tier: 'standard', path }).errors).toEqual([]);
	});
});

// ---------------------------------------------------------------- seed

const seedApplied = Object.keys(DRIVEN).filter((id) => LANE_CONTROLS[id].seed === CONTROL_APPLIED);
const seedIgnored = Object.keys(LANE_CONTROLS).filter((id) => LANE_CONTROLS[id].seed === CONTROL_IGNORED);

function seedOnTheWire(backend, req) {
	if (backend === 'tripo') return req.model_seed;
	if (backend === 'rodin') return req.seed === undefined ? undefined : Number(req.seed);
	return req.seed;
}

describe('seed', () => {
	it.each(seedApplied)('%s: the seed reaches the engine, and no seed sends none', async (backend) => {
		expect(seedOnTheWire(backend, await laneRequest(backend, { seed: 7 }))).toBe(7);
		sent = [];
		expect(seedOnTheWire(backend, await laneRequest(backend))).toBeUndefined();
	});

	it.each(seedIgnored)('%s: an explicit seed is refused with a 400 naming seed', async (backend) => {
		const res = await post({ prompt: 'a teapot', backend, seed: 7 }, { headers: keyHeaders(backend) });
		expect(res.statusCode).toBe(400);
		expect(res.body.errors.map((e) => e.field)).toContain('seed');
	});
});

// ---------------------------------------------------------------- aspect ratio

const aspectReference = Object.keys(LANE_CONTROLS).filter((id) => LANE_CONTROLS[id].aspect_ratio === ASPECT_REFERENCE);
const aspectIgnoredDriven = Object.keys(DRIVEN).filter((id) => LANE_CONTROLS[id].aspect_ratio === CONTROL_IGNORED);

describe('aspect ratio', () => {
	it('the page offers exactly the shapes the API accepts', () => {
		for (const ratio of FORGE_ASPECT_RATIOS) {
			expect(normalizeForgeOptions({ aspect_ratio: ratio }).errors).toEqual([]);
		}
		const bad = normalizeForgeOptions({ aspect_ratio: '2:1' });
		expect(bad.errors.map((e) => e.field)).toContain('aspect_ratio');
	});

	it('an unknown shape is refused with a 400 naming aspect_ratio', async () => {
		const res = await post({ prompt: 'a teapot', aspect_ratio: '21:9' });
		expect(res.statusCode).toBe(400);
		expect(res.body.errors.map((e) => e.field)).toContain('aspect_ratio');
	});

	it.each(aspectReference.filter((id) => DRIVEN[id] && !DRIVEN[id].byok))(
		'%s: a text prompt is painted at the chosen shape before the 3D build',
		async (backend) => {
			for (const ratio of ['16:9', '3:4']) {
				textToImage.mockClear();
				const res = await post({ prompt: 'a brass teapot', backend, aspect_ratio: ratio });
				expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(300);
				expect(textToImage).toHaveBeenCalled();
				expect(textToImage.mock.calls[0][1].aspectRatio).toBe(ratio);
			}
		},
	);

	it.each(aspectIgnoredDriven)('%s: builds with no reference picture, so the shape changes nothing', async (backend) => {
		const bodies = [];
		for (const ratio of ['1:1', '16:9']) {
			sent = [];
			textToImage.mockClear();
			const body = DRIVEN[backend].sketch
				? photoBody(backend, { aspect_ratio: ratio })
				: { prompt: 'a brass teapot', backend, aspect_ratio: ratio };
			const res = await post(body, { headers: keyHeaders(backend) });
			if (res.statusCode >= 300) {
				// An image-only engine answers a text prompt with a designed 422.
				expect(res.body.error).toBe('backend_image_only');
				continue;
			}
			expect(textToImage).not.toHaveBeenCalled();
			const hit = requestsTo(DRIVEN[backend].host).at(-1);
			bodies.push(DRIVEN[backend].multipart ? JSON.stringify(formFields(hit.body)) : hit.body);
		}
		if (bodies.length) expect(new Set(bodies).size).toBe(1);
	});
});

// ---------------------------------------------------------------- guidance

const guidanceApplied = Object.keys(DRIVEN).filter((id) => LANE_CONTROLS[id].guidance === CONTROL_APPLIED);
const guidanceIgnored = Object.keys(DRIVEN).filter((id) => LANE_CONTROLS[id].guidance === CONTROL_IGNORED);

describe('guidance beside a photo', () => {
	it.each(guidanceApplied)('%s: the words reach the engine', async (backend) => {
		const req = await laneRequest(backend, { prompt: GUIDANCE });
		expect(JSON.stringify(req)).toContain(GUIDANCE);
	});

	it.each(guidanceIgnored)('%s: the engine builds from the photo alone, so the words never reach it', async (backend) => {
		const req = await laneRequest(backend, { prompt: GUIDANCE });
		expect(JSON.stringify(req)).not.toContain(GUIDANCE);
	});
});

// ---------------------------------------------------------------- fill other sides

describe('fill other sides', () => {
	it('pixal3d: a single photo asks the worker to paint the missing sides', async () => {
		expect((await laneRequest('pixal3d', { fill_other_sides: true })).fill_other_sides).toBe(true);
		sent = [];
		expect(await laneRequest('pixal3d')).not.toHaveProperty('fill_other_sides');
	});

	const rejecting = Object.keys(LANE_CONTROLS).filter((id) => LANE_CONTROLS[id].fill_other_sides === CONTROL_REJECTED);

	it.each(rejecting)('%s: fill_other_sides is refused with a 400 naming the field', async (backend) => {
		const res = await post({ path: 'image', image_urls: [PHOTO], backend, fill_other_sides: true }, { headers: keyHeaders(backend) });
		expect(res.statusCode).toBe(400);
		expect(res.body.errors.map((e) => e.field)).toContain('fill_other_sides');
	});

	it('with no engine named, fill_other_sides is refused too: the default lane cannot paint sides', async () => {
		const res = await post({ path: 'image', image_urls: [PHOTO], fill_other_sides: true });
		expect(res.statusCode).toBe(400);
		expect(res.body.errors.map((e) => e.field)).toContain('fill_other_sides');
	});
});

// ---------------------------------------------------------------- both handlers

describe('the ChatGPT clone refuses the same combinations', () => {
	it.each([
		[{ prompt: 'a teapot', backend: 'anigen', tier: 'high' }, 'tier'],
		[{ prompt: 'a teapot', backend: 'meshy', seed: 7 }, 'seed'],
		[{ path: 'image', image_urls: [PHOTO], backend: 'trellis2', fill_other_sides: true }, 'fill_other_sides'],
		[{ prompt: 'a teapot', aspect_ratio: '21:9' }, 'aspect_ratio'],
		[{ prompt: 'a teapot', backend: 'no_such_engine' }, 'backend'],
	])('%j names %s', async (body, field) => {
		const res = await post(body, { url: '/api/gpt-forge', handler: gptForgeHandler, headers: keyHeaders(body.backend) });
		expect(res.statusCode).toBe(400);
		expect(res.body.errors.map((e) => e.field)).toContain(field);
	});
});

// ---------------------------------------------------------------- protected lane

describe('protected lane: self-hosted TRELLIS default request is unchanged', () => {
	// The request the lane serves at its measured success rate, pinned byte for
	// byte so no control work can alter it (docs/ops/forge-protected-lanes.md).
	it('a photo at the default tier with no options', async () => {
		const res = await post({ path: 'image', image_urls: [PHOTO], backend: 'trellis_selfhost', skip_validation: true });
		expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(300);
		expect(onlyJsonBodyTo('trellis.worker.test')).toBe(
			JSON.stringify({
				images: [PHOTO],
				body_type: 'neutral',
				quality: { ss_steps: 35, slat_steps: 35, simplify: 0.82, texture_size: 2048 },
				matte: true,
			}),
		);
	});
});
