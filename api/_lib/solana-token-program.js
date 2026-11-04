// Which SPL token program owns a mint: classic Token or Token-2022.
//
// Every associated token account address is derived from the owning program, and
// every transfer instruction is addressed to it, so code that assumes the classic
// program builds a transaction that cannot execute against a Token-2022 mint: the
// derived source ATA does not exist and the instruction is sent to a program that
// does not own the mint. $THREE is a Token-2022 mint (pump.fun has minted under
// Token-2022 since its metadata-extension launch format), USDC is classic, and the
// x402 rail accepts both, so nothing on that rail may hardcode either program.
//
// A mint's owning program is fixed at creation and can never change, so the
// answer is cached for the life of the process and the two mints the platform
// settles are seeded, which keeps the hot path free of an RPC round-trip.
//
// The rule every payment builder follows: resolve the program with
// tokenProgramForMint, then derive every ATA with ataFor and pass the same
// program to every create and transfer instruction. Never call
// getAssociatedTokenAddressSync or createTransferCheckedInstruction without
// the program argument; their default is the classic program.

import { PublicKey } from '@solana/web3.js';
import {
	createAssociatedTokenAccountIdempotentInstruction,
	createTransferCheckedInstruction,
	getAssociatedTokenAddressSync,
	unpackAccount,
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { mintDecimals } from './solana/read-guards.js';

export const SUPPORTED_TOKEN_PROGRAMS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];

const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const programByMint = new Map([
	[USDC_MAINNET, TOKEN_PROGRAM_ID],
	[USDC_DEVNET, TOKEN_PROGRAM_ID],
	[THREE_MINT, TOKEN_2022_PROGRAM_ID],
]);

function mintKey(mint) {
	return typeof mint === 'string' ? mint : mint.toBase58();
}

export function isSupportedTokenProgram(programId) {
	return SUPPORTED_TOKEN_PROGRAMS.some((id) => id.equals(programId));
}

// Record a mint's owning program without an RPC read, for a caller that already
// knows it (it created the mint, or just read the account for another reason).
// Refuses an unsupported program so the map can never hold a wrong answer.
export function seedTokenProgramForMint(mint, programId) {
	const program = SUPPORTED_TOKEN_PROGRAMS.find((id) => id.equals(programId));
	if (!program) throw new Error(`not a token program: ${programId}`);
	programByMint.set(mintKey(mint), program);
	return program;
}

// Sync lookup for callers that cannot await (static transaction validators).
// Returns null when the mint has not been seeded or resolved yet.
export function knownTokenProgramForMint(mint) {
	return programByMint.get(mintKey(mint)) || null;
}

// Authoritative lookup: reads the mint account's owner once, then serves the
// cache. Throws when the account is missing or owned by anything other than a
// token program, because a caller that proceeds on a guess derives wrong ATAs.
export async function tokenProgramForMint(connection, mint) {
	const key = mintKey(mint);
	const cached = programByMint.get(key);
	if (cached) return cached;
	const info = await connection.getAccountInfo(new PublicKey(key), 'confirmed');
	if (!info) {
		const err = new Error(`mint account not found: ${key}`);
		err.code = 'mint_not_found';
		throw err;
	}
	const program = SUPPORTED_TOKEN_PROGRAMS.find((id) => id.equals(info.owner));
	if (!program) {
		const err = new Error(`mint ${key} is owned by ${info.owner.toBase58()}, not a token program`);
		err.code = 'mint_not_token';
		throw err;
	}
	programByMint.set(key, program);
	return program;
}

// Associated token account for `owner` under the mint's owning program. The
// program is required: there is no default, because the default is what broke
// every $THREE builder. allowOwnerOffCurve is for PDA owners (escrows, vaults).
export function ataFor(mint, owner, tokenProgram, { allowOwnerOffCurve = false } = {}) {
	if (typeof tokenProgram?.toBase58 !== 'function' || !isSupportedTokenProgram(tokenProgram)) {
		throw new Error(`ataFor needs the mint's token program, got: ${tokenProgram}`);
	}
	const mintPk = typeof mint === 'string' ? new PublicKey(mint) : mint;
	const ownerPk = typeof owner === 'string' ? new PublicKey(owner) : owner;
	return getAssociatedTokenAddressSync(mintPk, ownerPk, allowOwnerOffCurve, tokenProgram);
}

