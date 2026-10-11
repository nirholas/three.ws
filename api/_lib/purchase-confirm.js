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
import { insertNotification, emailAllowedForType } from './notify.js';
import { verifyEvmUsdcPayment, evmChainId } from './evm-payment-verify.js';
import { sendPurchaseReceiptEmail, sendSaleNotificationEmail } from './email.js';
import { creditReferralCommission } from './referrals.js';
import { resolveListingSplit, recordSplitDistribution } from './splits.js';
import { recordOnchainLicenseForPurchase } from './skill-license-issue.js';

const APP_ORIGIN = process.env.APP_ORIGIN || 'https://three.ws';

// USDC and most SPL skill prices use 6 decimals. Render atomic units as a human
// amount (e.g. 1500000 → "1.50") for receipts/notifications.
function formatAmount(atomics, decimals = 6) {
	try {
		const n = Number(BigInt(atomics)) / 10 ** decimals;
		return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
	} catch {
		return String(atomics);
	}
}

// Best-effort symbol for the currency shown in emails. The platform's only
// settlement asset is USDC; fall back to a short mint label otherwise.
function currencyLabel(mint) {
	if (!mint) return 'USDC';
	const m = String(mint);
	if (/usdc/i.test(m)) return 'USDC';
	return m.length > 10 ? `${m.slice(0, 4)}…${m.slice(-4)}` : m;
}

// Explorer URL for a confirmed payment, by chain.
function txExplorerUrl(chain, txSignature) {
	if (!txSignature) return null;
	if (chain === 'solana') return `https://solscan.io/tx/${txSignature}`;
	if (evmChainId(chain) && /^base/i.test(String(chain))) return `https://basescan.org/tx/${txSignature}`;
	if (evmChainId(chain)) return `https://basescan.org/tx/${txSignature}`;
	return null;
}

// Real, sendable email for a user. Skips missing addresses and the synthetic
// `…@privy.local` placeholders minted for wallet-only Privy accounts — those are
// not deliverable mailboxes.
async function getUserEmail(userId) {
	if (!userId) return null;
	try {
		const [row] = await sql`SELECT email FROM users WHERE id = ${userId} AND deleted_at IS NULL`;
		const email = row?.email;
		if (!email || /@privy\.local$/i.test(email)) return null;
		return email;
	} catch {
		return null;
	}
}

async function getAgentName(agentId) {
	try {
		const [row] = await sql`SELECT name FROM agent_identities WHERE id = ${agentId}`;
		return row?.name || null;
	} catch {
		return null;
	}
}

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
		crypto
			.createHash('sha256')
			.update((process.env.SESSION_SECRET || 'dev') + ':receipts')
			.digest('hex')
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
		 AND pw.approved_at IS NOT NULL AND pw.effective_at <= now()
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
		...(purchase.recipient_user_id && purchase.recipient_user_id !== purchase.user_id
			? { recipient_user_id: purchase.recipient_user_id }
			: {}),
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
			maxSupportedTransactionVersion: 1,
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

// Verify the platform-fee leg: the treasury's token account for `splTokenMint`
// must have increased by at least `minAtomics` in this transaction. The fee leg
// carries no Solana-Pay reference of its own (the reference rides the seller
// leg, which validateTransfer checks), so we confirm it by the same balance-
// delta technique @solana/pay uses — matched on the parsed token balance's
// `owner`, which is robust to versioned txs and ATA addressing.
async function feeLegSatisfied(txSignature, feeWallet, splTokenMint, minAtomics) {
	if (minAtomics <= 0n) return true;
	const tx = await rpc().withFallback((conn) =>
		conn.getParsedTransaction(txSignature, {
			commitment: 'confirmed',
			maxSupportedTransactionVersion: 1,
		}),
	);
	if (!tx || tx.meta?.err) return false;

	const mintStr = splTokenMint.toBase58();
	const matches = (b) => b && b.mint === mintStr && b.owner === feeWallet;
	const pre = tx.meta.preTokenBalances?.find(matches);
	const post = tx.meta.postTokenBalances?.find(matches);
	const preAmt = BigInt(pre?.uiTokenAmount?.amount ?? '0');
	const postAmt = BigInt(post?.uiTokenAmount?.amount ?? '0');
	return postAmt - preAmt >= minAtomics;
}

