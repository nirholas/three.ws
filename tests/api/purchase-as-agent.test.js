// Unit tests for POST /api/marketplace/purchase-as-agent.
//
// Mocks: sql, auth, rate-limit, agent-wallet, purchase-confirm, solana/web3.js,
//        @solana/spl-token. All on-chain I/O is replaced with deterministic stubs
//        so these run offline with no DATABASE_URL or Solana RPC needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

// ── Mock layer ──────────────────────────────────────────────────────────────

const authState = { session: null };
vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser:     vi.fn(async () => authState.session),
	authenticateBearer: vi.fn(async () => null),
	extractBearer:      vi.fn(() => null),
}));

const sqlQueue = [];
vi.mock('../../api/_lib/db.js', () => ({
	sql: Object.assign(
		vi.fn(async () => sqlQueue.length ? sqlQueue.shift() : []),
		{ transaction: vi.fn(async (fns) => { for (const f of fns) await f; }) },
	),
}));

const rlState = { success: true };
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		authIp:   vi.fn(async () => rlState),
		agentBuy: vi.fn(async () => rlState),
	},
	clientIp: vi.fn(() => '127.0.0.1'),
}));

const mockKeypair = {
	publicKey: { toBase58: () => 'BuyerPubkey11111111111111111111111111111111' },
	secretKey:  new Uint8Array(64),
};
vi.mock('../../api/_lib/agent-wallet.js', () => ({
	recoverSolanaAgentKeypair: vi.fn(async () => mockKeypair),
}));

const confirmResult = { status: 'confirmed', tx_signature: 'sig123' };
vi.mock('../../api/_lib/purchase-confirm.js', () => ({
	confirmSkillPurchase: vi.fn(async () => confirmResult),
	resolvePayoutAddress:  vi.fn(async () => 'SellerPayout111111111111111111111111111111'),
	logEvent:              vi.fn(async () => {}),
}));

// Shared fake connection instance so tests can call mockRejectedValueOnce on its methods.
const fakeConn = {
	getLatestBlockhash: vi.fn(async () => ({ blockhash: 'bh', lastValidBlockHeight: 99 })),
	sendRawTransaction: vi.fn(async () => 'txSig'),
	confirmTransaction: vi.fn(async () => {}),
};

vi.mock('@solana/web3.js', async (orig) => {
	const real = await orig();
	class FakeTransaction {
		constructor() {}
		add() { return this; }
		sign() {}
		serialize() { return Buffer.alloc(100); }
	}
	function MockConnection() { return fakeConn; }
	// Stub PublicKey so test fixtures don't need to use valid 44-char base58 keys.
	function MockPublicKey(v) {
		this._v = String(v);
		this.toBase58 = () => this._v;
		this.toBytes = () => new Uint8Array(32);
	}
	const FakeKeypair = {
		publicKey: new MockPublicKey('BuyerPubkey111'),
		secretKey: new Uint8Array(64),
	};
	return {
		...real,
		Connection: MockConnection,
		Transaction: FakeTransaction,
		PublicKey: MockPublicKey,
		Keypair: { generate: vi.fn(() => FakeKeypair) },
	};
});

