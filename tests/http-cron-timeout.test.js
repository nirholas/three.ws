/**
 * wrapCron()'s time budget (api/_lib/http.js).
 *
 * Before this, `maxDuration` was a Vercel-enforced per-function budget. Nothing
 * replaced that enforcement after the 2026-07-07 Cloud Run migration, so every
 * one of the 100 cron handlers ran with no ceiling except Cloud Run's own 900s
 * ingress timeout: a hang anywhere inside one surfaced 15 minutes later as
 * "The request has been terminated because it has reached the maximum request
 * timeout" with no cron name, no elapsed time, and no heartbeat write.
 *
 * wrapCron now races the handler against its own budget and answers a clean
 * 503 `cron_timeout` before that happens, while never cancelling the handler
 * itself (Node has no generic preemption). Real (short) timers are used below
 * rather than fake ones, because the heartbeat write goes through a
 * fire-and-forget dynamic `import('./cache.js')` whose settling is not
 * observable through the fake-timer clock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sent = [];
const cache = new Map();

vi.mock('../api/_lib/alerts.js', () => ({
	sendOpsAlert: async (title, detail, opts) => { sent.push({ title, detail, opts }); },
}));
vi.mock('../api/_lib/cache.js', () => ({
	cacheGet: async (k) => (cache.has(k) ? cache.get(k) : null),
	cacheSet: async (k, v) => { cache.set(k, v); },
}));

const { wrapCron, DEFAULT_CRON_MAX_DURATION_MS } = await import('../api/_lib/http.js');

function fakeRes() {
	const headers = {};
	return {
		statusCode: 0,
		body: undefined,
		ended: false,
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return headers[String(k).toLowerCase()]; },
		end(b) { this.body = b; this.ended = true; this.writableEnded = true; },
		_headers: headers,
	};
}

function fakeReq(url) {
	return { method: 'GET', url, headers: {} };
}

// Let fire-and-forget heartbeat writes (behind a dynamic import) settle.
function flush(ms = 20) {
	return new Promise((r) => setTimeout(r, ms));
}

let errSpy, warnSpy;
beforeEach(() => {
	cache.clear();
	sent.length = 0;
	errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	errSpy.mockRestore();
	warnSpy.mockRestore();
});

describe('wrapCron() time budget', () => {
	it('answers 503 cron_timeout before a never-resolving handler settles', async () => {
		const handler = wrapCron(() => new Promise(() => {}), { maxDurationMs: 30 });
		const res = fakeRes();

		await handler(fakeReq('/api/cron/stuck-forever'), res);
		await flush();

		expect(res.statusCode).toBe(503);
		const body = JSON.parse(res.body);
		expect(body).toMatchObject({ ok: false, reason: 'cron_timeout', cron: 'stuck-forever', budget_ms: 30 });

		const beat = cache.get('cron:heartbeat:stuck-forever');
		expect(beat).toMatchObject({ ok: false, timed_out: true });

		expect(sent).toHaveLength(1);
		expect(sent[0].opts.signature).toBe('cron:timeout:stuck-forever');
	});

	it('a handler that resolves well inside the budget is completely unaffected', async () => {
		const budgetHandler = wrapCron(async (req, res) => {
			res.setHeader('x-ok', '1');
			res.statusCode = 200;
			res.end(JSON.stringify({ ok: true, did: 'work' }));
		}, { maxDurationMs: 30_000 });
		const plainHandler = wrapCron(async (req, res) => {
			res.setHeader('x-ok', '1');
			res.statusCode = 200;
			res.end(JSON.stringify({ ok: true, did: 'work' }));
		});

		const resBudget = fakeRes();
		await budgetHandler(fakeReq('/api/cron/quick-one'), resBudget);
		await flush();
		const beatBudget = cache.get('cron:heartbeat:quick-one');

		cache.clear();
		const resPlain = fakeRes();
		await plainHandler(fakeReq('/api/cron/quick-one'), resPlain);
		await flush();
		const beatPlain = cache.get('cron:heartbeat:quick-one');

		expect(resBudget.statusCode).toBe(resPlain.statusCode);
		expect(resBudget.body).toBe(resPlain.body);
		expect(beatBudget).toMatchObject({ ok: true });
		expect(beatPlain).toMatchObject({ ok: true });
		expect(beatBudget.timed_out).toBeUndefined();
		expect(sent).toHaveLength(0);
	});

	it('falls back to a 120000ms budget when maxDurationMs is not passed', async () => {
		expect(DEFAULT_CRON_MAX_DURATION_MS).toBe(120_000);

		// Prove wrapCron actually arms its timer with that default (not waiting out
		// a real 120s budget in a unit test) by capturing the ms argument the
		// race's setTimeout is called with.
		const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
		const handler = wrapCron(() => new Promise(() => {}));
		const res = fakeRes();
		const invocation = handler(fakeReq('/api/cron/no-budget-given'), res);
		await flush();

		const budgetCall = setTimeoutSpy.mock.calls.find((call) => call[1] === DEFAULT_CRON_MAX_DURATION_MS);
		expect(budgetCall).toBeDefined();
		expect(res.statusCode).toBe(0);

		setTimeoutSpy.mockRestore();
		// Unstick the still-pending invocation so it doesn't leak into later tests.
		void invocation;
	});

	it('never lets the handler\'s late settlement crash the process or double-write', async () => {
		let rejectLate;
		const handler = wrapCron(() => new Promise((_resolve, reject) => { rejectLate = reject; }), { maxDurationMs: 30 });
		const res = fakeRes();

		await handler(fakeReq('/api/cron/late-reject'), res);
		await flush();
		expect(res.statusCode).toBe(503);

		// The real handler finally rejects well after the budget already answered.
		// This must never throw an unhandled rejection or try to mutate `res` again.
		expect(() => rejectLate(new Error('late failure, nobody is listening anymore'))).not.toThrow();
		await flush();

		expect(res.statusCode).toBe(503);
		const beat = cache.get('cron:heartbeat:late-reject');
		expect(beat).toMatchObject({ ok: false, timed_out: true });
	});
});