/**
 * Run confirm for a single skill_purchases row.
 * @param {object} pur — the row, must include id, user_id, agent_id, skill,
 *                       amount, currency_mint, chain, mint_decimals, status,
 *                       referrer_user_id (optional).
 * @returns {Promise<{ status: 'pending' | 'confirmed' | 'tipped' | 'mismatch' | 'expired',
 *                     tx_signature?: string, tipped_amount?: string, message?: string }>}
 */
export async function confirmSkillPurchase(pur, opts = {}) {
	if (pur.status === 'confirmed') {
		return { status: 'confirmed', tx_signature: pur.tx_signature };
	}
	if (pur.status === 'expired' || (pur.expires_at && new Date(pur.expires_at) < new Date())) {
		return { status: 'expired' };
	}

	let payoutAddress = await resolvePayoutAddress(pur.agent_id, pur.chain);

	// Multi-collaborator routing: when this listing has an on-chain (0xSplits)
	// split, the creator's net must flow INTO the split contract so 0xSplits
	// distributes to each collaborator trustlessly. For EVM listings we verify
	// the payment reached the split address instead of the owner's wallet. Solana
	// splits stay ledger-mode (0xSplits is EVM-only) and pay the owner wallet,
	// with each collaborator's exact share recorded in split_distributions.
	const split = await resolveListingSplit(sql, pur.agent_id, pur.skill).catch(() => null);
	if (split?.split_mode === 'onchain' && split.split_address && evmChainId(pur.chain)) {
		payoutAddress = split.split_address;
	}
	if (!payoutAddress) throw new Error('payout wallet not configured');

	if (pur.chain === 'solana') return confirmSolanaSkill(pur, payoutAddress, split);
	if (evmChainId(pur.chain)) return confirmEvmSkill(pur, payoutAddress, opts.txHash, split);
	throw new Error(`chain '${pur.chain}' not supported`);
}

// Solana path: locate the tx via Solana-Pay reference, then validateTransfer.
async function confirmSolanaSkill(pur, payoutAddress, split = null) {
	const refKey = new PublicKey(pur.reference);
	const recipient = new PublicKey(payoutAddress);
	const splToken = new PublicKey(pur.currency_mint);
	const decimals = pur.mint_decimals ?? 6;
	const pow = new BigNumber(10).pow(decimals);
	const fullAtomics = new BigNumber(pur.amount);
	const feeAtomics = new BigNumber(pur.platform_fee_amount || 0);
	const feeWallet = pur.platform_fee_wallet || null;

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

	// 2. Strict validation. When a platform fee applies, the buyer's wallet signs
	// ONE transaction with two legs — (price − fee) to the seller and the fee to
	// the treasury — and we verify BOTH (the reference, proven above, is shared by
	// the whole tx). A mobile Solana-Pay QR can't express a split, so we also
	// accept a single full-amount transfer to the seller (no platform fee taken on
	// that path): a buyer who paid the full price is never blocked.
	const validateLeg = (who, amountAtomics) =>
		rpc().withFallback((conn) =>
			validateTransfer(
				conn,
				txSignature,
				{ recipient: who, amount: amountAtomics.dividedBy(pow), splToken, reference: refKey },
				{ commitment: 'confirmed' },
			),
		);

	const attempts = [];
	if (feeAtomics.gt(0) && feeWallet) {
		attempts.push({ creator: fullAtomics.minus(feeAtomics), feeTaken: feeAtomics, feeWallet });
	}
	attempts.push({ creator: fullAtomics, feeTaken: new BigNumber(0), feeWallet: null });

	let matched = null;
	let lastErr = null;
	for (const a of attempts) {
		try {
			// Seller leg: reference-bound, checked by @solana/pay (verifies the
			// reference rides the FINAL instruction and the seller received ≥ leg).
			await validateLeg(recipient, a.creator);
			// Fee leg: balance-delta on the treasury's token account.
			if (a.feeTaken.gt(0)) {
				const ok = await feeLegSatisfied(
					txSignature,
					a.feeWallet,
					splToken,
					BigInt(a.feeTaken.toFixed(0)),
				);
				if (!ok) throw new Error('platform fee leg missing or short');
			}
			matched = a;
			break;
		} catch (e) {
			lastErr = e;
		}
	}

	if (!matched) {
		// Mismatch — but the transfer happened. Mark as tipped if we can pin down
		// the actual amount that hit the seller's wallet; else mark failed.
		const reason = lastErr?.message || 'on-chain transfer did not match expected';
		const actual = await findReferencedTransferAmount(txSignature, recipient, splToken);
		if (actual !== null)
			return markSkillTipped(pur, txSignature, actual.toString(), reason, payoutAddress);
		return markSkillMismatch(pur, txSignature, reason);
	}

	return finalizeSkillConfirmation(pur, txSignature, payoutAddress, matched.feeTaken.toFixed(0), split);
}

