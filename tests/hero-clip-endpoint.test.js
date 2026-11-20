// /api/v1/models/hero-clip, driven end to end through the real gateway,
// validation, job handle and xAI client. Only the boundaries are replaced:
// the session lookup, the account stores (forge creations, avatars), the
// object store, DNS for the SSRF guard, the GLB rasterizer, and xAI's HTTP.
// xAI bodies are the documented shapes (docs.x.ai video generation) and the
// live no-credentials answer recorded 2026-11-20, as in tests/xai-video.test.js.

import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'hero-clip-endpoint-secret-0123456789abcdef';
process.env.APP_ORIGIN = 'https://three.ws';
process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';

const state = vi.hoisted(() => ({
	creations: new Map(),
	avatars: new Map(),
	objects: new Map(),
	renders: [],
	burst: { success: true, limit: 3, remaining: 2, reset: 0 },
	daily: { success: true, limit: 5, remaining: 4, reset: 0 },
	dailyCalls: [],
}));

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getSessionUser: async (req) => (req.headers['x-test-user'] ? { id: req.headers['x-test-user'], sid: 's1' } : null),
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../api/_lib/dev-plans/quota.js', async (orig) => ({
	...(await orig()),
	devPlanGate: async () => ({ ok: true, release() {}, sub: { planId: 'free' } }),
}));
vi.mock('../api/_lib/rate-limit.js', async (orig) => {
	const real = await orig();
	return {
		...real,
		limits: {
			...real.limits,
			apiV1: async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 }),
			heroClipBurst: async () => ({ ...state.burst, reset: Date.now() + 60_000 }),
			heroClipDaily: async (key, cap) => {
				state.dailyCalls.push({ key, cap });
				return { ...state.daily, limit: cap, reset: Date.now() + 86_400_000 };
			},
		},
	};
});
vi.mock('../api/_lib/usage.js', async (orig) => ({ ...(await orig()), recordEvent: vi.fn() }));
vi.mock('../api/_lib/xai-usage.js', () => ({ recordXaiUsage: vi.fn() }));
vi.mock('../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `h:${v}`,
	ownerClientKey: (h) => `client:${h}`,
	isCreationOwner: async ({ id, userId }) => state.creations.get(id)?.owner === userId,
	getPublicCreation: async ({ id, includePrivate }) => {
		const c = state.creations.get(id);
		if (!c) return null;
		if (c.visibility === 'private' && !includePrivate) return null;
		return c;
	},
}));
vi.mock('../api/_lib/avatars.js', () => ({
	getAvatar: async ({ id }) => state.avatars.get(id) || null,
	resolveAvatarUrl: async (a) => ({ url: a.url }),
}));
vi.mock('../api/_lib/r2.js', async (orig) => ({
	...(await orig()),
	headObject: async (key) => (state.objects.has(key) ? { ContentLength: state.objects.get(key).body.length } : null),
	putObject: async (obj) => {
		state.objects.set(obj.key, obj);
	},
	cdnUrl: (key) => `https://three.ws/cdn/${key}`,
}));
vi.mock('../api/_lib/ssrf-guard.js', async (orig) => ({
	...(await orig()),
	assertSafePublicUrl: async (url) => {
		if (/\/\/(localhost|127\.|10\.|169\.254\.)/.test(url)) throw new Error('that address is not public');
	},
	fetchSafePublicUrl: (url, init) => globalThis.fetch(url, init),
}));
vi.mock('../api/_lib/render-glb.js', async (orig) => ({
	...(await orig()),
	renderGlbToPng: async (opts) => {
		state.renders.push(opts);
		// An 8-byte PNG signature plus the angle, so each render is distinct.
		return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(`${opts.yaw}:${opts.pitch}:${opts.width}`)]);
	},
}));

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CREATION = '3abac32f-ced2-4189-b822-d30c96dbc87e';
const PRIVATE_CREATION = '44444444-4444-4444-8444-444444444444';
const AVATAR = '55555555-5555-4555-8555-555555555555';
const GLB = `https://three.ws/cdn/forge/anon/${CREATION}.glb`;
const REQUEST_ID = 'd97415a1-5796-b7ec-379f-4e6819e08fdf';

