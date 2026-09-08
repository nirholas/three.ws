/**
 * GET /api/forge?progress=<id> — the read side of the pre-submit progress
 * channel /forge polls while its own POST is still open.
 *
 * These pin the route itself (the crumb store is covered by
 * tests/forge-progress.test.js): a well-formed trace answers with whatever the
 * pipeline has finished so far, an unknown trace answers with an empty list
 * rather than an error, and a malformed id is refused before anything is read.
 *
 * The property that matters most is the last one: polling ahead of the first
 * milestone is the NORMAL case, so it must be indistinguishable from a healthy
 * "not there yet", never a failure the page has to render.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
});

const crumbs = new Map();
vi.mock('../../api/_lib/cache.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		cacheGetFresh: vi.fn(async (key) => (crumbs.has(key) ? crumbs.get(key) : null)),
		cacheSet: vi.fn(async (key, value) => {
			crumbs.set(key, value);
		}),
	};
});

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.7',
	};
});

const { default: handler } = await import('../../api/forge.js');

const TRACE = 'f0e1d2c3b4a596877869504132231415';

function makeReq(url) {
	return { method: 'GET', url, headers: { 'x-forge-client': 'tester' } };
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

describe('GET /api/forge?progress', () => {
	beforeEach(() => {
		crumbs.clear();
	});

	it('returns the milestones recorded so far for a known trace', async () => {
		crumbs.set(`forge:progress:${TRACE}`, [
			{ stage: 'directed', at: 10, directed_prompt: 'a brass sundial, aged patina, studio light' },
			{ stage: 'reference', at: 20, preview_image_url: 'https://cdn.example/ref.jpg' },
		]);
		const res = makeRes();
		await handler(makeReq(`/api/forge?progress=${TRACE}`), res);
		expect(res.statusCode).toBe(200);
		expect(res.body.progress.map((c) => c.stage)).toEqual(['directed', 'reference']);
		expect(res.body.progress[1].preview_image_url).toBe('https://cdn.example/ref.jpg');
	});

	it('answers an unstarted trace with an empty list, not an error', async () => {
		const res = makeRes();
		await handler(makeReq(`/api/forge?progress=${TRACE}`), res);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ progress: [] });
	});

	it('refuses a malformed trace id before reading anything', async () => {
		const res = makeRes();
		await handler(makeReq('/api/forge?progress=nope'), res);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toBe('invalid_progress_id');
	});

	it('never caches a progress read', async () => {
		const res = makeRes();
		await handler(makeReq(`/api/forge?progress=${TRACE}`), res);
		expect(String(res.headers['cache-control'])).toContain('no-store');
	});

	it('leaves the job poll alone', async () => {
		const res = makeRes();
		await handler(makeReq('/api/forge'), res);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toBe('missing_job');
	});
});