// EVM path: the buyer submits the settlement tx hash; verify a USDC transfer of
// at least the price reached the seller's payout wallet on Base.
async function confirmEvmSkill(pur, payoutAddress, txHash, split = null) {
	if (!txHash) return { status: 'pending' }; // buyer hasn't broadcast / submitted yet

	// Idempotency pre-check: one settlement tx can confirm at most one purchase.
	// Covers rows in ANY status — a concurrent confirm parks the hash on a
	// still-'pending' row via the atomic claim below, and the unique index on
	// skill_purchases.tx_signature is the hard backstop either way.
	const [dupe] = await sql`
		SELECT id FROM skill_purchases
		WHERE tx_signature = ${txHash} AND id != ${pur.id}
		LIMIT 1
	`;
	if (dupe)
		return {
			status: 'mismatch',
			message: 'this transaction has already been used for another purchase',
		};

	const result = await verifyEvmUsdcPayment({
		txHash,
		chain: pur.chain,
		recipient: payoutAddress,
		expectedAmount: pur.amount,
	});
	if (result.status === 'pending') return { status: 'pending' };

	// Bind the on-chain payment to the buyer. The seller's payout address is
	// public, so "a USDC transfer to the seller exists" is not proof THIS buyer
	// paid — without binding, anyone could confirm a public transfer against
	// their own purchase. EVM USDC transfers carry no reference (unlike the
	// Solana-Pay path), so we bind on the payer address: the funds must
	// originate from a wallet linked to the buyer's account. Mirrors
	// api/payments/evm/[action].js. No DB write on failure — the buyer can
	// link the paying wallet and retry the same tx hash.
	if (result.from) {
		const payer = result.from.toLowerCase();
		const [linked] = await sql`
			SELECT 1 FROM user_wallets
			WHERE user_id = ${pur.user_id} AND lower(address) = ${payer}
			LIMIT 1
		`;
		if (!linked) {
			return {
				status: 'mismatch',
				message:
					'payment must be sent from a wallet linked to your account — link the paying wallet, then retry',
			};
		}
	} else if (result.status === 'match') {
		return {
			status: 'mismatch',
			message: 'could not determine payer address from transaction',
		};
	}

	// Atomically claim the tx hash for THIS purchase before any ledger write.
	// The unique index on skill_purchases.tx_signature turns a concurrent claim
	// of the same hash for another purchase into a 23505, surfaced as a clean
	// mismatch instead of a double-confirm.
	let claimed;
	try {
		claimed = await sql`
			UPDATE skill_purchases
			SET tx_signature = ${txHash}
			WHERE id = ${pur.id} AND status = 'pending'
			  AND (tx_signature IS NULL OR tx_signature = ${txHash})
			RETURNING id
		`;
	} catch (e) {
		if (e?.code === '23505') {
			return {
				status: 'mismatch',
				message: 'this transaction has already been used for another purchase',
			};
		}
		throw e;
	}
	if (claimed.length === 0) {
		// Row is no longer pending (or carries a different hash) — report the
		// settled state instead of double-processing.
		const [row] =
			await sql`SELECT status, tx_signature FROM skill_purchases WHERE id = ${pur.id}`;
		if (row?.status === 'confirmed')
			return { status: 'confirmed', tx_signature: row.tx_signature };
		if (row?.status === 'tipped') return { status: 'tipped', tx_signature: row.tx_signature };
		return { status: 'mismatch', message: 'purchase is no longer pending' };
	}

	if (result.status === 'mismatch') {
		// A short-but-real transfer is a tip; nothing on-chain at all is a mismatch.
		if (result.actualAmount && BigInt(result.actualAmount) > 0n) {
			return markSkillTipped(
				pur,
				txHash,
				result.actualAmount,
				result.message || 'amount mismatch',
				payoutAddress,
			);
		}
		return markSkillMismatch(pur, txHash, result.message || 'no matching transfer');
	}
	return finalizeSkillConfirmation(pur, txHash, payoutAddress, '0', split);
}