function toKey(value) {
	return typeof value === 'string' ? new PublicKey(value) : value;
}

// transferChecked addressed to the mint's own program. `references` ride as
// read-only keys at the end, which is where @solana/pay looks for them.
export function tokenTransfer({ source, mint, destination, authority, atomics, decimals, tokenProgram, references = [] }) {
	if (!isSupportedTokenProgram(tokenProgram)) {
		throw new Error(`tokenTransfer needs the mint's token program, got: ${tokenProgram}`);
	}
	const ix = createTransferCheckedInstruction(
		toKey(source),
		toKey(mint),
		toKey(destination),
		toKey(authority),
		BigInt(atomics),
		Number(decimals),
		[],
		tokenProgram,
	);
	for (const ref of references) ix.keys.push({ pubkey: toKey(ref), isSigner: false, isWritable: false });
	return ix;
}

// Idempotent create instructions for every owner whose ATA does not exist yet,
// funded by `payer`. A seller or treasury that has never held the mint has no
// token account, and a transfer into a missing account fails the whole payment.
// One batched read decides which are missing; when the node cannot answer, every
// create is included instead, because an idempotent create on an existing
// account is a no-op and a missing one is the failure we are preventing.
export async function createMissingAtas(connection, { payer, mint, tokenProgram, owners }) {
	const mintPk = toKey(mint);
	const seen = new Set();
	const targets = [];
	for (const owner of owners) {
		if (!owner) continue;
		const ownerPk = toKey(owner);
		const ata = ataFor(mintPk, ownerPk, tokenProgram, { allowOwnerOffCurve: true });
		if (seen.has(ata.toBase58())) continue;
		seen.add(ata.toBase58());
		targets.push({ owner: ownerPk, ata });
	}
	if (!targets.length) return [];
	let infos = null;
	try {
		infos = await connection.getMultipleAccountsInfo(targets.map((t) => t.ata), 'confirmed');
	} catch {
		infos = null;
	}
	return targets
		.filter((_, i) => !Array.isArray(infos) || !infos[i])
		.map((t) =>
			createAssociatedTokenAccountIdempotentInstruction(toKey(payer), t.ata, t.owner, mintPk, tokenProgram),
		);
}

// The whole SPL leg of a custodial transfer (escrow funding, release, refund,
// reclaim): resolve the mint's program and decimals, open the destination ATA
// when it is missing (payer funds the rent), then one TransferChecked from the
// sender's ATA. `authority` is the owner signing for the source, `from` by
// default. Callers that already hold the program or decimals pass them to skip
// the reads; the platform's own mints never touch the network.
export async function splTransferInstructions(
	connection,
	{ mint, from, to, payer, atomics, authority = from, tokenProgram = null, decimals = null },
) {
	const mintPk = toKey(mint);
	const program = tokenProgram || (await tokenProgramForMint(connection, mintPk));
	const dec = decimals ?? (await mintDecimals(connection, mintPk, { programId: program }));
	const creates = await createMissingAtas(connection, { payer, mint: mintPk, tokenProgram: program, owners: [to] });
	const transfer = tokenTransfer({
		source: ataFor(mintPk, from, program, { allowOwnerOffCurve: true }),
		mint: mintPk,
		destination: ataFor(mintPk, to, program, { allowOwnerOffCurve: true }),
		authority,
		atomics,
		decimals: dec,
		tokenProgram: program,
	});
	return [...creates, transfer];
}

// Raw balance of `owner`'s associated token account for `mint`, under the
// mint's own program. A wallet that never held the mint has no account and reads
// 0n. Anything else that goes wrong (the node is unreachable, the address holds
// a non-token account) throws, because a sweep that read "empty" off an RPC blip
// would record the drop as settled and strand what is still in it.
export async function tokenBalanceAtomics(connection, { mint, owner, tokenProgram = null }) {
	const mintPk = toKey(mint);
	const program = tokenProgram || (await tokenProgramForMint(connection, mintPk));
	const ata = ataFor(mintPk, owner, program, { allowOwnerOffCurve: true });
	const info = await connection.getAccountInfo(ata, 'confirmed');
	if (!info) return 0n;
	return unpackAccount(ata, info, program).amount;
}
