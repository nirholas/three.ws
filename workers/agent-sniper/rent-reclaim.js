// agent-sniper: recover the rent a trade's token account locks up.
//
// Every buy opens an associated token account for the coin (~0.0015-0.002 SOL of
// rent) and the sell path never closed it. Measured on 2026-10-01 across the 11
// sniper wallets: 1,377 token accounts holding 2.61 SOL of rent, 1,162 of them
// already empty (2.20 SOL), against a realized trading loss of 0.54 SOL. At
// 0.002 SOL per trade the unclosed rent alone needed a ~79% move to break even,
// and it is what drained most arms dry. See docs/ops/sniper-fleet-review-2026-10-01.md.
//
// The close is deliberately a SEPARATE transaction sent after the exit confirms,
// never an instruction inside the sell: a close fails on any non-zero balance, and
// bundling it would let a few leftover base units abort a stop-loss sell. Here a
// failed close costs nothing but the attempt, and the account is retried by the
// next exit on the same wallet or by scripts/sniper-reclaim-rent.mjs.
//
// Only accounts that read EXACTLY zero on-chain are closed, and the rent always
// goes back to the owning wallet itself, so this can never move value anywhere.

import { createCloseAccountInstruction } from '@solana/spl-token';
import { log } from './log.js';
import { deriveTokenAccounts, TOKEN_PROGRAMS } from './reconcile.js';

/** Closes per transaction. Each close is ~3 accounts; 20 stays far under the size cap. */
export const MAX_CLOSES_PER_TX = 20;

/**
 * Pick the token accounts that are safe to close and batch them. Pure.
 *
 * A row qualifies only when its program is a known token program and its raw
 * amount is exactly zero. Unknown amounts (null, unparseable) never qualify: an
 * unreadable balance is not an empty one.
 *
 * @param {Array<{pubkey:string, programId:string, amount:string|bigint|null, lamports?:number}>} accounts
 * @param {{maxPerTx?:number}} [opts]
 * @returns {{batches:Array<Array<{pubkey:string, programId:string, lamports:number}>>, closable:number, rentLamports:number}}
 */
export function planCloses(accounts, { maxPerTx = MAX_CLOSES_PER_TX } = {}) {
	const known = new Set(TOKEN_PROGRAMS);
	const closable = [];
	for (const a of accounts || []) {
		if (!a || !known.has(a.programId)) continue;
		let amount;
		try { amount = a.amount == null ? null : BigInt(a.amount); } catch { amount = null; }
		if (amount !== 0n) continue;
		closable.push({ pubkey: a.pubkey, programId: a.programId, lamports: Number(a.lamports) || 0 });
	}
	const size = Math.max(1, Math.floor(maxPerTx));
	const batches = [];
	for (let i = 0; i < closable.length; i += size) batches.push(closable.slice(i, i + size));
	return { batches, closable: closable.length, rentLamports: closable.reduce((s, a) => s + a.lamports, 0) };
}

/**
 * Build the close instructions for one batch. Rent returns to the owner.
 *
 * @param {object} ctx  getTradeCtx() result (for web3)
 * @param {import('@solana/web3.js').PublicKey} ownerPk
 * @param {Array<{pubkey:string, programId:string}>} batch
 */
export function buildCloseInstructions(ctx, ownerPk, batch) {
	return batch.map((a) => createCloseAccountInstruction(
		new ctx.web3.PublicKey(a.pubkey),
		ownerPk,
		ownerPk,
		[],
		new ctx.web3.PublicKey(a.programId),
	));
}

/**
 * Read the owner's token accounts for one mint, with exact raw amounts.
 * Returns null when any read fails, so a degraded RPC never reads as "empty".
 */
async function readMintAccounts(ctx, ownerPk, mint) {
	const out = [];
	for (const ata of deriveTokenAccounts(ctx, ownerPk, new ctx.web3.PublicKey(mint))) {
		let info;
		try { info = await ctx.connection.getAccountInfo(ata); } catch { return null; }
		if (!info) continue;
		let amount;
		try { amount = (await ctx.connection.getTokenAccountBalance(ata))?.value?.amount ?? null; } catch { return null; }
		out.push({ pubkey: ata.toBase58(), programId: info.owner.toBase58(), amount, lamports: info.lamports });
	}
	return out;
}

/**
 * After a full exit, close the coin's now-empty token account(s) so the rent
 * returns to the agent wallet. Best effort: never throws, and a balance that is
 * not provably zero is left alone.
 *
 * @param {{ctx:object, keypair:import('@solana/web3.js').Keypair, mint:string, sendTx:Function, tag?:object}} args
 *   sendTx(instructions) broadcasts and resolves to a signature.
 * @returns {Promise<{closed:number, rentLamports:number, sig?:string, skipped?:string}>}
 */
export async function reclaimMintRent({ ctx, keypair, mint, sendTx, tag = {} }) {
	try {
		const accounts = await readMintAccounts(ctx, keypair.publicKey, mint);
		if (accounts == null) return { closed: 0, rentLamports: 0, skipped: 'balance_unreadable' };
		const plan = planCloses(accounts);
		if (plan.closable === 0) return { closed: 0, rentLamports: 0, skipped: accounts.length ? 'not_empty' : 'no_account' };
		const sig = await sendTx(buildCloseInstructions(ctx, keypair.publicKey, plan.batches[0]));
		log.trade('rent-reclaim', { ...tag, mint, closed: plan.closable, rent_sol: plan.rentLamports / 1e9, sig });
		return { closed: plan.closable, rentLamports: plan.rentLamports, sig };
	} catch (err) {
		log.warn('rent reclaim failed (account left for the next sweep)', { ...tag, mint, err: err?.message });
		return { closed: 0, rentLamports: 0, skipped: 'send_failed' };
	}
}