// Seller received some funds against this purchase, but not the exact expected
// amount — record it as 'tipped' so the money is acknowledged and the seller can
// grant access manually. Shared by both chains.
async function markSkillTipped(pur, txSignature, actualAmount, reason, payoutAddress) {
	await sql`
		UPDATE skill_purchases
		SET status = 'tipped', tx_signature = ${txSignature},
		    tipped_amount = ${actualAmount}, confirmed_at = now()
		WHERE id = ${pur.id} AND status = 'pending'
	`;
	await emitReceipt(pur, txSignature, payoutAddress, 'tipped');
	await logEvent(pur.id, 'tipped', { actual: actualAmount, expected: pur.amount, reason });
	const sellerId = await getSellerUserId(pur.agent_id);
	if (sellerId) {
		await insertNotification(sellerId, 'skill_payment_mismatch', {
			agent_id: pur.agent_id,
			skill: pur.skill,
			expected_amount: String(pur.amount),
			actual_amount: actualAmount,
			tx_signature: txSignature,
			purchase_id: pur.id,
		});
	}
	return {
		status: 'tipped',
		tx_signature: txSignature,
		tipped_amount: actualAmount,
		message: reason,
	};
}

// No matching transfer at all — mark failed, no on-chain side effect.
async function markSkillMismatch(pur, txSignature, reason) {
	await sql`
		UPDATE skill_purchases
		SET status = 'failed', tx_signature = ${txSignature}
		WHERE id = ${pur.id} AND status = 'pending'
	`;
	await logEvent(pur.id, 'mismatch_no_transfer', { reason });
	return { status: 'mismatch', message: reason };
}

