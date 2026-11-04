// The browser agent-payments skills must build against the SDK they import and
// the token program of the currency they move.
//
// $THREE (FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump) is a Token-2022 mint, and
// @three-ws/agent-payments defaults every vault and payer ATA to the classic
// program unless a tokenProgram is passed. The skills also drifted from the SDK:
// PumpAgent was constructed as (mint, connection) when the signature is
// (mint, environment, connection), so the online reads ran without a connection;
// distributePayments returns an instruction array that was nested in another
// array; and accept-v2 called a method the exported PumpAgentOffline does not
// have, passing the wallet itself as its token account.
//
// The connection here is a stub that answers only the reads the SDK makes (mint
// account, token balances, GlobalConfig, blockhash) and records what is sent, so
// every transaction is decoded and inspected without touching a cluster.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Keypair, PublicKey, TransactionMessage } from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	MintLayout,
	MINT_SIZE,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import BN from 'bn.js';
import { getGlobalConfigPDA, getPumpProgram, getTokenAgentPaymentsPDA } from '@three-ws/agent-payments';

const THREE_MINT = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
const AGENT_MINT = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;

const state = { sent: [], balanceReads: [], tokenBalances: new Map(), globalConfig: null };

function mintData(decimals) {
	const data = Buffer.alloc(MINT_SIZE);
	MintLayout.encode(
		{
			mintAuthorityOption: 0,
			mintAuthority: PublicKey.default,
			supply: 0n,
			decimals,
			isInitialized: true,
			freezeAuthorityOption: 0,
			freezeAuthority: PublicKey.default,
		},
		data,
	);
	return data;
}

class StubConnection {
	constructor(url) {
		this.rpcEndpoint = url;
		this.commitment = 'confirmed';
	}
	async getAccountInfo(key) {
		if (key.equals(THREE_MINT)) {
			return { owner: TOKEN_2022_PROGRAM_ID, data: mintData(6), lamports: 1, executable: false };
		}
		if (state.globalConfig && key.equals(getGlobalConfigPDA()[0])) return state.globalConfig;
		return null;
	}
	async getAccountInfoAndContext(key) {
		return { context: { slot: 1 }, value: await this.getAccountInfo(key) };
	}
	async getMultipleAccountsInfo(keys) {
		return Promise.all(keys.map((k) => this.getAccountInfo(k)));
	}
	async getTokenAccountBalance(ata) {
		state.balanceReads.push(ata.toBase58());
		const amount = state.tokenBalances.get(ata.toBase58());
		if (amount == null) throw new Error('could not find account');
		return { value: { amount: String(amount), decimals: 6 } };
	}
	async getLatestBlockhash() {
		return { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1 };
	}
	async sendRawTransaction() {
		return 'sig'.padEnd(64, '1');
	}
	async confirmTransaction() {
		return { value: { err: null } };
	}
}

globalThis.__agentPaymentsStubConnection = StubConnection;

vi.mock('@solana/web3.js', async (importOriginal) => {
	const actual = await importOriginal();
	// Resolved at construction time: the factory is hoisted above the class.
	return {
		...actual,
		Connection: function Connection(...args) {
			return new globalThis.__agentPaymentsStubConnection(...args);
		},
	};
});

vi.mock('../src/erc8004/solana-deploy.js', () => ({
	SOLANA_RPC: { mainnet: 'https://stub.invalid/mainnet', devnet: 'https://stub.invalid/devnet' },
	detectSolanaWallet: () => ({
		isConnected: true,
		publicKey: owner,
		async signTransaction(tx) {
			state.sent.push(TransactionMessage.decompile(tx.message).instructions);
			return { serialize: () => new Uint8Array(0) };
		},
	}),
}));

const { registerAgentPaymentSkills } = await import('../src/agent-skills-agent-payments.js');

const registry = new Map();
registerAgentPaymentSkills({ register: (skill) => registry.set(skill.name, skill) });
const run = (name, args) => registry.get(name).handler(args, {});

const has = (ix, key) => ix.keys.some((k) => k.pubkey.equals(key));
const lastSent = () => state.sent.at(-1);

beforeEach(() => {
	state.sent = [];
	state.balanceReads = [];
	state.tokenBalances = new Map();
	state.globalConfig = null;
});

