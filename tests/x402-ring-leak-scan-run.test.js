// Run-shape tests for the x402 ring leak scanner (api/cron/x402-ring-leak-scan.js).
//
// Production 2026-10-09: the registry held 2,006 enabled wallets, a serial pass
// over them took 600 to 900 s against a 300 s maxDuration, and the economy tick
// re-fired the route every minute with nothing stopping a second run, so about
// eight full scans overlapped at all times and burned the Solana RPC quota.
// These pin the two guards that replaced that: a lease that skips a re-fire and
// a budget that stops STARTING wallets. scanPlan's three-tier wallet selection
// (role / ledger-active / checked_at rotation) and runScan's tiered budgeting
// are covered in tests/x402-ring-leak-scan-budget.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DEFAULT_CRON_MAX_DURATION_MS } from '../api/_lib/http.js';

const lockHeld = { value: false };
vi.mock('../api/_lib/cache.js', () => ({
	acquireLock: vi.fn(async () => !lockHeld.value),
	cacheGet: vi.fn(async () => 0),
	cacheSet: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: async () => ({ pressured: false }),
}));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn(async () => {}) }));

const { scanWithinBudget, maxDuration, RUN_BUDGET_MS, default: handler } = await import('../api/cron/x402-ring-leak-scan.js');

// 2026-10-24 production incident: every single invocation (100% over a 6h
// sample) answered 503 at ~120.0s, logging `[cron] x402-ring-leak-scan
// exceeded its 120000ms budget`. Root cause: the file never passed a
// `maxDurationMs` option to wrapCron, so http.js's wrapCron fell back to
// DEFAULT_CRON_MAX_DURATION_MS (120s) and raced every run against that, while
// the handler's own RUN_BUDGET_MS (200s) assumed it had until vercel.json's
// declared 300s maxDuration to work with. The external race always won first.
describe('cron timeout wiring', () => {
	it('declares a maxDuration that covers its own scan budget, so wrapCron does not truncate every run at the 120s default', () => {
		expect(maxDuration).toBeGreaterThan(0);
		expect(maxDuration * 1000).toBeGreaterThan(DEFAULT_CRON_MAX_DURATION_MS);
		expect(maxDuration * 1000).toBeGreaterThan(RUN_BUDGET_MS);
	});
});

describe('scanWithinBudget', () => {
	it('stops starting wallets at the budget and reports how far it got', async () => {
		let t = 0;
		const now = () => t;
		const scanned = [];
		const scanOne = async (w) => {
			scanned.push(w);
			t += 100; // each wallet costs 100 ms of fake clock
			return { wallet: w };
		};
		const { results, started } = await scanWithinBudget(['A', 'B', 'C', 'D', 'E'], scanOne, { budgetMs: 250, concurrency: 1, now });
		expect(scanned).toEqual(['A', 'B', 'C']);
		expect(started).toBe(3);
		expect(results).toHaveLength(3);
	});

	it('records a throwing wallet as an error and keeps going', async () => {
		const scanOne = async (w) => {
			if (w === 'B') throw new Error('rpc down');
			return { wallet: w, leaks: 0 };
		};
		const { results, started } = await scanWithinBudget(['A', 'B', 'C'], scanOne, { budgetMs: 60_000, concurrency: 2 });
		expect(started).toBe(3);
		expect(results).toContainEqual({ wallet: 'B', error: 'rpc down' });
		expect(results.filter((r) => !r.error)).toHaveLength(2);
	});

	it('runs no more than `concurrency` wallets at once', async () => {
		let live = 0;
		let peak = 0;
		const scanOne = async (w) => {
			live += 1;
			peak = Math.max(peak, live);
			await new Promise((r) => setTimeout(r, 5));
			live -= 1;
			return { wallet: w };
		};
		await scanWithinBudget(['A', 'B', 'C', 'D', 'E', 'F', 'G'], scanOne, { budgetMs: 60_000, concurrency: 3 });
		expect(peak).toBe(3);
	});
});

describe('handler lease', () => {
	beforeEach(() => {
		process.env.CRON_SECRET = 'test-cron-secret';
	});

	function call() {
		const req = { method: 'GET', url: '/api/cron/x402-ring-leak-scan', headers: { authorization: 'Bearer test-cron-secret' } };
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

	it('skips without touching the chain while another run holds the lease', async () => {
		lockHeld.value = true;
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ ok: true, skipped: true, reason: 'lease_held' });
	});
});
