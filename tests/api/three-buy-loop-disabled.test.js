// api/cron/three-buy-loop.js is a disabled-by-default treasury tool. It must do
// nothing unless THREE_BUY_LOOP_ENABLED=1 is set explicitly, even when the older
// THREE_MICROBUY_ENABLED flag is on, and it must not be wired into the economy tick.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const sqlMock = vi.fn();
vi.mock('../../api/_lib/db.js', () => ({ sql: sqlMock, isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn() }));
vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => false, drain: vi.fn() }));

const { default: handler } = await import('../../api/cron/three-buy-loop.js');

function makeReqRes() {
	const req = { method: 'GET', url: '/api/cron/three-buy-loop', headers: { authorization: 'Bearer test-cron-secret' } };
	const res = {
		statusCode: 0, body: null, headers: {},
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(b) { this.body = b ? JSON.parse(b) : null; },
		get headersSent() { return this.body !== null; },
		get writableEnded() { return this.body !== null; },
	};
	return { req, res };
}

describe('three-buy-loop is disabled by default', () => {
	beforeEach(() => {
		process.env.CRON_SECRET = 'test-cron-secret';
		process.env.THREE_MICROBUY_ENABLED = '1';
		delete process.env.THREE_BUY_LOOP_ENABLED;
		sqlMock.mockReset();
	});
	afterEach(() => {
		delete process.env.THREE_MICROBUY_ENABLED;
		delete process.env.THREE_BUY_LOOP_ENABLED;
	});

	it('skips without touching the database when the flag is unset', async () => {
		const { req, res } = makeReqRes();
		await handler(req, res);
		expect(res.body.skipped).toBe(true);
		expect(res.body.reason).toBe('THREE_BUY_LOOP_ENABLED not set');
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('skips when the flag is anything but 1', async () => {
		process.env.THREE_BUY_LOOP_ENABLED = 'true';
		const { req, res } = makeReqRes();
		await handler(req, res);
		expect(res.body.skipped).toBe(true);
	});

	it('is not scheduled by the economy tick', () => {
		const src = readFileSync('api/cron/economy-tick.js', 'utf8');
		expect(src).not.toContain('/api/cron/three-buy-loop');
	});
});
