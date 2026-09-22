// Wallet-funded credit top-ups: an agent pays for its own inference.
//
// Moves USDC from an agent's custodial Solana wallet to the platform treasury
// and credits the owner's account at the published rate (USDC_CREDIT_RATE, no
// fee). The transfer is a standard x402 `exact` payment: the agent wallet signs
// one USDC TransferChecked to the treasury, and the in-house self-facilitator
// (api/_lib/x402/self-facilitator.js) validates it, co-signs as fee payer and
// broadcasts it. The agent therefore needs USDC only, never SOL for fees, and
// no third party touches the settlement.
//
// Every top-up is guarded exactly like any other outbound agent spend:
//   • reserveSpendUsd() claims a pending custody row under the agent's per-tx
//     and daily ceilings, the natural-language policy, the kill switch and the
//     behavioural anomaly freeze, BEFORE the key is touched;
//   • the custody row is finalized with the on-chain signature, so the top-up
//     appears in the owner's audit feed and counts toward the daily cap;
//   • the credit_ledger 'deposit' row carries the same signature, and is
//     idempotent on the top-up id, so a retry never credits twice.
//
// Owner and provisioning flows are two-step: previewTopup() writes a
// single-use preview (recipient, amount, token, chain, credits) that expires in
// ten minutes, and executeTopup() requires `confirm_deposit: true` plus that
// fresh preview_id. An armed wallet intent (source 'intent') is itself the
// owner's standing authorization and calls topupFromIntent() directly.

import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { sql } from './db.js';
import { env } from './env.js';
import { creditAccount, getCreditAccount } from './credits.js';
import { USDC_CREDIT_RATE } from './pricing/catalog.js';
import { getSolanaAddressBalances, recoverSolanaAgentKeypair } from './agent-wallet.js';
import {
	enforceSpendLimit,
	reserveSpendUsd,
	releaseSpendReservation,
	updateCustodyEvent,
	SpendLimitError,
} from './agent-trade-guards.js';
import { NETWORK_SOLANA_MAINNET } from './x402/solana-networks.js';
import { bootstrapSolanaContext, buildPaymentTx, nextAutoNonce } from './x402/pay.js';
import { loadFeePayerKeypair, settleRingPayment } from './x402/self-facilitator.js';
import { facilitatorFeeMeter, recordSettledFee } from './x402/wallet-fee-meter.js';
import { claimSettleCredit } from './x402/settle-credit.js';
import { PENDING_SCOPE_FACILITATOR, SqlPendingSettlementStore } from './x402/pending-settlements.js';
import { insertNotification } from './notify.js';
import { logAudit } from './audit.js';

export const TOPUP_MIN_USDC = 0.1;
export const TOPUP_MAX_USDC = 1000;
export const PREVIEW_TTL_MINUTES = 10;
export const CUSTODY_CATEGORY = 'inference_topup';

const USDC_DECIMALS = 6;

export class TopupError extends Error {
	constructor(status, code, message, detail = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.detail = detail;
		this.expose = true;
	}
}

/** Validate and normalize a USDC amount to 6 decimals. */
export function normalizeTopupAmount(raw) {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) {
		throw new TopupError(400, 'validation_error', 'amount_usdc must be a positive number');
	}
	const rounded = Math.floor(n * 10 ** USDC_DECIMALS) / 10 ** USDC_DECIMALS;
	if (rounded < TOPUP_MIN_USDC) {
		throw new TopupError(400, 'validation_error', `the smallest top-up is ${TOPUP_MIN_USDC} USDC`);
	}
	if (rounded > TOPUP_MAX_USDC) {
		throw new TopupError(400, 'validation_error', `the largest single top-up is ${TOPUP_MAX_USDC} USDC`);
	}
	return rounded;
}

/** Credits a top-up buys at the published rate. No fee is taken. */
export function creditsForUsdc(amountUsdc) {
	return Math.floor(Number(amountUsdc) * USDC_CREDIT_RATE * 1e6) / 1e6;
}

function treasuryAddress() {
	const addr = env.X402_PAY_TO_SOLANA;
	if (!addr) {
		throw new TopupError(503, 'treasury_unconfigured', 'Wallet top-ups are unavailable: the platform treasury address is not configured.');
	}
	return addr;
}

function usdcMint() {
	const mint = env.X402_ASSET_MINT_SOLANA;
	if (!mint) {
		throw new TopupError(503, 'usdc_unconfigured', 'Wallet top-ups are unavailable: the USDC mint is not configured.');
	}
	return mint;
}

