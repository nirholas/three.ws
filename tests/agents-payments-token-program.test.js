// /api/agents/payments/{pay-prep,balances,distribute-prep,withdraw-prep} build
// the agent-payments transactions a wallet signs. They are mint-generic: the
// buyer picks the currency (USDC, $THREE, any SPL mint the agent accepts).
//
// $THREE (FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump) is a Token-2022 mint, and
// the @three-ws/agent-payments builders default every token account and the
// tokenProgram account to the classic SPL Token program unless told otherwise.
// The handler never passed the mint's program, so a $THREE payment debited an
// account the buyer does not have, balances read classic vault ATAs that never
// exist (always 0), and distribute/withdraw named the wrong program on-chain.
//
// Two transaction-shape bugs rode along:
// - pay-prep prepended its own SetComputeUnitLimit to instructions that already
//   start with one. The runtime rejects a transaction carrying two
//   compute-budget instructions of the same kind (DuplicateInstruction), so no
//   agent payment could land in any currency.
// - distribute-prep handed distributePayments' instruction ARRAY to
//   Transaction.add as one item, so the prep threw before it built anything.
//
// These tests run the real SDK builders over a fake chain and decode the
// transaction the handler returns.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { getTokenAgentPaymentsPDA } from '@three-ws/agent-payments';

const THREE_MINT = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const state = vi.hoisted(() => ({
	user: { id: 'user-1', username: 'buyer' },
	wallet: null,
	agentMint: null,
	mintOwners: new Map(),
	balanceReads: [],
	inserts: [],
}));

vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => ({
		rpcEndpoint: 'http://fake-rpc.invalid',
		async getAccountInfo(pk) {
			const owner = state.mintOwners.get(pk.toBase58());
			if (!owner) return null;
			return { owner, data: Buffer.alloc(82), lamports: 1, executable: false };
		},
		async getLatestBlockhash() {
			return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 };
		},
		async getTokenAccountBalance(ata) {
			state.balanceReads.push(ata.toBase58());
			return { value: { amount: '0', decimals: 6 } };
		},
	}),
}));

vi.mock('../api/_lib/auth.js', () => ({ getSessionUser: async () => state.user }));

vi.mock('../api/_lib/rate-limit.js', () => {
	const ok = async () => ({ success: true });
	return { limits: new Proxy({}, { get: () => ok }), clientIp: () => '127.0.0.1' };
});

vi.mock('../api/_lib/notify.js', () => ({ insertNotification: async () => {} }));

vi.mock('../api/_lib/db.js', async (importOriginal) => ({
	...(await importOriginal()),
	sql: (strings, ...values) => {
		const q = strings.join('?');
		if (/insert into/i.test(q)) {
			state.inserts.push(q);
			return Promise.resolve([]);
		}
		if (/from user_wallets/i.test(q)) {
			return Promise.resolve(values.includes(state.wallet.toBase58()) ? [{ id: 'w1' }] : []);
		}
		if (/meta->'payments'->>'mint'/i.test(q)) {
			return Promise.resolve([{ id: 'agent-1', user_id: state.user.id }]);
		}
		if (/from agent_identities/i.test(q)) {
			return Promise.resolve([
				{ id: 'agent-1', name: 'Agent', meta: { payments: { configured: true, mint: state.agentMint.toBase58() } } },
			]);
		}
		return Promise.resolve([]);
	},
}));

const { default: handler } = await import('../api/agents/payments/[action].js');

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => {
		r._h[k.toLowerCase()] = v;
	};
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => {
		r._b = b;
	};
	return r;
}

async function call(action, { method = 'POST', body, query = {} } = {}) {
	const res = makeRes();
	await handler(
		{
			method,
			url: `/api/agents/payments/${action}`,
			query: { action, ...query },
			headers: { origin: 'https://three.ws', 'content-type': 'application/json' },
			socket: { remoteAddress: '127.0.0.1' },
			body,
		},
		res,
	);
	return { status: res.statusCode, body: res._b ? JSON.parse(res._b) : null };
}

const decode = (b64) => Transaction.from(Buffer.from(b64, 'base64'));
const has = (ix, key) => ix.keys.some((k) => k.pubkey.equals(key));
const SET_CU_LIMIT = 2;
const SET_CU_PRICE = 3;

