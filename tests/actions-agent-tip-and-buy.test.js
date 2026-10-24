// Coverage for the "Tip this agent" and "Buy this agent's coin" Solana Blinks:
//
//   api/actions/agent-tip.js       unsigned SOL/$THREE transfer to the agent's own wallet
//   api/actions/agent-buy-coin.js  unsigned Jupiter swap into the agent's pump.fun mint
//
// Both wrap the same unsigned-transaction builders (buildTransferTransaction,
// buildSwapTransaction) and envelope/header pattern as api/actions/avatar.js.
// The cases below pin the behaviour a Blink client depends on:
//
//   1. The GET card carries the Action spec's `type` and version headers.
//   2. `?agent=` only ever names a real agent id; a non-uuid is 400.
//   3. An unknown agent is 404; an agent with no mainnet launch is 404 for buy-coin.
//   4. POST rejects an off-curve (PDA) account before calling any builder.
//   5. POST with a valid account/amount calls the expected builder with the
//      expected arguments and returns the serialized transaction.
//   6. The tip endpoint's `token=THREE` branch passes the hardcoded $THREE
//      mint to the builder, never an arbitrary caller-supplied mint.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a) }));

const getOrCreateAgentSolanaWallet = vi.fn();
vi.mock('../api/_lib/agent-wallet.js', () => ({
	getOrCreateAgentSolanaWallet: (...a) => getOrCreateAgentSolanaWallet(...a),
}));

vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => ({}),
}));

const buildTransferTransaction = vi.fn();
const buildSwapTransaction = vi.fn();
vi.mock('../api/_lib/custody/builders.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		buildTransferTransaction: (...a) => buildTransferTransaction(...a),
		buildSwapTransaction: (...a) => buildSwapTransaction(...a),
	};
});

const { default: tipHandler } = await import('../api/actions/agent-tip.js');
const { default: buyCoinHandler } = await import('../api/actions/agent-buy-coin.js');

// $THREE, the platform's own coin, doubles as a known-good on-curve pubkey.
const ON_CURVE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const AGENT_UUID = '3f1c8a52-9f6b-4a3d-8c21-0d5b7e9a1c44';
const AGENT_ROW = { id: AGENT_UUID, name: 'Nova', avatar_thumbnail_key: null };
const COIN_ROW = { mint: 'coin-mint-placeholder-not-real', name: 'Nova Coin', symbol: 'NOVA' };

function mockReq(method, url, body) {
	const req = { method, url, headers: { host: 'localhost' } };
	if (body !== undefined) {
		req.headers['content-type'] = 'application/json';
		req.body = body;
	}
	return req;
}

function mockRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		ended: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b; this.ended = true; },
	};
}

const parse = (res) => JSON.parse(String(res.body));

// Both handlers query sql() sequentially (agent lookup first, coin lookup
// second for buy-coin); this just replays canned rows in call order.
function queueSql(...results) {
	let i = 0;
	sqlMock.mockImplementation(async () => results[i++] ?? []);
}

function fakeTransaction() {
	return { serialize: () => Buffer.from('fake-serialized-tx') };
}

beforeEach(() => {
	sqlMock.mockReset();
	getOrCreateAgentSolanaWallet.mockReset();
	buildTransferTransaction.mockReset();
	buildSwapTransaction.mockReset();
});