const DOC_CREATE = { request_id: REQUEST_ID };
const DOC_PENDING = { status: 'pending' };
const DOC_DONE = {
	status: 'done',
	video: { url: 'https://vidgen.x.ai/out/video.mp4', duration: 6, respect_moderation: true },
	model: 'grok-imagine-video-1.5-lite',
};
const DOC_FAILED = {
	status: 'failed',
	error: { code: 'invalid_argument', message: 'Prompt cannot be empty. Please provide a prompt.' },
};
// A real clip is far above storeVideo's 1 KB "empty clip" floor.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(4096, 7)]);
const LIVE_NO_KEY = { code: 'unauthenticated:no-credentials', error: 'No credentials presented.' };

let handler;
let lib;
const xaiCalls = [];
let xai = {};

function jsonResponse(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeAll(async () => {
	handler = (await import('../api/v1/models/hero-clip.js')).default;
	lib = await import('../api/_lib/hero-clip.js');
});

beforeEach(() => {
	delete process.env.GROK_API_KEY;
	delete process.env.XAI_API_KEY;
	delete process.env.HERO_CLIP_DAILY_CAP;
	state.creations.clear();
	state.avatars.clear();
	state.objects.clear();
	state.renders.length = 0;
	state.dailyCalls.length = 0;
	state.burst = { success: true, limit: 3, remaining: 2, reset: 0 };
	state.daily = { success: true, limit: 5, remaining: 4, reset: 0 };
	state.creations.set(CREATION, {
		id: CREATION,
		owner: OTHER,
		visibility: 'public',
		prompt: 'a small chrome toy rocket on a launch pad, glossy',
		glb_url: GLB,
		size_bytes: 2_000_000,
	});
	state.creations.set(PRIVATE_CREATION, {
		id: PRIVATE_CREATION,
		owner: OTHER,
		visibility: 'private',
		prompt: 'secret',
		glb_url: 'https://three.ws/cdn/forge/private.glb',
	});
	state.avatars.set(AVATAR, { id: AVATAR, name: 'Pilot', visibility: 'public', url: 'https://three.ws/cdn/avatars/pilot.glb' });
	xaiCalls.length = 0;
	xai = {
		create: () => jsonResponse(200, DOC_CREATE),
		status: () => jsonResponse(200, DOC_PENDING),
	};
	vi.stubGlobal('fetch', async (url, init = {}) => {
		const u = String(url);
		xaiCalls.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
		if (u === 'https://api.x.ai/v1/videos/generations') return xai.create();
		if (u.startsWith('https://api.x.ai/v1/videos/')) return xai.status();
		if (u.startsWith('https://vidgen.x.ai/')) return new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } });
		throw new Error(`unexpected fetch ${u}`);
	});
});

afterEach(() => vi.unstubAllGlobals());

function fakeRes() {
	const headers = {};
	return {
		statusCode: 200,
		raw: '',
		headersSent: false,
		writableEnded: false,
		headers,
		setHeader(k, v) {
			headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete headers[k.toLowerCase()];
		},
		writeHead(status, h) {
			this.statusCode = status;
			for (const [k, v] of Object.entries(h || {})) headers[k.toLowerCase()] = v;
			this.headersSent = true;
			return this;
		},
		write(chunk) {
			this.raw += String(chunk);
			return true;
		},
		end(chunk) {
			if (chunk) this.raw += String(chunk);
			this.writableEnded = true;
			this.headersSent = true;
		},
		on() {},
		once() {},
		get body() {
			return this.raw ? JSON.parse(this.raw) : null;
		},
	};
}

async function call(method, { user, body, query = '' } = {}) {
	const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
	const req = Readable.from(payload);
	req.method = method;
	req.url = `/api/v1/models/hero-clip${query}`;
	req.headers = { host: 'three.ws', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(user ? { 'x-test-user': user } : {}) };
	req.socket = { remoteAddress: '203.0.113.7' };
	const res = fakeRes();
	await handler(req, res);
	return res;
}

