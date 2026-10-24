// Cadence-lease test for api/cron/economy-reconcile.js.
//
// Production 2026-10-24: economy-tick.js fires economy-reconcile every minute
// (it is one of ~36 TARGETS in that fan-out) on top of its own dedicated */30
// Cloud Scheduler job (vercel.json), with nothing to stop the two callers from
// overlapping. Unlike x402-ring-leak-scan.js (which hit the identical disease
// and was fixed with a lease, see tests/x402-ring-leak-scan-run.test.js), this
// handler ran a full on-chain reconciliation (hash-chain verify, up to 200
// getParsedTransaction calls, a balance read) on every single invocation, so it
// queued many overlapping full scans against the Solana RPC. During the RPC
// lane exhaustion windows this is exactly what blew every run past wrapCron's
// 120s default budget, logging a 100% `[cron] economy-reconcile exceeded its
// 120000ms budget` storm. A lease that makes the native 30-min cadence durable
// regardless of how often the route is invoked fixes it the same way.

import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

const lockHeld = { value: false };
vi.mock('../api/_lib/cache.js', () => ({
	acquireLock: vi.fn(async () => !lockHeld.value),
}));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));
vi.mock('../api/_lib/db-retry.js', () => ({ withDbRetry: (fn) => fn() }));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn(async () => {}) }));
vi.mock('../api/_lib/economy-master.js', () => ({ ECONOMY_MASTER_ADDRESS: 'MASTER', RESERVE_SOL: 0.1 }));
vi.mock('../api/_lib/solana-signers.js', () => ({ SOLANA_SIGNERS: [], resolveSignerPubkey: vi.fn(async () => ({ pubkey: null })) }));
vi.mock('../api/_lib/economy-ledger.js', () => ({ verifyChain: vi.fn(async () => ({ ok: true, count: 0 })) }));
vi.mock('../api/_lib/avatar-wallet.js', () => ({ getSolBalance: vi.fn(async () => ({ sol: 10 })) }));
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => ({ getSignaturesForAddress: vi.fn(async () => []), getSignatureStatuses: vi.fn(async () => ({ value: [] })) }),
}));

const { default: handler } = await import('../api/cron/economy-reconcile.js');

describe('economy-reconcile handler lease', () => {
	beforeEach(() => {
		process.env.CRON_SECRET = 'test-cron-secret';
		lockHeld.value = false;
	});

	function call() {
		const req = { method: 'GET', url: '/api/cron/economy-reconcile', headers: { authorization: 'Bearer test-cron-secret' } };
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
