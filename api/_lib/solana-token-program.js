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

import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

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