/** The sponsor fee payer, or null when this deployment has none (self-pay). */
function sponsorOrNull() {
	try {
		return loadFeePayerKeypair();
	} catch {
		return null;
	}
}

async function loadOwnedAgent(agentId, userId) {
	const [row] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) throw new TopupError(404, 'not_found', 'agent not found');
	if (String(row.user_id) !== String(userId)) throw new TopupError(403, 'forbidden', 'not your agent');
	const meta = row.meta || {};
	if (!meta.solana_address || !meta.encrypted_solana_secret) {
		throw new TopupError(409, 'wallet_not_ready', 'This agent has no signable Solana wallet yet. Open its wallet page to provision one.');
	}
	return { ...row, meta };
}

function spendLimitToTopupError(e) {
	return new TopupError(403, e.code || 'spend_limit', e.message, e.detail || {});
}

// ── preview ─────────────────────────────────────────────────────────────────

/**
 * Write a single-use preview of a wallet-funded top-up. Nothing moves.
 * @returns {Promise<object>} the confirmation table the owner must approve
 */
export async function previewTopup({ userId, agentId, amountUsdc, source = 'owner' }) {
	const amount = normalizeTopupAmount(amountUsdc);
	const agent = await loadOwnedAgent(agentId, userId);
	const payTo = treasuryAddress();
	const mint = usdcMint();

	const balances = await getSolanaAddressBalances(agent.meta.solana_address, 'mainnet');
	if (balances.usdc == null) {
		throw new TopupError(503, 'rpc_unavailable', 'Could not read the agent wallet balance from Solana. Retry in a moment.');
	}
	if (balances.usdc + 1e-9 < amount) {
		throw new TopupError(402, 'insufficient_usdc', `The agent wallet holds ${balances.usdc} USDC, less than the ${amount} USDC requested. Fund the wallet first.`, {
			wallet_usdc: balances.usdc,
			requested_usdc: amount,
			deposit_address: agent.meta.solana_address,
		});
	}

	// Fail fast on the owner's own policy (freeze, per-tx cap, English rules)
	// so a preview never shows a top-up the guard would refuse. The binding
	// check is the atomic reserve at execution time.
	try {
		await enforceSpendLimit({
			agentId: agent.id,
			meta: agent.meta,
			userId,
			category: CUSTODY_CATEGORY,
			usdValue: amount,
			asset: 'USDC',
			destination: payTo,
		});
	} catch (e) {
		if (e instanceof SpendLimitError) throw spendLimitToTopupError(e);
		throw e;
	}

	const sponsor = sponsorOrNull();
	if (!sponsor && !(balances.sol > 0.00001)) {
		throw new TopupError(409, 'no_fee_payer', 'The agent wallet needs a little SOL (0.00001) to pay the network fee on this deployment.');
	}

	const credits = creditsForUsdc(amount);
	const acct = await getCreditAccount(userId);
	const [row] = await sql`
		INSERT INTO inference_topups
			(user_id, agent_id, source, status, amount_usdc, credits_usd, payer_address, pay_to, network, expires_at)
		VALUES
			(${userId}, ${agent.id}, ${source}, 'previewed', ${amount.toFixed(6)}, ${credits.toFixed(6)},
			 ${agent.meta.solana_address}, ${payTo}, 'mainnet', now() + make_interval(mins => ${PREVIEW_TTL_MINUTES}))
		RETURNING id, expires_at
	`;

	return {
		preview_id: row.id,
		expires_at: row.expires_at,
		confirm_flag: 'confirm_deposit',
		agent: { id: agent.id, name: agent.name },
		from: agent.meta.solana_address,
		to: payTo,
		to_label: 'three.ws treasury',
		token: 'USDC',
		mint,
		chain: 'solana',
		network: 'mainnet',
		amount_usdc: amount,
		rate: USDC_CREDIT_RATE,
		fee_usd: 0,
		credits_usd: credits,
		network_fee: sponsor ? 'paid by three.ws' : 'about 0.000005 SOL from the agent wallet',
		wallet_usdc_before: balances.usdc,
		wallet_usdc_after: Math.round((balances.usdc - amount) * 1e6) / 1e6,
		balance_before_usd: acct.balanceUsd,
		balance_after_usd: Math.round((acct.balanceUsd + credits) * 1e6) / 1e6,
	};
}

// ── execute ─────────────────────────────────────────────────────────────────