describe('agent-payments-balances', () => {
	it('reads the Token-2022 vaults of a $THREE agent and formats with the mint decimals', async () => {
		const [paymentsPda] = getTokenAgentPaymentsPDA(AGENT_MINT);
		const paymentAta = getAssociatedTokenAddressSync(THREE_MINT, paymentsPda, true, TOKEN_2022_PROGRAM_ID);
		state.tokenBalances.set(paymentAta.toBase58(), 2_500_000n);

		const out = await run('agent-payments-balances', {
			agentMint: AGENT_MINT.toBase58(),
			currencyMint: THREE_MINT.toBase58(),
		});

		expect(out.success).toBe(true);
		expect(state.balanceReads).toHaveLength(3);
		expect(state.balanceReads).toContain(paymentAta.toBase58());
		expect(out.data.paymentVault).toBe(paymentAta.toBase58());
		expect(out.data.paymentBalance).toBe('2500000');
		expect(out.output).toContain('Payment: 2.500000');
	});
});

describe('agent-payments-distribute', () => {
	it('sends every distribute instruction on the Token-2022 program for $THREE', async () => {
		const out = await run('agent-payments-distribute', {
			agentMint: AGENT_MINT.toBase58(),
			currencyMint: THREE_MINT.toBase58(),
		});
		expect(out.success).toBe(true);
		const ixs = lastSent();
		expect(ixs.length).toBeGreaterThan(0);
		const distribute = ixs.at(-1);
		expect(has(distribute, TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(has(distribute, TOKEN_PROGRAM_ID)).toBe(false);
	});
});

describe('agent-payments-withdraw', () => {
	it('defaults the receiver to the owner Token-2022 ATA and opens it first', async () => {
		const receiver = getAssociatedTokenAddressSync(THREE_MINT, owner, false, TOKEN_2022_PROGRAM_ID);
		const out = await run('agent-payments-withdraw', {
			agentMint: AGENT_MINT.toBase58(),
			currencyMint: THREE_MINT.toBase58(),
		});
		expect(out.success).toBe(true);
		const [create, withdraw] = lastSent();
		expect(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
		expect(create.keys[1].pubkey.equals(receiver)).toBe(true);
		expect(create.keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(has(withdraw, receiver)).toBe(true);
		expect(has(withdraw, TOKEN_2022_PROGRAM_ID)).toBe(true);
	});
});

describe('agent-payments-accept-v2', () => {
	it('pays a $THREE invoice from the payer Token-2022 ATA', async () => {
		const payerAta = getAssociatedTokenAddressSync(THREE_MINT, owner, false, TOKEN_2022_PROGRAM_ID);
		const out = await run('agent-payments-accept-v2', {
			agentMint: AGENT_MINT.toBase58(),
			currencyMint: THREE_MINT.toBase58(),
			amount: '1000000',
			memo: '42',
		});
		expect(out.success).toBe(true);
		const accept = lastSent().at(-1);
		expect(has(accept, payerAta)).toBe(true);
		expect(has(accept, TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(accept.keys.some((k) => k.pubkey.equals(owner) && k.isSigner)).toBe(true);
	});
});

describe('agent-payments-update-buyback', () => {
	it('reads GlobalConfig over the connection and sends the update', async () => {
		const program = getPumpProgram(new StubConnection('x'));
		const supported = Array.from({ length: 10 }, () => PublicKey.default);
		supported[0] = THREE_MINT;
		const data = await program.coder.accounts.encode('globalConfig', {
			bump: 255,
			protocolAuthority: Keypair.generate().publicKey,
			buybackAuthority: Keypair.generate().publicKey,
			supportedCurrenciesMint: supported,
			tokenizedAgentSequence: new BN(0),
		});
		state.globalConfig = { owner: program.programId, data, lamports: 1, executable: false };

		const out = await run('agent-payments-update-buyback', { agentMint: AGENT_MINT.toBase58(), buybackBps: 2500 });
		expect(out.success).toBe(true);
		const update = lastSent().at(-1);
		expect(update.programId.equals(program.programId)).toBe(true);
		// The $THREE payment vault rides as a remaining account, derived on Token-2022.
		const vault = getAssociatedTokenAddressSync(THREE_MINT, getTokenAgentPaymentsPDA(AGENT_MINT)[0], true, TOKEN_2022_PROGRAM_ID);
		expect(has(update, vault)).toBe(true);
	});
});
