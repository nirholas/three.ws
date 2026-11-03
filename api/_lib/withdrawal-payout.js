// Crash-safe withdrawal payouts.
//
// Every payout moves real USDC, so the order of operations is the control:
//
//   1. claim      pending -> processing in one UPDATE ... WHERE status = 'pending'
//                 (single winner, a second cron tick or retry gets nothing)
//   2. sign       the sender signs the transaction
//   3. record     the signature (and its landing window / nonce) is persisted
//                 BEFORE the transaction is broadcast (recordSend)
//   4. broadcast  and confirm
//   5. settle     completed on confirmation
//
// A failure is classified by how far it got. Nothing signed -> nothing can have
// left the treasury -> `failed` (balance released). Anything after the signature
// was recorded -> `broadcast_unconfirmed` (balance stays reserved) and the
// reconciler below decides from the chain. Only `completed` and a chain-proven
// `failed` ever settle a row, so a transfer can never be paid twice.

import { sql } from './db.js';
import { BROADCAST_UNCONFIRMED_ALERT_MS } from './withdrawal-status.js';

function logTransition(event) {
	console.log(JSON.stringify({ evt: 'withdrawal_transition', ...event }));
}

/**
 * Persist one signed attempt BEFORE it is broadcast. Throws when the row is no
 * longer `processing`, which aborts the send: broadcasting a transaction the
 * ledger cannot account for is the one thing this pipeline must never do.
 *
 * @param {string} id withdrawal id
 * @param {{ signature?: string, hash?: string, lastValidBlockHeight?: number, nonce?: number, attempt?: number }} signed
 */
export async function recordSend(id, signed) {
	const signature = signed.signature || signed.hash;
	if (!signature) throw new Error('signed transaction carries no signature');
	const attempt = JSON.stringify({
		signature,
		lastValidBlockHeight: signed.lastValidBlockHeight ?? null,
		nonce: signed.nonce ?? null,
		at: new Date().toISOString(),
	});
	const rows = await sql`
		UPDATE agent_withdrawals
		SET send_signature = ${signature},
		    send_attempts = coalesce(send_attempts, '[]'::jsonb) || ${attempt}::jsonb,
		    last_valid_block_height = greatest(last_valid_block_height, ${signed.lastValidBlockHeight ?? null}::bigint),
		    send_nonce = coalesce(${signed.nonce ?? null}::bigint, send_nonce),
		    send_attempted_at = now(),
		    updated_at = now()
		WHERE id = ${id} AND status = 'processing'
		RETURNING id
	`;
	if (!rows.length) {
		throw new Error(`withdrawal ${id} is no longer processing; refusing to broadcast`);
	}
	logTransition({ id, to: 'processing', signature, recorded: true });
}

/**
 * Settle a row whose payout landed.
 * @returns {Promise<boolean>} whether this call performed the transition
 */
export async function markCompleted(id, signature) {
	const rows = await sql`
		UPDATE agent_withdrawals
		SET status = 'completed', tx_signature = ${signature}, error_message = NULL, updated_at = now()
		WHERE id = ${id} AND status IN ('processing', 'broadcast_unconfirmed')
		RETURNING id
	`;
	if (rows.length) logTransition({ id, to: 'completed', signature });
	return rows.length > 0;
}

/**
 * Fail a row whose payout provably did not (and cannot) move funds.
 * @returns {Promise<boolean>}
 */
export async function markFailed(id, message) {
	const rows = await sql`
		UPDATE agent_withdrawals
		SET status = 'failed', error_message = ${message}, updated_at = now()
		WHERE id = ${id} AND status IN ('processing', 'broadcast_unconfirmed')
		RETURNING id
	`;
	if (rows.length) logTransition({ id, to: 'failed', reason: message });
	return rows.length > 0;
}

/**
 * Park a row whose broadcast outcome is unknown. The balance stays reserved.
 * @returns {Promise<boolean>}
 */
export async function markBroadcastUnconfirmed(id, message) {
	const rows = await sql`
		UPDATE agent_withdrawals
		SET status = 'broadcast_unconfirmed', error_message = ${message}, updated_at = now()
		WHERE id = ${id} AND status = 'processing'
		RETURNING id
	`;
	if (rows.length) logTransition({ id, to: 'broadcast_unconfirmed', reason: message });
	return rows.length > 0;
}

/**
 * Decide the fate of a payout that threw. `signed` is whether the signing hook
 * ever recorded a signature for this send.
 *
 * @returns {Promise<'failed'|'broadcast_unconfirmed'>}
 */
export async function settleSendFailure(id, err, signed) {
	const message = err?.message || String(err);
	if (!signed) {
		await markFailed(id, message);
		return 'failed';
	}
	await markBroadcastUnconfirmed(id, message);
	return 'broadcast_unconfirmed';
}