// Atomic confirm + ledger writes. Identical for Solana and EVM once a valid
// payment is proven, so both chains converge here. `txSignature` is the Solana
// signature or the EVM tx hash.
async function finalizeSkillConfirmation(pur, txSignature, payoutAddress, platformFeeAtomics = '0', split = null) {
	const intentId = `sp_${pur.id}`;
	const updated = await sql`
		UPDATE skill_purchases
		SET status = 'confirmed', tx_signature = ${txSignature}, confirmed_at = now()
		WHERE id = ${pur.id} AND status = 'pending'
		RETURNING id, kind, valid_until
	`;
	if (updated.length > 0) {
		// Grant skill access to the BENEFICIARY. For a gift that's the recipient
		// (recipient_user_id); for a normal purchase it's the payer (user_id).
		// Permanent purchases get a non-expiring grant; time-passes expire at their
		// valid_until window. skill_access_grants is the authoritative access
		// record; skill_purchases tracks payment.
		const beneficiaryId = pur.recipient_user_id || pur.user_id;
		const isGift = !!pur.recipient_user_id && pur.recipient_user_id !== pur.user_id;
		const confirmedRow = updated[0];
		const grantExpiresAt = confirmedRow.kind === 'time_pass' && confirmedRow.valid_until
			? confirmedRow.valid_until
			: null;
		try {
			await sql`
				INSERT INTO skill_access_grants
					(user_id, agent_id, skill_name, purchase_id, expires_at)
				VALUES
					(${beneficiaryId}, ${pur.agent_id}, ${pur.skill}, ${pur.id}, ${grantExpiresAt})
				ON CONFLICT (user_id, agent_id, skill_name) DO UPDATE
					SET expires_at  = EXCLUDED.expires_at,
					    purchase_id = EXCLUDED.purchase_id,
					    updated_at  = now()
			`;
		} catch (e) {
			// If the table doesn't exist (pre-migration) don't block payment confirm —
			// access is still tracked via skill_purchases status = 'confirmed'.
			if (!e?.message?.includes('does not exist')) throw e;
			console.warn('[purchase-confirm] skill_access_grants table missing, skipping grant');
		}

		await sql`
			INSERT INTO agent_payment_intents
				(id, payer_user_id, agent_id, currency_mint, amount, status, expires_at,
				 cluster, tx_signature, paid_at, payload)
			VALUES
				(${intentId}, ${pur.user_id}, ${pur.agent_id}, ${pur.currency_mint},
				 ${String(pur.amount)}, 'confirmed', now() + interval '30 days',
				 ${pur.chain === 'solana' ? 'mainnet' : pur.chain}, ${txSignature}, now(),
				 ${JSON.stringify({ kind: 'skill_purchase', skill: pur.skill, reference: pur.reference })}::jsonb)
			ON CONFLICT (id) DO NOTHING
		`;

		// 3a. Split the gross: platform fee (collected on-chain by the treasury),
		// referral commission (C6, accrued to the referrer), and the creator's net.
		const grossAmt = BigInt(pur.amount);
		const platformFee = (() => {
			try { return BigInt(platformFeeAtomics || '0'); } catch { return 0n; }
		})();
		let referralAmt = 0n;
		if (pur.referrer_user_id) {
			referralAmt = (grossAmt * BigInt(referralBps())) / 10000n;
		}
		const netAmt = grossAmt - platformFee - referralAmt;
		// settled_to_wallet: the buyer paid the seller's payout wallet (or its
		// split contract) directly, so the seller already holds this money. Left
		// false, the withdrawal ledger counted it as a treasury liability and the
		// payout cron paid it a second time from the treasury.
		await sql`
			INSERT INTO agent_revenue_events
				(agent_id, intent_id, skill, gross_amount, fee_amount, platform_fee_amount,
				 net_amount, currency_mint, chain, payer_address, settled_to_wallet)
			VALUES
				(${pur.agent_id}, ${intentId}, ${pur.skill},
				 ${grossAmt.toString()}, ${referralAmt.toString()}, ${platformFee.toString()},
				 ${netAmt.toString()}, ${pur.currency_mint}, ${pur.chain}, ${payoutAddress}, true)
			ON CONFLICT (intent_id) DO NOTHING
		`;

		// 3a-bis. Multi-collaborator split: apportion the creator's net across the
		// listing's recipients and record each one's exact share. Idempotent per
		// (purchase, address). In on-chain mode the net already flowed into the
		// 0xSplits contract (rows are informational/settled); in ledger mode each
		// recipient withdraws their accrued share. Never blocks the confirmed
		// payment — a split ledger failure degrades to the seller-net record above.
		if (split?.recipients?.length) {
			try {
				await recordSplitDistribution(sql, {
					purchaseId: pur.id,
					split,
					netAtomics: netAmt,
					currencyMint: pur.currency_mint,
					chain: pur.chain,
				});
				await logEvent(pur.id, 'split_recorded', {
					split_id: split.id,
					mode: split.split_mode,
					recipients: split.recipients.length,
					net: netAmt.toString(),
				});
			} catch (e) {
				console.error('[purchase-confirm] split distribution failed', e?.message);
			}
		}

		// 3a-ter. Mint the trustless on-chain skill license to the beneficiary so
		// entitlement can be verified against Solana, not just our DB. Best-effort:
		// degrades cleanly when the minter key is unset or the program is undeployed
		// (recordOnchainLicenseForPurchase never throws into the confirm path).
		recordOnchainLicenseForPurchase(sql, pur).catch((e) =>
			console.error('[purchase-confirm] license mint failed', e?.message),
		);

		if (pur.referrer_user_id && referralAmt > 0n) {
			// Credit the referrer's accrued earnings AND fire the commission email.
			// Real payout happens via the existing withdrawal flow keyed off the
			// referral_earnings_total column. Best-effort; never blocks confirm.
			try {
				const buyerHandle = await getUserDisplay(pur.user_id);
				await creditReferralCommission({
					referrerUserId: pur.referrer_user_id,
					amountAtomics: referralAmt,
					currency: currencyLabel(pur.currency_mint),
					fromHandle: buyerHandle,
					skillName: pur.skill,
				});
			} catch (e) {
				console.error('[purchase-confirm] referral commission credit failed', e?.message);
			}
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
				gift: isGift,
			});
		}
		if (isGift) {
			// Tell the recipient they were gifted access, and confirm delivery to
			// the buyer. Names are best-effort, resolved from public profile fields.
			const [gifterName, recipientName] = await Promise.all([
				getUserDisplay(pur.user_id),
				getUserDisplay(beneficiaryId),
			]);
			// No tx_signature here on purpose: the recipient didn't pay, so the
			// notification links to the agent page (where they can use the skill)
			// rather than an on-chain payment they have nothing to do with.
			await insertNotification(beneficiaryId, 'skill_gift_received', {
				agent_id: pur.agent_id,
				skill: pur.skill,
				from: gifterName,
				from_user_id: pur.user_id,
				currency_mint: pur.currency_mint,
				purchase_id: pur.id,
			});
			await insertNotification(pur.user_id, 'skill_gift_sent', {
				agent_id: pur.agent_id,
				skill: pur.skill,
				to: recipientName,
				to_user_id: beneficiaryId,
				amount: grossAmt.toString(),
				currency_mint: pur.currency_mint,
				tx_signature: txSignature,
				purchase_id: pur.id,
			});
		} else {
			await insertNotification(pur.user_id, 'skill_purchase_confirmed', {
				agent_id: pur.agent_id,
				skill: pur.skill,
				amount: grossAmt.toString(),
				currency_mint: pur.currency_mint,
				tx_signature: txSignature,
				purchase_id: pur.id,
			});
		}
		if (pur.referrer_user_id && referralAmt > 0n) {
			await insertNotification(pur.referrer_user_id, 'referral_earned', {
				skill: pur.skill,
				amount: referralAmt.toString(),
				currency_mint: pur.currency_mint,
				purchase_id: pur.id,
			});
		}

		// 3c. Transactional emails — best-effort, fully isolated from the critical
		// path. A send failure (or missing creds) must never affect the confirmed
		// payment, the access grant, or the response. These complement the in-app
		// notifications above; they do not replace them.
		await sendPurchaseEmails({
			pur,
			txSignature,
			sellerId,
			grossAmt,
			netAmt,
		}).catch((e) => console.error('[purchase-confirm] email dispatch failed', e?.message));
	}

	return { status: 'confirmed', tx_signature: txSignature };
}

