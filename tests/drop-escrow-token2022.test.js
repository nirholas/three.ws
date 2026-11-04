// Drops funded in $THREE must move on the mint's own token program.
//
// $THREE (FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump) is a Token-2022 mint. The
// sealed-drop funding, balance read and reclaim sweep, and the IRL escrow fund,
// release and refund, all derived ATAs and a plain Transfer on the classic SPL
// Token program. For a $THREE drop that meant: funding failed on-chain, the
// claim page read the balance as 0, and the reclaim sweep found no classic
// account, recorded the drop as reclaimed with reclaimTx 'empty', and left the
// sender's $THREE stranded in the drop wallet for good. The same catch-all also
// turned an RPC blip into that permanent 'empty'.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
	ACCOUNT_SIZE,
	AccountLayout,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	TokenInstruction,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';

const THREE = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const fundingKp = Keypair.generate();

const chain = vi.hoisted(() => ({ accounts: new Map(), down: false, sent: [], reclaims: [] }));

function tokenAccount(mint, owner, amount, program) {
	const data = Buffer.alloc(ACCOUNT_SIZE);
	AccountLayout.encode(
		{
			mint,
			owner,
			amount,
			delegateOption: 0,
			delegate: PublicKey.default,
			state: 1,
			isNativeOption: 0,
			isNative: 0n,
			delegatedAmount: 0n,
			closeAuthorityOption: 0,
			closeAuthority: PublicKey.default,
		},
		data,
	);
	return { data, owner: program, lamports: 2_039_280, executable: false };
}

function fakeConnection() {
	const read = (k) => {
		if (chain.down) throw new TypeError('fetch failed');
		return chain.accounts.get(k.toBase58()) || null;
	};
	return {
		getAccountInfo: async (k) => read(k),
		getMultipleAccountsInfo: async (keys) => keys.map(read),
	};
}

vi.mock('../api/_lib/env.js', () => ({
	env: {
		THREE_TOKEN_MINT: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
		THREE_TOKEN_DECIMALS: 6,
		get VANITY_DROP_FUNDING_KEY() {
			return bs58.encode(fundingKp.secretKey);
		},
	},
}));
vi.mock('../api/_lib/agent-pumpfun.js', () => ({ solanaConnection: () => fakeConnection() }));
vi.mock('../api/_lib/execution-engine.js', () => ({
	submitProtected: async ({ instructions }) => {
		chain.sent.push(instructions);
		return { signature: `sig${chain.sent.length}` };
	},
}));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn() }));
vi.mock('../api/_lib/secret-box.js', () => ({ decryptSecret: async (enc) => enc }));
vi.mock('../api/_lib/agent-wallet.js', () => ({ generateSolanaAgentWallet: vi.fn() }));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({ recordCustodyEvent: vi.fn(), updateCustodyEvent: vi.fn() }));
vi.mock('../api/_lib/sealed-drop-store.js', () => ({
	recordReclaim: async (row) => {
		chain.reclaims.push(row);
	},
}));

const { splTransferInstructions, tokenBalanceAtomics } = await import('../api/_lib/solana-token-program.js');
const { fundDropAddress, readDropBalance, sweepReclaim } = await import('../api/_lib/sealed-drop-funding.js');
const { releaseFromEscrow, sweepRefund } = await import('../api/_lib/irl-drops.js');

function irlDrop(escrowKp, extra = {}) {
	return {
		asset: 'THREE',
		network: 'mainnet',
		escrow_address: escrowKp.publicKey.toBase58(),
		escrow_secret_enc: Buffer.from(escrowKp.secretKey).toString('base64'),
		...extra,
	};
}

const ata2022 = (owner) => getAssociatedTokenAddressSync(THREE, owner, true, TOKEN_2022_PROGRAM_ID);

beforeEach(() => {
	chain.accounts.clear();
	chain.down = false;
	chain.sent = [];
	chain.reclaims = [];
});

