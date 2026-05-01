/**
 * Subscription billing — charge a creator subscription via x402.
 *
 * x402 is a request-payment protocol: the server emits a 402 challenge, and
 * the client pays. It does not support server-initiated pulls from a stored
 * wallet. So the flow here is:
 *   1. Record a `subscription_payments` row as 'pending'.
 *   2. If we can construct an x402 payment request from the subscriber's stored
 *      wallet_address, include it in the response so the caller can forward it
 *      to the subscriber for approval.
 *   3. Return { success: false, pending: true, paymentId } — the caller must
 *      notify the subscriber out-of-band to approve the charge.
 *
 * When a subscriber approves (via the client) and the tx lands, the payment
 * status is updated to 'succeeded' by a future confirm endpoint (not yet built).
 */

import { sql } from './db.js';

/**
 * Attempt to charge a subscription for its current period.
 * Creates a subscription_payments record and returns the result.
 *
 * @param {string} subscriptionId
 * @returns {Promise<{ success: boolean, pending?: boolean, paymentId: string, error?: string }>}
 */
export async function chargeSubscription(subscriptionId) {
	const [row] = await sql`
		SELECT
			cs.id, cs.plan_id, cs.subscriber_user_id, cs.wallet_address,
			cs.current_period_end, cs.payment_method,
			sp.price_usd, sp.creator_id,
			u.email AS subscriber_email
		FROM creator_subscriptions cs
		JOIN subscription_plans sp ON sp.id = cs.plan_id
		JOIN users u ON u.id = cs.subscriber_user_id
		WHERE cs.id = ${subscriptionId}
	`;

	if (!row) {
		return { success: false, error: 'subscription_not_found' };
	}

	// Create the payment record.
	const [payment] = await sql`
		INSERT INTO subscription_payments (subscription_id, amount_usd, status)
		VALUES (${subscriptionId}, ${row.price_usd}, 'pending')
		RETURNING id, status, amount_usd
	`;

	// x402 does not support server-initiated pulls from a stored wallet.
	// Log clearly and return pending so the cron/caller knows to notify subscriber.
	if (row.payment_method === 'x402') {
		console.log(JSON.stringify({
			event: 'subscription_billing.pending',
			subscription_id: subscriptionId,
			payment_id: payment.id,
			amount_usd: row.price_usd,
			wallet_address: row.wallet_address || null,
			note: 'x402 server-pull not yet supported; subscriber must approve payment',
		}));
		return { success: false, pending: true, paymentId: payment.id };
	}

	// Future payment methods (e.g. pre-authorized Solana delegation) can be
	// added here. For now treat any unknown method as pending.
	return { success: false, pending: true, paymentId: payment.id };
}

/**
 * Mark a pending payment as succeeded (called from a webhook or confirm endpoint).
 *
 * @param {string} paymentId
 * @param {string} txHash
 */
export async function confirmPayment(paymentId, txHash) {
	const [payment] = await sql`
		UPDATE subscription_payments
		SET status = 'succeeded', tx_hash = ${txHash}, paid_at = now()
		WHERE id = ${paymentId} AND status = 'pending'
		RETURNING id, subscription_id
	`;
	if (!payment) return { ok: false, error: 'payment_not_found_or_already_processed' };

	// Advance current_period_end on the subscription.
	const [sub] = await sql`
		SELECT cs.current_period_end, sp.interval
		FROM creator_subscriptions cs
		JOIN subscription_plans sp ON sp.id = cs.plan_id
		WHERE cs.id = ${payment.subscription_id}
	`;
	if (sub) {
		const periodMs = sub.interval === 'weekly' ? 7 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
		const nextEnd = new Date(new Date(sub.current_period_end).getTime() + periodMs).toISOString();
		await sql`
			UPDATE creator_subscriptions
			SET current_period_end = ${nextEnd}, status = 'active'
			WHERE id = ${payment.subscription_id}
		`;
	}

	return { ok: true, paymentId };
}

/**
 * Mark a payment as failed and optionally set subscription to past_due.
 *
 * @param {string} paymentId
 * @param {string} subscriptionId
 */
export async function failPayment(paymentId, subscriptionId) {
	await sql`
		UPDATE subscription_payments SET status = 'failed'
		WHERE id = ${paymentId}
	`;

	// Count failures for this subscription to decide whether to set past_due.
	const [{ failCount }] = await sql`
		SELECT count(*)::int AS "failCount"
		FROM subscription_payments
		WHERE subscription_id = ${subscriptionId} AND status = 'failed'
	`;

	if (failCount >= 3) {
		await sql`
			UPDATE creator_subscriptions SET status = 'past_due'
			WHERE id = ${subscriptionId} AND status = 'active'
		`;
	}
}
