// The real POST /api/forge records one forge_submit event for every way a
// generation request ends before a job exists. Drives the actual handler; only
// the network boundary (global fetch) is stubbed.
//
// Before the submit observer was wired, none of these requests produced any
// event: a request refused at sign-in, at input validation or at the reference
// image step was in no count at all (the 2026-11-26 outage).

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';

const SEED = 'test-seed-secret-prejob';
let forge;
let savedFetch;
let savedSecret;
let logSpy;

function mockRes() {
	return {
		statusCode: 200,
		headersSent: false,
		writableEnded: false,
		_headers: {},
		_body: '',
		setHeader(k, v) {
			this._headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this._headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete this._headers[k.toLowerCase()];
		},
		end(b) {
			this._body = b || '';
			this.writableEnded = true;
			this.headersSent = true;
		},
		get json() {
			try {
				return JSON.parse(this._body);
			} catch {
				return null;
			}
		},
	};
}

function postReq(body, headers = {}) {
	const raw = Buffer.from(JSON.stringify(body));
	const r = Readable.from([raw]);
	r.method = 'POST';
	r.url = '/api/forge';
	r.headers = {
		origin: 'http://localhost:3000',
		'content-type': 'application/json',
		'content-length': String(raw.length),
		...headers,
	};
	r.socket = { remoteAddress: '203.0.113.7' };
	return r;
}

// A platform job acting for a person: past sign-in, and counted (only a
// showcase seed with no person behind it is internal).
const signedIn = (extra = {}) => ({
	'x-forge-seed': SEED,
	'x-forge-on-behalf': 'test',
	'x-forge-on-behalf-user': 'user_prejob_test',
	'x-forge-client': 'prejob-test-client',
	...extra,
});

function submitEvents() {
	return logSpy.mock.calls
		.map((c) => {
			try {
				return JSON.parse(c[0]);
			} catch {
				return null;
			}
		})
		.filter((e) => e && e.evt === 'forge_submit');
}

beforeAll(async () => {
	savedSecret = process.env.CRON_SECRET;
	process.env.CRON_SECRET = SEED;
	process.env.NODE_ENV = 'development';
	forge = (await import('../../api/forge.js')).default;
});

afterAll(() => {
	if (savedSecret === undefined) delete process.env.CRON_SECRET;
	else process.env.CRON_SECRET = savedSecret;
});

beforeEach(() => {
	savedFetch = global.fetch;
	logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	global.fetch = savedFetch;
	vi.restoreAllMocks();
});

describe('POST /api/forge records pre-job endings', () => {
	it('sign_in: an anonymous request', async () => {
		const res = mockRes();
		await forge(postReq({ prompt: 'a red chair' }), res);
		expect(res.statusCode).toBe(401);
		const events = submitEvents();
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ outcome: 'sign_in', stage: 'sign_in', cause: 'sign_in_required', http_status: 401 });
	});

	it('input: a prompt too short to generate from', async () => {
		const res = mockRes();
		await forge(postReq({ prompt: 'hi' }, signedIn()), res);
		expect(res.statusCode).toBe(400);
		const events = submitEvents();
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ outcome: 'failed', stage: 'input', cause: 'invalid_prompt', http_status: 400, internal: false });
	});

	it('input: options the request cannot use', async () => {
		const res = mockRes();
		await forge(postReq({ prompt: 'a red chair', seed: 'not-a-seed' }, signedIn()), res);
		expect(res.statusCode).toBe(400);
		expect(submitEvents()).toEqual([expect.objectContaining({ stage: 'input', cause: 'invalid_options' })]);
	});

	it('input: an engine whose licence excludes the requester region', async () => {
		const res = mockRes();
		await forge(postReq({ prompt: 'a red chair', backend: 'hunyuan3d' }, signedIn({ 'x-client-region': 'DE' })), res);
		expect(res.statusCode).toBe(403);
		expect(submitEvents()).toEqual([expect.objectContaining({ stage: 'input', cause: 'region_restricted' })]);
	});

	it('a showcase seed job is logged as internal (never counted)', async () => {
		const res = mockRes();
		await forge(postReq({ prompt: 'hi' }, { 'x-forge-seed': SEED }), res);
		expect(res.statusCode).toBe(400);
		expect(submitEvents()).toEqual([expect.objectContaining({ stage: 'input', internal: true })]);
	});

	it('submit: no 3D lane can take the job on this deployment', async () => {
		const res = mockRes();
		await forge(postReq({ prompt: 'a red wooden chair', director: false, tier: 'standard' }, signedIn()), res);
		expect(res.statusCode).toBe(503);
		const events = submitEvents();
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ outcome: 'failed', stage: 'submit', cause: res.json.error, http_status: 503 });
	});

	it('reference: the image ladder refused, before any job existed', async () => {
		// Every upstream answers 429 with a stated wait, so painting the reference
		// image for the text prompt fails on the free HF lane's path.
		global.fetch = vi.fn(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '45' } }));
		const res = mockRes();
		await forge(
			postReq(
				{ prompt: 'a red wooden chair', director: false, tier: 'standard', backend: 'huggingface' },
				signedIn({ 'x-client-region': 'US' }),
			),
			res,
		);
		expect(res.statusCode).toBeGreaterThanOrEqual(400);
		const events = submitEvents();
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ outcome: 'failed', stage: 'reference', http_status: res.statusCode });
		expect(events[0].cause).toBe(res.json.error);
	}, 30_000);
});

// The ChatGPT clone of the pipeline (api/gpt-forge.js) shares the lane
// counters, so its pre-job endings are counted the same way.
describe('POST /api/gpt-forge records pre-job endings', () => {
	let gptForge;
	beforeAll(async () => {
		gptForge = (await import('../../api/gpt-forge.js')).default;
	});

	it('sign_in: an anonymous request', async () => {
		const res = mockRes();
		await gptForge(postReq({ prompt: 'a red chair' }), res);
		expect(res.statusCode).toBe(401);
		expect(submitEvents()).toEqual([expect.objectContaining({ outcome: 'sign_in', stage: 'sign_in', cause: 'sign_in_required' })]);
	});

	it('input: a prompt too short to generate from', async () => {
		const res = mockRes();
		await gptForge(postReq({ prompt: 'hi' }, signedIn()), res);
		expect(res.statusCode).toBe(400);
		expect(submitEvents()).toEqual([expect.objectContaining({ outcome: 'failed', stage: 'input', cause: 'invalid_prompt' })]);
	});

	it('submit: no 3D lane can take the job on this deployment', async () => {
		const res = mockRes();
		await gptForge(postReq({ prompt: 'a red wooden chair', director: false, tier: 'standard' }, signedIn()), res);
		expect(res.statusCode).toBeGreaterThanOrEqual(500);
		expect(submitEvents()).toEqual([expect.objectContaining({ outcome: 'failed', stage: 'submit', cause: res.json.error })]);
	});
});