// ── Bundle verification ───────────────────────────────────────────────────────
//
// A bundle is ONE payment for the whole-bundle price. This proves that payment
// on-chain before any skill is unlocked, reusing the exact primitives the
// single-skill path uses (Solana-Pay reference + validateTransfer, treasury
// fee-leg balance delta, EVM payer-binding). The caller performs the DB writes
// (mark confirmed, unlock skills, record revenue) only on { status: 'confirmed' }.
//
// @param {object} b — { chain, reference, txHash, recipient, currencyMint,
//                       priceAtomics, feeAtomics, feeWallet, decimals, userId }
// @returns {Promise<{ status: 'confirmed'|'pending'|'mismatch', txSignature?: string, message?: string }>}
export async function verifyBundlePayment(b) {
	const recipient = await resolvePayoutAddress(b.agentId, b.chain);
	if (!recipient) throw new Error('payout wallet not configured');
	if (b.chain === 'solana') return verifyBundleSolana(b, recipient);
	if (evmChainId(b.chain)) return verifyBundleEvm(b, recipient);
	throw new Error(`chain '${b.chain}' not supported`);
}

async function verifyBundleSolana(b, payoutAddress) {
	if (!b.reference) return { status: 'mismatch', message: 'purchase is missing its payment reference' };
	const refKey = new PublicKey(b.reference);
	const recipient = new PublicKey(payoutAddress);
	const splToken = new PublicKey(b.currencyMint);
	const pow = new BigNumber(10).pow(b.decimals ?? 6);
	const fullAtomics = new BigNumber(b.priceAtomics);
	const feeAtomics = new BigNumber(b.feeAtomics || 0);

	let signatureInfo;
	try {
		signatureInfo = await rpc().withFallback((conn) =>
			findReference(conn, refKey, { finality: 'confirmed' }),
		);
	} catch (e) {
		if (/FindReferenceError|not found/i.test(e?.message || '')) return { status: 'pending' };
		throw e;
	}
	const txSignature = signatureInfo.signature;

	const validateLeg = (who, amountAtomics) =>
		rpc().withFallback((conn) =>
			validateTransfer(
				conn,
				txSignature,
				{ recipient: who, amount: amountAtomics.dividedBy(pow), splToken, reference: refKey },
				{ commitment: 'confirmed' },
			),
		);

	const attempts = [];
	if (feeAtomics.gt(0) && b.feeWallet)
		attempts.push({ creator: fullAtomics.minus(feeAtomics), feeTaken: feeAtomics, feeWallet: b.feeWallet });
	attempts.push({ creator: fullAtomics, feeTaken: new BigNumber(0), feeWallet: null });

	let matched = null;
	let lastErr = null;
	for (const a of attempts) {
		try {
			await validateLeg(recipient, a.creator);
			if (a.feeTaken.gt(0)) {
				const ok = await feeLegSatisfied(txSignature, a.feeWallet, splToken, BigInt(a.feeTaken.toFixed(0)));
				if (!ok) throw new Error('platform fee leg missing or short');
			}
			matched = a;
			break;
		} catch (e) {
			lastErr = e;
		}
	}
	if (!matched)
		return { status: 'mismatch', message: lastErr?.message || 'on-chain transfer did not match expected' };
	return { status: 'confirmed', txSignature };
}