describe('splTransferInstructions', () => {
	it('opens the missing Token-2022 ATA and sends a TransferChecked on Token-2022', async () => {
		const from = Keypair.generate().publicKey;
		const to = Keypair.generate().publicKey;
		const payer = Keypair.generate().publicKey;
		const [create, transfer] = await splTransferInstructions(fakeConnection(), { mint: THREE, from, to, payer, atomics: 7_000_000n });
		expect(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
		expect(create.keys[0].pubkey.equals(payer)).toBe(true);
		expect(create.keys[1].pubkey.equals(ata2022(to))).toBe(true);
		expect(create.keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.data[0]).toBe(TokenInstruction.TransferChecked);
		expect(transfer.keys[0].pubkey.equals(ata2022(from))).toBe(true);
		expect(transfer.keys[2].pubkey.equals(ata2022(to))).toBe(true);
		expect(transfer.keys[3].pubkey.equals(from)).toBe(true);
		expect(transfer.data.readBigUInt64LE(1)).toBe(7_000_000n);
		expect(transfer.data[9]).toBe(6);
	});

	it('signs with a separate authority and skips the create when the ATA exists', async () => {
		const from = Keypair.generate().publicKey;
		const to = Keypair.generate().publicKey;
		const authority = Keypair.generate().publicKey;
		chain.accounts.set(ata2022(to).toBase58(), tokenAccount(THREE, to, 0n, TOKEN_2022_PROGRAM_ID));
		const ixs = await splTransferInstructions(fakeConnection(), { mint: THREE, from, to, payer: authority, authority, atomics: 1n });
		expect(ixs).toHaveLength(1);
		expect(ixs[0].keys[3].pubkey.equals(authority)).toBe(true);
	});

	it('keeps USDC on the classic program', async () => {
		const from = Keypair.generate().publicKey;
		const to = Keypair.generate().publicKey;
		const ixs = await splTransferInstructions(fakeConnection(), { mint: USDC, from, to, payer: from, atomics: 1n });
		expect(ixs.at(-1).programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
		expect(ixs[0].keys[5].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
	});
});

describe('tokenBalanceAtomics', () => {
	it("reads the balance from the owner's Token-2022 account", async () => {
		const owner = Keypair.generate().publicKey;
		chain.accounts.set(ata2022(owner).toBase58(), tokenAccount(THREE, owner, 42_000_000n, TOKEN_2022_PROGRAM_ID));
		expect(await tokenBalanceAtomics(fakeConnection(), { mint: THREE, owner })).toBe(42_000_000n);
	});

	it('reads 0 for a wallet with no account and throws when the node is down', async () => {
		const owner = Keypair.generate().publicKey;
		expect(await tokenBalanceAtomics(fakeConnection(), { mint: THREE, owner })).toBe(0n);
		chain.down = true;
		await expect(tokenBalanceAtomics(fakeConnection(), { mint: THREE, owner })).rejects.toThrow(/fetch failed/);
	});
});

describe('sealed $THREE drops', () => {
	it('funds the drop wallet on Token-2022', async () => {
		const drop = Keypair.generate().publicKey;
		await fundDropAddress({ toAddress: drop.toBase58(), asset: 'THREE', atomics: 3_000_000n });
		const transfer = chain.sent[0].at(-1);
		expect(transfer.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.keys[0].pubkey.equals(ata2022(fundingKp.publicKey))).toBe(true);
		expect(transfer.keys[2].pubkey.equals(ata2022(drop))).toBe(true);
	});

	it('reads the funded balance a claimer sees from the Token-2022 account', async () => {
		const drop = Keypair.generate().publicKey;
		chain.accounts.set(ata2022(drop).toBase58(), tokenAccount(THREE, drop, 3_000_000n, TOKEN_2022_PROGRAM_ID));
		expect(await readDropBalance({ address: drop.toBase58(), asset: 'THREE' })).toEqual({ atomics: '3000000' });
	});

	it('sweeps the whole $THREE balance back instead of recording an empty reclaim', async () => {
		const dropKp = Keypair.generate();
		const sender = Keypair.generate().publicKey;
		chain.accounts.set(ata2022(dropKp.publicKey).toBase58(), tokenAccount(THREE, dropKp.publicKey, 3_000_000n, TOKEN_2022_PROGRAM_ID));
		const out = await sweepReclaim({
			record: { id: 'd1', status: 'reclaimed', asset: 'THREE' },
			dropSecretKey: dropKp.secretKey,
			toAddress: sender.toBase58(),
		});
		expect(out.reclaimTx).toBe('sig1');
		expect(chain.reclaims).toEqual([{ id: 'd1', reclaimTx: 'sig1' }]);
		const transfer = chain.sent[0].at(-1);
		expect(transfer.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.keys[0].pubkey.equals(ata2022(dropKp.publicKey))).toBe(true);
		expect(transfer.keys[2].pubkey.equals(ata2022(sender))).toBe(true);
		expect(transfer.keys[3].pubkey.equals(dropKp.publicKey)).toBe(true);
		expect(transfer.data.readBigUInt64LE(1)).toBe(3_000_000n);
	});

	it('does not record an empty reclaim when the chain cannot be read', async () => {
		chain.down = true;
		const dropKp = Keypair.generate();
		await expect(
			sweepReclaim({
				record: { id: 'd2', status: 'reclaimed', asset: 'THREE' },
				dropSecretKey: dropKp.secretKey,
				toAddress: Keypair.generate().publicKey.toBase58(),
			}),
		).rejects.toThrow();
		expect(chain.reclaims).toEqual([]);
	});
});

describe('IRL $THREE escrows', () => {
	it('releases a claim from the Token-2022 escrow account, co-signed by the escrow', async () => {
		const escrowKp = Keypair.generate();
		const claimer = Keypair.generate().publicKey;
		await releaseFromEscrow({ drop: irlDrop(escrowKp), toAddress: claimer.toBase58(), atomics: '1250000' });
		const [create, transfer] = chain.sent[0];
		expect(create.keys[0].pubkey.equals(fundingKp.publicKey)).toBe(true);
		expect(create.keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.keys[0].pubkey.equals(ata2022(escrowKp.publicKey))).toBe(true);
		expect(transfer.keys[2].pubkey.equals(ata2022(claimer))).toBe(true);
		expect(transfer.keys[3].pubkey.equals(escrowKp.publicKey)).toBe(true);
		expect(transfer.data.readBigUInt64LE(1)).toBe(1_250_000n);
	});

	it('refunds the whole $THREE escrow balance instead of reporting it empty', async () => {
		const escrowKp = Keypair.generate();
		const creator = Keypair.generate().publicKey;
		chain.accounts.set(ata2022(escrowKp.publicKey).toBase58(), tokenAccount(THREE, escrowKp.publicKey, 9_000_000n, TOKEN_2022_PROGRAM_ID));
		const sig = await sweepRefund({ drop: irlDrop(escrowKp, { refund_address: creator.toBase58() }) });
		expect(sig).toBe('sig1');
		const transfer = chain.sent[0].at(-1);
		expect(transfer.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.keys[2].pubkey.equals(ata2022(creator))).toBe(true);
		expect(transfer.data.readBigUInt64LE(1)).toBe(9_000_000n);
	});

	it('leaves the refund pending when the escrow balance cannot be read', async () => {
		chain.down = true;
		const escrowKp = Keypair.generate();
		const drop = irlDrop(escrowKp, { refund_address: Keypair.generate().publicKey.toBase58() });
		await expect(sweepRefund({ drop })).rejects.toThrow();
		expect(chain.sent).toEqual([]);
	});
});
