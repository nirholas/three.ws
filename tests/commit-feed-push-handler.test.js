// Handler-level test for api/cron/commit-feed-push.js.
//
// Production 2026-10-24: a single HTTP 500 on this route with no matching app
// log. pushTelegramLane() only catches its own GitHub-rate-limit error; any
// other failure (a transient GitHub 5xx, a network blip fetching a commit
// page) throws straight out of it. The handler's try/finally has no catch, so
// that throw reached wrap()'s generic handler and answered a raw 500 instead
// of the graceful { ok: false } this cron already gives a Telegram failure.
// Since the cron runs every 5 minutes and is state-driven (app_settings), a
// transient failure should be reported and retried next tick, not crash.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const lock = { held: false };
const pushResult = { value: null, throws: null };
vi.mock('../api/_lib/commit-feed-push.js', () => ({
	acquireLock: vi.fn(async () => !lock.held),
	releaseLock: vi.fn(async () => {}),
	pushTelegramLane: vi.fn(async () => {
		if (pushResult.throws) throw pushResult.throws;
		return pushResult.value;
	}),
}));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: vi.fn(() => true) }));

const { default: handler } = await import('../api/cron/commit-feed-push.js');

function makeReqRes() {
	const req = { method: 'GET', url: '/api/cron/commit-feed-push', headers: {} };
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
	return { req, res };
}

describe('commit-feed-push handler', () => {
	beforeEach(() => {
		lock.held = false;
		pushResult.value = { posted: 0 };
		pushResult.throws = null;
	});

	it('answers a graceful degraded response, not a 500, when pushTelegramLane throws a non-rate-limit error', async () => {
		pushResult.throws = new Error('GitHub commits fetch failed (502)');
		const { req, res } = makeReqRes();
		await handler(req, res);
		expect(res.statusCode).not.toBe(500);
		expect(res.statusCode).toBe(502);
		const body = JSON.parse(res.body);
		expect(body.ok).toBe(false);
		expect(body.error).toContain('GitHub commits fetch failed');
	});

	it('still releases the lock after a thrown error', async () => {
		pushResult.throws = new Error('boom');
		const { releaseLock } = await import('../api/_lib/commit-feed-push.js');
		const { req, res } = makeReqRes();
		await handler(req, res);
		expect(releaseLock).toHaveBeenCalled();
	});
});
