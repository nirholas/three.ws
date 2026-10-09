// Run-shape tests for the x402 ring leak scanner (api/cron/x402-ring-leak-scan.js).
//
// Production 2026-10-09: the registry held 2,006 enabled wallets, a serial pass
// over them took 600 to 900 s against a 300 s maxDuration, and the economy tick
// re-fired the route every minute with nothing stopping a second run, so about
// eight full scans overlapped at all times and burned the Solana RPC quota.
// These pin the three guards that replaced that: a lease that skips a re-fire,
// a budget that stops STARTING wallets, and a round-robin walk of the registry.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const { scanPlan, scanWithinBudget, default: handler } = await import('../api/cron/x402-ring-leak-scan.js');

describe('scanPlan', () => {
	it('puts every role wallet first and never repeats one in the rotation', () => {
		const plan = scanPlan(['ROLE_A', null, 'ROLE_B'], ['R1', 'ROLE_A', 'R2', 'R3'], 0);
		expect(plan.roles).toEqual(['ROLE_A', 'ROLE_B']);
		expect(plan.rotation).toEqual(['R1', 'R2', 'R3']);
	});

	it('starts the registry where the last run stopped and wraps around', () => {
		expect(scanPlan([], ['R1', 'R2', 'R3', 'R4'], 2).rotation).toEqual(['R3', 'R4', 'R1', 'R2']);
		expect(scanPlan([], ['R1', 'R2', 'R3'], 7).start).toBe(1);
	});

	it('treats a missing or garbage offset as the start', () => {
		expect(scanPlan([], ['R1', 'R2'], undefined).rotation).toEqual(['R1', 'R2']);
		expect(scanPlan([], ['R1', 'R2'], 'nope').rotation).toEqual(['R1', 'R2']);
		expect(scanPlan([], [], 5)).toEqual({ roles: [], rotation: [], start: 0 });
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