function rowResult(row, extra = {}) {
	return {
		topup_id: row.id,
		status: row.status,
		agent_id: row.agent_id,
		amount_usdc: Number(row.amount_usdc),
		credits_usd: Number(row.credits_usd),
		signature: row.signature || null,
		explorer_url: row.signature ? `https://solscan.io/tx/${row.signature}` : null,
		api_key_id: row.api_key_id || null,
		...extra,
	};
}

/**
 * Execute a previewed top-up. Requires `confirmDeposit === true` and a fresh,
 * unused preview owned by the caller. Retrying a settled or pending preview is
 * safe: it returns the recorded result or reconciles the recorded signature.
 */
export async function executeTopup({ userId, previewId, confirmDeposit, sources = ['owner'] }) {
	if (confirmDeposit !== true) {
		throw new TopupError(400, 'confirm_required', 'Moving funds needs confirm_deposit: true together with a preview_id from the matching /preview call. Show the preview to the owner first.');
	}
	if (!previewId) {
		throw new TopupError(400, 'preview_required', 'preview_id is required: call the matching /preview route first.');
	}
	const [row] = await sql`SELECT * FROM inference_topups WHERE id = ${previewId} AND user_id = ${userId}`;
	if (!row || !sources.includes(row.source)) {
		throw new TopupError(404, 'preview_not_found', 'No preview with that id belongs to this account. Create a new one with /preview.');
	}
	if (row.status === 'settled') return rowResult(row, { replay: true });
	if (row.status === 'pending') return reconcileTopup(row);
	if (row.status === 'failed' || row.status === 'expired') {
		throw new TopupError(409, 'preview_used', `This preview already ${row.status === 'failed' ? `failed (${row.error || 'settlement failed'})` : 'expired'}. Create a new one with /preview.`);
	}
	if (row.status === 'executing') {
		throw new TopupError(409, 'in_flight', 'This top-up is already being settled. Retry in a few seconds to read its result.');
	}

	const [claimed] = await sql`
		UPDATE inference_topups SET status = 'executing', executed_at = now()
		WHERE id = ${previewId} AND status = 'previewed' AND expires_at > now()
		RETURNING *
	`;
	if (!claimed) {
		await sql`UPDATE inference_topups SET status = 'expired' WHERE id = ${previewId} AND status = 'previewed' AND expires_at <= now()`;
		throw new TopupError(410, 'preview_expired', `Previews are valid for ${PREVIEW_TTL_MINUTES} minutes. Create a new one with /preview and confirm it.`);
	}
	return runTopup(claimed);
}

/**
 * Fire a top-up from an armed wallet intent. Idempotent per `idempotencyKey`,
 * which the intent engine derives from the rule and its window, so a rule
 * tops up at most once per window however often the sweep runs.
 */
export async function topupFromIntent({ agentId, ownerId, amountUsdc, intentId, idempotencyKey }) {
	const amount = normalizeTopupAmount(amountUsdc);
	const agent = await loadOwnedAgent(agentId, ownerId);
	const payTo = treasuryAddress();
	const credits = creditsForUsdc(amount);
	const [row] = await sql`
		INSERT INTO inference_topups
			(user_id, agent_id, source, status, amount_usdc, credits_usd, payer_address, pay_to,
			 network, intent_id, idempotency_key, executed_at)
		VALUES
			(${ownerId}, ${agent.id}, 'intent', 'executing', ${amount.toFixed(6)}, ${credits.toFixed(6)},
			 ${agent.meta.solana_address}, ${payTo}, 'mainnet', ${intentId}, ${idempotencyKey}, now())
		ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		RETURNING *
	`;
	if (!row) return { status: 'skipped', note: 'already topped up in this window' };
	return runTopup(row);
}

async function markFailed(id, reason) {
	await sql`UPDATE inference_topups SET status = 'failed', error = ${String(reason).slice(0, 300)} WHERE id = ${id}`;
}

async function treasuryAtaExists(conn, payTo, mint) {
	const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(payTo), false, TOKEN_PROGRAM_ID);
	const info = await conn.getAccountInfo(ata, 'confirmed');
	return info != null;
}

