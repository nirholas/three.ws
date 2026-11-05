// /api/avatar/video-generate and /api/avatar/video-status against the LongCat
// GPU host: configured, unconfigured, and host-stopped branches, plus the wake.
//
// A stopped host used to surface as a raw socket error (502 worker_unreachable).
// It must now be a typed, retryable 503 capacity_unavailable with Retry-After,
// release the free-trial slot, and ask for the host to be started.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { sqlCalls: [], usage: [], plan: 'paid', fetchImpl: null, wakeCalls: 0 };

vi.mock('../api/_lib/http.js', () => ({
	cors: () => false,
	wrap: (h) => h,
	rateLimited: (res) => res._send(429, {}),
	json: (res, status, body, headers = {}) => res._send(status, body, headers),
	error: (res, status, code, message, extra = {}) =>
		res._send(status, { error: code, error_description: message, ...extra }),
}));
vi.mock('../api/_lib/auth.js', () => ({ getSessionUser: vi.fn(async () => ({ id: 'user-1' })) }));
vi.mock('../api/_lib/env.js', () => ({ env: { APP_ORIGIN: 'https://three.ws', S3_PUBLIC_DOMAIN: 'https://three.ws/cdn' } }));
vi.mock('../api/_lib/r2.js', () => ({ publicUrl: (k) => `https://three.ws/cdn/${k}`, thumbnailUrl: () => null }));
vi.mock('../api/_lib/avatar-render.js', () => ({
	resolveRenderParams: () => ({ params: {} }),
	renderAvatarImage: vi.fn(),
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		videoGenerateUser: async () => ({ success: true }),
		videoGenerateGlobal: async () => ({ success: true }),
		longcatWakeBurst: async () => ({ success: true }),
		longcatWakeDaily: async () => ({ success: true }),
	},
}));
vi.mock('../api/_lib/gcp-auth.js', () => ({ getGcpAccessToken: vi.fn(async () => 'tok') }));
vi.mock('../api/_lib/upstream-fetch.js', () => ({ fetchUpstream: vi.fn((...a) => state.fetchImpl(...a)) }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...vals) => {
		const q = strings.join('?').toLowerCase();
		state.sqlCalls.push(q);
		if (q.includes('select plan from users')) return [{ plan: state.plan }];
		if (q.includes('select count(*)')) return [{ n: '0' }];
		if (q.includes('insert into usage_events') && q.includes('returning id')) {
			state.usage.push(1);
			return [{ id: 7 }];
		}
		if (q.includes('select user_id from usage_events')) return [{ user_id: 'user-1' }];
		return [];
	}),
}));

const { default: generate } = await import('../api/avatar/video-generate.js');
const { default: status } = await import('../api/avatar/video-status.js');
const host = await import('../api/_lib/longcat-host.js');

function makeRes() {
	const res = {
		code: null, body: null, headers: {},
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		_send(code, body, headers = {}) {
			this.code = code; this.body = body;
			Object.assign(this.headers, headers);
			return this;
		},
	};
	return res;
}

const postBody = { image_url: 'https://three.ws/cdn/a.png', audio_url: 'https://three.ws/cdn/a.wav' };
const post = () => ({ method: 'POST', url: '/api/avatar/video-generate', body: postBody, headers: {} });
const poll = () => ({ method: 'GET', url: '/api/avatar/video-status?job_id=job-1', headers: {} });

function reply(status, body) {
	return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body ?? '') };
}

beforeEach(() => {
	state.sqlCalls = []; state.usage = []; state.plan = 'paid'; state.fetchImpl = null;
	delete process.env.LONGCAT_WORKER_URL;
	delete process.env.LONGCAT_WORKER_KEY;
	delete process.env.LONGCAT_GCE_INSTANCE;
});

describe('unconfigured deployment', () => {
	it('video-generate answers 503 worker_unconfigured and the GET says unavailable', async () => {
		const res = await generate(post(), makeRes());
		expect(res.code).toBe(503);
		expect(res.body.error).toBe('worker_unconfigured');
		const probe = await generate({ method: 'GET', url: '/api/avatar/video-generate', headers: {} }, makeRes());
		expect(probe.body).toMatchObject({ available: false, reason: 'worker_unconfigured' });
	});

	it('video-status answers 503 worker_unconfigured', async () => {
		const res = await status(poll(), makeRes());
		expect(res.code).toBe(503);
		expect(res.body.error).toBe('worker_unconfigured');
	});
});

