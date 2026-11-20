// Grok Imagine Video client (api/_lib/xai-video.js).
//
// Every upstream body here is copied verbatim from xAI's documentation or from
// a live call, with its source, so the client is tested against the shapes xAI
// actually returns:
//   [GEN]  https://docs.x.ai/developers/model-capabilities/video/generation
//   [REF]  https://docs.x.ai/developers/model-capabilities/video/reference-to-video
//   [LIVE] POST https://api.x.ai/v1/videos/generations, recorded 2026-11-20
//          (no credentials, then a deliberately invalid key)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const r2 = vi.hoisted(() => ({ objects: new Map() }));
const usage = vi.hoisted(() => ({ events: [] }));

vi.mock('../api/_lib/r2.js', () => ({
	headObject: vi.fn(async (key) => (r2.objects.has(key) ? { ContentLength: r2.objects.get(key).body.length } : null)),
	putObject: vi.fn(async (obj) => {
		r2.objects.set(obj.key, obj);
	}),
	cdnUrl: (key) => `https://three.ws/cdn/${key}`,
}));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: (evt) => usage.events.push(evt) }));
vi.mock('../api/_lib/ssrf-guard.js', () => ({
	fetchSafePublicUrl: (url, init) => globalThis.fetch(url, init),
}));

// [GEN] "Step 1" response.
const DOC_CREATE = { request_id: 'd97415a1-5796-b7ec-379f-4e6819e08fdf' };
// [GEN] "Response (when complete)".
const DOC_DONE = {
	status: 'done',
	video: { url: 'https://vidgen.x.ai/.../video.mp4', duration: 8, respect_moderation: true },
	model: 'grok-imagine-video-1.5',
};
// [GEN] "Error Handling", a failed generation when polling manually.
const DOC_FAILED = {
	status: 'failed',
	error: { code: 'invalid_argument', message: 'Prompt cannot be empty. Please provide a prompt.' },
};
// [LIVE] no Authorization header: HTTP 401.
const LIVE_NO_KEY = { code: 'unauthenticated:no-credentials', error: 'No credentials presented.' };
// [LIVE] invalid key: HTTP 400.
const LIVE_BAD_KEY = {
	code: 'invalid-argument',
	error: 'Incorrect API key provided. You can obtain an API key from https://console.x.ai.',
};

const calls = [];
let responder = null;

function jsonResponse(status, body, headers = {}) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

beforeEach(() => {
	calls.length = 0;
	usage.events.length = 0;
	r2.objects.clear();
	process.env.GROK_API_KEY = 'xai-test-key';
	vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
		calls.push({ url: String(url), init });
		return responder(String(url), init);
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.GROK_API_KEY;
});

async function load() {
	return import('../api/_lib/xai-video.js');
}

describe('buildVideoRequest', () => {
	it('lite pins the real front render as the first frame and sends no references (lite has none)', async () => {
		const { buildVideoRequest } = await load();
		const body = buildVideoRequest({
			tier: 'lite',
			prompt: 'slow turntable',
			duration: 6,
			firstFrame: 'data:image/png;base64,AAAA',
			references: ['data:image/png;base64,BBBB'],
			loop: true,
		});
		expect(body).toEqual({
			model: 'grok-imagine-video-1.5-lite',
			prompt: 'slow turntable',
			duration: 6,
			resolution: '480p',
			generate_audio: false,
			image: { url: 'data:image/png;base64,AAAA' },
		});
	});

	it('full adds the other angles as reference_images at 720p, in the [REF] shape, and can loop', async () => {
		const { buildVideoRequest } = await load();
		const refs = Array.from({ length: 20 }, (_, i) => `https://three.ws/r/${i}.png`);
		const body = buildVideoRequest({ tier: 'full', prompt: 'push in', duration: 8, firstFrame: 'https://three.ws/r/front.png', references: refs, loop: true });
		expect(body.model).toBe('grok-imagine-video-1.5');
		expect(body.resolution).toBe('720p');
		expect(body.image).toEqual({ url: 'https://three.ws/r/front.png' });
		expect(body.reference_images).toHaveLength(14);
		expect(body.reference_images[0]).toEqual({ url: 'https://three.ws/r/0.png' });
		expect(body.last_frame).toEqual({ url: 'https://three.ws/r/front.png' });
	});

	it('rejects durations the model does not take and empty inputs', async () => {
		const { buildVideoRequest } = await load();
		const base = { prompt: 'p', firstFrame: 'https://x/y.png' };
		expect(() => buildVideoRequest({ ...base, duration: 0 })).toThrow(/duration/);
		expect(() => buildVideoRequest({ ...base, duration: 16 })).toThrow(/duration/);
		expect(() => buildVideoRequest({ ...base, duration: 6, prompt: ' ' })).toThrow(/prompt/);
		expect(() => buildVideoRequest({ ...base, duration: 6, firstFrame: '' })).toThrow(/firstFrame/);
		expect(() => buildVideoRequest({ ...base, duration: 6, tier: 'ultra' })).toThrow(/tier/);
	});
});

