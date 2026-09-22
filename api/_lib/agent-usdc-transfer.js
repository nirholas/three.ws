// Guarded agent→agent USDC settlement — the x402 payment leg of the signal
// marketplace, and a reusable primitive for any "agent A pays agent B N USDC"
// flow that must respect the same custody policy every other outbound path does.
//
// Safe by construction, identical guarantees to api/x402-pay.js's per-agent path:
//   • reserveSpendUsd() atomically claims a pending custody row under the agent's
//     daily USD ceiling + kill switch BEFORE the key is touched — a frozen wallet
//     or a breached cap rejects with SpendLimitError and nothing is signed;
//   • a retried payment with the same idempotency key replays the prior settled
//     signature instead of paying twice (custody idempotency index);
//   • the spend lands in agent_custody_events (category 'signal') with the real
//     on-chain signature, so it shows in the owner's audit feed and counts toward
//     the daily ceiling like every other spend;
//   • execution goes through the shared MEV-aware engine (submitProtected), so it
//     gets the same dynamic compute budget + bounded confirmation as a trade.
//
// USDC is 1:1 USD, so the spend's USD value IS its USDC amount — no price feed
// risk on the metering side.

import { PublicKey } from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync, createTransferCheckedInstruction,
	createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { sql } from './db.js';
import { recoverSolanaAgentKeypair } from './agent-wallet.js';
import { solanaConnection } from './agent-pumpfun.js';
import { submitProtected } from './execution-engine.js';
import {
	getSpendLimits, reserveSpendUsd, updateCustodyEvent, releaseSpendReservation,
	SpendLimitError,
} from './agent-trade-guards.js';
import { logAudit } from './audit.js';

const USDC_MINT_BY_NETWORK = {
	mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	// USDC on devnet (Circle's official devnet mint).
	devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};
const USDC_DECIMALS = 6;

/** USDC (float) → 6-decimal atomic units (BigInt, floored). */
export function usdcToAtomics(usdc) {
	return BigInt(Math.max(0, Math.floor(Number(usdc) * 10 ** USDC_DECIMALS)));
}

/**
 * Pay `usdc` USDC from a custodial agent wallet to `toAddress`, fully guarded and
 * audited under custody category `category` (default 'signal'). Never throws past
 * the boundary except for a real spend-limit rejection, which surfaces as
 * `{ status: 'blocked', code }` so callers can record it cleanly.
 *
 * @param {object} a
 * @param {string} a.fromAgentId   payer agent id
 * @param {string} a.fromUserId    payer agent owner id (for audit)
 * @param {object} a.fromMeta      payer agent.meta (encrypted secret + spend limits)
 * @param {string} a.toAddress     recipient base58 Solana address (USDC ATA derived)
 * @param {number} a.usdc          amount in USDC (= USD)
 * @param {bigint|string} [a.amountAtomics]  exact 6-decimal amount to send. Pass it
 *   when the payee quoted an exact atomic price (a card invoice), so float
 *   rounding in `usdc` can never underpay it. Must match `usdc` to the cent.
 * @param {string} [a.network]
 * @param {string} [a.category]    custody category (default 'signal')
 * @param {string} a.idempotencyKey
 * @param {object} [a.rowMeta]     extra metadata stored on the custody row
 * @returns {Promise<{status:'paid'|'replayed'|'blocked'|'failed', signature?:string,
 *   custodyEventId?:number, usdc?:number, code?:string, message?:string}>}
 */
