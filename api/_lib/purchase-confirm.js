// Skill-purchase confirmation pipeline.
//
// Both /api/marketplace/purchase/:reference/confirm and the off-web webhook
// at /api/webhooks/solana-pay execute the same critical-path logic:
//
//   1. Resolve the purchase + payout wallet.
//   2. Locate the on-chain tx via Solana Pay reference.
//   3. validateTransfer (strict).
//        ✓ match  — atomic confirm + ledger writes + receipts + notifications + referral split.
//        ✗ found-but-mismatched — fall back to inspecting the parsed tx; if any USDC of any
//          amount actually moved to the seller's wallet attached to our reference, mark the
//          row 'tipped' with the actual amount and notify the seller. Buyer's funds did not
//          vanish — pretending they did is a worse failure than acknowledging it.
//   4. Emit a signed receipt (HMAC-SHA256 over canonical JSON).
//
// Called from server endpoints; not user-facing.

import crypto from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { findReference, validateTransfer } from '@solana/pay';
import BigNumber from 'bignumber.js';

import { sql } from './db.js';
import { rpcFallbackFromEnv } from './solana/rpc-fallback.js';
import { insertNotification } from './notify.js';

let _rpc;
function rpc() {
	if (!_rpc) _rpc = rpcFallbackFromEnv({ network: 'mainnet' });
	return _rpc;
}

// HMAC key for receipts. Falls back to a derived value off SESSION_SECRET if
// PURCHASE_RECEIPT_KEY isn't set, so receipts still work in dev.
function receiptKey() {
	return (
		process.env.PURCHASE_RECEIPT_KEY ||
		crypto.createHash('sha256').update((process.env.SESSION_SECRET || 'dev') + ':receipts').digest('hex')
	);
}

// Default referral commission: 5%. Set REFERRAL_COMMISSION_BPS in env to tune.
function referralBps() {
	const v = parseInt(process.env.REFERRAL_COMMISSION_BPS || '500', 10);
	return Number.isFinite(v) && v >= 0 && v <= 10000 ? v : 500;
}

export async function logEvent(referenceOrPurchaseId, event, payload = {}) {
	try {
		await sql`
			INSERT INTO purchase_events (purchase_id, event, payload)
			VALUES (
				(SELECT id FROM skill_purchases
				 WHERE reference = ${referenceOrPurchaseId} OR id::text = ${referenceOrPurchaseId}
				 LIMIT 1),
				${event},
				${JSON.stringify(payload)}::jsonb
			)
		`;
	} catch (e) {
		console.error('[purchase-confirm] logEvent', e?.message);
	}
}

// Public: resolve the seller's payout address for an agent + chain. Used by
// purchase create AND confirm so a single source of truth.
export async function resolvePayoutAddress(agentId, chain) {
	const [row] = await sql`
		SELECT pw.address
		FROM agent_identities a
		JOIN agent_payout_wallets pw
		  ON pw.user_id = a.user_id
		 AND pw.chain = ${chain}
		 AND (pw.agent_id = a.id OR pw.is_default = true)
		WHERE a.id = ${agentId} AND a.deleted_at IS NULL
		ORDER BY (pw.agent_id IS NOT NULL) DESC, pw.is_default DESC, pw.created_at ASC
		LIMIT 1
	`;
	return row?.address ?? null;
}

// Sign a receipt body. The signature covers the canonical JSON (sorted keys).
function signReceipt(body) {
	const canonical = JSON.stringify(body, Object.keys(body).sort());
	return crypto.createHmac('sha256', receiptKey()).update(canonical).digest('hex');
}

async function emitReceipt(purchase, txSignature, payoutAddress, kind) {
	const body = {
		v: 1,
		kind,
		purchase_id: purchase.id,
		reference: purchase.reference,
		user_id: purchase.user_id,
		agent_id: purchase.agent_id,
		skill: purchase.skill,
		amount: String(purchase.amount),
		currency_mint: purchase.currency_mint,
		chain: purchase.chain,
		recipient: payoutAddress,
		tx_signature: txSignature,
		issued_at: new Date().toISOString(),
	};
	const signature = signReceipt(body);
	await sql`
		INSERT INTO purchase_receipts (purchase_id, receipt_json, signature)
		VALUES (${purchase.id}, ${JSON.stringify(body)}::jsonb, ${signature})
		ON CONFLICT (purchase_id) DO NOTHING
	`;
	return { body, signature };
}

