// Regressions for /api/subscriptions and /api/subscriptions/plans.
//
// Three faults these lock in, all found by probing the live handlers:
//   1. A malformed path id (/api/subscriptions/not-a-uuid, /plans/not-a-uuid)
//      went straight into a uuid comparison, so Postgres answered 22P02 and the
//      caller got an opaque 500 instead of "your id is wrong".
//   2. PUT /api/subscriptions/plans/:id answered 405, which meant the dashboard
//      plan editor (src/dashboard-next/pages/monetize.js saves an edit with PUT)
//      could never save a change to an existing tier.
//   3. GET /api/subscriptions/plans/:id fell through to the list handler and
//      answered "creator_id or agent_id required" for a perfectly well-formed
//      request. It now serves the plan, with drafts visible only to their owner.
//
// A HEAD probe used to match no dispatch branch and fall through to 405 on both
// handlers; RFC 9110 9.3.2 requires it to reach whatever GET reaches.
//
// POST /api/subscriptions/subscribe builds the transaction the subscriber signs.
// Two faults locked in there: the reference-bound creator leg went FIRST, so
// @solana/pay validateTransfer (which reads only the last instruction) decoded
// the treasury fee leg and every fee-split subscription failed to confirm; and
// every ATA and transfer used the classic token program, so a checkout in a
// Token-2022 mint ($THREE) addressed accounts that never exist.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	MINT_SIZE,
	MintLayout,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({
	sql: (...a) => sqlMock(...a),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const getSessionUserMock = vi.fn();
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: (...a) => getSessionUserMock(...a),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));

vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	clientIp: () => '127.0.0.1',
	limits: {
		publicIp: async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 1000 }),
		authIp: async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 1000 }),
	},
}));
vi.mock('../api/_lib/subscription-billing.js', () => ({
	chargeSubscription: vi.fn(async () => ({ success: false, error: 'creator_payout_wallet_missing' })),
}));

const chain = vi.hoisted(() => ({ program: null, missing: new Set(), payout: null, fee: null }));
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => ({
		getLatestBlockhash: async () => ({ blockhash: '9sHcv6xwn9YkB8nxTUGKDwPwNnmqVp5oAXxU8Fdkm4J6', lastValidBlockHeight: 1 }),
		getAccountInfo: async () => ({ owner: chain.program, data: chain.mintData, lamports: 1_461_600, executable: false }),
		getMultipleAccountsInfo: async (keys) =>
			keys.map((k) =>
				chain.missing.has(k.toBase58())
					? null
					: { owner: chain.program, data: Buffer.alloc(165), lamports: 2_039_280, executable: false },
			),
	}),
}));
vi.mock('../api/_lib/solana/read-guards.js', async (importOriginal) => ({
	...(await importOriginal()),
	getRecentBlockhashInfo: async () => ({ blockhash: '9sHcv6xwn9YkB8nxTUGKDwPwNnmqVp5oAXxU8Fdkm4J6', lastValidBlockHeight: 1 }),
}));
vi.mock('../api/_lib/marketplace-platform-fee.js', () => ({
	resolveMarketplaceFee: async ({ grossAtomics }) =>
		chain.fee ? { bps: 1000, feeAtomics: grossAtomics / 10n, recipient: chain.fee } : null,
}));
vi.mock('../api/_lib/subscription-checkout.js', async (importOriginal) => ({
	...(await importOriginal()),
	resolveSubscriptionPayout: async () => chain.payout,
}));

const { default: plansHandler } = await import('../api/subscriptions/plans.js');
const { default: subsHandler } = await import('../api/subscriptions/index.js');
const { default: subscribeHandler } = await import('../api/subscriptions/subscribe.js');

const OWNER = 'ab2aabd2-39f7-493b-8191-c9f174af62ab';
const OTHER = 'f23703c0-9d75-4e60-9a4c-349da5d7a2f2';
const PLAN = '735977d9-289d-4517-8ac4-68e97c649de8';
const SUB = '7c8e0051-0279-484a-b7d5-a19d821ade61';

function mkReq({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
	return {
		method,
		url,
		headers: { ...headers },
		body: body ?? undefined,
	};
}

function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b; this.writableEnded = true; },
	};
}