describe('configured and reachable', () => {
	beforeEach(() => {
		process.env.LONGCAT_WORKER_URL = 'https://1-2-3-4.sslip.io/';
		process.env.LONGCAT_WORKER_KEY = 'k';
	});

	it('video-generate queues a job and forwards the bearer key', async () => {
		state.fetchImpl = async (url, init) => {
			expect(url).toBe('https://1-2-3-4.sslip.io/generate');
			expect(init.headers.authorization).toBe('Bearer k');
			return reply(202, { job_id: 'job-1', status: 'queued' });
		};
		const res = await generate(post(), makeRes());
		expect(res.code).toBe(202);
		expect(res.body).toEqual({ job_id: 'job-1', status: 'queued' });
	});

	it('video-status relays the worker job', async () => {
		state.fetchImpl = async () => reply(200, { job_id: 'job-1', status: 'running', progress: 0.4 });
		const res = await status(poll(), makeRes());
		expect(res.code).toBe(200);
		expect(res.body).toMatchObject({ job_id: 'job-1', status: 'running', progress: 0.4 });
	});

	it('a worker 404 is not a capacity problem', async () => {
		state.fetchImpl = async () => reply(404, {});
		const res = await status(poll(), makeRes());
		expect(res.code).toBe(404);
	});
});

describe('host stopped', () => {
	beforeEach(() => {
		process.env.LONGCAT_WORKER_URL = 'https://1-2-3-4.sslip.io';
		process.env.LONGCAT_WORKER_KEY = 'k';
	});

	it('video-generate returns a typed retryable 503 on a socket error and releases the free-trial slot', async () => {
		state.plan = 'free';
		state.fetchImpl = async () => { throw new Error('connect ETIMEDOUT'); };
		const res = await generate(post(), makeRes());
		expect(res.code).toBe(503);
		expect(res.body).toMatchObject({ error: 'capacity_unavailable', retry_after_seconds: host.CAPACITY_RETRY_SECONDS });
		expect(res.headers['retry-after']).toBe(String(host.CAPACITY_RETRY_SECONDS));
		expect(state.sqlCalls.some((q) => q.includes('delete from usage_events'))).toBe(true);
	});

	it('video-generate treats a proxy 502 as capacity, but a worker 503 as a worker error', async () => {
		state.fetchImpl = async () => reply(502, 'bad gateway');
		expect((await generate(post(), makeRes())).body.error).toBe('capacity_unavailable');
		state.fetchImpl = async () => reply(503, { detail: 'model weights are not staged on this instance' });
		expect((await generate(post(), makeRes())).body.error).toBe('worker_error');
	});

	it('video-status returns the typed retry on a socket error and on a 504', async () => {
		state.fetchImpl = async () => { throw new Error('socket hang up'); };
		const a = await status(poll(), makeRes());
		expect(a.code).toBe(503);
		expect(a.body.error).toBe('capacity_unavailable');
		state.fetchImpl = async () => reply(504, '');
		expect((await status(poll(), makeRes())).body.error).toBe('capacity_unavailable');
	});
});

describe('requestHostWake', () => {
	const ok = { success: true };
	const mk = (impl) => ({
		instance: 'proj/us-central1-a/longcat-avatar',
		rateLimits: { longcatWakeBurst: async () => ok, longcatWakeDaily: async () => ok },
		getToken: async () => 'tok',
		fetcher: vi.fn(impl),
	});

	it('is disabled without an instance reference', async () => {
		expect(await host.requestHostWake({ instance: '' })).toBe('disabled');
		expect(await host.requestHostWake({ instance: 'not/valid' })).toBe('disabled');
	});

	it('starts a terminated host', async () => {
		const deps = mk(async (url) => (url.endsWith('/start') ? reply(200, {}) : reply(200, { status: 'TERMINATED' })));
		expect(await host.requestHostWake(deps)).toBe('started');
		const urls = deps.fetcher.mock.calls.map((c) => c[0]);
		expect(urls[1]).toBe('https://compute.googleapis.com/compute/v1/projects/proj/zones/us-central1-a/instances/longcat-avatar/start');
	});

	it('does not restart a running host', async () => {
		const deps = mk(async () => reply(200, { status: 'RUNNING' }));
		expect(await host.requestHostWake(deps)).toBe('already_running');
		expect(deps.fetcher).toHaveBeenCalledTimes(1);
	});

	it('is throttled by the wake limiters and never calls Compute', async () => {
		const deps = mk(async () => reply(200, {}));
		deps.rateLimits.longcatWakeBurst = async () => ({ success: false });
		expect(await host.requestHostWake(deps)).toBe('throttled');
		expect(deps.fetcher).not.toHaveBeenCalled();
	});

	it('swallows a Compute failure', async () => {
		const deps = mk(async () => { throw new Error('boom'); });
		expect(await host.requestHostWake(deps)).toBe('failed');
	});
});