describe('createVideoJob', () => {
	it('posts to /v1/videos/generations with the key and returns the [GEN] request_id', async () => {
		responder = () => jsonResponse(200, DOC_CREATE);
		const { createVideoJob } = await load();
		const out = await createVideoJob({ model: 'grok-imagine-video-1.5-lite', prompt: 'p' });
		expect(out).toEqual({ requestId: 'd97415a1-5796-b7ec-379f-4e6819e08fdf' });
		expect(calls[0].url).toBe('https://api.x.ai/v1/videos/generations');
		expect(calls[0].init.method).toBe('POST');
		expect(calls[0].init.headers.authorization).toBe('Bearer xai-test-key');
		expect(JSON.parse(calls[0].init.body).model).toBe('grok-imagine-video-1.5-lite');
	});

	it('maps the [LIVE] 401 with no credentials to unauthorized', async () => {
		responder = () => jsonResponse(401, LIVE_NO_KEY);
		const { createVideoJob } = await load();
		const err = await createVideoJob({ model: 'm', prompt: 'p' }, { apiKey: '' }).catch((e) => e);
		expect(err.name).toBe('XaiVideoError');
		expect(err.code).toBe('unauthorized');
		expect(err.status).toBe(401);
		expect(err.providerCode).toBe('unauthenticated:no-credentials');
		expect(err.detail).toBe('No credentials presented.');
		expect(calls[0].init.headers.authorization).toBeUndefined();
	});

	it('maps the [LIVE] 400 "Incorrect API key" to unauthorized, not a bad request', async () => {
		responder = () => jsonResponse(400, LIVE_BAD_KEY);
		const { createVideoJob } = await load();
		const err = await createVideoJob({ model: 'm', prompt: 'p' }).catch((e) => e);
		expect(err.code).toBe('unauthorized');
		expect(err.status).toBe(400);
	});

	it('maps 429 to rate_limited and carries Retry-After', async () => {
		responder = () => jsonResponse(429, { code: 'resource-exhausted', error: 'Too Many Requests' }, { 'retry-after': '12' });
		const { createVideoJob } = await load();
		const err = await createVideoJob({ model: 'm', prompt: 'p' }).catch((e) => e);
		expect(err.code).toBe('rate_limited');
		expect(err.retryAfter).toBe(12);
	});

	it('maps other 4xx to bad_request and 5xx to unavailable', async () => {
		const { createVideoJob } = await load();
		responder = () => jsonResponse(404, { code: 'not-found', error: 'The model grok-x does not exist.' });
		expect((await createVideoJob({}).catch((e) => e)).code).toBe('bad_request');
		responder = () => new Response('upstream connect error', { status: 503 });
		expect((await createVideoJob({}).catch((e) => e)).code).toBe('unavailable');
	});

	it('refuses to call out without a configured key', async () => {
		delete process.env.GROK_API_KEY;
		delete process.env.XAI_API_KEY;
		responder = () => jsonResponse(200, DOC_CREATE);
		const { createVideoJob } = await load();
		const err = await createVideoJob({}).catch((e) => e);
		expect(err.code).toBe('not_configured');
		expect(calls).toHaveLength(0);
	});
});