/** Reserve, sign, settle through the self-facilitator, then credit. */
async function runTopup(row) {
	const agent = await loadOwnedAgent(row.agent_id, row.user_id).catch(async (e) => {
		await markFailed(row.id, e.message);
		throw e;
	});
	const amount = Number(row.amount_usdc);
	const atomics = BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
	const idem = `inference_topup:${row.id}`;

	let reservationId;
	try {
		const reservation = await reserveSpendUsd({
			agentId: agent.id,
			userId: row.user_id,
			meta: agent.meta,
			category: CUSTODY_CATEGORY,
			usdValue: amount,
			destination: row.pay_to,
			asset: 'USDC',
			rowMeta: {
				topup_id: row.id,
				source: row.source,
				credits_usd: Number(row.credits_usd),
				...(row.intent_id ? { intent_id: row.intent_id } : {}),
			},
		});
		reservationId = reservation.reservationId;
	} catch (e) {
		if (e instanceof SpendLimitError) {
			await markFailed(row.id, e.message);
			throw spendLimitToTopupError(e);
		}
		await markFailed(row.id, e?.message || 'reserve failed');
		throw e;
	}
	await sql`
		UPDATE agent_custody_events SET idempotency_key = ${idem}, amount_raw = ${atomics.toString()}
		WHERE id = ${reservationId} AND idempotency_key IS NULL
	`;
	await sql`UPDATE inference_topups SET custody_event_id = ${reservationId} WHERE id = ${row.id}`;

	const fail = async (code, message, status = 502) => {
		await releaseSpendReservation(reservationId, code);
		await markFailed(row.id, message);
		throw new TopupError(status, code, message);
	};

	let keypair;
	try {
		keypair = await recoverSolanaAgentKeypair(agent.meta.encrypted_solana_secret, {
			agentId: agent.id,
			userId: row.user_id,
			reason: CUSTODY_CATEGORY,
			meta: { topup_id: row.id, usdc: amount, to: row.pay_to },
		});
	} catch {
		return fail('key_recover_failed', 'The agent wallet key could not be recovered, so nothing was signed.', 500);
	}
	if (keypair.publicKey.toBase58() !== row.payer_address) {
		return fail('wallet_changed', 'The agent wallet changed after this top-up was previewed. Nothing was signed; preview again.', 409);
	}

	const sponsor = sponsorOrNull();
	let settled;
	let requirement;
	try {
		const { conn, blockhash, mintInfo } = await bootstrapSolanaContext({ buyer: keypair });
		requirement = {
			scheme: 'exact',
			network: NETWORK_SOLANA_MAINNET,
			asset: usdcMint(),
			payTo: row.pay_to,
			amount: atomics.toString(),
			extra: sponsor ? { feePayer: sponsor.publicKey.toBase58() } : {},
		};
		const receiverAtaExists = await treasuryAtaExists(conn, row.pay_to, requirement.asset);
		const transaction = buildPaymentTx({
			accept: requirement,
			buyer: keypair,
			blockhash,
			mintInfo,
			receiverAtaExists,
			nonce: nextAutoNonce(),
			selfPay: !sponsor,
		});
		settled = await settleRingPayment({
			paymentPayload: { x402Version: 2, payload: { transaction } },
			requirement,
			conn,
			feePayer: sponsor || undefined,
			feeMeter: facilitatorFeeMeter(),
			pendingStore: new SqlPendingSettlementStore({ scope: PENDING_SCOPE_FACILITATOR }),
			idempotencyKey: idem,
		});
	} catch (e) {
		return fail('settle_failed', `The transfer could not be settled: ${String(e?.message || e).slice(0, 200)}`);
	}

	if (!settled.success && settled.pending && settled.transaction) {
		await updateCustodyEvent(reservationId, { signature: settled.transaction, meta: { confirm: 'pending' } });
		const [p] = await sql`
			UPDATE inference_topups SET status = 'pending', signature = ${settled.transaction}
			WHERE id = ${row.id} RETURNING *
		`;
		return rowResult(p, { note: 'Broadcast, waiting for Solana to confirm. Retry the same call to read the result.' });
	}
	if (!settled.success) {
		return fail('settle_failed', `The self-facilitator refused the transfer: ${settled.reason || 'unknown reason'}. Nothing moved.`);
	}

	const credit = await claimSettleCredit({
		sql,
		row: {
			network: requirement.network,
			payer: settled.payer,
			payTo: requirement.payTo,
			mint: requirement.asset,
			amountAtomic: Number(requirement.amount),
			txSig: settled.transaction,
			feeLamports: settled.feeLamports,
			idempotencyKey: idem,
			feePayer: settled.feePayer,
		},
	});
	if (!credit.granted && !credit.idempotentReplay) {
		await updateCustodyEvent(reservationId, { status: 'failed', signature: settled.transaction, meta: { refused: credit.reason } });
		await markFailed(row.id, `settlement signature refused: ${credit.reason}`);
		throw new TopupError(409, 'settle_refused', `The settlement could not be attributed to this top-up (${credit.reason}). Contact support with signature ${settled.transaction}.`);
	}
	if (credit.granted) recordSettledFee(settled.feePayer, settled.feeLamports);

	return finalizeSettled({ ...row, custody_event_id: reservationId }, settled.transaction);
}

