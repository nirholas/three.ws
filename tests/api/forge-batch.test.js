/**
 * POST/GET /api/forge-batch: fan out N /api/forge submissions from one call
 * and poll them as a group (api/forge-batch.js).
 *
 * /api/forge itself is never exercised here: every self-call is a mocked
 * `fetch`, so these tests pin forge-batch.js's own contract (validation,
 * per-item isolation, group status, Redis-backed retrieval) independent of
 * the real generation pipeline.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
});

const store = new Map();
function fakeRedis() {
	return {
		async set(key, value) {
			store.set(key, value);
		},
		async get(key) {
			return store.has(key) ? store.get(key) : null;
		},
	};
}

vi.mock('../../api/_lib/redis.js', () => ({
	getRedis: () => fakeRedis(),
}));

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			forgeBatchSubmit: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			forgeBatchStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.9',
	};
});

const { default: handler } = await import('../../api/forge-batch.js');

function makePostReq(body, { headers = {} } = {}) {
	return {
		method: 'POST',
		url: '/api/forge-batch',
		headers: { 'content-type': 'application/json', ...headers },
		on(event, cb) {
			if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
			if (event === 'end') cb();
		},
	};
}

function makeGetReq(url, { headers = {} } = {}) {
	return { method: 'GET', url, headers };
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

function mockFetchSequence(impl) {
	vi.stubGlobal('fetch', vi.fn(impl));
}

function jsonResponse(status, data) {
	return { ok: status >= 200 && status < 300, status, json: async () => data };
}

describe('POST /api/forge-batch', () => {
	beforeEach(() => {
		store.clear();
		vi.unstubAllGlobals();
	});

	it('submits every item and returns a retrievable batch id', async () => {
		let n = 0;
		mockFetchSequence(async (url) => {
			expect(String(url)).toBe('https://three.ws/api/forge');
			n += 1;
			return jsonResponse(200, { job_id: `job-${n}`, status: 'queued', path: 'image', tier: 'draft', backend: 'nvidia' });
		});

		const req = makePostReq({ items: [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }, { prompt: 'd' }] });
		const res = makeRes();
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.body.batch_id).toBeTruthy();
		expect(res.body.items).toHaveLength(4);
		expect(res.body.items.every((i) => i.ok && i.job_id)).toBe(true);
		expect(res.body.status).toBe('queued');
	});

	it('isolates one failing item: the rest still submit with real job ids', async () => {
		mockFetchSequence(async (url, init) => {
			const body = JSON.parse(init.body);
			if (body.prompt === 'bad') return jsonResponse(400, { error: 'invalid_options', message: 'nope' });
			return jsonResponse(200, { job_id: `job-${body.prompt}`, status: 'queued' });
		});

		const req = makePostReq({ items: [{ prompt: 'good1' }, { prompt: 'bad' }, { prompt: 'good2' }] });
		const res = makeRes();
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.body.items[0]).toMatchObject({ ok: true, job_id: 'job-good1' });
		expect(res.body.items[1]).toMatchObject({ ok: false, error: 'invalid_options' });
		expect(res.body.items[2]).toMatchObject({ ok: true, job_id: 'job-good2' });
	});

	it('rejects an empty items array', async () => {
		const req = makePostReq({ items: [] });
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toBe('missing_items');
	});

	it('rejects a batch larger than the max', async () => {
		const items = Array.from({ length: 9 }, (_, i) => ({ prompt: `p${i}` }));
		const req = makePostReq({ items });
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toBe('too_many_items');
	});
});

describe('GET /api/forge-batch?batch=', () => {
	beforeEach(() => {
		store.clear();
		vi.unstubAllGlobals();
	});

	it('completes a 4-item batch and retrieves it as a group', async () => {
		let n = 0;
		mockFetchSequence(async (url) => {
			n += 1;
			return jsonResponse(200, { job_id: `job-${n}`, status: 'queued' });
		});
		const submit = makePostReq({ items: [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }, { prompt: 'd' }] });
		const submitRes = makeRes();
		await handler(submit, submitRes);
		const { batch_id } = submitRes.body;

		mockFetchSequence(async (url) => {
			const jobId = decodeURIComponent(String(url).split('job=')[1]);
			return jsonResponse(200, { job_id: jobId, status: 'done', glb_url: `https://cdn.example/${jobId}.glb` });
		});
		const poll = makeGetReq(`/api/forge-batch?batch=${batch_id}`);
		const pollRes = makeRes();
		await handler(poll, pollRes);

		expect(pollRes.statusCode).toBe(200);
		expect(pollRes.body.status).toBe('done');
		expect(pollRes.body.items).toHaveLength(4);
		expect(pollRes.body.items.every((i) => i.status === 'done' && i.glb_url)).toBe(true);
	});

	it('404s on an unknown batch id', async () => {
		const req = makeGetReq('/api/forge-batch?batch=does-not-exist');
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(404);
		expect(res.body.error).toBe('batch_not_found');
	});

	it('400s when no batch id is passed', async () => {
		const req = makeGetReq('/api/forge-batch');
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toBe('missing_batch');
	});
});
