// Chain reads and UNSIGNED transaction building for staked Event Markets.
// The server never holds a staker's key and never signs on their behalf: every
// builder returns a base64 transaction with the staker as fee payer and no
// signatures, for the user's own wallet to review and sign.

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
	TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAccount, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { build, decodePool, decodePosition, poolPda, positionPda, programId, vaultFor, decodeConfig, configPda } from './program.js';
import { stakingConfig } from './config.js';

let conn;
export function connection() {
	if (!conn) conn = new Connection(stakingConfig().rpcUrl, 'confirmed');
	return conn;
}

const tokenProgramCache = new Map();
/** Classic SPL or Token-2022, read from the mint account's owner. */
export async function tokenProgramFor(mint) {
	if (!tokenProgramCache.has(mint)) {
		const info = await connection().getAccountInfo(new PublicKey(mint));
		if (!info) throw new Error('stake mint not found on this cluster');
		tokenProgramCache.set(mint, info.owner);
	}
	return tokenProgramCache.get(mint);
}

export const poolIdBytes = (hex) => Buffer.from(hex, 'hex');

export async function readPool(poolIdHex) {
	const info = await connection().getAccountInfo(poolPda(programId(), poolIdBytes(poolIdHex)));
	return info ? decodePool(info.data) : null;
}

export async function readConfig() {
	const info = await connection().getAccountInfo(configPda(programId()));
	return info ? decodeConfig(info.data) : null;
}

export async function readPosition(poolIdHex, owner) {
	const program = programId();
	const info = await connection().getAccountInfo(positionPda(program, poolPda(program, poolIdBytes(poolIdHex)), new PublicKey(owner)));
	return info ? decodePosition(info.data) : null;
}

export async function vaultBalance(poolIdHex, mint) {
	const program = programId();
	const vault = vaultFor(poolPda(program, poolIdBytes(poolIdHex)), mint, await tokenProgramFor(mint));
	try {
		return (await getAccount(connection(), vault, 'confirmed', await tokenProgramFor(mint))).amount;
	} catch {
		return 0n;
	}
}

async function unsigned(feePayer, instructions) {
	const { blockhash, lastValidBlockHeight } = await connection().getLatestBlockhash('confirmed');
	const tx = new Transaction({ feePayer: new PublicKey(feePayer), blockhash, lastValidBlockHeight }).add(...instructions);
	return {
		transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
		last_valid_block_height: lastValidBlockHeight,
	};
}

export async function buildStakeTx(pool, { wallet, outcome, amount }) {
	const tokenProgram = await tokenProgramFor(pool.mint);
	return unsigned(wallet, [build.stake(programId(), {
		staker: wallet, poolId: poolIdBytes(pool.poolIdHex), mint: pool.mint, outcome, amount, tokenProgram,
	})]);
}

/** Claim and refund create the owner's token account first when it is missing, so a payout can never fail on that. */
export async function buildPayoutTx(pool, { wallet, kind }) {
	const tokenProgram = await tokenProgramFor(pool.mint);
	const owner = new PublicKey(wallet);
	const ata = getAssociatedTokenAddressSync(new PublicKey(pool.mint), owner, false, tokenProgram);
	const args = { owner: wallet, poolId: poolIdBytes(pool.poolIdHex), mint: pool.mint, tokenProgram };
	return unsigned(wallet, [
		createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, new PublicKey(pool.mint), tokenProgram),
		kind === 'claim' ? build.claim(programId(), args) : build.refund(programId(), args),
	]);
}

export { TOKEN_PROGRAM_ID };
