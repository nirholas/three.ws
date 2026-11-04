// Token-program registry for the facilitator. The program that owns a mint decides
// every associated-token-account address, so it is pinned from the mint and never
// read off the buyer's instruction. Mints the operator settles are seeded; anything
// else is resolved once from the mint account's owner and cached.

import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

export const SUPPORTED_TOKEN_PROGRAMS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];

export const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

export function isSupportedTokenProgram(programId) {
	return SUPPORTED_TOKEN_PROGRAMS.some((id) => id.equals(programId));
}

const keyOf = (mint) => (typeof mint === 'string' ? mint : mint.toBase58());

/**
 * @param {Array<[string, PublicKey]>} [seed] mint to owning-program pairs
 */
export function defaultTokenPrograms(seed = [
	[USDC_MAINNET, TOKEN_PROGRAM_ID],
	[USDC_DEVNET, TOKEN_PROGRAM_ID],
	[THREE_MINT, TOKEN_2022_PROGRAM_ID],
]) {
	const byMint = new Map(seed.map(([m, p]) => [keyOf(m), p]));
	return {
		/** Sync lookup. Null when the mint is neither seeded nor resolved yet. */
		known(mint) {
			return byMint.get(keyOf(mint)) || null;
		},
		/** Authoritative lookup: reads the mint account owner once, then serves the cache. */
		async resolve(connection, mint) {
			const key = keyOf(mint);
			const cached = byMint.get(key);
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
			byMint.set(key, program);
			return program;
		},
	};
}
