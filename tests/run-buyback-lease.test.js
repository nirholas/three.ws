// Cadence-lease test for handleRunBuyback in api/cron/[name].js.
//
// Production 2026-10-24: a single HTTP 503 (budget timeout) on run-buyback.
// economy-tick.js fires /api/cron/run-buyback every minute (one of its ~36
// fan-out TARGETS) on top of its own dedicated vercel.json `0 * * * *` Cloud
// Scheduler job, with nothing stopping the two callers from overlapping.
// Unlike economy-reconcile (fixed the same way earlier this session), each
// run here also reads and can swap/burn up to 200 coins' buyback vaults, so
// an overlapping run risks racing itself against the same vault balance, not
// just running long. A lease that makes the hourly cadence durable regardless
// of how often the route is invoked fixes both the timeout risk and the race.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const lockHeld = { value: false };
vi.mock('../api/_lib/cache.js', () => ({
	acquireLock: vi.fn(async () => !lockHeld.value),
}));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: vi.fn(() => true) }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const { default: handler } = await import('../api/cron/[name].js');

function call() {
	const req = { method: 'GET', url: '/api/cron/run-buyback?name=run-buyback', query: { name: 'run-buyback' }, headers: {} };
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; this.writableEnded = true; this.headersSent = true; },
	};
	return handler(req, res).then(() => res);
}

describe('run-buyback handler lease', () => {
	beforeEach(() => {
		lockHeld.value = false;
	});

	it('skips the per-mint sweep without touching the chain while another run holds the lease', async () => {
		lockHeld.value = true;
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ ok: true, skipped: true, reason: 'lease_held' });
	});
});
