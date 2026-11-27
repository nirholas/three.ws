/**
 * Batch generation on a shared GPU (api/forge-batch.js): fair, independent,
 * throttle-aware, resumable, and validated before anything starts.
 *
 * The real handler runs end to end. Only the network boundaries are replaced:
 * the self-call to /api/forge (global fetch), Redis (an in-memory store that
 * honours SET NX), the account lookup, and the NemoGuard text screen.
 *
 * What these pin, in the order the hardening order asks for:
 *   - a batch never has more than one item on the GPU at a time (holder tier
 *     or not), and a person has one open batch at a time;
 *   - a batch never spends past the person's allowance: once /api/forge says
 *     the allowance is used up, the rest are held back, never submitted;
 *   - one failing item leaves the others to run, and the group reports partial
 *     success with honest counts;
 *   - a stated wait from the image step is honoured between items instead of
 *     failing the remaining ones;
 *   - the batch survives the page closing: the person's latest batch comes
 *     back with every item's state, and only its owner can see it;
 *   - empty, duplicate, over-long and flagged lines are refused per item
 *     before anything is submitted;
 *   - items that have not started can be cancelled, a failed item retried.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
});

const store = new Map();
vi.mock('../api/_lib/redis.js', () => ({
	getRedis: () => ({
		async set(key, value, opts = {}) {
			if (opts.nx && store.has(key)) return null;
			store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
			return 'OK';
		},
		async get(key) {
			return store.has(key) ? store.get(key) : null;
		},
		async del(key) {
			return store.delete(key) ? 1 : 0;
		},
	}),
}));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		forgeBatchSubmit: vi.fn(async () => ({ success: true })),
		forgeBatchStatus: vi.fn(async () => ({ success: true })),
	},
	clientIp: () => '203.0.113.9',
}));

let currentUser = { id: 'acct-fair' };
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => currentUser,
}));

vi.mock('../api/_lib/comp-access.js', () => ({
	resolveCompAccess: async () => ({ comped: true }),
	COMP_TIER: { rateMultiplier: 4 },
}));

const flagged = new Set();
vi.mock('../api/_lib/content-safety.js', () => ({
	screenText: vi.fn(async (text) =>
		flagged.has(text)
			? { checked: true, flagged: true, categories: ['Violence'] }
			: { checked: true, flagged: false, categories: [] },
	),
}));

const { default: handler } = await import('../api/forge-batch.js');

function req(method, url, body) {
	return {
		method,
		url,
		headers: { host: 'three.ws', 'x-forwarded-proto': 'https', 'content-type': 'application/json', cookie: '__Host-sid=s' },
		on(event, cb) {
			if (event === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
			if (event === 'end') cb();
		},
	};
}

function res() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(k, v) {
			this.headers[String(k).toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[String(k).toLowerCase()];
		},
		end(b) {
			this.body = b ? JSON.parse(b) : null;
		},
	};
}

async function call(method, url, body) {
	const r = res();
	await handler(req(method, url, body), r);
	return r;
}

const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, headers: new Map(), json: async () => data });

// A scripted /api/forge: submits answer from `onSubmit(body)`, job polls from
// the `jobs` map (job id -> status payload). Every call is recorded.
let submits;
let polls;
let jobs;
let onSubmit;
function installForge() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url, init = {}) => {
			const u = String(url);
			if (init.method === 'POST' && u.endsWith('/api/forge')) {
				const body = JSON.parse(init.body);
				submits.push(body);
				return onSubmit(body, submits.length);
			}
			const jobId = decodeURIComponent(u.split('job=')[1] || '');
			polls.push(jobId);
			return reply(200, jobs.get(jobId) || { status: 'queued' });
		}),
	);
}

let now;
beforeEach(() => {
	store.clear();
	flagged.clear();
	currentUser = { id: 'acct-fair' };
	submits = [];
	polls = [];
	jobs = new Map();
	onSubmit = (body, n) => reply(200, { job_id: `job-${n}`, status: 'queued' });
	now = 1_800_000_000_000;
	vi.spyOn(Date, 'now').mockImplementation(() => now);
	installForge();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const three = { items: [{ prompt: 'a red armchair' }, { prompt: 'a clay pot' }, { prompt: 'a brass lamp' }] };
const poll = (id) => call('GET', `/api/forge-batch?batch=${id}`);

describe('fairness on one GPU', () => {
	it('puts one item on the GPU at a time, even for a comped holder', async () => {
		const start = await call('POST', '/api/forge-batch', three);
		expect(start.statusCode).toBe(200);
		expect(submits).toHaveLength(1);
		expect(start.body.max_active).toBe(1);
		expect(start.body.items.map((i) => i.status)).toEqual(['queued', 'pending', 'pending']);

		// Still running: polling never starts a second job alongside it.
		jobs.set('job-1', { status: 'running' });
		await poll(start.body.batch_id);
		await poll(start.body.batch_id);
		expect(submits).toHaveLength(1);

		// Item 0 finishes: the next poll starts item 1, and only item 1.
		jobs.set('job-1', { status: 'done', glb_url: 'https://cdn.example/1.glb' });
		const next = await poll(start.body.batch_id);
		expect(submits).toHaveLength(2);
		expect(submits[1].prompt).toBe('a clay pot');
		expect(next.body.items.map((i) => i.status)).toEqual(['done', 'queued', 'pending']);
	});

	it('allows one open batch per person', async () => {
		const first = await call('POST', '/api/forge-batch', three);
		const second = await call('POST', '/api/forge-batch', { items: [{ prompt: 'a wooden stool' }] });
		expect(second.statusCode).toBe(409);
		expect(second.body).toMatchObject({ error: 'batch_in_progress', batch_id: first.body.batch_id });
		expect(submits).toHaveLength(1);
	});

	it('never spends past the allowance: once it is used up the rest are held back unsubmitted', async () => {
		onSubmit = (body, n) =>
			n === 1
				? reply(200, { job_id: 'job-1', status: 'done', glb_url: 'https://cdn.example/1.glb' })
				: reply(429, { error: 'rate_limited', limit: 'generation_hourly', message: 'Generation limit reached.', retry_after: 3000 });
		const start = await call('POST', '/api/forge-batch', three);
		// Item 0 came back done from cache, so item 1 was submitted in the same call and refused.
		expect(submits).toHaveLength(2);
		const [a, b, c] = start.body.items;
		expect(a.status).toBe('done');
		expect(b).toMatchObject({ status: 'failed', ok: false, error: 'allowance_reached', retryable: true });
		expect(c).toMatchObject({ status: 'failed', ok: false, error: 'allowance_reached' });
		expect(start.body.status).toBe('partial');
		// Nothing else is ever submitted for this batch.
		await poll(start.body.batch_id);
		expect(submits).toHaveLength(2);
	});
});

describe('independent items', () => {
	it('keeps going after one item fails and reports partial success honestly', async () => {
		const start = await call('POST', '/api/forge-batch', three);
		const id = start.body.batch_id;
		jobs.set('job-1', { status: 'failed', error: 'reconstruction failed' });
		await poll(id); // item 0 failed, item 1 starts
		jobs.set('job-2', { status: 'done', glb_url: 'https://cdn.example/2.glb' });
		await poll(id); // item 1 done, item 2 starts
		jobs.set('job-3', { status: 'done', glb_url: 'https://cdn.example/3.glb' });
		const end = await poll(id);

		expect(submits).toHaveLength(3);
		expect(end.body.items.map((i) => i.status)).toEqual(['failed', 'done', 'done']);
		expect(end.body.items[0]).toMatchObject({ ok: false, error: 'generation_failed', message: 'reconstruction failed', retryable: true });
		expect(end.body.status).toBe('partial');
		expect(end.body.summary).toMatchObject({ total: 3, done: 2, failed: 1, cancelled: 0, pending: 0, active: 0 });
	});

	it('a submit refusal on one item does not stop the next', async () => {
		onSubmit = (body, n) =>
			body.prompt === 'a clay pot'
				? reply(400, { error: 'invalid_options', message: 'bad option' })
				: reply(200, { job_id: `job-${n}`, status: 'done', glb_url: `https://cdn.example/${n}.glb` });
		const start = await call('POST', '/api/forge-batch', three);
		expect(start.body.items.map((i) => i.status)).toEqual(['done', 'failed', 'done']);
		expect(start.body.items[1]).toMatchObject({ error: 'invalid_options', retryable: false });
	});

	it('retries a failed item on request and runs it again', async () => {
		onSubmit = (body, n) =>
			n === 1
				? reply(502, { error: 'generation_failed', message: 'upstream died' })
				: reply(200, { job_id: `job-${n}`, status: 'done', glb_url: `https://cdn.example/${n}.glb` });
		const start = await call('POST', '/api/forge-batch', three);
		expect(start.body.items.map((i) => i.status)).toEqual(['failed', 'done', 'done']);
		const retried = await call('POST', `/api/forge-batch?batch=${start.body.batch_id}&action=retry&item=0`);
		expect(retried.statusCode).toBe(200);
		expect(submits).toHaveLength(4);
		expect(retried.body.items[0]).toMatchObject({ status: 'done', ok: true, attempts: 2 });
		expect(retried.body.status).toBe('done');
	});
});

describe('throttles inside a batch', () => {
	it('waits the stated time between items instead of failing the rest', async () => {
		onSubmit = (body, n) => {
			if (n === 1) return reply(200, { job_id: 'job-1', status: 'done', glb_url: 'https://cdn.example/1.glb' });
			if (n === 2) return reply(429, { error: 'rate_limited', queued: true, message: 'queued behind others', retry_after: 45 });
			return reply(200, { job_id: `job-${n}`, status: 'queued' });
		};
		const start = await call('POST', '/api/forge-batch', three);
		const id = start.body.batch_id;
		expect(start.body.items[1]).toMatchObject({ status: 'waiting', retry_at: new Date(now + 45_000).toISOString() });
		expect(start.body.items[2].status).toBe('pending');
		expect(start.body.status).toBe('waiting');

		now += 20_000;
		await poll(id);
		expect(submits).toHaveLength(2); // not before the stated wait

		now += 26_000;
		const after = await poll(id);
		expect(submits).toHaveLength(3);
		expect(submits[2].prompt).toBe('a clay pot');
		expect(after.body.items[1]).toMatchObject({ status: 'queued', job_id: 'job-3' });
	});

	it('gives up on an item that keeps being throttled, and moves on', async () => {
		onSubmit = (body) =>
			body.prompt === 'a red armchair'
				? reply(503, { error: 'generation_unavailable', message: 'temporarily unavailable', retry_after: 30 })
				: reply(200, { job_id: 'job-x', status: 'done', glb_url: 'https://cdn.example/x.glb' });
		const start = await call('POST', '/api/forge-batch', three);
		const id = start.body.batch_id;
		let last = start;
		for (let i = 0; i < 6; i++) {
			now += 31_000;
			last = await poll(id);
		}
		expect(last.body.items[0]).toMatchObject({ status: 'failed', error: 'generation_unavailable', retryable: true });
		expect(last.body.items.slice(1).map((i) => i.status)).toEqual(['done', 'done']);
	});
});

describe('resumable', () => {
	it('brings the latest batch back with every item state after the page closed', async () => {
		const start = await call('POST', '/api/forge-batch', three);
		jobs.set('job-1', { status: 'done', glb_url: 'https://cdn.example/1.glb' });
		const back = await call('GET', '/api/forge-batch?latest=1');
		expect(back.statusCode).toBe(200);
		expect(back.body.batch_id).toBe(start.body.batch_id);
		expect(back.body.items.map((i) => i.status)).toEqual(['done', 'queued', 'pending']);
		expect(back.body.items[0].prompt).toBe('a red armchair');
		// The stored request bodies never leave the server.
		expect(back.body.items[0].body).toBeUndefined();
	});

	it('answers 404 to anyone but the owner', async () => {
		const start = await call('POST', '/api/forge-batch', three);
		currentUser = { id: 'someone-else' };
		const peek = await poll(start.body.batch_id);
		expect(peek.statusCode).toBe(404);
		const latest = await call('GET', '/api/forge-batch?latest=1');
		expect(latest.statusCode).toBe(404);
		expect(latest.body.error).toBe('no_recent_batch');
	});
});

describe('validation up front', () => {
	it('flags empty, duplicate, over-long and flagged items per item and starts nothing', async () => {
		flagged.add('a violent thing');
		const r = await call('POST', '/api/forge-batch', {
			items: [
				{ prompt: 'a red armchair' },
				{ prompt: '   ' },
				{ prompt: 'A  Red Armchair' },
				{ prompt: 'x'.repeat(1001) },
				{ prompt: 'a violent thing' },
				{ prompt: 'ok' },
			],
		});
		expect(r.statusCode).toBe(400);
		expect(r.body.error).toBe('invalid_items');
		const codes = r.body.items.map((i) => i.issues.map((x) => x.code));
		expect(codes).toEqual([[], ['empty'], ['duplicate'], ['too_long'], ['content_blocked'], ['too_short']]);
		expect(r.body.items[2].issues[0].message).toMatch(/item 1/);
		expect(submits).toHaveLength(0);
		expect([...store.keys()].some((k) => k.includes('fr:batch:user:'))).toBe(false);
	});

	it('accepts a photo item with no prompt', async () => {
		const r = await call('POST', '/api/forge-batch', { items: [{ image_url: 'https://cdn.example/a.png' }, { prompt: 'a clay pot' }] });
		expect(r.statusCode).toBe(200);
		expect(submits[0]).toMatchObject({ image_url: 'https://cdn.example/a.png' });
	});
});

describe('cancel', () => {
	it('cancels what has not started and leaves the running item alone', async () => {
		const start = await call('POST', '/api/forge-batch', three);
		const id = start.body.batch_id;
		const one = await call('POST', `/api/forge-batch?batch=${id}&action=cancel&item=2`);
		expect(one.body.items.map((i) => i.status)).toEqual(['queued', 'pending', 'cancelled']);
		const started = await call('POST', `/api/forge-batch?batch=${id}&action=cancel&item=0`);
		expect(started.statusCode).toBe(409);
		expect(started.body.error).toBe('not_cancellable');
		const all = await call('POST', `/api/forge-batch?batch=${id}&action=cancel`);
		expect(all.body.items.map((i) => i.status)).toEqual(['queued', 'cancelled', 'cancelled']);
		jobs.set('job-1', { status: 'done', glb_url: 'https://cdn.example/1.glb' });
		const end = await poll(id);
		expect(submits).toHaveLength(1);
		expect(end.body.status).toBe('partial');
		expect(end.body.summary).toMatchObject({ done: 1, cancelled: 2 });
		// A finished batch frees the person to start another.
		const again = await call('POST', '/api/forge-batch', { items: [{ prompt: 'a wooden stool' }] });
		expect(again.statusCode).toBe(200);
	});
});
