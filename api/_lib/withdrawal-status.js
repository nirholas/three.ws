// Single source of truth for which withdrawal statuses hold a user's balance.
//
// A withdrawal row keeps the money reserved from the moment it is requested
// until it is provably settled one way or the other. `broadcast_unconfirmed`
// is the state a payout enters once its signed transaction may have reached
// the chain but the cron could not confirm it: funds may already have moved,
// so the balance must stay reserved until the reconciler proves the outcome.
// Only `failed` releases the balance, and only when nothing was ever sent or
// the chain proves the transaction can never land.

/** Statuses that count against a user's available balance. */
export const RESERVED_WITHDRAWAL_STATUSES = Object.freeze([
	'pending',
	'processing',
	'broadcast_unconfirmed',
	'completed',
]);

/** Statuses that are still in flight (not yet settled, not yet released). */
export const IN_FLIGHT_WITHDRAWAL_STATUSES = Object.freeze([
	'pending',
	'processing',
	'broadcast_unconfirmed',
]);

/** Every status the payout pipeline writes. */
export const WITHDRAWAL_STATUSES = Object.freeze([
	'pending',
	'processing',
	'broadcast_unconfirmed',
	'completed',
	'failed',
]);

/** A row stuck in `broadcast_unconfirmed` longer than this pages an operator. */
export const BROADCAST_UNCONFIRMED_ALERT_MS = 30 * 60 * 1000;

/** User-facing label for a status. The raw status stays in the API payload. */
export function withdrawalStatusLabel(status) {
	if (status === 'broadcast_unconfirmed') return 'confirming';
	return status;
}