describe('getVideoJob', () => {
	it('normalizes the [GEN] done body', async () => {
		responder = () => jsonResponse(200, DOC_DONE);
		const { getVideoJob } = await load();
		const job = await getVideoJob(DOC_CREATE.request_id);
		expect(calls[0].url).toBe('https://api.x.ai/v1/videos/d97415a1-5796-b7ec-379f-4e6819e08fdf');
		expect(job).toEqual({ status: 'done', videoUrl: 'https://vidgen.x.ai/.../video.mp4', duration: 8, model: 'grok-imagine-video-1.5' });
	});

	it('reports pending while the video is generating', async () => {
		responder = () => jsonResponse(200, { status: 'pending' });
		const { getVideoJob } = await load();
		expect(await getVideoJob(DOC_CREATE.request_id)).toEqual({ status: 'pending' });
	});

	it('turns the [GEN] failed body into a typed bad_request with the upstream code', async () => {
		responder = () => jsonResponse(200, DOC_FAILED);
		const { getVideoJob } = await load();
		const job = await getVideoJob(DOC_CREATE.request_id);
		expect(job.status).toBe('failed');
		expect(job.error.code).toBe('bad_request');
		expect(job.error.providerCode).toBe('invalid_argument');
		expect(job.error.detail).toBe('Prompt cannot be empty. Please provide a prompt.');
	});

	it('treats a moderation block, and a filtered result (respect_moderation false), as refused', async () => {
		const { getVideoJob } = await load();
		responder = () => jsonResponse(200, { status: 'failed', error: { code: 'invalid_argument', message: 'Content blocked by moderation.' } });
		expect((await getVideoJob(DOC_CREATE.request_id)).error.code).toBe('refused');
		responder = () => jsonResponse(200, { ...DOC_DONE, video: { ...DOC_DONE.video, respect_moderation: false } });
		const filtered = await getVideoJob(DOC_CREATE.request_id);
		expect(filtered.status).toBe('failed');
		expect(filtered.error.code).toBe('refused');
	});

	it('maps the documented failure codes', async () => {
		const { getVideoJob } = await load();
		const codeFor = async (code) => {
			responder = () => jsonResponse(200, { status: 'failed', error: { code, message: 'x' } });
			return (await getVideoJob(DOC_CREATE.request_id)).error.code;
		};
		expect(await codeFor('permission_denied')).toBe('unauthorized');
		expect(await codeFor('failed_precondition')).toBe('bad_request');
		expect(await codeFor('service_unavailable')).toBe('unavailable');
		expect(await codeFor('internal_error')).toBe('failed');
	});

	it('rejects a malformed request id before any network call', async () => {
		const { getVideoJob } = await load();
		await expect(getVideoJob('../../etc')).rejects.toMatchObject({ code: 'bad_request' });
		expect(calls).toHaveLength(0);
	});

	it('maps the [LIVE] 401 on a status read', async () => {
		responder = () => jsonResponse(401, LIVE_NO_KEY);
		const { getVideoJob } = await load();
		await expect(getVideoJob(DOC_CREATE.request_id, { apiKey: '' })).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
	});
});

