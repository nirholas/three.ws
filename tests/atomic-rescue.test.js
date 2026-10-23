import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
	buildRescueTransactions,
	MAX_BUNDLE_TXS,
	MAX_TX_BYTES,
} from '../packages/avatar-agent-mcp/src/lib/atomic-rescue.js';
import { JITO_TIP_ACCOUNTS } from '../packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js';

// Bundle construction only: nothing here signs or sends. Wallets are synthetic
// keypairs generated per run; the one real mint used is $THREE.
const THREE_MINT = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
const BLOCKHASH = '11111111111111111111111111111111';

const compromised = Keypair.generate().publicKey;
const destination = Keypair.generate().publicKey;
const feePayer = Keypair.generate().publicKey;
const tipAccount = new PublicKey(JITO_TIP_ACCOUNTS[0]);

function tokenAccount(overrides = {}) {
	return {
		address: Keypair.generate().publicKey,
		mint: THREE_MINT,
		programId: TOKEN_PROGRAM_ID,
		amount: 1_500_000n,
		decimals: 6,
		state: 'initialized',
		...overrides,
	};
}

function build(tokenAccounts, extra = {}) {
	return buildRescueTransactions({
		compromised,
		destination,
		feePayer,
		solLamports: 250_000,
		tokenAccounts,
		blockhash: BLOCKHASH,
		tipAccount,
		tipSol: 0.001,
		...extra,
	});
}

/** Decode a tx into { program, keys, data } per instruction. */
function decode(tx) {
	const keys = tx.message.staticAccountKeys;
	return tx.message.compiledInstructions.map((ix) => ({
		program: keys[ix.programIdIndex],
		accounts: ix.accountKeyIndexes.map((i) => keys[i]),
		data: Buffer.from(ix.data),
	}));
}

const SYSTEM = SystemProgram.programId;
const isTransfer = (ix) => ix.program.equals(SYSTEM) && ix.data.readUInt32LE(0) === 2;
const lamportsOf = (ix) => Number(ix.data.readBigUInt64LE(4));

