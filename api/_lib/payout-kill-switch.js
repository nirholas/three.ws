// @ts-check
// Operator kill switch for outbound payouts.
//
// One runtime flag, `payouts_paused` (app_flags, see flags.js), stops every
// payout cron from claiming new work: withdrawals, coin payouts and club
// payouts. It flips without a redeploy (fleet-wide within the 30 s flag cache)
// and falls back to the PAYOUTS_PAUSED env var when no row exists, so adopting
// it changes nothing until an operator sets it.
//
// Pausing never rewrites a ledger row. A payout that was already broadcast is
// reconciled from the chain by the withdrawals cron once it runs again; nothing
// is re-sent or dropped.

import { getFlag, setFlag } from './flags.js';
import { logAuditNow } from './audit.js';

export const PAYOUTS_PAUSED_FLAG = 'payouts_paused';

/** @returns {Promise<{ paused: boolean, reason: string | null, source: 'flag' | 'env' | 'default' }>} */
export async function payoutsPauseState() {
	const envOn = process.env.PAYOUTS_PAUSED === 'true' || process.env.PAYOUTS_PAUSED === '1';
	const flag = await getFlag(PAYOUTS_PAUSED_FLAG, { fallback: envOn });
	const value = /** @type {{ reason?: unknown } | null} */ (flag.value);
	const reason = value && typeof value.reason === 'string' ? value.reason : null;
	if (flag.exists) return { paused: flag.enabled, reason, source: 'flag' };
	return { paused: envOn, reason: null, source: envOn ? 'env' : 'default' };
}

export async function payoutsPaused() {
	return (await payoutsPauseState()).paused;
}

/**
 * Flip the switch and write the audit row. The audit row is awaited: an
 * operator pausing money movement needs to know the trail recorded.
 *
 * @param {{ paused: boolean, reason?: string | null, userId: string, req?: object | null }} input
 */
export async function setPayoutsPaused({ paused, reason = null, userId, req = null }) {
	const note = reason ? String(reason).slice(0, 500) : null;
	const row = await setFlag(PAYOUTS_PAUSED_FLAG, {
		enabled: paused,
		value: note ? { reason: note } : null,
		updatedBy: userId,
	});
	const audited = await logAuditNow({
		userId,
		action: paused ? 'payouts.pause' : 'payouts.resume',
		resourceId: PAYOUTS_PAUSED_FLAG,
		meta: { paused, reason: note },
		req,
	});
	return { paused: row.enabled === true, reason: note, updatedAt: row.updated_at, audited };
}