function computeBudget(tx, kind) {
	return tx.instructions.filter((ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === kind);
}

beforeEach(() => {
	state.wallet = Keypair.generate().publicKey;
	state.agentMint = Keypair.generate().publicKey;
	state.balanceReads = [];
	state.inserts = [];
	state.mintOwners = new Map();
});

describe('pay-prep', () => {
	async function payPrep(currency) {
		const { status, body } = await call('pay-prep', {
			body: {
				agent_id: 'agent-1',
				wallet_address: state.wallet.toBase58(),
				currency_mint: currency.toBase58(),
				amount: '1500000',
				memo: '42',
			},
		});
		expect(status).toBe(201);
		return decode(body.tx_base64);
	}

	it('carries exactly one compute-unit limit and one price, so the runtime accepts it', async () => {
		const tx = await payPrep(USDC_MINT);
		expect(computeBudget(tx, SET_CU_LIMIT)).toHaveLength(1);
		expect(computeBudget(tx, SET_CU_PRICE)).toHaveLength(1);
	});

	it('pays $THREE from the buyer Token-2022 account on the Token-2022 program', async () => {
		const tx = await payPrep(THREE_MINT);
		const accept = tx.instructions.at(-1);
		const buyerAta = getAssociatedTokenAddressSync(THREE_MINT, state.wallet, false, TOKEN_2022_PROGRAM_ID);
		const [vaultOwner] = getTokenAgentPaymentsPDA(state.agentMint);
		const vaultAta = getAssociatedTokenAddressSync(THREE_MINT, vaultOwner, true, TOKEN_2022_PROGRAM_ID);
		expect(has(accept, buyerAta)).toBe(true);
		expect(has(accept, vaultAta)).toBe(true);
		expect(has(accept, TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(has(accept, TOKEN_PROGRAM_ID)).toBe(false);
	});

	it('keeps USDC on the classic program', async () => {
		const tx = await payPrep(USDC_MINT);
		const accept = tx.instructions.at(-1);
		expect(has(accept, getAssociatedTokenAddressSync(USDC_MINT, state.wallet, false, TOKEN_PROGRAM_ID))).toBe(true);
		expect(has(accept, TOKEN_PROGRAM_ID)).toBe(true);
	});

	it('resolves an arbitrary Token-2022 currency from its mint account owner', async () => {
		const mint = Keypair.generate().publicKey;
		state.mintOwners.set(mint.toBase58(), TOKEN_2022_PROGRAM_ID);
		const tx = await payPrep(mint);
		const accept = tx.instructions.at(-1);
		expect(has(accept, getAssociatedTokenAddressSync(mint, state.wallet, false, TOKEN_2022_PROGRAM_ID))).toBe(true);
		expect(has(accept, TOKEN_2022_PROGRAM_ID)).toBe(true);
	});

	it('answers 422 mint_not_found for a currency that is not a mint, before writing an intent', async () => {
		const { status, body } = await call('pay-prep', {
			body: {
				agent_id: 'agent-1',
				wallet_address: state.wallet.toBase58(),
				currency_mint: Keypair.generate().publicKey.toBase58(),
				amount: '1',
			},
		});
		expect(status).toBe(422);
		expect(body.error).toBe('mint_not_found');
		expect(state.inserts).toHaveLength(0);
	});
});

describe('balances', () => {
	it('reads the Token-2022 vault accounts for a $THREE currency', async () => {
		const { status } = await call('balances', {
			method: 'GET',
			query: { mint: state.agentMint.toBase58(), currency_mint: THREE_MINT.toBase58() },
		});
		expect(status).toBe(200);
		const [vaultOwner] = getTokenAgentPaymentsPDA(state.agentMint);
		const vault2022 = getAssociatedTokenAddressSync(THREE_MINT, vaultOwner, true, TOKEN_2022_PROGRAM_ID).toBase58();
		expect(state.balanceReads).toContain(vault2022);
		expect(state.balanceReads).toHaveLength(3);
	});
});

describe('distribute-prep', () => {
	it('builds a signable distribute on the Token-2022 program for $THREE', async () => {
		const { status, body } = await call('distribute-prep', {
			body: {
				mint: state.agentMint.toBase58(),
				currency_mint: THREE_MINT.toBase58(),
				wallet_address: state.wallet.toBase58(),
			},
		});
		expect(status).toBe(201);
		const tx = decode(body.tx_base64);
		const distribute = tx.instructions.at(-1);
		expect(has(distribute, TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(has(distribute, TOKEN_PROGRAM_ID)).toBe(false);
		expect(computeBudget(tx, SET_CU_LIMIT)).toHaveLength(1);
	});

	it('builds a USDC distribute on the classic program', async () => {
		const { status, body } = await call('distribute-prep', {
			body: {
				mint: state.agentMint.toBase58(),
				currency_mint: USDC_MINT.toBase58(),
				wallet_address: state.wallet.toBase58(),
			},
		});
		expect(status).toBe(201);
		expect(has(decode(body.tx_base64).instructions.at(-1), TOKEN_PROGRAM_ID)).toBe(true);
	});
});

describe('withdraw-prep', () => {
	it('withdraws $THREE into the owner Token-2022 account on the Token-2022 program', async () => {
		const { status, body } = await call('withdraw-prep', {
			body: {
				mint: state.agentMint.toBase58(),
				currency_mint: THREE_MINT.toBase58(),
				wallet_address: state.wallet.toBase58(),
			},
		});
		expect(status).toBe(201);
		const withdraw = decode(body.tx_base64).instructions.at(-1);
		const receiver = getAssociatedTokenAddressSync(THREE_MINT, state.wallet, false, TOKEN_2022_PROGRAM_ID);
		expect(has(withdraw, receiver)).toBe(true);
		expect(has(withdraw, TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(has(withdraw, TOKEN_PROGRAM_ID)).toBe(false);
	});

	it('opens the default receiver account in the same transaction, and leaves a supplied one alone', async () => {
		const prep = (extra = {}) =>
			call('withdraw-prep', {
				body: {
					mint: state.agentMint.toBase58(),
					currency_mint: THREE_MINT.toBase58(),
					wallet_address: state.wallet.toBase58(),
					...extra,
				},
			});
		const receiver = getAssociatedTokenAddressSync(THREE_MINT, state.wallet, false, TOKEN_2022_PROGRAM_ID);
		const opened = decode((await prep()).body.tx_base64).instructions;
		const create = opened.find((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
		expect(create.keys[1].pubkey.equals(receiver)).toBe(true);
		expect(create.keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);

		const supplied = Keypair.generate().publicKey;
		const given = decode((await prep({ receiver_ata: supplied.toBase58() })).body.tx_base64).instructions;
		expect(given.some((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID))).toBe(false);
		expect(has(given.at(-1), supplied)).toBe(true);
	});
});