const parse = (res) => (res.body ? JSON.parse(res.body) : undefined);
const jsonReq = (method, url, body) =>
	mkReq({ method, url, headers: { 'content-type': 'application/json' }, body });

// The handlers use tagged-template sql``; queue one result array per call.
let sqlQueue = [];
beforeEach(() => {
	sqlQueue = [];
	sqlMock.mockReset().mockImplementation(() => Promise.resolve(sqlQueue.length ? sqlQueue.shift() : []));
	getSessionUserMock.mockReset().mockResolvedValue({ id: OWNER });
});

describe('subscriptions: malformed path ids answer 4xx, never a 500', () => {
	it('GET /api/subscriptions/:id rejects a non-uuid before touching the database', async () => {
		const res = mkRes();
		await subsHandler(mkReq({ url: '/api/subscriptions/not-a-uuid' }), res);
		expect(res.statusCode).toBe(400);
		expect(parse(res).error).toBe('validation_error');
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('DELETE /api/subscriptions/:id rejects a non-uuid before touching the database', async () => {
		const res = mkRes();
		await subsHandler(mkReq({ method: 'DELETE', url: '/api/subscriptions/not-a-uuid' }), res);
		expect(res.statusCode).toBe(400);
		expect(parse(res).error).toBe('validation_error');
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('PATCH /api/subscriptions/plans/:id rejects a non-uuid', async () => {
		const res = mkRes();
		await plansHandler(jsonReq('PATCH', '/api/subscriptions/plans/not-a-uuid', { name: 'abc' }), res);
		expect(res.statusCode).toBe(400);
		expect(parse(res).error_description).toMatch(/valid UUID/);
	});

	it('DELETE /api/subscriptions/plans/:id rejects a non-uuid', async () => {
		const res = mkRes();
		await plansHandler(mkReq({ method: 'DELETE', url: '/api/subscriptions/plans/not-a-uuid' }), res);
		expect(res.statusCode).toBe(400);
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('GET /api/subscriptions/plans/:id rejects a non-uuid', async () => {
		const res = mkRes();
		await plansHandler(mkReq({ url: '/api/subscriptions/plans/not-a-uuid' }), res);
		expect(res.statusCode).toBe(400);
		expect(sqlMock).not.toHaveBeenCalled();
	});
});

describe('subscription plans: the dashboard editor saves with PUT', () => {
	it('PUT /api/subscriptions/plans/:id updates the plan like PATCH does', async () => {
		sqlQueue = [
			[{ id: PLAN, active: true }],
			[{ id: PLAN, name: 'Renamed', active: true }],
		];
		const res = mkRes();
		await plansHandler(
			jsonReq('PUT', `/api/subscriptions/plans/${PLAN}`, { name: 'Renamed', price_usd: 6 }),
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(parse(res).plan).toMatchObject({ id: PLAN, name: 'Renamed' });
	});

	it('advertises PUT in the CORS preflight', async () => {
		const res = mkRes();
		await plansHandler(
			mkReq({ method: 'OPTIONS', url: '/api/subscriptions/plans', headers: { origin: 'http://localhost:3000' } }),
			res,
		);
		expect(res.statusCode).toBe(204);
		expect(res.headers['access-control-allow-methods']).toContain('PUT');
	});
});

describe('subscription plans: single-plan read', () => {
	it('serves an active plan to an anonymous caller', async () => {
		getSessionUserMock.mockResolvedValue(null);
		sqlQueue = [[{ id: PLAN, creator_id: OTHER, name: 'Tier', active: true }]];
		const res = mkRes();
		await plansHandler(mkReq({ url: `/api/subscriptions/plans/${PLAN}` }), res);
		expect(res.statusCode).toBe(200);
		expect(parse(res).plan.id).toBe(PLAN);
	});

	it('404s an unknown plan', async () => {
		sqlQueue = [[]];
		const res = mkRes();
		await plansHandler(mkReq({ url: `/api/subscriptions/plans/${PLAN}` }), res);
		expect(res.statusCode).toBe(404);
		expect(parse(res).error).toBe('not_found');
	});

	it('hides a draft from everyone but its creator', async () => {
		getSessionUserMock.mockResolvedValue({ id: OTHER });
		sqlQueue = [[{ id: PLAN, creator_id: OWNER, name: 'Draft', active: false }]];
		const res = mkRes();
		await plansHandler(mkReq({ url: `/api/subscriptions/plans/${PLAN}` }), res);
		expect(res.statusCode).toBe(404);
	});

	it('shows a draft to its creator', async () => {
		getSessionUserMock.mockResolvedValue({ id: OWNER });
		sqlQueue = [[{ id: PLAN, creator_id: OWNER, name: 'Draft', active: false }]];
		const res = mkRes();
		await plansHandler(mkReq({ url: `/api/subscriptions/plans/${PLAN}` }), res);
		expect(res.statusCode).toBe(200);
		expect(parse(res).plan.active).toBe(false);
	});
});

describe('subscriptions: HEAD reaches the GET branch', () => {
	it('HEAD /api/subscriptions/mine answers like GET', async () => {
		sqlQueue = [[{ id: SUB, plan_id: PLAN, status: 'active' }]];
		const res = mkRes();
		await subsHandler(mkReq({ method: 'HEAD', url: '/api/subscriptions/mine' }), res);
		expect(res.statusCode).toBe(200);
	});

	it('HEAD /api/subscriptions/plans answers like GET', async () => {
		sqlQueue = [[]];
		const res = mkRes();
		await plansHandler(mkReq({ method: 'HEAD', url: `/api/subscriptions/plans?creator_id=${OWNER}` }), res);
		expect(res.statusCode).toBe(200);
	});
});

describe('subscriptions: unchanged contract', () => {
	it('GET /api/subscriptions/mine requires a session', async () => {
		getSessionUserMock.mockResolvedValue(null);
		const res = mkRes();
		await subsHandler(mkReq({ url: '/api/subscriptions/mine' }), res);
		expect(res.statusCode).toBe(401);
		expect(parse(res).error).toBe('unauthorized');
	});

	it('POST /api/subscriptions refuses a plan the caller owns', async () => {
		sqlQueue = [[{ id: PLAN, creator_id: OWNER, price_usd: '9.99', interval: 'monthly', active: true }]];
		const res = mkRes();
		await subsHandler(jsonReq('POST', '/api/subscriptions', { plan_id: PLAN }), res);
		expect(res.statusCode).toBe(409);
		expect(parse(res).error_description).toMatch(/your own plan/);
	});

	it('POST /api/subscriptions records the tier unpaid, never active, until a verified payment', async () => {
		const SUBSCRIBER = '00000000-0000-4000-8000-0000000000aa';
		getSessionUserMock.mockResolvedValue({ id: SUBSCRIBER });
		sqlQueue = [
			[{ id: PLAN, creator_id: OWNER, price_usd: '9.99', interval: 'monthly', active: true }],
			[],
			[{ id: 'sub-1', status: 'past_due' }],
		];
		const res = mkRes();
		await subsHandler(jsonReq('POST', '/api/subscriptions', { plan_id: PLAN }), res);
		expect(res.statusCode).toBe(201);
		const insert = sqlMock.mock.calls.map((c) => c[0].join('?')).find((t) => /INSERT INTO creator_subscriptions/.test(t));
		expect(insert).toMatch(/'past_due'/);
		expect(insert).not.toMatch(/'active'/);
	});

	it('GET /api/subscriptions/plans still requires creator_id or agent_id', async () => {
		const res = mkRes();
		await plansHandler(mkReq({ url: '/api/subscriptions/plans' }), res);
		expect(res.statusCode).toBe(400);
		expect(parse(res).error_description).toMatch(/creator_id or agent_id/);
	});
});

describe('POST /api/subscriptions/subscribe: the transaction the subscriber signs', () => {
	const THREE_MINT = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
	const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
	const BUYER = Keypair.generate().publicKey;
	const CREATOR = Keypair.generate().publicKey;
	const TREASURY = Keypair.generate().publicKey;
	const REFERENCE = Keypair.generate().publicKey;
	const TRANSFER_CHECKED = 12;

	function mintData(decimals) {
		const data = Buffer.alloc(MINT_SIZE);
		MintLayout.encode(
			{
				mintAuthorityOption: 0,
				mintAuthority: PublicKey.default,
				supply: 1n,
				decimals,
				isInitialized: true,
				freezeAuthorityOption: 0,
				freezeAuthority: PublicKey.default,
			},
			data,
		);
		return data;
	}

	// The handler reuses a fresh pending checkout row, which is the source of
	// truth for the split the transaction encodes.
	function queuePendingCheckout(mint) {
		sqlQueue = [
			[{ id: PLAN, creator_id: OTHER, agent_id: null, name: 'Gold', price_usd: '10.00', interval: 'monthly', active: true }],
			[],
			[
				{
					reference: REFERENCE.toBase58(),
					amount: '10000000',
					creator_amount: '9000000',
					platform_fee_amount: '1000000',
					platform_fee_wallet: TREASURY.toBase58(),
					currency_mint: mint.toBase58(),
					recipient: CREATOR.toBase58(),
				},
			],
		];
	}

	async function subscribe() {
		const res = mkRes();
		await subscribeHandler(
			jsonReq('POST', '/api/subscriptions/subscribe', { tierId: PLAN, buyerPublicKey: BUYER.toBase58() }),
			res,
		);
		expect(res.statusCode).toBe(200);
		const tx = VersionedTransaction.deserialize(Buffer.from(parse(res).data.transaction, 'base64'));
		const keys = tx.message.staticAccountKeys;
		return tx.message.compiledInstructions.map((ix) => ({
			program: keys[ix.programIdIndex],
			accounts: ix.accountKeyIndexes.map((i) => keys[i]),
			data: Buffer.from(ix.data),
		}));
	}

	beforeEach(() => {
		delete process.env.MARKETPLACE_PAYER_KEYPAIR;
		delete process.env.PLATFORM_TREASURY_KEYPAIR;
		delete process.env.TREASURY_KEYPAIR;
		chain.payout = CREATOR.toBase58();
		chain.fee = TREASURY;
		chain.missing = new Set();
		chain.program = TOKEN_PROGRAM_ID;
		chain.mintData = mintData(6);
	});

	it('closes a fee-split USDC subscription with the reference-bound creator leg', async () => {
		queuePendingCheckout(USDC_MINT);
		const ixs = await subscribe();
		const transfers = ixs.filter((ix) => ix.data[0] === TRANSFER_CHECKED);
		expect(transfers).toHaveLength(2);
		const ata = (owner) => getAssociatedTokenAddressSync(USDC_MINT, owner, false, TOKEN_PROGRAM_ID);
		expect(transfers[0].accounts[2].equals(ata(TREASURY))).toBe(true);
		const last = ixs.at(-1);
		expect(last.data[0]).toBe(TRANSFER_CHECKED);
		expect(last.accounts[2].equals(ata(CREATOR))).toBe(true);
		expect(last.accounts.at(-1).equals(REFERENCE)).toBe(true);
	});

	it('builds a checkout persisted in $THREE with Token-2022 ATAs and transfers', async () => {
		chain.program = TOKEN_2022_PROGRAM_ID;
		queuePendingCheckout(THREE_MINT);
		const ixs = await subscribe();
		const ata = (owner) => getAssociatedTokenAddressSync(THREE_MINT, owner, false, TOKEN_2022_PROGRAM_ID);
		const transfers = ixs.filter((ix) => ix.data[0] === TRANSFER_CHECKED);
		expect(transfers).toHaveLength(2);
		for (const ix of transfers) {
			expect(ix.program.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
			expect(ix.accounts[0].equals(ata(BUYER))).toBe(true);
		}
		expect(ixs.at(-1).accounts[2].equals(ata(CREATOR))).toBe(true);
	});

	it("opens the creator's and treasury's missing ATAs idempotently before the transfers", async () => {
		chain.program = TOKEN_2022_PROGRAM_ID;
		const ata = (owner) => getAssociatedTokenAddressSync(THREE_MINT, owner, false, TOKEN_2022_PROGRAM_ID);
		chain.missing = new Set([ata(CREATOR).toBase58(), ata(TREASURY).toBase58()]);
		queuePendingCheckout(THREE_MINT);
		const ixs = await subscribe();
		expect(ixs).toHaveLength(4);
		for (const ix of ixs.slice(0, 2)) {
			expect(ix.program.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
			expect(ix.data[0]).toBe(1);
			expect(ix.accounts[0].equals(BUYER)).toBe(true); // no platform payer configured: the buyer funds rent
			expect(ix.accounts[5].equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		}
		expect(ixs.at(-1).accounts.at(-1).equals(REFERENCE)).toBe(true);
	});
});