export async function transferUsdcGuarded({
	fromAgentId, fromUserId, fromMeta, toAddress, usdc, amountAtomics = null,
	network = 'mainnet', category = 'signal', idempotencyKey, rowMeta = {},
}) {
	const net = network === 'devnet' ? 'devnet' : 'mainnet';
	const amount = Number(usdc);
	if (!(amount > 0)) return { status: 'failed', code: 'zero_amount' };
	const exactRaw = amountAtomics != null ? BigInt(amountAtomics) : null;
	if (exactRaw != null && (exactRaw <= 0n || Math.abs(Number(exactRaw) / 10 ** USDC_DECIMALS - amount) > 0.005)) {
		return { status: 'failed', code: 'amount_mismatch' };
	}
	if (!idempotencyKey) return { status: 'failed', code: 'idempotency_required' };

	const encryptedSecret = fromMeta?.encrypted_solana_secret || null;
	const payerAddress = fromMeta?.solana_address || null;
	if (!encryptedSecret || !payerAddress) return { status: 'failed', code: 'wallet_preparing' };

	let toPk; let payerPk; let mintPk;
	try {
		toPk = new PublicKey(toAddress);
		payerPk = new PublicKey(payerAddress);
		mintPk = new PublicKey(USDC_MINT_BY_NETWORK[net]);
	} catch {
		return { status: 'failed', code: 'bad_address' };
	}
	if (toPk.equals(payerPk)) return { status: 'failed', code: 'self_payment' };

	// Replay path — a prior settled payment with this key returns its signature.
	const [prior] = await sql`
		SELECT id, status, signature FROM agent_custody_events
		WHERE agent_id = ${fromAgentId} AND idempotency_key = ${idempotencyKey} LIMIT 1
	`;
	if (prior) {
		if (prior.status === 'confirmed' && prior.signature) {
			return { status: 'replayed', signature: prior.signature, custodyEventId: Number(prior.id), usdc: amount };
		}
		if (prior.status === 'pending') return { status: 'failed', code: 'in_flight' };
		return { status: 'failed', code: 'prior_failed' };
	}

	// 1. Reserve under the daily ceiling + kill switch (atomic, pre-signature).
	let reservationId;
	try {
		const reservation = await reserveSpendUsd({
			agentId: fromAgentId, userId: fromUserId, meta: fromMeta,
			limits: getSpendLimits(fromMeta), category, usdValue: amount,
			destination: toAddress, network: net, asset: 'USDC',
			rowMeta: { ...rowMeta, idempotency_key: idempotencyKey },
		});
		reservationId = reservation.reservationId;
	} catch (e) {
		if (e instanceof SpendLimitError) return { status: 'blocked', code: e.code, message: e.message };
		throw e;
	}

	// Attach the idempotency key to the reserved row so a retry replays it.
	await updateCustodyEvent(reservationId, { meta: { idempotency_key: idempotencyKey, ...rowMeta } }).catch(() => {});
	await sql`UPDATE agent_custody_events SET idempotency_key = ${idempotencyKey}, amount_raw = ${(exactRaw ?? usdcToAtomics(amount)).toString()} WHERE id = ${reservationId} AND idempotency_key IS NULL`.catch(() => {});

	// 2. Recover the key (audit-logged), build the USDC transfer, settle on-chain.
	let keypair;
	try {
		keypair = await recoverSolanaAgentKeypair(encryptedSecret, {
			agentId: fromAgentId, userId: fromUserId, reason: `${category}_pay`,
			meta: { to: toAddress, usdc: amount, custody_event_id: reservationId },
		});
	} catch {
		await releaseSpendReservation(reservationId, 'key_recover_failed');
		return { status: 'failed', code: 'key_recover_failed' };
	}

	const fromAta = getAssociatedTokenAddressSync(mintPk, keypair.publicKey, false, TOKEN_PROGRAM_ID);
	const toAta = getAssociatedTokenAddressSync(mintPk, toPk, false, TOKEN_PROGRAM_ID);
	const raw = exactRaw ?? usdcToAtomics(amount);
	const instructions = [
		// Idempotent: a no-op if the recipient already holds a USDC account.
		createAssociatedTokenAccountIdempotentInstruction(keypair.publicKey, toAta, toPk, mintPk, TOKEN_PROGRAM_ID),
		createTransferCheckedInstruction(fromAta, mintPk, toAta, keypair.publicKey, raw, USDC_DECIMALS, [], TOKEN_PROGRAM_ID),
	];

	let signature;
	try {
		const result = await submitProtected({
			network: net, connection: solanaConnection(net), payer: keypair, instructions,
			opts: { tipMode: 'off', confirmTimeoutMs: 45_000 },
		});
		signature = result.signature;
	} catch (e) {
		if (e?.code === 'TX_ERR' && e.signature) {
			// Broadcast but unconfirmed — keep the row pending so a retry can replay/settle.
			await updateCustodyEvent(reservationId, { signature: e.signature, meta: { confirm: 'unconfirmed' } }).catch(() => {});
			return { status: 'failed', code: 'unconfirmed', signature: e.signature, custodyEventId: reservationId };
		}
		await releaseSpendReservation(reservationId, 'send_failed');
		return { status: 'failed', code: 'send_failed', message: (e?.message || '').slice(0, 200) };
	}

	await updateCustodyEvent(reservationId, { status: 'confirmed', signature, usd: amount }).catch(() => {});
	logAudit({
		userId: fromUserId, action: 'custody.signal_pay', resourceId: fromAgentId,
		meta: { to: toAddress, usdc: amount, signature, network: net, category },
	});
	return { status: 'paid', signature, custodyEventId: reservationId, usdc: amount };
}
