// Self-serve plan changes: quotes, checkouts, confirmation and receipts.
//
// An upgrade is priced pro rata: the difference between the two plans' prices
// times the fraction of the current period still ahead, so moving up on day 20
// of 30 costs a third of the difference. Coming from Free starts a fresh
// 30-day period at the full price. A renewal extends the period by 30 days at
// the full price. A downgrade is never charged: it is scheduled and takes
// effect when the period ends (scheduleDevPlanChange).
//
// Three ways to pay:
//   credits  debited from the account balance in the same request.
//   USDC     the user's own wallet signs a transfer this module builds.
//   THREE    the same, at the discount the plan config sets.
// The server never signs anything. For a wallet payment the checkout holds the
// exact recipient, amount and asset the user is shown before they sign, and
// confirmation reads the landed transaction back from the chain.

import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	createAssociatedTokenAccountIdempotentInstruction,
	createTransferCheckedInstruction,
} from '@solana/spl-token';
import { sql } from '../db.js';
import { debitCredits } from '../credits.js';
import { insertNotification } from '../notify.js';
import { sendEmail } from '../email.js';
import { logAudit } from '../audit.js';
import { getTokenPriceUsd } from '../token/price.js';
import { usdToUsdcAtomics } from '../subscription-pricing.js';
import { assetConfig, treasuryWallet, assertWallet, verifyPassPayment } from '../premium.js';
import { solanaConnection } from '../solana/connection.js';
import { blockhashKey, getRecentBlockhashInfo } from '../solana/read-guards.js';
import {
	DEFAULT_DEV_PLAN_ID,
	DEV_PLAN_PERIOD_MS,
	DEV_PLAN_PAY_ASSETS,
	DEV_PLAN_MANAGE_URL,
	devPlanById,
	threeDiscountBps,
} from './config.js';
import { getDevSubscription, setDevSubscription, scheduleDevPlan, invalidateDevSubscription } from './subscription.js';

export const DEV_PLAN_CHECKOUT_TTL_MS = 10 * 60_000;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;

function fail(status, code, message, extra = {}) {
	return Object.assign(new Error(message), { status, code, expose: true, ...extra });
}

function cents(n) {
	return Math.round(n * 100) / 100;
}

function assertAsset(asset) {
	if (!DEV_PLAN_PAY_ASSETS.includes(asset)) throw fail(400, 'bad_asset', `asset must be one of: ${DEV_PLAN_PAY_ASSETS.join(', ')}`);
	return asset;
}

/**
 * Price a move to `planId` for the account's current subscription. Pure given
 * the subscription, so the dashboard can show the exact number before any
 * checkout exists.
 */
export function quoteDevPlanChange(sub, planId, asset = 'credits', now = new Date()) {
	assertAsset(asset);
	const target = devPlanById(planId);
	const current = sub.plan;
	if (!target.purchasable) throw fail(400, 'not_purchasable', `the ${target.name} plan cannot be bought here`);
	if (target.rank < current.rank) throw fail(400, 'downgrade_not_charged', 'a downgrade is scheduled for the end of the period, not bought; use the schedule endpoint');
	const periodStart = sub.periodStart.getTime();
	const periodEnd = sub.periodEnd.getTime();
	const nowMs = now.getTime();
	let kind;
	let amountUsd;
	let nextStart;
	let nextEnd;
	let remainingFraction = null;
	if (target.rank === current.rank) {
		kind = 'renew';
		amountUsd = target.priceUsd;
		nextStart = new Date(periodEnd);
		nextEnd = new Date(periodEnd + DEV_PLAN_PERIOD_MS);
	} else if (current.priceUsd === 0) {
		kind = 'upgrade';
		amountUsd = target.priceUsd;
		nextStart = now;
		nextEnd = new Date(nowMs + DEV_PLAN_PERIOD_MS);
	} else {
		kind = 'upgrade';
		remainingFraction = Math.min(1, Math.max(0, (periodEnd - nowMs) / (periodEnd - periodStart)));
		amountUsd = (target.priceUsd - current.priceUsd) * remainingFraction;
		nextStart = sub.periodStart;
		nextEnd = sub.periodEnd;
	}
	const discountBps = asset === 'THREE' ? threeDiscountBps() : 0;
	const listUsd = cents(amountUsd);
	amountUsd = cents(amountUsd * (1 - discountBps / 10_000));
	return {
		kind,
		asset,
		plan: target,
		from: current.id,
		amountUsd,
		listUsd,
		discountBps,
		remainingFraction,
		periodStart: nextStart,
		periodEnd: nextEnd,
		renewWith: asset,
	};
}