function jobFor(userId, overrides = {}) {
	return lib.encodeHeroClipJob({
		requestId: REQUEST_ID,
		userId,
		tier: 'lite',
		preset: 'turntable',
		seconds: 6,
		source: { kind: 'creation', id: CREATION, title: 'Chrome toy rocket', page: `/m/${CREATION}` },
		poster: 'https://three.ws/api/render/glb?glbUrl=x',
		...overrides,
	});
}

describe('GET describe', () => {
	it('tells a signed-out visitor what the feature offers and that clips are not available', async () => {
		const res = await call('GET');
		expect(res.statusCode).toBe(200);
		expect(res.body.data).toMatchObject({
			available: false,
			signed_in: false,
			default_preset: 'turntable',
			durations: [4, 6, 8, 10],
			default_duration: 6,
			tiers: ['lite', 'full'],
			default_tier: 'lite',
			daily_cap: 5,
		});
		expect(res.body.data.presets.map((p) => p.id)).toEqual(['turntable', 'hero_push_in', 'light_sweep', 'product_reveal']);
	});

	it('reports availability and the env daily cap once a key exists', async () => {
		process.env.GROK_API_KEY = 'xai-test';
		process.env.HERO_CLIP_DAILY_CAP = '3';
		const res = await call('GET', { user: USER });
		expect(res.body.data).toMatchObject({ available: true, signed_in: true, daily_cap: 3 });
	});
});

describe('POST without signing in', () => {
	it('answers 401 with the sign-in links and renders nothing', async () => {
		const res = await call('POST', { body: { model_id: CREATION } });
		expect(res.statusCode).toBe(401);
		expect(res.body).toMatchObject({ error: 'sign_in_required' });
		expect(res.body.sign_in_url).toMatch(/login|sign/);
		expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
		expect(state.renders).toHaveLength(0);
	});
});

describe('POST validation', () => {
	it.each([
		[{ model_id: CREATION, glb_url: GLB }, 400, 'validation_error'],
		[{}, 400, 'validation_error'],
		[{ model_id: 'not-a-uuid' }, 400, 'validation_error'],
		[{ model_id: CREATION, preset: 'spin_forever' }, 400, 'validation_error'],
		[{ model_id: CREATION, duration: 7 }, 400, 'validation_error'],
		[{ model_id: CREATION, tier: 'ultra' }, 400, 'validation_error'],
		[{ glb_url: 'http://three.ws/a.glb' }, 400, 'validation_error'],
		[{ glb_url: 'https://169.254.169.254/latest.glb' }, 400, 'invalid_src'],
		[{ model_id: '99999999-9999-4999-8999-999999999999' }, 404, 'not_found'],
	])('%j answers %i %s', async (body, status, error) => {
		const res = await call('POST', { user: USER, body });
		expect(res.statusCode).toBe(status);
		expect(res.body.error).toBe(error);
		expect(state.renders).toHaveLength(0);
	});

	it('treats someone else\'s private creation as not found, not forbidden', async () => {
		const res = await call('POST', { user: USER, body: { model_id: PRIVATE_CREATION } });
		expect(res.statusCode).toBe(404);
	});
});

describe('POST with no xAI key', () => {
	it('answers 503 clips_unavailable with the real turntable and angle renders of that model', async () => {
		const res = await call('POST', { user: USER, body: { model_id: CREATION, preset: 'light_sweep' } });
		expect(res.statusCode).toBe(503);
		expect(res.body).toMatchObject({
			error: 'clips_unavailable',
			available: false,
			retry: false,
			message: 'Hero clips are not available yet. The turntable below is built from real renders of your model.',
			source: { kind: 'creation', id: CREATION, page: `/m/${CREATION}` },
		});
		const turntable = new URL(res.body.fallback.turntable_url, 'https://three.ws');
		expect(turntable.pathname).toBe('/api/render/animate');
		expect(turntable.searchParams.get('src')).toBe(GLB);
		expect(turntable.searchParams.get('spin')).toBe('360');
		expect(res.body.fallback.refs).toHaveLength(6);
		const azimuths = res.body.fallback.refs.map((r) => new URL(r.url, 'https://three.ws').searchParams.get('azimuth'));
		expect(new Set(azimuths).size).toBe(6);
		expect(state.renders).toHaveLength(0);
		expect(xaiCalls).toHaveLength(0);
	});

	it('resolves an avatar id the same way', async () => {
		const res = await call('POST', { user: USER, body: { model_id: AVATAR } });
		expect(res.statusCode).toBe(503);
		expect(res.body.source).toMatchObject({ kind: 'avatar', title: 'Pilot', page: `/avatars/${AVATAR}` });
	});
});

