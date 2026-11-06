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
const db = vi.hoisted(() => ({ mints: [], selects: [] }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings) => {
		const text = strings.join('?');
		if (text.includes('from pump_agent_mints')) {
			db.selects.push(text);
			return db.mints;
		}
		return [{ id: 1 }];
	}),
}));
const vault = vi.hoisted(() => ({ reads: 0, onRead: () => {} }));
vi.mock('../api/_lib/pump.js', async (orig) => ({
	...(await orig()),
	getConnection: () => ({ getAccountInfo: async () => null }),
	getPumpAgent: async () => ({
		agent: {
			getBalances: async () => {
				vault.reads += 1;
				vault.onRead();
				return { buybackVault: { balance: 0 } };
			},
		},
	}),
}));

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
		db.mints = [];
		db.selects.length = 0;
		vault.reads = 0;
		vault.onRead = () => {};
	});

	it('skips the per-mint sweep without touching the chain while another run holds the lease', async () => {
		lockHeld.value = true;
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ ok: true, skipped: true, reason: 'lease_held' });
	});

	// Production 2026-11-06: a sweep ran past the route's 300s budget and answered 503
	// while the handler kept working. Stopping between coins never interrupts a swap.
	it('stops starting coins near the budget and reports what it left for the next run', async () => {
		const coin = (id) => ({ id, mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump', network: 'mainnet', quote_mint: 'THREEsynthetic1111' });
		db.mints = [coin(1), coin(2), coin(3)];
		let now = Date.now();
		const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
		vault.onRead = () => { now += 130_000; };

		const res = await call();
		clock.mockRestore();

		const body = JSON.parse(res.body);
		expect(vault.reads).toBe(2);
		expect(body).toMatchObject({ ok: true, processed: 2, deferred: 1 });
	});

	it('starts with the coins that waited longest, so a deferred tail is not starved', async () => {
		await call();
		expect(db.selects[0]).toMatch(/order by\s+\S*last_run_at asc nulls first/i);
	});
});
