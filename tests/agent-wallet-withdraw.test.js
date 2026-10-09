// Integration tests for the custodial withdraw endpoint
// (api/agents/solana-wallet.js handleWithdraw, POST /api/agents/:id/solana/withdraw).
//
// Proves at the handler layer:
//   1. invalid destination          → 400, key never recovered
//   2. off-curve (PDA) destination  → 400, key never recovered
//   3. idempotency replay           → 200 replayed, never re-sends
//   4. spend-limit breach           → 403 with the reason, key never recovered
//   5. simulate=true                → simulated result, never signs, never sends
//   6. live SOL "max" withdraw      → 200 confirmed signature, rent+fee reserved
//
// All Solana RPC, the agent key recovery, and the spend policy are mocked so the
// orchestration is deterministic. Real spend-policy enforcement + address
// validation are covered by tests/agent-custody-guards.test.js.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-custody-withdraw';

// ── auth ────────────────────────────────────────────────────────────────────
const authState = { session: { id: 'user-1' } };
// The real-funds agreement gate is covered by tests/real-funds-agreement.test.js;
// here the account has signed, so the handler's own guards are what is under test.
vi.mock('../api/_lib/real-funds-agreement.js', () => ({
	requireRealFundsAgreement: vi.fn(async () => true),
	currentSignatureFor: vi.fn(async () => ({ signedAt: '2026-09-17T00:00:00.000Z', signatureName: 'Test Signer', context: null })),
	agreementRequirement: () => ({ version: 2, sign_url: 'https://three.ws/legal/agreements', documents: [] }),
}));

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => authState.session),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));

// CSRF enforcement is exercised by agent-identity-csrf.test.js; here we mock it
// through so these tests focus on withdraw validation, spend policy, and signing.
vi.mock('../api/_lib/csrf.js', () => ({
	requireCsrf: vi.fn(async () => true),
	issueCsrf: vi.fn(async () => ({ token: 'test-csrf', expiresIn: 3600 })),
}));

// ── db ──────────────────────────────────────────────────────────────────────
// The marketplace "balance is promised to bidders" lookup is answered from its
// own slot so it never consumes a row a test queued for the idempotency path.
const sqlState = { queue: [], calls: [], listing: [] };
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const query = strings.join('?');
		sqlState.calls.push({ query, values });
		if (query.includes('FROM agent_listings')) return sqlState.listing;
		return sqlState.queue.length ? sqlState.queue.shift() : [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

// ── rate limit ──────────────────────────────────────────────────────────────
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		withdrawalPerUser: vi.fn(async () => ({ success: true })),
		authIp: vi.fn(async () => ({ success: true })),
		walletRead: vi.fn(async () => ({ success: true })),
		auditLogRead: vi.fn(async () => ({ success: true })),
	},
	clientIp: vi.fn(() => '127.0.0.1'),
}));

// ── cache / audit / usage ────────────────────────────────────────────────────
vi.mock('../api/_lib/cache.js', () => ({ cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => {}) }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));
vi.mock('../src/solana/sns.js', () => ({ reverseLookupAddress: vi.fn(async () => null) }));

// ── Solana RPC (fake connection) ──────────────────────────────────────────────
const connState = {
	balance: 2_000_000_000, // 2 SOL
	rentExempt: 890_880,
	blockhash: Keypair.generate().publicKey.toBase58(), // valid 32-byte base58
	sendSig: 'LIVESIG1111111111111111111111111111111111111',
	confirmErr: null,
	sent: 0,
	simulate: { value: { err: null, logs: ['Program log: ok'], unitsConsumed: 250 } },
};
const fakeConn = {
	getBalance: vi.fn(async () => connState.balance),
	getMinimumBalanceForRentExemption: vi.fn(async () => connState.rentExempt),
	getLatestBlockhash: vi.fn(async () => ({ blockhash: connState.blockhash, lastValidBlockHeight: 1000 })),
	simulateTransaction: vi.fn(async () => connState.simulate),
	sendRawTransaction: vi.fn(async () => { connState.sent += 1; return connState.sendSig; }),
	confirmTransaction: vi.fn(async () => ({ value: { err: connState.confirmErr } })),
	getSignatureStatuses: vi.fn(async () => ({ value: [{ err: connState.confirmErr, confirmationStatus: 'confirmed', slot: 1 }], context: { slot: 1 } })),
	getBlockHeight: vi.fn(async () => 1),
	getSignatureStatus: vi.fn(async () => ({ value: { err: null, confirmationStatus: 'confirmed' } })),
	getAccountInfo: vi.fn(async () => null),
	getTokenAccountBalance: vi.fn(async () => ({ value: { amount: '0', uiAmount: 0, decimals: 6 } })),
	getParsedTokenAccountsByOwner: vi.fn(async () => ({ value: [] })),
};
vi.mock('../api/_lib/agent-pumpfun.js', () => ({
	solanaConnection: vi.fn(() => fakeConn),
	solanaPublicConnection: vi.fn(() => fakeConn),
}));