/** Book a confirmed transfer: custody row, credit ledger, top-up row, owner notice. */
async function finalizeSettled(row, signature) {
	if (row.custody_event_id) {
		await updateCustodyEvent(row.custody_event_id, {
			status: 'confirmed',
			signature,
			usd: Number(row.amount_usdc),
		});
	}
	const credited = await creditAccount({
		userId: row.user_id,
		amountUsd: Number(row.credits_usd),
		kind: 'deposit',
		action: 'inference.topup',
		refType: 'agent_wallet_topup',
		refId: String(row.agent_id),
		txSignature: signature,
		asset: 'USDC',
		assetAmount: BigInt(Math.round(Number(row.amount_usdc) * 10 ** USDC_DECIMALS)).toString(),
		priceUsd: USDC_CREDIT_RATE,
		idempotencyKey: `inference_topup:${row.id}`,
		meta: { topup_id: row.id, agent_id: row.agent_id, source: row.source },
	});
	const [done] = await sql`
		UPDATE inference_topups
		SET status = 'settled', signature = ${signature}, ledger_id = ${credited.ledgerId}, settled_at = now(), error = NULL
		WHERE id = ${row.id}
		RETURNING *
	`;
	if (!credited.replay) {
		insertNotification(row.user_id, 'inference_topup', {
			agent_id: row.agent_id,
			amount_usdc: Number(row.amount_usdc),
			credits_usd: Number(row.credits_usd),
			signature,
			source: row.source,
			link: '/credits',
		});
		logAudit({
			userId: row.user_id,
			action: 'inference.topup',
			resourceId: row.agent_id,
			meta: { topup_id: row.id, usdc: Number(row.amount_usdc), credits_usd: Number(row.credits_usd), signature, source: row.source },
		});
	}
	return rowResult(done, { balance_usd: credited.balanceUsd });
}

/**
 * Settle the outcome of a top-up whose broadcast was not yet confirmed. Reads
 * the recorded signature from chain: landed credits the account, reverted
 * releases the reservation, unknown stays pending for the next read.
 */
export async function reconcileTopup(row) {
	if (!row.signature) return rowResult(row);
	const { solanaConnection } = await import('./solana/connection.js');
	const conn = solanaConnection({ url: env.SOLANA_RPC_URL, commitment: 'confirmed' });
	let status = null;
	try {
		status = (await conn.getSignatureStatuses([row.signature], { searchTransactionHistory: true }))?.value?.[0] || null;
	} catch {
		return rowResult(row, { note: 'Solana did not answer; still pending. Retry shortly.' });
	}
	if (status && status.err == null && ['confirmed', 'finalized'].includes(status.confirmationStatus)) {
		return finalizeSettled(row, row.signature);
	}
	if (status && status.err != null) {
		if (row.custody_event_id) await releaseSpendReservation(row.custody_event_id, 'reverted');
		await markFailed(row.id, 'the transfer reverted on chain; nothing moved');
		const [failed] = await sql`SELECT * FROM inference_topups WHERE id = ${row.id}`;
		return rowResult(failed);
	}
	const ageMs = Date.now() - new Date(row.executed_at || row.created_at).getTime();
	if (!status && ageMs > 5 * 60_000) {
		if (row.custody_event_id) await releaseSpendReservation(row.custody_event_id, 'dropped');
		await markFailed(row.id, 'the transfer never landed (blockhash expired); nothing moved');
		const [failed] = await sql`SELECT * FROM inference_topups WHERE id = ${row.id}`;
		return rowResult(failed);
	}
	return rowResult(row, { note: 'Broadcast, waiting for Solana to confirm.' });
}

/** Reconcile every pending top-up for one account (called from the usage read). */
export async function reconcilePendingTopups(userId) {
	const rows = await sql`
		SELECT * FROM inference_topups
		WHERE user_id = ${userId} AND status = 'pending' AND signature IS NOT NULL
		ORDER BY created_at ASC LIMIT 5
	`;
	for (const row of rows) {
		await reconcileTopup(row).catch((err) => console.warn('[inference-topup] reconcile failed', row.id, err?.message));
	}
}