/**
 * Reconcile every payout that may have been broadcast against the chain.
 *
 *   confirmed -> completed (+ notification)
 *   expired   -> failed with a clear reason (+ notification), releasing the balance
 *   pending   -> left alone for the next tick; an operator is paged once a row has
 *                waited longer than 30 minutes
 *
 * Also abandons `processing` rows that never reached the signing hook (the worker
 * died before anything was signed, so nothing can have been sent).
 *
 * @param {object} deps
 * @param {(row: object) => Promise<{ state: string, signature?: string, detail?: string }>} deps.checkSendStatus
 * @param {Function} deps.insertNotification
 * @param {Function} deps.sendOpsAlert
 * @param {number} [deps.now] epoch ms (tests)
 */
export async function reconcileBroadcastedWithdrawals({ checkSendStatus, insertNotification, sendOpsAlert, now = Date.now() }) {
	const report = { checked: 0, completed: 0, failed: 0, pending: 0, abandoned: 0, errors: [] };

	const abandoned = await sql`
		UPDATE agent_withdrawals
		SET status = 'failed',
		    error_message = 'Payout worker stopped before the transfer was signed; nothing was sent',
		    updated_at = now()
		WHERE status = 'processing'
		  AND send_signature IS NULL
		  AND send_attempted_at IS NOT NULL
		  AND updated_at < now() - interval '15 minutes'
		RETURNING id, user_id, amount, currency_mint
	`;
	for (const w of abandoned) {
		report.abandoned++;
		logTransition({ id: w.id, to: 'failed', reason: 'abandoned_before_signing' });
		await insertNotification(w.user_id, 'withdrawal_failed', {
			withdrawal_id: w.id,
			amount: w.amount,
			currency_mint: w.currency_mint,
			reason: 'payout_interrupted',
		}).catch((e) => console.error('[process-withdrawals] notify abandoned failed:', e.message));
	}

	const rows = await sql`
		SELECT id, user_id, amount, currency_mint, chain, to_address, status, send_signature,
		       send_attempts, last_valid_block_height, send_nonce, updated_at
		FROM agent_withdrawals
		WHERE status = 'broadcast_unconfirmed'
		   OR (status = 'processing' AND send_signature IS NOT NULL
		       AND updated_at < now() - interval '5 minutes')
		ORDER BY updated_at ASC
		LIMIT 50
	`;

	const stuck = [];
	for (const row of rows) {
		report.checked++;
		let verdict;
		try {
			verdict = await checkSendStatus(row);
		} catch (e) {
			report.errors.push({ id: row.id, error: e.message || String(e) });
			report.pending++;
			continue;
		}

		if (verdict.state === 'confirmed') {
			if (await markCompleted(row.id, verdict.signature)) {
				report.completed++;
				await sql`
					UPDATE users
					SET referral_earnings_total = greatest(0, coalesce(referral_earnings_total, 0) - ${row.amount})
					WHERE id = ${row.user_id}
				`.catch((e) => console.error('[process-withdrawals] referral deduct failed:', e.message));
				await insertNotification(row.user_id, 'withdrawal_completed', {
					withdrawal_id: row.id,
					amount: row.amount,
					currency_mint: row.currency_mint,
					chain: row.chain,
					tx_signature: verdict.signature,
				}).catch((e) => console.error('[process-withdrawals] notify completed failed:', e.message));
			}
		} else if (verdict.state === 'expired') {
			const reason = `Payout never landed: ${verdict.detail || 'transaction window expired'}`;
			if (await markFailed(row.id, reason)) {
				report.failed++;
				await insertNotification(row.user_id, 'withdrawal_failed', {
					withdrawal_id: row.id,
					amount: row.amount,
					currency_mint: row.currency_mint,
					reason,
				}).catch((e) => console.error('[process-withdrawals] notify failed failed:', e.message));
			}
		} else {
			report.pending++;
			const waitedMs = now - new Date(row.updated_at).getTime();
			if (row.status === 'broadcast_unconfirmed' && waitedMs > BROADCAST_UNCONFIRMED_ALERT_MS) {
				stuck.push({ row, waitedMs, detail: verdict.detail });
			}
		}
	}

	if (stuck.length) {
		await sendOpsAlert(
			`${stuck.length} withdrawal(s) stuck in broadcast_unconfirmed >30m`,
			stuck
				.map(
					(s) =>
						`• ${s.row.id}: ${s.row.amount} ${s.row.currency_mint} (${s.row.chain}), ` +
						`sig ${s.row.send_signature || 'none'}, waiting ${Math.round(s.waitedMs / 60000)}m` +
						(s.detail ? `, ${s.detail}` : ''),
				)
				.join('\n') +
				'\nFunds may have moved. The balance stays reserved; check the signature on chain before intervening.',
			{ signature: 'withdrawals-broadcast-unconfirmed' },
		);
	}

	return report;
}