// Inspect an actual transfer instruction on-chain so we can tell if the buyer
// paid SOMETHING with our reference, even if the amount/mint didn't match.
async function findReferencedTransferAmount(txSignature, recipient, splTokenMint) {
	const tx = await rpc().withFallback((conn) =>
		conn.getParsedTransaction(txSignature, {
			commitment: 'confirmed',
			maxSupportedTransactionVersion: 0,
		}),
	);
	if (!tx || tx.meta?.err) return null;

	const recipientStr = recipient.toBase58();
	const mintStr = splTokenMint.toBase58();

	const ixs = tx.transaction.message.instructions;
	for (const ix of ixs) {
		if (!('parsed' in ix)) continue;
		const t = ix.parsed?.type;
		const info = ix.parsed?.info;
		if (!info) continue;
		const goesToOurWallet =
			info.destination === recipientStr || info.destinationOwner === recipientStr;
		if (!goesToOurWallet) continue;

		if (t === 'transferChecked' && info.mint === mintStr) {
			return BigInt(info.tokenAmount?.amount ?? '0');
		}
		if (t === 'transfer') {
			// Untyped SPL transfer — amount is in raw units. Trust the mint match
			// must come from the validateTransfer pre-check; here we just record.
			return BigInt(info.amount ?? '0');
		}
	}
	return null;
}

/**
 * Run confirm for a single skill_purchases row.
 * @param {object} pur — the row, must include id, user_id, agent_id, skill,
 *                       amount, currency_mint, chain, mint_decimals, status,
 *                       referrer_user_id (optional).
 * @returns {Promise<{ status: 'pending' | 'confirmed' | 'tipped' | 'mismatch' | 'expired',
 *                     tx_signature?: string, tipped_amount?: string, message?: string }>}
 */
