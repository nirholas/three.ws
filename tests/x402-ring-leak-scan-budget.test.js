// Ledger-tiered selection + checked_at rotation tests for the x402 ring leak
// scanner (api/cron/x402-ring-leak-scan.js). Companion to
// tests/x402-ring-leak-scan-run.test.js (lease + plain budget mechanics) and
// tests/x402-ring-leak-classify.test.js (pure classification).
//
// Order 400 (2026-10-08) measured the registry at 2,006 enabled wallets, each
// costing a cursor read plus an RPC call every single run regardless of
// whether it had ever moved a lamport. These tests pin the fix that scopes a
// run to what can actually have leaked: role wallets (hold real balances),
// then registry wallets the platform's OWN ledger (x402_ring_pool.last_used_at)
// shows claimed a payer since their last check, then the rest of the registry
// oldest-checked_at-first, and the checked_at stamp that makes that rotation
// self-correcting even for a wallet with zero signatures.
//
// Root cause of task 6 (x402_ring_fee_observed never recording a row), found
// 2026-10-11: @solana/web3.js's own Connection.getParsedTransactions returns
// message.accountKeys entries as { pubkey: PublicKey, signer, writable }
// where pubkey is a live PublicKey instance, not a string. accountKeyStrings
// used to return that instance unconverted, so every `=== wallet` or
// `indexOf(wallet)` comparison against a plain base58 string silently failed:
// classifyWalletDebits's walletIdx was always -1 (zero events on every real
// transaction) and the fee cross-check's fee.ours was always false (feeByDay
// never accumulated). The two describe blocks below pin the fix against that
// real response shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlCalls = [];
const sqlQueue = [];
vi.mock('../api/_lib/cache.js', () => ({
	acquireLock: vi.fn(async () => true),
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlCalls.push({ text: strings.join('?'), values });
		return sqlQueue.length ? sqlQueue.shift() : [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn(async () => {}) }));

const { scanPlan, runScan, scanWallet, accountKeyStrings, classifyWalletDebits } = await import('../api/cron/x402-ring-leak-scan.js');

// Duck-typed PublicKey: has toBase58() like the real @solana/web3.js class,
// without pulling the dependency into a unit test.
class FakePubkey {
	constructor(b58) { this.b58 = b58; }
	toBase58() { return this.b58; }
	toString() { return this.b58; }
}

describe('scanPlan - three tiers, each deduped against the ones before it', () => {
	it('role wallets first, then ledger-active, then the rest of the registry', () => {
		const plan = scanPlan(
			['ROLE_A', null, 'ROLE_B'],
			['ROLE_A', 'L1', 'L2'],           // ROLE_A already a role, dropped from ledgerActive
			['L1', 'L2', 'R1', 'R2', 'R3'],   // registry, oldest-checked_at-first from the query
		);
		expect(plan.roles).toEqual(['ROLE_A', 'ROLE_B']);
		expect(plan.ledgerActive).toEqual(['L1', 'L2']);
		expect(plan.rotation).toEqual(['R1', 'R2', 'R3']); // L1/L2 not repeated in rotation
	});

	it('never scans the same wallet twice across tiers, even with garbage input', () => {
		const plan = scanPlan(undefined, [null, 'L1', 'L1'], ['L1', 'L1', 'R1']);
		expect(plan.roles).toEqual([]);
		expect(plan.ledgerActive).toEqual(['L1']);
		expect(plan.rotation).toEqual(['R1']);
	});
});

describe('runScan - tiered budget with a fake clock', () => {
	it('scans every tier and reports partial:false when the whole plan finishes inside budget', async () => {
		const plan = { roles: ['ROLE_A'], ledgerActive: ['L1'], rotation: ['R1', 'R2'] };
		let t = 0;
		const now = () => t;
		const scanOne = async (w) => { t += 10; return { wallet: w }; };
		const { results, partial, counts } = await runScan(plan, scanOne, { budgetMs: 10_000, concurrency: 1, now });
		expect(results.map((r) => r.wallet)).toEqual(['ROLE_A', 'L1', 'R1', 'R2']);
		expect(partial).toBe(false);
		expect(counts).toEqual({ roles: 1, ledgerActive: 1, rotation: 2 });
	});

	it('a run that exhausts the budget mid-rotation returns partial:true with the finished prefix', async () => {
		const plan = { roles: ['ROLE_A'], ledgerActive: [], rotation: ['R1', 'R2', 'R3', 'R4'] };
		let t = 0;
		const now = () => t;
		// Role wallet costs 10ms; each rotation wallet costs 40ms. Budget 90ms:
		// role (10) + R1 (40) = 50, R2 starts at 50 (<90) and finishes at 90, R3
		// would start at 90 which is NOT < 90 → never started.
		const scanOne = async (w) => {
			t += w === 'ROLE_A' ? 10 : 40;
			return { wallet: w };
		};
		const { results, partial, counts } = await runScan(plan, scanOne, { budgetMs: 90, concurrency: 1, now });
		expect(results.map((r) => r.wallet)).toEqual(['ROLE_A', 'R1', 'R2']);
		expect(partial).toBe(true);
		expect(counts).toEqual({ roles: 1, ledgerActive: 0, rotation: 2 });
	});

	it('an exhausted budget still lets the role tier run in full before starving rotation', async () => {
		const plan = { roles: ['ROLE_A', 'ROLE_B'], ledgerActive: ['L1'], rotation: ['R1'] };
		let t = 0;
		const now = () => t;
		const scanOne = async (w) => { t += 50; return { wallet: w }; };
		// Budget exhausted entirely by the two role wallets (100ms used of 100ms).
		const { results, partial, counts } = await runScan(plan, scanOne, { budgetMs: 100, concurrency: 1, now });
		expect(results.map((r) => r.wallet)).toEqual(['ROLE_A', 'ROLE_B']);
		expect(partial).toBe(true);
		expect(counts).toEqual({ roles: 2, ledgerActive: 0, rotation: 0 });
	});
});

describe('scanWallet - checked_at is stamped even with zero new signatures', () => {
	class FakePublicKey { constructor(v) { this.v = v; } }
	beforeEach(() => {
		sqlCalls.length = 0;
		sqlQueue.length = 0;
	});

	it('touches checked_at on a wallet with no new signatures, without touching last_signature', async () => {
		sqlQueue.push([]); // loadCursor → no row
		const conn = {
			getSignaturesForAddress: vi.fn(async () => []), // nothing new
			getParsedTransactions: vi.fn(async () => []),
		};
		const summary = await scanWallet(conn, FakePublicKey, 'NEVER_ACTIVE', {
			allowed: new Set(), usdcMint: 'USDC_MINT', runId: 'run-touch', feeByDay: new Map(),
		});
		expect(summary.scanned).toBe(0);
		const touch = sqlCalls.find((c) => c.text.includes('checked_at') && c.values.includes('NEVER_ACTIVE'));
		expect(touch).toBeTruthy();
		// The touch never names a last_signature column write; it only carries
		// the wallet, the run id, and the now() timestamps.
		expect(touch.text).not.toMatch(/last_signature/);
	});
});

describe('accountKeyStrings - resolves the real web3.js ParsedMessageAccount shape', () => {
	it('unwraps a { pubkey: PublicKey } entry to its base58 string, not the instance', () => {
		const keys = accountKeyStrings({
			accountKeys: [
				{ pubkey: new FakePubkey('WALLET_A'), signer: true, writable: true },
				{ pubkey: new FakePubkey('WALLET_B'), signer: false, writable: false },
			],
		});
		expect(keys).toEqual(['WALLET_A', 'WALLET_B']);
	});

	it('still resolves plain strings and { pubkey: string } entries the same as before', () => {
		expect(accountKeyStrings({ accountKeys: ['PLAIN', { pubkey: 'ALSO_PLAIN' }] })).toEqual(['PLAIN', 'ALSO_PLAIN']);
	});
});

describe('classifyWalletDebits - finds the wallet when accountKeys carry PublicKey instances', () => {
	it('resolves walletIdx (and so classifies events) against a { pubkey: PublicKey } account list', () => {
		const wallet = 'RING_WALLET';
		const counterparty = 'OUTSIDE_WALLET';
		const tx = {
			transaction: {
				signatures: ['sig1'],
				message: {
					accountKeys: [
						{ pubkey: new FakePubkey(wallet), signer: true, writable: true },
						{ pubkey: new FakePubkey(counterparty), signer: false, writable: true },
					],
					instructions: [{
						program: 'system',
						parsed: { type: 'transfer', info: { source: wallet, destination: counterparty, lamports: 5_000_000 } },
					}],
				},
			},
			meta: { fee: 5000, err: null, innerInstructions: [] },
		};
		const { unreadable, fee, events } = classifyWalletDebits(tx, { wallet, allowed: new Set(), usdcMint: 'USDC_MINT' });
		expect(unreadable).toBe(false);
		expect(fee.ours).toBe(true); // wallet is accountKeys[0] → the fee payer
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: 'leak', counterparty });
	});
});
