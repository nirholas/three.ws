// api/cron/scheduler-tick.js: the single Scheduler-driven clock for every cron
// in vercel.json. Pins the gate, the dry-run listing a deploy verifies with, and
// a real fan-out to an HTTP server standing in for the container.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';

vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: async () => ({ pressured: false }),
}));
vi.mock('../../api/_lib/env.js', () => ({ env: {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn() }));
vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => false, drain: vi.fn() }));

const { default: handler } = await import('../../api/cron/scheduler-tick.js');
const { dueCrons } = await import('../../api/_lib/cron-tick.js');

const SCHEDULED = '2026-11-26T10:00:04Z';
const { crons } = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const expectedDue = dueCrons(crons, new Date('2026-11-26T10:00:00Z')).due.map((d) => d.path);

function call({ url = '/api/cron/scheduler-tick', auth = 'Bearer test-cron-secret', method = 'GET' } = {}) {
	const res = {
		statusCode: 0,
		body: null,
		headers: {},
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ? JSON.parse(b) : null; },
		get headersSent() { return this.body !== null; },
		get writableEnded() { return this.body !== null; },
	};
	const req = {
		method,
		url,
		headers: { authorization: auth, host: 'svc.run.app', 'x-cloudscheduler-scheduletime': SCHEDULED },
	};
	return handler(req, res).then(() => res);
}

let server;
const hits = [];

beforeAll(async () => {
	server = http.createServer((req, res) => {
		hits.push({ url: req.url, auth: req.headers.authorization, host: req.headers.host });
		res.statusCode = 200;
		res.end('{}');
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
});
afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
	process.env.CRON_SECRET = 'test-cron-secret';
	process.env.CRON_TICK_ORIGIN = `http://127.0.0.1:${server.address().port}`;
	hits.length = 0;
});
afterEach(() => {
	delete process.env.CRON_SECRET;
	delete process.env.CRON_TICK_ORIGIN;
});

describe('GET /api/cron/scheduler-tick', () => {
	it('refuses a bad secret and fires nothing', async () => {
		expect((await call({ auth: 'Bearer wrong' })).statusCode).toBe(401);
		expect(hits).toEqual([]);
	});

	it('refuses methods other than GET', async () => {
		expect((await call({ method: 'POST' })).statusCode).toBe(405);
	});

	it('lists the crons due in the scheduled minute on a dry run without firing', async () => {
		const res = await call({ url: '/api/cron/scheduler-tick?dry=1' });
		expect(res.statusCode).toBe(200);
		expect(res.body.tick).toBe('2026-11-26T10:00:00.000Z');
		expect(res.body.due).toEqual(expectedDue);
		expect(res.body.due.length).toBeGreaterThan(14);
		expect(hits).toEqual([]);
	});

	it('fires every due cron once with the secret', async () => {
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(res.body.fired).toBe(expectedDue.length);
		expect(res.body.failed).toEqual([]);
		expect(hits.map((h) => h.url).sort()).toEqual([...expectedDue].sort());
		expect(new Set(hits.map((h) => h.auth))).toEqual(new Set(['Bearer test-cron-secret']));
	});
});