describe('POST with a key', () => {
	beforeEach(() => {
		process.env.GROK_API_KEY = 'xai-test';
	});

	it('renders the wide front frame and starts a lite job by default', async () => {
		const res = await call('POST', { user: USER, body: { glb_url: GLB, title: 'Chrome toy rocket', duration: 8 } });
		expect(res.statusCode).toBe(202);
		expect(state.renders).toHaveLength(1);
		expect(state.renders[0]).toMatchObject({ glbUrl: GLB, width: 1280, height: 720, yaw: 0, pitch: 10 });
		const create = xaiCalls.find((c) => c.url.endsWith('/videos/generations'));
		expect(create.headers.Authorization || create.headers.authorization).toBe('Bearer xai-test');
		expect(create.body).toMatchObject({ model: 'grok-imagine-video-1.5-lite', duration: 8, resolution: '480p', generate_audio: false });
		expect(create.body.image.url.startsWith('data:image/png;base64,')).toBe(true);
		expect(create.body.reference_images).toBeUndefined();
		expect(create.body.prompt).toContain('The model is titled "Chrome toy rocket".');
		const d = res.body.data;
		expect(d).toMatchObject({ status: 'generating', request_id: REQUEST_ID, tier: 'lite', preset: 'turntable', seconds: 8, renders: { count: 1 } });
		expect(d.poll_url).toBe(`/api/v1/models/hero-clip?job=${encodeURIComponent(d.job)}`);
		expect(lib.decodeHeroClipJob(d.job)).toMatchObject({ requestId: REQUEST_ID, userId: USER });
		expect(d.daily).toEqual({ limit: 5, remaining: 4 });
		expect(state.dailyCalls).toEqual([{ key: `user:${USER}`, cap: 5 }]);
	});

	it('hands the full model six reference angles and loops the turntable', async () => {
		const res = await call('POST', { user: USER, body: { model_id: CREATION, tier: 'full' } });
		expect(res.statusCode).toBe(202);
		expect(state.renders).toHaveLength(7);
		const create = xaiCalls.find((c) => c.url.endsWith('/videos/generations'));
		expect(create.body.model).toBe('grok-imagine-video-1.5');
		expect(create.body.reference_images).toHaveLength(6);
		expect(new Set(create.body.reference_images.map((r) => r.url)).size).toBe(6);
		expect(create.body.last_frame).toEqual(create.body.image);
		expect(res.body.data.renders.count).toBe(7);
	});

	it('stops at the burst limit before rendering anything', async () => {
		state.burst = { success: false, limit: 3, remaining: 0, reset: 0 };
		const res = await call('POST', { user: USER, body: { model_id: CREATION } });
		expect(res.statusCode).toBe(429);
		expect(state.renders).toHaveLength(0);
		expect(xaiCalls).toHaveLength(0);
	});

	it('stops at the daily cap before the paid call', async () => {
		state.daily = { success: false, limit: 5, remaining: 0, reset: 0 };
		const res = await call('POST', { user: USER, body: { model_id: CREATION } });
		expect(res.statusCode).toBe(429);
		expect(res.body).toMatchObject({ error: 'rate_limited', daily_cap: 5 });
		expect(xaiCalls).toHaveLength(0);
	});

	it('turns a rejected key into a retryable clips_unavailable', async () => {
		xai.create = () => jsonResponse(401, LIVE_NO_KEY);
		const res = await call('POST', { user: USER, body: { model_id: CREATION } });
		expect(res.statusCode).toBe(503);
		expect(res.body).toMatchObject({ error: 'clips_unavailable', retry: true });
	});

	it('answers 422 render_failed when the model cannot be rendered', async () => {
		const render = await import('../api/_lib/render-glb.js');
		const spy = vi.spyOn(render, 'renderGlbToPng').mockRejectedValueOnce(new Error('bad glb'));
		const res = await call('POST', { user: USER, body: { model_id: CREATION } });
		spy.mockRestore();
		expect(res.statusCode).toBe(422);
		expect(res.body).toMatchObject({ error: 'render_failed', retry: true });
		expect(xaiCalls).toHaveLength(0);
	});
});