// ── agent key recovery (returns a REAL keypair so signing works) ──────────────
const agentKp = Keypair.generate();
const recoverState = { calls: 0 };
vi.mock('../api/_lib/agent-wallet.js', () => ({
	generateSolanaAgentWallet: vi.fn(),
	recoverSolanaAgentKeypair: vi.fn(async () => { recoverState.calls += 1; return agentKp; }),
}));

// ── avatar-wallet (explorer + price) ──────────────────────────────────────────
vi.mock('../api/_lib/avatar-wallet.js', () => ({
	explorerTxUrl: vi.fn((sig, net) => `https://solscan.io/tx/${sig}${net === 'devnet' ? '?cluster=devnet' : ''}`),
	solUsdPrice: vi.fn(async () => 200),
}));

// ── shared spend policy (controllable; real version unit-tested separately) ───
class FakeSpendLimitError extends Error {
	constructor(code, message, detail = {}) { super(message); this.name = 'SpendLimitError'; this.status = 403; this.code = code; this.detail = detail; }
}
const guardState = { addrOverride: null, enforceThrow: null };
vi.mock('../api/_lib/agent-trade-guards.js', () => ({
	SpendLimitError: FakeSpendLimitError,
	validateSolanaAddress: vi.fn((addr) => {
		if (guardState.addrOverride) return guardState.addrOverride;
		try { const pk = new PublicKey(addr); return { valid: true, base58: pk.toBase58(), pubkey: pk, onCurve: true }; }
		catch { return { valid: false, reason: 'not_pubkey' }; }
	}),
	enforceSpendLimit: vi.fn(async () => { if (guardState.enforceThrow) throw guardState.enforceThrow; return { ok: true }; }),
	lamportsToUsd: vi.fn(async () => 100),
	getSpendLimits: vi.fn(() => ({ daily_usd: null, per_tx_usd: null, withdraw_allowlist: [] })),
	setSpendLimits: vi.fn(async () => ({ daily_usd: null, per_tx_usd: null, withdraw_allowlist: [] })),
	listCustodyEvents: vi.fn(async () => []),
	updateCustodyEvent: vi.fn(async () => {}),
	getDailySpendUsd: vi.fn(async () => 0),
}));

const { handleWithdraw } = await import('../api/agents/solana-wallet.js');

// ── request/response helpers ──────────────────────────────────────────────────
function mockReq(body) {
	const buf = Buffer.from(JSON.stringify(body || {}));
	return {
		method: 'POST',
		url: '/api/agents/agent-1/solana/withdraw',
		headers: { host: 'localhost', 'content-type': 'application/json' },
		on(evt, cb) {
			if (evt === 'data') queueMicrotask(() => cb(buf));
			if (evt === 'end') queueMicrotask(() => cb());
		},
		destroy() {},
	};
}
function mockRes() {
	return {
		statusCode: 200, headers: {}, body: undefined, ended: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b; this.ended = true; },
	};
}
function parse(res) { try { return JSON.parse(res.body); } catch { return null; } }

const AGENT_META = { solana_address: agentKp.publicKey.toBase58(), encrypted_solana_secret: 'ENC' };
function queueAgentRow() {
	sqlState.queue.push([{ id: 'agent-1', user_id: 'user-1', meta: AGENT_META }]);
}

beforeEach(() => {
	sqlState.queue = [];
	sqlState.calls = [];
	sqlState.listing = [];
	connState.sent = 0;
	connState.confirmErr = null;
	recoverState.calls = 0;
	guardState.addrOverride = null;
	guardState.enforceThrow = null;
	authState.session = { id: 'user-1' };
});

describe('handleWithdraw — validation + safety', () => {
	it('rejects an invalid destination with 400 and never touches the key', async () => {
		queueAgentRow();
		guardState.addrOverride = { valid: false, reason: 'not_base58' };
		const res = mockRes();
		await handleWithdraw(mockReq({ asset: 'SOL', amount: 0.1, destination: 'garbage' }), res, 'agent-1');
		expect(res.statusCode).toBe(400);
		expect(parse(res).error).toBe('invalid_destination');
		expect(recoverState.calls).toBe(0);
		expect(connState.sent).toBe(0);
	});

	it('rejects an off-curve (PDA) destination with 400', async () => {
		queueAgentRow();
		const [pda] = PublicKey.findProgramAddressSync([Buffer.from('x')], PublicKey.default);
		guardState.addrOverride = { valid: true, onCurve: false, base58: pda.toBase58(), pubkey: pda };
		const res = mockRes();
		await handleWithdraw(mockReq({ asset: 'SOL', amount: 0.1, destination: pda.toBase58() }), res, 'agent-1');
		expect(res.statusCode).toBe(400);
		expect(parse(res).error).toBe('invalid_destination');
		expect(recoverState.calls).toBe(0);
	});

	it('returns 403 with the reason on a spend-limit breach, without sending', async () => {
		queueAgentRow();
		sqlState.queue.push([]); // idempotency lookup: none
		guardState.enforceThrow = new FakeSpendLimitError('daily_exceeded', 'over the daily limit', { daily_usd: 5 });
		const res = mockRes();
		await handleWithdraw(mockReq({ asset: 'SOL', amount: 0.1, destination: Keypair.generate().publicKey.toBase58() }), res, 'agent-1');
		expect(res.statusCode).toBe(403);
		const body = parse(res);
		expect(body.error).toBe('daily_exceeded');
		expect(body.detail.daily_usd).toBe(5);
		expect(recoverState.calls).toBe(0);
		expect(connState.sent).toBe(0);
	});

	it('refuses with 409 while the balance is promised to an open marketplace bid, without touching the key', async () => {
		queueAgentRow();
		sqlState.listing = [{ id: 'listing-1' }];
		const res = mockRes();
		await handleWithdraw(mockReq({ asset: 'SOL', amount: 0.1, destination: Keypair.generate().publicKey.toBase58() }), res, 'agent-1');
		expect(res.statusCode).toBe(409);
		expect(parse(res).error).toBe('balance_listed');
		expect(recoverState.calls).toBe(0);
		expect(connState.sent).toBe(0);
	});

	it('forbids withdrawing from an agent the caller does not own', async () => {
		sqlState.queue.push([{ id: 'agent-1', user_id: 'someone-else', meta: AGENT_META }]);
		const res = mockRes();
		await handleWithdraw(mockReq({ asset: 'SOL', amount: 0.1, destination: Keypair.generate().publicKey.toBase58() }), res, 'agent-1');
		expect(res.statusCode).toBe(403);
		expect(parse(res).error).toBe('forbidden');
	});
});

