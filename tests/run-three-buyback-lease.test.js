// Cadence-lease test for handleRunThreeBuyback in api/cron/[name].js.
//
// economy-tick.js fires /api/cron/run-three-buyback every minute (fan-out
// TARGETS) on top of its own dedicated vercel.json `0 6 * * *` (once daily)
// Cloud Scheduler job. A live run sizes its spend off the buyback wallet's
// CURRENT USDC balance and signs a real Jupiter swap, so two overlapping real
// runs would each read the same pre-spend balance and could each deploy up to
// maxUsdPerRun(), doubling the per-run spend cap the policy relies on. A
// lease on the live path (mirroring run-buyback's fix above it in the same
// file) makes the daily cadence durable regardless of how often the route is
// invoked, without blocking ?dry_run=1 status checks, which never sign.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const lockHeld = { value: false };
vi.mock('../api/_lib/cache.js', () => ({
	acquireLock: vi.fn(async () => !lockHeld.value),
}));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: vi.fn(() => true) }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => [{ id: 'run-1' }]),
	isDbUnavailableError: vi.fn(() => false),
}));
vi.mock('../api/_lib/token/buyback.js', () => ({
	slippageBps: vi.fn(() => 50),
	revenueFeeAtomicsToDate: vi.fn(async () => 0n),
	isEnabled: vi.fn(() => true),
	loadBuybackSigner: vi.fn(async () => ({ publicKey: { toBase58: () => 'Signer111' } })),
	planBuyback: vi.fn(async () => ({ ok: false, reason: 'below_min', walletUsdcAtomics: 0n, spendUsdcAtomics: 0n })),
	usdcAtomicsToUsd: vi.fn(() => 0),
}));

const { default: handler } = await import('../api/cron/[name].js');

function call(query = {}) {
	const req = { method: 'GET', url: '/api/cron/run-three-buyback?name=run-three-buyback', query: { name: 'run-three-buyback', ...query }, headers: {} };
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

describe('run-three-buyback handler lease', () => {
	beforeEach(() => {
		lockHeld.value = false;
	});

	it('skips the live spend path without touching the signer while another run holds the lease', async () => {
		lockHeld.value = true;
		const { loadBuybackSigner } = await import('../api/_lib/token/buyback.js');
		loadBuybackSigner.mockClear();
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ ok: true, skipped: true, reason: 'lease_held' });
		expect(loadBuybackSigner).not.toHaveBeenCalled();
	});

	it('never gates a dry run behind the lease', async () => {
		lockHeld.value = true;
		const res = await call({ dry_run: '1' });
		const body = JSON.parse(res.body);
		expect(body.reason).not.toBe('lease_held');
	});
});