vi.mock('@solana/spl-token', () => ({
	getAssociatedTokenAddressSync: vi.fn(() => ({ toBase58: () => 'ATA' })),
	createTransferCheckedInstruction: vi.fn(() => ({
		keys: [],
		programId: { toBase58: () => 'TokenProg' },
		data: new Uint8Array(),
	})),
	createAssociatedTokenAccountIdempotentInstruction: vi.fn(() => ({
		keys: [],
		programId: { toBase58: () => 'ATProg' },
		data: new Uint8Array(),
	})),
	getMint: vi.fn(async () => ({ decimals: 6 })),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(body) {
	const s = body ? Readable.from([Buffer.from(JSON.stringify(body))]) : Readable.from([]);
	s.method  = 'POST';
	s.url     = '/api/marketplace/purchase-as-agent';
	s.headers = { host: 'localhost', 'content-type': 'application/json' };
	return s;
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(chunk) { if (chunk != null) this.body += chunk; this.writableEnded = true; },
	};
}

async function invoke(req, res) {
	const { default: handler } = await import('../../api/marketplace/purchase-as-agent.js');
	await handler(req, res);
	let json = {};
	try { json = JSON.parse(res.body); } catch {}
	return { res, json };
}

const BUYER_ID  = '00000000-0000-0000-0000-000000000001';
const SELLER_ID = '00000000-0000-0000-0000-000000000002';
const USER_ID   = 'aaaa0000-0000-0000-0000-000000000001';
const OTHER_ID  = 'bbbb0000-0000-0000-0000-000000000001';

const BUYER_ROW  = { id: BUYER_ID,  user_id: USER_ID,  meta: { encrypted_solana_secret: 'enc' } };
const SELLER_ROW = { id: SELLER_ID, user_id: OTHER_ID };
const PRICE_ROW  = { amount: 1_000_000, currency_mint: 'EPjF', chain: 'solana', mint_decimals: 6 };
const NO_EXISTING = [];
const SPEND_SUM  = [{ total: '0' }];
const PURCHASE_ROW = [{
	id: 'ppp', user_id: USER_ID, agent_id: SELLER_ID, skill: 'pro',
	status: 'pending', amount: 1_000_000, currency_mint: 'EPjF', chain: 'solana',
	reference: 'ref1', expires_at: null, mint_decimals: 6,
}];

beforeEach(() => {
	sqlQueue.length = 0;
	authState.session = { id: USER_ID };
	rlState.success = true;
	confirmResult.status = 'confirmed';
	confirmResult.tx_signature = 'sig123';
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/marketplace/purchase-as-agent', () => {
	it('returns 401 when not signed in', async () => {
		authState.session = null;
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(401);
	});

	it('returns 429 when per-IP rate limit exceeded', async () => {
		rlState.success = false;
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(429);
	});

	it('returns 400 when buyer and seller are the same agent', async () => {
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: BUYER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(400);
	});

	it('returns 400 on validation error (missing skill)', async () => {
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID }), makeRes());
		expect(res.statusCode).toBe(400);
	});

	it('returns 429 when per-agent rate limit exceeded', async () => {
		const { limits } = await import('../../api/_lib/rate-limit.js');
		limits.agentBuy.mockResolvedValueOnce({ success: false });
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(429);
	});

	it('returns 403 when caller does not own the buyer agent', async () => {
		// buyer.user_id is DIFFERENT from auth.userId
		sqlQueue.push([{ ...BUYER_ROW, user_id: OTHER_ID }]); // buyer lookup
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(403);
	});

	it('returns 404 when seller agent not found', async () => {
		sqlQueue.push([BUYER_ROW]);  // buyer
		sqlQueue.push([]);           // seller → empty
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(404);
	});

	it('returns 200 already_owned when confirmed purchase exists', async () => {
		sqlQueue.push([BUYER_ROW]);  // buyer
		sqlQueue.push([SELLER_ROW]); // seller
		sqlQueue.push([{ reference: 'ref-old', status: 'confirmed', tx_signature: 'oldsig', confirmed_at: new Date().toISOString() }]); // existing
		const { res, json } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(200);
		expect(json.data.already_owned).toBe(true);
		expect(json.data.reference).toBe('ref-old');
	});

	it('returns 404 when skill is not for sale', async () => {
		sqlQueue.push([BUYER_ROW]);  // buyer
		sqlQueue.push([SELLER_ROW]); // seller
		sqlQueue.push([]);           // no existing purchase
		sqlQueue.push([]);           // price lookup → empty
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(404);
	});

	it('returns 402 when daily spend cap would be exceeded', async () => {
		const cappedBuyer = { ...BUYER_ROW, meta: { ...BUYER_ROW.meta, auto_purchase_daily_limit_usdc: 0.5 } };
		// Daily spend: 500_000 atomics = 0.50 USDC; adding 1_000_000 would exceed 0.50 cap
		sqlQueue.push([cappedBuyer]);  // buyer
		sqlQueue.push([SELLER_ROW]);   // seller
		sqlQueue.push([]);             // no existing
		sqlQueue.push([PRICE_ROW]);    // price: 1 USDC
		sqlQueue.push([{ total: '500000' }]); // spend sum: 0.50 USDC already spent
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(402);
		expect(JSON.parse(res.body).error).toBe('spend_cap_exceeded');
	});

	it('returns 412 when buyer agent has no wallet', async () => {
		sqlQueue.push([{ ...BUYER_ROW, meta: {} }]); // buyer without wallet
		sqlQueue.push([SELLER_ROW]);
		sqlQueue.push([]);             // no existing
		sqlQueue.push([PRICE_ROW]);    // price
		sqlQueue.push([SPEND_SUM]);    // spend sum
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(412);
	});

	it('returns 200 confirmed on happy path', async () => {
		sqlQueue.push([BUYER_ROW]);    // buyer (no spending cap in meta)
		sqlQueue.push([SELLER_ROW]);   // seller
		sqlQueue.push([]);             // no existing purchase
		sqlQueue.push([PRICE_ROW]);    // price
		// no spend-sum call (no daily cap configured)
		sqlQueue.push(PURCHASE_ROW);   // INSERT RETURNING
		// resolvePayoutAddress is already mocked globally
		const { res, json } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(200);
		expect(json.data.status).toBe('confirmed');
		expect(json.data.skill).toBe('pro');
		expect(json.data.seller_agent_id).toBe(SELLER_ID);
		expect(typeof json.data.tx_signature).toBe('string');
	});

	it('flags self-dealing but does not block it', async () => {
		const selfDealSeller = { id: SELLER_ID, user_id: USER_ID }; // same user as buyer
		sqlQueue.push([BUYER_ROW]);
		sqlQueue.push([selfDealSeller]);
		sqlQueue.push([]);             // no existing
		sqlQueue.push([PRICE_ROW]);
		// no spend-sum (no cap)
		sqlQueue.push(PURCHASE_ROW);
		const { res, json } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(200);
		expect(json.data.is_self_dealing).toBe(true);
	});

	it('returns 502 when the on-chain transaction fails', async () => {
		// Temporarily make sendRawTransaction throw
		fakeConn.sendRawTransaction.mockRejectedValueOnce(new Error('insufficient funds'));

		sqlQueue.push([BUYER_ROW]);
		sqlQueue.push([SELLER_ROW]);
		sqlQueue.push([]);             // no existing
		sqlQueue.push([PRICE_ROW]);
		// no spend-sum (no cap)
		sqlQueue.push(PURCHASE_ROW);   // INSERT RETURNING
		sqlQueue.push([]);             // UPDATE status = 'failed'
		const { res } = await invoke(makeReq({ buyer_agent_id: BUYER_ID, seller_agent_id: SELLER_ID, skill: 'pro' }), makeRes());
		expect(res.statusCode).toBe(502);
	});
});