describe('buildRescueTransactions', () => {
	it('moves a token account in one tx: create ATA, transferChecked, close', () => {
		const account = tokenAccount();
		const { transactions, summary } = build([account]);
		expect(transactions).toHaveLength(1);
		const ixs = decode(transactions[0]);
		const programs = ixs.map((ix) => ix.program.toBase58());
		expect(programs).toEqual([
			ComputeBudgetProgram.programId.toBase58(),
			ComputeBudgetProgram.programId.toBase58(),
			ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
			TOKEN_PROGRAM_ID.toBase58(),
			TOKEN_PROGRAM_ID.toBase58(),
			SYSTEM.toBase58(),
			SYSTEM.toBase58(),
		]);
		// transferChecked (12) then closeAccount (9), both authorised by the compromised wallet.
		const [transfer, close] = [ixs[3], ixs[4]];
		expect(transfer.data[0]).toBe(12);
		expect(transfer.data.readBigUInt64LE(1)).toBe(account.amount);
		expect(transfer.accounts[0].equals(account.address)).toBe(true);
		expect(transfer.accounts[3].equals(compromised)).toBe(true);
		expect(close.data[0]).toBe(9);
		// The closed account's rent goes to the destination, never back to the compromised wallet.
		expect(close.accounts[1].equals(destination)).toBe(true);
		expect(summary.requiredSigners).toEqual([compromised.toBase58(), feePayer.toBase58()]);
	});

	it('pays fees, ATA rent and the tip from the fee payer, never the compromised wallet', () => {
		const { transactions } = build([tokenAccount()]);
		const tx = transactions[0];
		expect(tx.message.staticAccountKeys[0].equals(feePayer)).toBe(true);
		const ixs = decode(tx);
		const ataCreate = ixs.find((ix) => ix.program.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
		expect(ataCreate.accounts[0].equals(feePayer)).toBe(true);
		const tip = ixs.filter(isTransfer).find((ix) => ix.accounts[1].equals(tipAccount));
		expect(tip.accounts[0].equals(feePayer)).toBe(true);
		expect(lamportsOf(tip)).toBe(1_000_000);
	});

	it('returns the compromised wallet SOL to the destination in the last tx', () => {
		const { transactions, summary } = build([tokenAccount(), tokenAccount({ mint: Keypair.generate().publicKey })]);
		const last = decode(transactions.at(-1)).filter(isTransfer);
		const ret = last.find((ix) => ix.accounts[0].equals(compromised));
		expect(ret.accounts[1].equals(destination)).toBe(true);
		expect(lamportsOf(ret)).toBe(250_000);
		expect(summary.solReturnLamports).toBe(250_000);
	});

	it('leaves the SOL alone when asked, and still tips', () => {
		const { transactions, summary } = build([tokenAccount()], { returnSol: false });
		const transfers = transactions.flatMap((t) => decode(t)).filter(isTransfer);
		expect(transfers.some((ix) => ix.accounts[0].equals(compromised))).toBe(false);
		expect(transfers.some((ix) => ix.accounts[1].equals(tipAccount))).toBe(true);
		expect(summary.solReturnLamports).toBe(0);
	});

	it('closes an empty token account without a transfer or ATA creation', () => {
		const { transactions } = build([tokenAccount({ amount: 0n })]);
		const programs = decode(transactions[0]).map((ix) => ix.program.toBase58());
		expect(programs).not.toContain(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
		expect(decode(transactions[0]).some((ix) => ix.program.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 9)).toBe(true);
	});

	it('uses the Token-2022 program for Token-2022 accounts', () => {
		const { transactions } = build([tokenAccount({ programId: TOKEN_2022_PROGRAM_ID })]);
		const ixs = decode(transactions[0]);
		expect(ixs.some((ix) => ix.program.equals(TOKEN_2022_PROGRAM_ID) && ix.data[0] === 12)).toBe(true);
		expect(ixs.some((ix) => ix.program.equals(TOKEN_PROGRAM_ID))).toBe(false);
	});

	it('skips frozen accounts and reports them', () => {
		const frozen = tokenAccount({ state: 'frozen' });
		const { summary } = build([frozen, tokenAccount()]);
		expect(summary.skipped).toEqual([
			{ address: frozen.address.toBase58(), mint: THREE_MINT.toBase58(), reason: 'frozen' },
		]);
		expect(summary.tokenAccounts.flat()).toHaveLength(1);
	});

	it('still builds the SOL return and tip when there are no token accounts', () => {
		const { transactions } = build([]);
		expect(transactions).toHaveLength(1);
		const transfers = decode(transactions[0]).filter(isTransfer);
		expect(transfers).toHaveLength(2);
	});

	it('splits many accounts across transactions that each fit the size limit', () => {
		const accounts = Array.from({ length: 18 }, () => tokenAccount({ mint: Keypair.generate().publicKey }));
		const { transactions, summary } = build(accounts);
		expect(transactions.length).toBeGreaterThan(1);
		expect(transactions.length).toBeLessThanOrEqual(MAX_BUNDLE_TXS);
		for (const tx of transactions) expect(tx.serialize().length).toBeLessThanOrEqual(MAX_TX_BYTES);
		expect(summary.tokenAccounts.flat().length + summary.remaining).toBe(18);
		// Exactly one tx carries the tip.
		const tips = transactions.flatMap((t) => decode(t)).filter((ix) => isTransfer(ix) && ix.accounts[1].equals(tipAccount));
		expect(tips).toHaveLength(1);
	});

	it('defers what cannot fit in five transactions and counts it as remaining', () => {
		const accounts = Array.from({ length: 80 }, () => tokenAccount({ mint: Keypair.generate().publicKey }));
		const { transactions, summary } = build(accounts);
		expect(transactions.length).toBeLessThanOrEqual(MAX_BUNDLE_TXS);
		for (const tx of transactions) expect(tx.serialize().length).toBeLessThanOrEqual(MAX_TX_BYTES);
		expect(summary.remaining).toBeGreaterThan(0);
		expect(summary.tokenAccounts.flat().length + summary.remaining).toBe(80);
	});

	it('refuses a fee payer that is the compromised wallet', () => {
		expect(() => build([tokenAccount()], { feePayer: compromised })).toThrow(/different, safe wallet/);
	});

	it('refuses a destination that is the compromised wallet', () => {
		expect(() => build([tokenAccount()], { destination: compromised })).toThrow(/destination must differ/);
	});

	it('clamps an oversized tip to the spend-policy ceiling', () => {
		const { summary } = build([tokenAccount()], { tipSol: 50 });
		expect(summary.tipLamports).toBeLessThanOrEqual(20_000_000);
	});
});