async function verifyBundleEvm(b, payoutAddress) {
	if (!b.txHash) return { status: 'pending' };
	const result = await verifyEvmUsdcPayment({
		txHash: b.txHash,
		chain: b.chain,
		recipient: payoutAddress,
		expectedAmount: b.priceAtomics,
	});
	if (result.status === 'pending') return { status: 'pending' };

	// Bind the on-chain payment to the buyer — a public transfer to the seller is
	// not proof THIS buyer paid. Mirror confirmEvmSkill: the payer must be a
	// wallet linked to the buyer's account.
	if (result.from) {
		const payer = result.from.toLowerCase();
		const [linked] = await sql`
			SELECT 1 FROM user_wallets WHERE user_id = ${b.userId} AND lower(address) = ${payer} LIMIT 1
		`;
		if (!linked)
			return {
				status: 'mismatch',
				message:
					'payment must be sent from a wallet linked to your account — link the paying wallet, then retry',
			};
	} else if (result.status === 'match') {
		return { status: 'mismatch', message: 'could not determine payer address from transaction' };
	}

	if (result.status !== 'match')
		return { status: 'mismatch', message: result.message || 'amount mismatch' };
	return { status: 'confirmed', txSignature: b.txHash };
}

async function getSellerUserId(agentId) {
	const [row] = await sql`SELECT user_id FROM agent_identities WHERE id = ${agentId}`;
	return row?.user_id ?? null;
}