describe('GET ?job= status', () => {
	beforeEach(() => {
		process.env.GROK_API_KEY = 'xai-test';
	});

	it('needs a signed-in caller', async () => {
		const res = await call('GET', { query: `?job=${encodeURIComponent(jobFor(USER))}` });
		expect(res.statusCode).toBe(401);
	});

	it('reads someone else\'s handle exactly like a forged one', async () => {
		const foreign = await call('GET', { user: USER, query: `?job=${encodeURIComponent(jobFor(OTHER))}` });
		const forged = await call('GET', { user: USER, query: '?job=hc1.e30.bad' });
		expect(foreign.statusCode).toBe(404);
		expect(forged.statusCode).toBe(404);
		expect(foreign.body.error).toBe(forged.body.error);
		expect(xaiCalls).toHaveLength(0);
	});

	it('reports generating with the elapsed seconds while xAI is pending', async () => {
		const res = await call('GET', { user: USER, query: `?job=${encodeURIComponent(jobFor(USER, { createdAt: Date.now() - 42_000 }))}` });
		expect(res.statusCode).toBe(200);
		expect(res.body.data).toMatchObject({ status: 'generating', request_id: REQUEST_ID, preset: 'turntable' });
		expect(res.body.data.elapsed_s).toBeGreaterThanOrEqual(41);
		expect(res.body.data.elapsed_s).toBeLessThanOrEqual(44);
	});

	it('copies a finished clip into our storage and answers with its page and share link', async () => {
		xai.status = () => jsonResponse(200, DOC_DONE);
		const res = await call('GET', { user: USER, query: `?job=${encodeURIComponent(jobFor(USER))}` });
		expect(res.statusCode).toBe(200);
		expect(res.body.data).toMatchObject({
			status: 'done',
			request_id: REQUEST_ID,
			clip_url: `https://three.ws/cdn/hero-clips/${REQUEST_ID}.mp4`,
			page_url: `/hero-clip/${REQUEST_ID}`,
			share_url: `https://three.ws/hero-clip/${REQUEST_ID}`,
			share_text: 'Chrome toy rocket, a hero clip made from my 3D model on three.ws',
			duration: 6,
		});
		const stored = state.objects.get(`hero-clips/${REQUEST_ID}.mp4`);
		expect(stored).toBeTruthy();
		expect(stored.metadata || stored.Metadata).toMatchObject({ preset: 'turntable', source_page: `/m/${CREATION}` });
	});

	it('serves an already stored clip without asking xAI again', async () => {
		state.objects.set(`hero-clips/${REQUEST_ID}.mp4`, { body: Buffer.from('mp4') });
		const res = await call('GET', { user: USER, query: `?job=${encodeURIComponent(jobFor(USER))}` });
		expect(res.body.data.status).toBe('done');
		expect(xaiCalls).toHaveLength(0);
	});

	it('maps a failed job to its copy, without retry for a rejected request', async () => {
		xai.status = () => jsonResponse(200, DOC_FAILED);
		const res = await call('GET', { user: USER, query: `?job=${encodeURIComponent(jobFor(USER))}` });
		expect(res.statusCode).toBe(422);
		expect(res.body).toMatchObject({ status: 'failed', request_id: REQUEST_ID, retry: false });
	});

	it('gives up on a job pending past fifteen minutes', async () => {
		const res = await call('GET', { user: USER, query: `?job=${encodeURIComponent(jobFor(USER, { createdAt: Date.now() - 16 * 60_000 }))}` });
		expect(res.statusCode).toBe(504);
		expect(res.body).toMatchObject({ error: 'clip_timeout', status: 'failed', retry: true });
	});
});