async function priceInAsset(asset, amountUsd) {
	if (asset === 'credits') return { atomics: null, assetUsd: null, priceSource: 'credits' };
	if (asset === 'USDC') return { atomics: BigInt(usdToUsdcAtomics(amountUsd)), assetUsd: null, priceSource: 'parity' };
	const { priceUsd, source } = await getTokenPriceUsd({});
	if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw fail(503, 'price_unavailable', '$THREE price unavailable right now; pay in USDC or credits, or retry shortly');
	const { decimals } = assetConfig('THREE');
	return { atomics: BigInt(Math.ceil((amountUsd / priceUsd) * 10 ** decimals)), assetUsd: priceUsd, priceSource: source };
}

async function buildTransferTx({ wallet, asset, atomics, payTo }) {
	const { mint, decimals } = assetConfig(asset);
	const buyer = new PublicKey(wallet);
	const dest = new PublicKey(payTo);
	const mintKey = new PublicKey(mint);
	const fromAta = getAssociatedTokenAddressSync(mintKey, buyer, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
	const toAta = getAssociatedTokenAddressSync(mintKey, dest, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
	const instructions = [
		createAssociatedTokenAccountIdempotentInstruction(buyer, toAta, dest, mintKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
		createTransferCheckedInstruction(fromAta, mintKey, toAta, buyer, atomics, decimals, [], TOKEN_PROGRAM_ID),
	];
	const conn = solanaConnection();
	const { blockhash } = await getRecentBlockhashInfo(conn, blockhashKey({ network: 'mainnet' }));
	const message = new TransactionMessage({ payerKey: buyer, recentBlockhash: blockhash, instructions }).compileToV0Message();
	return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

function publicCheckout(row) {
	return {
		id: row.id,
		plan: row.plan_id,
		kind: row.kind,
		asset: row.asset,
		wallet: row.wallet,
		pay_to: row.pay_to,
		chain: row.asset === 'credits' ? null : 'solana',
		amount_usd: Number(row.amount_usd),
		amount_atomics: row.amount_atomics == null ? null : String(row.amount_atomics),
		asset_usd: row.asset_usd == null ? null : Number(row.asset_usd),
		period_start: row.period_start,
		period_end: row.period_end,
		status: row.status,
		tx_signature: row.tx_signature,
		expires_at: row.expires_at,
		created_at: row.created_at,
	};
}

export function publicReceipt(row) {
	return {
		id: row.id,
		checkout_id: row.checkout_id,
		plan: row.plan_id,
		kind: row.kind,
		asset: row.asset,
		amount_usd: Number(row.amount_usd),
		amount_atomics: row.amount_atomics == null ? null : String(row.amount_atomics),
		tx_signature: row.tx_signature,
		ledger_id: row.ledger_id,
		period_start: row.period_start,
		period_end: row.period_end,
		created_at: row.created_at,
	};
}

/**
 * Open a checkout. Credits settle immediately and the result carries the
 * receipt. A wallet asset returns the unsigned transfer for the user to sign,
 * together with the recipient, amount and asset it moves.
 */
export async function createDevPlanCheckout({ userId, planId, asset, wallet = null, req = null }) {
	assertAsset(asset);
	const sub = await getDevSubscription(userId, { fresh: true });
	const quote = quoteDevPlanChange(sub, planId, asset);
	if (asset !== 'credits') assertWallet(wallet);
	let payTo = null;
	if (asset !== 'credits') {
		try {
			payTo = treasuryWallet();
			assetConfig(asset);
		} catch (err) {
			throw fail(503, 'payments_not_configured', `${asset} payments are not available right now; pay with credits or try again shortly`);
		}
	}
	const priced = await priceInAsset(asset, quote.amountUsd);
	const expiresAt = new Date(Date.now() + DEV_PLAN_CHECKOUT_TTL_MS).toISOString();

	sql`delete from dev_plan_checkouts where status = 'pending' and expires_at < now() - interval '7 days'`.catch(() => {});

	const [row] = await sql`
		insert into dev_plan_checkouts
			(user_id, plan_id, kind, asset, wallet, pay_to, amount_usd, amount_atomics, asset_usd, price_source, period_start, period_end, expires_at)
		values
			(${userId}, ${quote.plan.id}, ${quote.kind}, ${asset}, ${wallet}, ${payTo}, ${quote.amountUsd},
			 ${priced.atomics == null ? null : priced.atomics.toString()}, ${priced.assetUsd}, ${priced.priceSource},
			 ${quote.periodStart.toISOString()}, ${quote.periodEnd.toISOString()}, ${expiresAt})
		returning *
	`;

	if (asset === 'credits') {
		let ledgerId = null;
		if (quote.amountUsd > 0) {
			try {
				const debit = await debitCredits({
					userId,
					amountUsd: quote.amountUsd,
					action: `dev_plan_${quote.kind}`,
					refType: 'dev_plan_checkout',
					refId: row.id,
					idempotencyKey: `devplan:checkout:${row.id}`,
					meta: { plan: quote.plan.id, kind: quote.kind, from: quote.from },
				});
				ledgerId = debit.ledgerId || null;
			} catch (err) {
				await sql`update dev_plan_checkouts set status = 'failed' where id = ${row.id}`;
				if (err?.status === 402) {
					throw fail(402, 'insufficient_credits', `this ${quote.kind} costs $${quote.amountUsd.toFixed(2)} in credits and the balance is $${Number(err.available_usd ?? 0).toFixed(2)}`, {
						required_usd: quote.amountUsd,
						available_usd: Number(err.available_usd ?? 0),
						top_up_url: '/dashboard/billing',
					});
				}
				throw err;
			}
		}
		const receipt = await applyDevPlanCheckout(row, { ledgerId, req });
		return { checkout: publicCheckout({ ...row, status: 'paid' }), receipt, tx_base64: null };
	}

	const txBase64 = await buildTransferTx({ wallet, asset, atomics: priced.atomics, payTo });
	return { checkout: publicCheckout(row), receipt: null, tx_base64: txBase64 };
}

function receiptEmail({ plan, kind, asset, amountUsd, periodStart, periodEnd, txSignature }) {
	const verb = kind === 'renew' ? 'renewed' : 'upgraded to';
	const period = `${new Date(periodStart).toISOString().slice(0, 10)} to ${new Date(periodEnd).toISOString().slice(0, 10)}`;
	const subject = `Receipt: three.ws API ${plan.name} plan`;
	const text = [
		`Your developer API plan was ${verb} ${plan.name}.`,
		`Amount: $${amountUsd.toFixed(2)} paid in ${asset === 'THREE' ? '$THREE' : asset}.`,
		`Period: ${period}.`,
		`Included calls: ${plan.includedCalls.toLocaleString('en-US')} per period, ${plan.burstPerMinute.toLocaleString('en-US')} per minute, ${plan.concurrent} concurrent.`,
		txSignature ? `Transaction: https://solscan.io/tx/${txSignature}` : null,
		`Manage your plan: https://three.ws${DEV_PLAN_MANAGE_URL}`,
	].filter(Boolean).join('\n');
	const html = `<p>Your developer API plan was ${verb} <strong>${plan.name}</strong>.</p>
<p>Amount: <strong>$${amountUsd.toFixed(2)}</strong> paid in ${asset === 'THREE' ? '$THREE' : asset}.<br>Period: ${period}.</p>
<p>Included calls: ${plan.includedCalls.toLocaleString('en-US')} per period, ${plan.burstPerMinute.toLocaleString('en-US')} per minute, ${plan.concurrent} concurrent.</p>
${txSignature ? `<p>Transaction: <a href="https://solscan.io/tx/${txSignature}">${txSignature}</a></p>` : ''}
<p><a href="https://three.ws${DEV_PLAN_MANAGE_URL}">Manage your plan</a></p>`;
	return { subject, text, html };
}

/** Move the account onto the checkout's plan, write the receipt, tell the user. */
export async function applyDevPlanCheckout(checkout, { txSignature = null, ledgerId = null, req = null } = {}) {
	const plan = devPlanById(checkout.plan_id);
	const amountUsd = Number(checkout.amount_usd);
	await setDevSubscription(checkout.user_id, {
		planId: plan.id,
		periodStart: new Date(checkout.period_start),
		periodEnd: new Date(checkout.period_end),
		renewWith: checkout.asset,
		paidUsd: amountUsd,
	});
	const [receipt] = await sql`
		insert into dev_plan_receipts (user_id, checkout_id, plan_id, kind, asset, amount_usd, amount_atomics, tx_signature, ledger_id, period_start, period_end)
		values (${checkout.user_id}, ${checkout.id}, ${plan.id}, ${checkout.kind}, ${checkout.asset}, ${amountUsd},
			${checkout.amount_atomics == null ? null : String(checkout.amount_atomics)}, ${txSignature}, ${ledgerId},
			${checkout.period_start}, ${checkout.period_end})
		on conflict (checkout_id) do update set checkout_id = excluded.checkout_id
		returning *
	`;
	await sql`update dev_plan_checkouts set status = 'paid', tx_signature = coalesce(${txSignature}, tx_signature) where id = ${checkout.id}`;
	invalidateDevSubscription(checkout.user_id);
	logAudit({ userId: checkout.user_id, action: `dev_plan_${checkout.kind}`, resourceId: checkout.id, meta: { plan: plan.id, asset: checkout.asset, amount_usd: amountUsd }, req });
	insertNotification(checkout.user_id, 'dev_plan_changed', {
		plan: plan.id,
		kind: checkout.kind,
		amount_usd: amountUsd,
		asset: checkout.asset,
		period_end: checkout.period_end,
		manage_url: DEV_PLAN_MANAGE_URL,
	});
	try {
		const [u] = await sql`select email from users where id = ${checkout.user_id} limit 1`;
		if (u?.email) {
			const mail = receiptEmail({ plan, kind: checkout.kind, asset: checkout.asset, amountUsd, periodStart: checkout.period_start, periodEnd: checkout.period_end, txSignature });
			await sendEmail({ to: u.email, ...mail });
		}
	} catch (err) {
		console.warn('[dev-plans] receipt email failed:', err?.message);
	}
	return publicReceipt(receipt);
}

/**
 * Confirm a wallet checkout from its landed transaction. Idempotent: the same
 * signature always returns the same receipt. Returns { status: 'paid', receipt }
 * or { status: 'pending', reason } while the chain is still confirming.
 */
export async function confirmDevPlanCheckout({ userId, checkoutId, txSignature, req = null }) {
	if (!SIG_RE.test(String(txSignature || ''))) throw fail(400, 'bad_signature', 'tx_signature must be a base58 Solana transaction signature');
	const [existing] = await sql`select * from dev_plan_receipts where tx_signature = ${txSignature} and user_id = ${userId} limit 1`;
	if (existing) return { status: 'paid', receipt: publicReceipt(existing) };
	const [checkout] = await sql`select * from dev_plan_checkouts where id = ${checkoutId} and user_id = ${userId} limit 1`;
	if (!checkout) throw fail(404, 'not_found', 'checkout not found');
	if (checkout.status === 'paid') {
		const [receipt] = await sql`select * from dev_plan_receipts where checkout_id = ${checkout.id} limit 1`;
		return { status: 'paid', receipt: receipt ? publicReceipt(receipt) : null };
	}
	if (checkout.asset === 'credits') throw fail(400, 'not_a_wallet_checkout', 'a credits checkout settles when it is created');
	if (new Date(checkout.expires_at).getTime() + 30 * 60_000 < Date.now()) throw fail(410, 'checkout_expired', 'this checkout expired; open a new one and sign the new transfer');
	const [taken] = await sql`select id from dev_plan_checkouts where tx_signature = ${txSignature} and id <> ${checkout.id} limit 1`;
	if (taken) throw fail(409, 'signature_already_used', 'this transaction already paid for a different checkout');
	const verdict = await verifyPassPayment({ wallet: checkout.wallet, asset: checkout.asset, amount_atomics: checkout.amount_atomics }, txSignature);
	if (!verdict.ok) {
		if (verdict.pending) return { status: 'pending', reason: verdict.reason };
		throw fail(400, 'payment_not_verified', verdict.reason);
	}
	const receipt = await applyDevPlanCheckout(checkout, { txSignature, req });
	return { status: 'paid', receipt };
}

/**
 * Schedule a lower plan (or Free) for the end of the period, or clear a
 * scheduled change by naming the current plan.
 */
export async function scheduleDevPlanChange({ userId, planId, req = null }) {
	const sub = await getDevSubscription(userId, { fresh: true });
	const target = devPlanById(planId);
	if (target.rank > sub.plan.rank) throw fail(400, 'upgrade_is_bought', 'an upgrade takes effect now through a checkout, not a schedule');
	if (sub.plan.id === DEFAULT_DEV_PLAN_ID) throw fail(400, 'already_free', 'the account is on the Free plan; there is nothing to schedule');
	const scheduled = target.rank === sub.plan.rank ? null : target.id;
	const next = await scheduleDevPlan(userId, scheduled);
	logAudit({ userId, action: 'dev_plan_schedule', resourceId: userId, meta: { scheduled, from: sub.plan.id }, req });
	return next;
}

export async function listDevPlanReceipts(userId, limit = 50) {
	const rows = await sql`
		select * from dev_plan_receipts where user_id = ${userId}
		order by created_at desc limit ${Math.min(200, Math.max(1, limit))}
	`;
	return rows.map(publicReceipt);
}

export async function getDevPlanCheckout(userId, checkoutId) {
	const [row] = await sql`select * from dev_plan_checkouts where id = ${checkoutId} and user_id = ${userId} limit 1`;
	return row ? publicCheckout(row) : null;
}