// Send the buyer receipt + seller sale-notification for a confirmed purchase.
// Best-effort: each send is independently guarded so one failure never blocks
// the other, and the whole function is awaited under a .catch() at the call site
// so nothing here can break the confirmed payment. Skips users without a real,
// deliverable email (wallet-only / Privy accounts). sendEmail itself no-ops when
// RESEND_API_KEY is unset (dev/preview), so these are safe everywhere.
async function sendPurchaseEmails({ pur, txSignature, sellerId, grossAmt, netAmt }) {
	const decimals = pur.mint_decimals ?? 6;
	const currency = currencyLabel(pur.currency_mint);
	const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	const txUrl = txExplorerUrl(pur.chain, txSignature);
	const agentName = await getAgentName(pur.agent_id);
	const agentUrl = pur.agent_id ? `${APP_ORIGIN}/agents/${encodeURIComponent(pur.agent_id)}` : null;

	// Buyer receipt → the payer (the recipient of a gift didn't pay, so the
	// receipt always goes to whoever was charged). Gated by the buyer's email
	// preference for the 'purchases' category — honours the off switch.
	const buyerEmail = await getUserEmail(pur.user_id);
	if (buyerEmail && (await emailAllowedForType(pur.user_id, 'skill_purchase_confirmed'))) {
		await sendPurchaseReceiptEmail({
			to: buyerEmail,
			skillName: pur.skill,
			agentName,
			agentUrl,
			amount: formatAmount(grossAmt.toString(), decimals),
			currency,
			date,
			txUrl,
			txId: txSignature,
		}).catch((e) => console.error('[purchase-confirm] receipt email failed', e?.message));
	}

	// Seller sale-notification → the agent's owner, with net (post-fee, post-
	// referral) earnings and the buyer's public handle (never their email).
	if (sellerId && sellerId !== pur.user_id) {
		const sellerEmail = await getUserEmail(sellerId);
		// Gated by the seller's email preference for the 'sales' category.
		if (sellerEmail && (await emailAllowedForType(sellerId, 'skill_purchased'))) {
			const buyerHandle = await getUserDisplay(pur.user_id);
			await sendSaleNotificationEmail({
				to: sellerEmail,
				skillName: pur.skill,
				agentName,
				agentUrl,
				netAmount: formatAmount(netAmt.toString(), decimals),
				currency,
				buyerHandle,
				date,
				txUrl,
				txId: txSignature,
			}).catch((e) => console.error('[purchase-confirm] sale email failed', e?.message));
		}
	}
}

// Best-effort friendly label for a user (gift notifications). Username first,
// then display name, then a short id — never the email.
async function getUserDisplay(userId) {
	if (!userId) return null;
	try {
		const [row] = await sql`SELECT username, display_name FROM users WHERE id = ${userId}`;
		return row?.username || row?.display_name || `user ${String(userId).slice(0, 8)}`;
	} catch {
		return null;
	}
}
