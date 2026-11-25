// RPC-budget regression test for api/cron/economy-reconcile.js.
//
// Production 2026-11-25: /api/healthz rpc_lanes named economy-reconcile the top
// Solana RPC caller at 8082 calls/24h, with both paid lanes (Helius, Alchemy)
// over quota and the agent-index crawl starved 28h behind. Root cause: every
// run lists the master's last 200 signatures and calls getParsedTransaction on
// each one that is not in the ledger. Inbound funding and fee-only txs are
// never booked in the ledger and were never recorded anywhere else, so the same
// ~170 benign signatures were re-fetched on every one of the 48 runs a day
// (48 x ~168 = ~8064). A signature already classified benign must not be
// fetched again; only new or still-unexplained signatures cost an RPC call.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map(); // payment_reconciliation, keyed by `${source}|${source_ref}`

function sqlMock(strings, ...values) {
	const text = strings.join('?');
	if (/INSERT INTO payment_reconciliation/.test(text)) {
		const [source, sourceRef, , , , dbStatus, chainStatus, reconciled] = values;
		store.set(`${source}|${sourceRef}`, { source, source_ref: sourceRef, db_status: dbStatus, chain_status: chainStatus, reconciled });
		return Promise.resolve([]);
	}
	if (/FROM payment_reconciliation/.test(text)) {
		const rows = [...store.values()].filter((r) => r.source === 'economy_master_onchain' && r.reconciled === true);
		return Promise.resolve(rows.map((r) => ({ source_ref: r.source_ref })));
	}
	return Promise.resolve([]);
}

vi.mock('../api/_lib/cache.js', () => ({ acquireLock: vi.fn(async () => true) }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn((s, ...v) => sqlMock(s, ...v)) }));
vi.mock('../api/_lib/db-retry.js', () => ({ withDbRetry: (fn) => fn() }));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn(async () => {}) }));
vi.mock('../api/_lib/solana-signers.js', () => ({ SOLANA_SIGNERS: [], resolveSignerPubkey: vi.fn(async () => ({ pubkey: null })) }));
vi.mock('../api/_lib/economy-ledger.js', () => ({ verifyChain: vi.fn(async () => ({ ok: true, count: 0 })) }));
vi.mock('../api/_lib/avatar-wallet.js', () => ({ getSolBalance: vi.fn(async () => ({ sol: 10 })) }));

const MASTER = '11111111111111111111111111111112';
const sigInfos = [
	{ signature: 'INBOUND1', err: null },
	{ signature: 'INBOUND2', err: null },
	{ signature: 'FEEONLY1', err: null },
	{ signature: 'UNREADABLE1', err: null },
];
function parsedTx(sig) {
	if (sig === 'UNREADABLE1') return null;
	const lost = sig === 'FEEONLY1' ? 5000 : -2_000_000_000; // fee only, or SOL received
	return {
		transaction: { message: { accountKeys: [MASTER, 'FUNDER'] } },
		meta: { preBalances: [10_000_000_000, 5_000_000_000], postBalances: [10_000_000_000 - lost, 5_000_000_000 + lost] },
	};
}
const getParsedTransaction = vi.fn(async (sig) => parsedTx(sig));
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => ({
		getSignaturesForAddress: vi.fn(async () => sigInfos),
		getParsedTransaction,
		getSignatureStatuses: vi.fn(async () => ({ value: [] })),
	}),
}));
vi.mock('../api/_lib/economy-master.js', () => ({ ECONOMY_MASTER_ADDRESS: MASTER, RESERVE_SOL: 0.1 }));

const { default: handler } = await import('../api/cron/economy-reconcile.js');

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

describe('economy-reconcile RPC budget', () => {
	beforeEach(() => {
		process.env.CRON_SECRET = 'test-cron-secret';
		store.clear();
		getParsedTransaction.mockClear();
	});

	it('fetches each unbooked signature once, then skips the ones it classified benign', async () => {
		await call();
		expect(getParsedTransaction).toHaveBeenCalledTimes(4);

		getParsedTransaction.mockClear();
		const res = await call();
		expect(res.statusCode).toBe(200);
		// Only the signature that could not be read is retried.
		expect(getParsedTransaction.mock.calls.map((c) => c[0])).toEqual(['UNREADABLE1']);
	});

	it('records benign verdicts as reconciled so the money-health board stays clean', async () => {
		await call();
		const rows = [...store.values()].filter((r) => r.source === 'economy_master_onchain');
		expect(rows.map((r) => r.source_ref).sort()).toEqual(['FEEONLY1', 'INBOUND1', 'INBOUND2']);
		expect(rows.every((r) => r.reconciled === true)).toBe(true);
	});
});