describe('pollVideoJob', () => {
	it('backs off between reads (2 s x1.5, capped at 10 s) until done', async () => {
		const sequence = [{ status: 'pending' }, { status: 'pending' }, { status: 'pending' }, { status: 'pending' }, { status: 'pending' }, DOC_DONE];
		responder = () => jsonResponse(200, sequence.shift());
		const sleeps = [];
		let clock = 0;
		const { pollVideoJob } = await load();
		const job = await pollVideoJob(DOC_CREATE.request_id, {
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			now: () => clock,
		});
		expect(job.status).toBe('done');
		expect(sleeps).toEqual([2000, 3000, 4500, 6750, 10000]);
	});

	it('throws a typed timeout at the hard limit', async () => {
		responder = () => jsonResponse(200, { status: 'pending' });
		let clock = 0;
		const { pollVideoJob } = await load();
		const err = await pollVideoJob(DOC_CREATE.request_id, {
			timeoutMs: 9000,
			sleep: async (ms) => {
				clock += ms;
			},
			now: () => clock,
		}).catch((e) => e);
		expect(err.code).toBe('timeout');
		expect(err.requestId).toBe(DOC_CREATE.request_id);
	});

	it('throws the typed failure when the job fails', async () => {
		responder = () => jsonResponse(200, DOC_FAILED);
		const { pollVideoJob } = await load();
		await expect(pollVideoJob(DOC_CREATE.request_id, { sleep: async () => {} })).rejects.toMatchObject({ code: 'bad_request' });
	});
});

describe('storeVideo', () => {
	const mp4 = Buffer.concat([Buffer.from('00000018667479706d703432', 'hex'), Buffer.alloc(4096, 7)]);

	it('downloads the temporary clip into our store once, meters it, and returns the CDN URL', async () => {
		responder = (url) => {
			expect(url).toBe('https://vidgen.x.ai/.../video.mp4');
			return new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } });
		};
		const { storeVideo } = await load();
		const first = await storeVideo({
			requestId: DOC_CREATE.request_id,
			videoUrl: DOC_DONE.video.url,
			tier: 'lite',
			seconds: 6,
			metadata: { owner: 'u1', preset: 'turntable' },
			usage: { userId: 'u1', meta: { preset: 'turntable' } },
		});
		expect(first).toEqual({
			clipUrl: 'https://three.ws/cdn/hero-clips/d97415a1-5796-b7ec-379f-4e6819e08fdf.mp4',
			key: 'hero-clips/d97415a1-5796-b7ec-379f-4e6819e08fdf.mp4',
			bytes: mp4.length,
			stored: true,
		});
		const obj = r2.objects.get(first.key);
		expect(obj.contentType).toBe('video/mp4');
		expect(Buffer.compare(obj.body, mp4)).toBe(0);
		expect(obj.metadata).toMatchObject({ owner: 'u1', preset: 'turntable', model: 'grok-imagine-video-1.5-lite' });

		expect(usage.events).toHaveLength(1);
		expect(usage.events[0]).toMatchObject({
			kind: 'xai_video',
			clientId: 'xai-video',
			provider: 'xai',
			model: 'grok-imagine-video-1.5-lite',
			costMicroUsd: 120000,
			userId: 'u1',
		});

		const again = await storeVideo({ requestId: DOC_CREATE.request_id, videoUrl: DOC_DONE.video.url, tier: 'lite', seconds: 6 });
		expect(again.stored).toBe(false);
		expect(calls).toHaveLength(1);
		expect(usage.events).toHaveLength(1);
	});

	it('refuses an empty download instead of storing a broken clip', async () => {
		responder = () => new Response(Buffer.alloc(10), { status: 200 });
		const { storeVideo } = await load();
		await expect(storeVideo({ requestId: DOC_CREATE.request_id, videoUrl: DOC_DONE.video.url, tier: 'lite', seconds: 6 })).rejects.toMatchObject({ code: 'failed' });
		expect(r2.objects.size).toBe(0);
	});

	it('reports an expired temporary URL as unavailable', async () => {
		responder = () => new Response('gone', { status: 403 });
		const { storeVideo } = await load();
		await expect(storeVideo({ requestId: DOC_CREATE.request_id, videoUrl: DOC_DONE.video.url, tier: 'full', seconds: 6 })).rejects.toMatchObject({ code: 'unavailable' });
	});
});

describe('cost', () => {
	it('meters list price per second', async () => {
		const { clipCostMicroUsd } = await load();
		expect(clipCostMicroUsd('lite', 6)).toBe(120000);
		expect(clipCostMicroUsd('full', 10)).toBe(800000);
	});
});