describe('handleWithdraw — idempotency', () => {
	it('replays a confirmed withdrawal for the same idempotency key without re-sending', async () => {
		queueAgentRow();
		sqlState.queue.push([{ id: 9, status: 'confirmed', signature: 'OLDSIG' }]); // existing confirmed
		const res = mockRes();
		await handleWithdraw(mockReq({ asset: 'SOL', amount: 0.1, destination: Keypair.generate().publicKey.toBase58(), idempotency_key: 'k-1' }), res, 'agent-1');
		expect(res.statusCode).toBe(200);
		const body = parse(res).data;
		expect(body.replayed).toBe(true);
		expect(body.signature).toBe('OLDSIG');
		expect(connState.sent).toBe(0);
		expect(recoverState.calls).toBe(0);
	});

	it('reports an in-flight withdrawal (pending row) as 409', async () => {
		queueAgentRow();
		sqlState.queue.push([{ id: 9, status: 'pending', signature: null }]);
		const res = mockRes();
		await handleWithdraw(mockReq({ asset: 'SOL', amount: 0.1, destination: Keypair.generate().publicKey.toBase58(), idempotency_key: 'k-2' }), res, 'agent-1');
		expect(res.statusCode).toBe(409);
		expect(parse(res).error).toBe('withdrawal_in_progress');
		expect(connState.sent).toBe(0);
	});
});

describe('handleWithdraw — simulate', () => {
	it('returns a simulation without signing or sending', async () => {
		queueAgentRow();
		sqlState.queue.push([]); // idempotency lookup: none
		const res = mockRes();
		await handleWithdraw(mockReq({ asset: 'SOL', amount: 'max', destination: Keypair.generate().publicKey.toBase58(), simulate: true }), res, 'agent-1');
		expect(res.statusCode).toBe(200);
		const body = parse(res).data;
		expect(body.simulated).toBe(true);
		expect(body.err).toBeNull();
		expect(recoverState.calls).toBe(0);
		expect(connState.sent).toBe(0);
	});
});

describe('handleWithdraw — live SOL max sweep', () => {
	it('reserves rent + fees, signs, sends, confirms, and returns the signature', async () => {
		queueAgentRow();
		sqlState.queue.push([]);          // idempotency lookup: none
		sqlState.queue.push([{ id: 77 }]); // claim INSERT … RETURNING id
		const res = mockRes();
		await handleWithdraw(mockReq({ asset: 'SOL', amount: 'max', destination: Keypair.generate().publicKey.toBase58() }), res, 'agent-1');
		expect(res.statusCode).toBe(200);
		const body = parse(res).data;
		expect(body.replayed).toBe(false);
		expect(body.signature).toBe(connState.sendSig);
		expect(body.asset).toBe('SOL');
		// Max sweep leaves balance - rentExempt - feeReserve (15000) lamports.
		const expectedLamports = BigInt(connState.balance) - BigInt(connState.rentExempt) - 15_000n;
		expect(body.lamports).toBe(expectedLamports.toString());
		expect(recoverState.calls).toBe(1);
		expect(connState.sent).toBe(1);
	});

	it('does not double-send; one confirmed send produces one signature', async () => {
		queueAgentRow();
		sqlState.queue.push([]);
		sqlState.queue.push([{ id: 78 }]);
		const res = mockRes();
		await handleWithdraw(mockReq({ asset: 'SOL', amount: 0.5, destination: Keypair.generate().publicKey.toBase58() }), res, 'agent-1');
		expect(res.statusCode).toBe(200);
		expect(connState.sent).toBe(1);
	});
});