describe('api/actions/agent-tip GET (the Blink card)', () => {
	it('returns a spec-shaped action with version headers', async () => {
		queueSql([AGENT_ROW]);
		const res = mockRes();
		await tipHandler(mockReq('GET', `/api/actions/agent-tip?agent=${AGENT_UUID}`), res);

		expect(res.statusCode).toBe(200);
		const card = parse(res);
		expect(card.type).toBe('action');
		expect(card.title).toBe('Tip Nova');
		expect(card.links.actions.length).toBeGreaterThan(1);
		expect(card.links.actions.at(-1).parameters[0]).toMatchObject({ name: 'amount' });
		expect(res.headers['x-action-version']).toBe('2.1.3');
		expect(res.headers['x-blockchain-ids']).toMatch(/^solana:/);
	});

	it('rejects a non-uuid agent id as 400', async () => {
		const res = mockRes();
		await tipHandler(mockReq('GET', '/api/actions/agent-tip?agent=not-a-uuid'), res);

		expect(res.statusCode).toBe(400);
		expect(parse(res).error).toBe('bad_request');
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('404s an unknown agent', async () => {
		queueSql([]);
		const res = mockRes();
		await tipHandler(mockReq('GET', `/api/actions/agent-tip?agent=${AGENT_UUID}`), res);

		expect(res.statusCode).toBe(404);
		expect(parse(res).message).toMatch(/not available/i);
	});

	it('puts the Action version headers on the OPTIONS preflight', async () => {
		const res = mockRes();
		await tipHandler(mockReq('OPTIONS', '/api/actions/agent-tip'), res);

		expect(res.statusCode).toBe(204);
		expect(res.headers['x-action-version']).toBe('2.1.3');
	});
});

describe('api/actions/agent-tip POST (the tip transaction)', () => {
	it('rejects an off-curve account before calling any builder', async () => {
		queueSql([AGENT_ROW]);
		const { PublicKey } = await import('@solana/web3.js');
		const [pda] = PublicKey.findProgramAddressSync([Buffer.from('three')], new PublicKey(MEMO_PROGRAM));

		const res = mockRes();
		await tipHandler(
			mockReq('POST', `/api/actions/agent-tip?agent=${AGENT_UUID}`, { account: pda.toBase58(), amount: 0.1 }),
			res,
		);

		expect(res.statusCode).toBe(400);
		expect(buildTransferTransaction).not.toHaveBeenCalled();
		expect(getOrCreateAgentSolanaWallet).not.toHaveBeenCalled();
	});

	it('builds a SOL transfer to the agent own wallet for a valid account/amount', async () => {
		queueSql([AGENT_ROW]);
		getOrCreateAgentSolanaWallet.mockResolvedValue({ address: 'agent-wallet-address', created: false });
		buildTransferTransaction.mockResolvedValue({ transaction: fakeTransaction() });

		const res = mockRes();
		await tipHandler(
			mockReq('POST', `/api/actions/agent-tip?agent=${AGENT_UUID}`, { account: ON_CURVE, amount: 0.25 }),
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(parse(res).type).toBe('transaction');
		expect(buildTransferTransaction).toHaveBeenCalledWith(
			expect.objectContaining({
				sender: ON_CURVE,
				recipient: 'agent-wallet-address',
				amount: 0.25,
				token: 'SOL',
				memo: `tip:${AGENT_UUID}`,
				network: 'mainnet',
			}),
		);
	});

	it('passes the hardcoded $THREE mint, not a caller-supplied one, for token=THREE', async () => {
		queueSql([AGENT_ROW]);
		getOrCreateAgentSolanaWallet.mockResolvedValue({ address: 'agent-wallet-address', created: false });
		buildTransferTransaction.mockResolvedValue({ transaction: fakeTransaction() });

		const res = mockRes();
		await tipHandler(
			mockReq('POST', `/api/actions/agent-tip?agent=${AGENT_UUID}&token=THREE`, { account: ON_CURVE, amount: 10 }),
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(buildTransferTransaction).toHaveBeenCalledWith(
			expect.objectContaining({ token: THREE_MINT }),
		);
	});

	it('rejects a non-positive amount before resolving the wallet', async () => {
		queueSql([AGENT_ROW]);
		const res = mockRes();
		await tipHandler(
			mockReq('POST', `/api/actions/agent-tip?agent=${AGENT_UUID}`, { account: ON_CURVE, amount: 0 }),
			res,
		);

		expect(res.statusCode).toBe(400);
		expect(getOrCreateAgentSolanaWallet).not.toHaveBeenCalled();
	});
});

describe('api/actions/agent-buy-coin GET (the Blink card)', () => {
	it('returns a spec-shaped action naming the agent coin', async () => {
		queueSql([AGENT_ROW], [COIN_ROW]);
		const res = mockRes();
		await buyCoinHandler(mockReq('GET', `/api/actions/agent-buy-coin?agent=${AGENT_UUID}`), res);

		expect(res.statusCode).toBe(200);
		const card = parse(res);
		expect(card.type).toBe('action');
		expect(card.title).toBe('Buy NOVA');
		expect(res.headers['x-action-version']).toBe('2.1.3');
	});

	it('rejects a non-uuid agent id as 400', async () => {
		const res = mockRes();
		await buyCoinHandler(mockReq('GET', '/api/actions/agent-buy-coin?agent=not-a-uuid'), res);

		expect(res.statusCode).toBe(400);
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('404s an unknown agent', async () => {
		queueSql([]);
		const res = mockRes();
		await buyCoinHandler(mockReq('GET', `/api/actions/agent-buy-coin?agent=${AGENT_UUID}`), res);

		expect(res.statusCode).toBe(404);
		expect(parse(res).message).toMatch(/not available/i);
	});

	it('404s an agent with no mainnet launch instead of a card with nothing to buy', async () => {
		queueSql([AGENT_ROW], []);
		const res = mockRes();
		await buyCoinHandler(mockReq('GET', `/api/actions/agent-buy-coin?agent=${AGENT_UUID}`), res);

		expect(res.statusCode).toBe(404);
		expect(parse(res).message).toMatch(/not launched a coin/i);
	});
});

describe('api/actions/agent-buy-coin POST (the swap transaction)', () => {
	it('rejects an off-curve account before calling any builder', async () => {
		queueSql([AGENT_ROW], [COIN_ROW]);
		const { PublicKey } = await import('@solana/web3.js');
		const [pda] = PublicKey.findProgramAddressSync([Buffer.from('three')], new PublicKey(MEMO_PROGRAM));

		const res = mockRes();
		await buyCoinHandler(
			mockReq('POST', `/api/actions/agent-buy-coin?agent=${AGENT_UUID}`, { account: pda.toBase58(), amount: 0.5 }),
			res,
		);

		expect(res.statusCode).toBe(400);
		expect(buildSwapTransaction).not.toHaveBeenCalled();
	});

	it('builds a SOL -> mint swap for a valid account/amount', async () => {
		queueSql([AGENT_ROW], [COIN_ROW]);
		buildSwapTransaction.mockResolvedValue({ transaction: fakeTransaction() });

		const res = mockRes();
		await buyCoinHandler(
			mockReq('POST', `/api/actions/agent-buy-coin?agent=${AGENT_UUID}`, { account: ON_CURVE, amount: 0.5 }),
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(parse(res).type).toBe('transaction');
		expect(buildSwapTransaction).toHaveBeenCalledWith(
			expect.objectContaining({
				sender: ON_CURVE,
				inputMint: 'So11111111111111111111111111111111111111112',
				outputMint: COIN_ROW.mint,
				amount: 0.5,
				slippageBps: 50,
			}),
		);
	});

	it('surfaces a no_route builder error as the 422 it already is, not a 500', async () => {
		queueSql([AGENT_ROW], [COIN_ROW]);
		buildSwapTransaction.mockRejectedValue(Object.assign(new Error('No swap route found for this pair and amount'), { status: 422, code: 'no_route' }));

		const res = mockRes();
		await buyCoinHandler(
			mockReq('POST', `/api/actions/agent-buy-coin?agent=${AGENT_UUID}`, { account: ON_CURVE, amount: 0.5 }),
			res,
		);

		expect(res.statusCode).toBe(422);
		expect(parse(res).error).toBe('no_route');
	});
});