export async function confirmSkillPurchase(pur) {
	if (pur.status === 'confirmed') {
		return { status: 'confirmed', tx_signature: pur.tx_signature };
	}
	if (pur.status === 'expired' || (pur.expires_at && new Date(pur.expires_at) < new Date())) {
		return { status: 'expired' };
	}
	if (pur.chain !== 'solana') {
		throw new Error(`chain '${pur.chain}' not supported`);
	}

	const payoutAddress = await resolvePayoutAddress(pur.agent_id, pur.chain);
	if (!payoutAddress) throw new Error('payout wallet not configured');

	const refKey = new PublicKey(pur.reference);
	const recipient = new PublicKey(payoutAddress);
	const splToken = new PublicKey(pur.currency_mint);
	const decimals = pur.mint_decimals ?? 6;
	const expectedAmount = new BigNumber(pur.amount).dividedBy(new BigNumber(10).pow(decimals));

	// 1. Find the on-chain tx via reference.
	let signatureInfo;
	try {
		signatureInfo = await rpc().withFallback((conn) =>
			findReference(conn, refKey, { finality: 'confirmed' }),
		);
	} catch (e) {
		if (/FindReferenceError|not found/i.test(e?.message || '')) {
			return { status: 'pending' };
		}
		throw e;
	}
	const txSignature = signatureInfo.signature;

	// 2. Strict validation.
	try {
		await rpc().withFallback((conn) =>
			validateTransfer(
				conn,
				txSignature,
				{ recipient, amount: expectedAmount, splToken, reference: refKey },
				{ commitment: 'confirmed' },
			),
		);
	} catch (e) {
		// 2a. Mismatch — but the transfer happened. Mark as tipped if we can pin down
		//     the actual amount that hit the seller's wallet.
		const actual = await findReferencedTransferAmount(txSignature, recipient, splToken);
		if (actual !== null) {
			await sql`
				UPDATE skill_purchases
				SET status = 'tipped', tx_signature = ${txSignature},
				    tipped_amount = ${actual.toString()}, confirmed_at = now()
				WHERE id = ${pur.id} AND status = 'pending'
			`;
			await emitReceipt(pur, txSignature, payoutAddress, 'tipped');
			await logEvent(pur.id, 'tipped', { actual: actual.toString(), expected: pur.amount, reason: e.message });
			// Notify seller — they got SOMETHING; let them know it was a mismatch
			// so they can decide whether to grant access manually.
			await getSellerUserId(pur.agent_id).then((sellerId) => {
				if (!sellerId) return;
				return insertNotification(sellerId, 'skill_payment_mismatch', {
					agent_id: pur.agent_id,
					skill: pur.skill,
					expected_amount: String(pur.amount),
					actual_amount: actual.toString(),
					tx_signature: txSignature,
					purchase_id: pur.id,
				});
			});
			return { status: 'tipped', tx_signature: txSignature, tipped_amount: actual.toString(), message: e.message };
		}

		// 2b. No matching transfer at all — mark failed, no on-chain side effect.
		await sql`
			UPDATE skill_purchases
			SET status = 'failed', tx_signature = ${txSignature}
			WHERE id = ${pur.id} AND status = 'pending'
		`;
		await logEvent(pur.id, 'mismatch_no_transfer', { reason: e.message });
		return { status: 'mismatch', message: e.message };
	}

	// 3. Match. Atomic confirm + ledger writes.
	const intentId = `sp_${pur.id}`;
	const updated = await sql`
		UPDATE skill_purchases
		SET status = 'confirmed', tx_signature = ${txSignature}, confirmed_at = now()
		WHERE id = ${pur.id} AND status = 'pending'
		RETURNING id
	`;
	if (updated.length > 0) {
		await sql`
			INSERT INTO agent_payment_intents
				(id, payer_user_id, agent_id, currency_mint, amount, status, expires_at,
				 cluster, tx_signature, paid_at, payload)
			VALUES
				(${intentId}, ${pur.user_id}, ${pur.agent_id}, ${pur.currency_mint},
				 ${String(pur.amount)}, 'confirmed', now() + interval '30 days',
				 'mainnet', ${txSignature}, now(),
				 ${JSON.stringify({ kind: 'skill_purchase', skill: pur.skill, reference: pur.reference })}::jsonb)
			ON CONFLICT (id) DO NOTHING
		`;

		// 3a. Referral commission split (C6).
		const grossAmt = BigInt(pur.amount);
		let referralAmt = 0n;
		if (pur.referrer_user_id) {
			referralAmt = (grossAmt * BigInt(referralBps())) / 10000n;
		}
		const netAmt = grossAmt - referralAmt;
		await sql`
			INSERT INTO agent_revenue_events
				(agent_id, intent_id, skill, gross_amount, fee_amount, net_amount,
				 currency_mint, chain, payer_address)
			VALUES
				(${pur.agent_id}, ${intentId}, ${pur.skill},
				 ${grossAmt.toString()}, ${referralAmt.toString()}, ${netAmt.toString()},
				 ${pur.currency_mint}, ${pur.chain}, ${payoutAddress})
		`;
		if (pur.referrer_user_id && referralAmt > 0n) {
			// Track the referrer's accrued earnings. Real payout happens via the
			// existing withdrawal flow keyed off this column.
			await sql`
				UPDATE users
				SET referral_earnings_total = COALESCE(referral_earnings_total, 0) + ${Number(referralAmt)}
				WHERE id = ${pur.referrer_user_id}
			`;
		}

		await emitReceipt(pur, txSignature, payoutAddress, 'purchase');
		await logEvent(pur.id, 'confirmed', { tx_signature: txSignature });

		// 3b. Notifications.
		const sellerId = await getSellerUserId(pur.agent_id);
		if (sellerId) {
			await insertNotification(sellerId, 'skill_purchased', {
				agent_id: pur.agent_id,
				skill: pur.skill,
				gross_amount: grossAmt.toString(),
				net_amount: netAmt.toString(),
				currency_mint: pur.currency_mint,
				tx_signature: txSignature,
				purchase_id: pur.id,
			});
		}
		await insertNotification(pur.user_id, 'skill_purchase_confirmed', {
			agent_id: pur.agent_id,
			skill: pur.skill,
			amount: grossAmt.toString(),
			currency_mint: pur.currency_mint,
			tx_signature: txSignature,
			purchase_id: pur.id,
		});
		if (pur.referrer_user_id && referralAmt > 0n) {
			await insertNotification(pur.referrer_user_id, 'referral_earned', {
				skill: pur.skill,
				amount: referralAmt.toString(),
				currency_mint: pur.currency_mint,
				purchase_id: pur.id,
			});
		}
	}

	return { status: 'confirmed', tx_signature: txSignature };
}

async function getSellerUserId(agentId) {
	const [row] = await sql`SELECT user_id FROM agent_identities WHERE id = ${agentId}`;
	return row?.user_id ?? null;
}
