// api/_lib/x402/spent-payments.js
//
// Durable spent-payment record: the replay guard that outlives the cache TTL.
//
// paidEndpoint()'s always-on replay key (`proof:<paymentHash>`) lives in the
// idempotency cache and expires with X402_PAYMENT_IDENTIFIER_TTL. After that,
// a captured X-PAYMENT header can re-enter the handler and re-run its side
// effects (the good is delivered a second time). The money leg is already
// covered (settle-credit.js refuses a second credit for one signature), but
// DELIVERY is not, because the wrapper delivers before it settles on the
// default path.
//
// This module closes that leg with a Postgres row per honoured proof:
//
//   · isPaymentSpent():   one indexed lookup, run BEFORE the handler so a
//                          replay never reaches the side effects.
//   · claimSpentPayment(): the atomic claim, run once settlement and receipt
//                          work succeeded: `INSERT … ON CONFLICT DO NOTHING
//                          RETURNING` on the primary key. Zero rows back means
//                          another request already honoured this proof, i.e.
//                          a replay that raced past the lookup.
//
// The claim runs LAST in the settle path on purpose, and a payment that
// settled but then failed a downstream step is NOT a replay: the buyer was
// charged and got nothing. Such a proof is recorded with outcome
// `failed_after_settle` plus the settlement it produced, and the same X-PAYMENT
// header may then re-run the work a bounded number of times within a window
// (claimPaidRetry) with no second verify or settle. Re-verifying would not
// work anyway: the payment already landed on chain, so the facilitator rejects
// it. Only a proof whose work was delivered (`delivered`) answers 409.
//
// Failure policy: FAIL OPEN, deliberately. The in-cache guard, the payment
// identifier reservation and the on-chain settle-credit gate all remain in
// force, so a Neon outage degrades this control to "cache-window replay
// protection" rather than 5xx-ing a payment whose funds already moved. That is
// the opposite of settle-credit.js (which fails closed) because the failure
// modes are not symmetric: refusing there costs a retry, refusing here would
// break every paid route for the duration of a DB outage. Both the missing
// table (a deploy that ran ahead of its migration) and a dead DB take the same
// open path.

import { sql } from '../db.js';

/** Postgres `undefined_table`: the migration has not been applied here yet. */
const UNDEFINED_TABLE = '42P01';

function classifyUnavailable(err) {
	const code = err?.code || err?.sourceError?.code;
	return code === UNDEFINED_TABLE ? 'table_missing' : 'db_unavailable';
}

function logDegraded(op, err) {
	console.error(
		`[x402-spent-payments] ${op} degraded (${classifyUnavailable(err)}):`,
		err?.message || err,
	);
}

/** Retries a buyer gets after a failure that happened once they were charged. */
export const PAID_RETRY_MAX = Math.max(1, Number(process.env.X402_PAID_RETRY_MAX) || 3);
/** How long those retries stay open, from the first failure. */
export const PAID_RETRY_WINDOW_SECONDS = Math.max(
	60,
	Number(process.env.X402_PAID_RETRY_WINDOW_SECONDS) || 24 * 3600,
);

/**
 * Has this payment proof already been honoured, and if it failed after the
 * buyer was charged, may it still be retried?
 *
 * @param {string|null|undefined} paymentHash Hash of the signed X-PAYMENT proof.
 * @returns {Promise<{ spent: boolean, unavailable: boolean, retryable: boolean, outcome: string|null, endpoint: string|null, settlement: object|null }>}
 *   `spent` is true only on a positive, durable answer. `retryable` is true when
 *   the proof settled but its work failed, retries remain and the window is
 *   open. `unavailable` marks the fail-open path so the caller can log it rather
 *   than silently trusting a "not spent" that was never actually checked.
 */
export async function isPaymentSpent(paymentHash) {
	const none = { spent: false, retryable: false, outcome: null, endpoint: null, settlement: null };
	if (!paymentHash) return { ...none, unavailable: false };
	try {
		const rows = await sql`
			SELECT endpoint, outcome, retry_count, retry_until, settlement
			FROM x402_spent_payments WHERE payment_hash = ${paymentHash} LIMIT 1
		`;
		const row = rows?.[0];
		if (!row) return { ...none, unavailable: false };
		const retryable =
			row.outcome === 'failed_after_settle' &&
			Number(row.retry_count || 0) < PAID_RETRY_MAX &&
			(!row.retry_until || new Date(row.retry_until).getTime() > Date.now());
		const settlement = typeof row.settlement === 'string' ? JSON.parse(row.settlement) : row.settlement;
		return {
			spent: true,
			unavailable: false,
			retryable,
			outcome: row.outcome || 'delivered',
			endpoint: row.endpoint ?? null,
			settlement: settlement || null,
		};
	} catch (err) {
		logDegraded('lookup', err);
		return { ...none, unavailable: true };
	}
}

/**
 * Claim the proof as spent. Atomic: the primary key is the arbiter, so of any
 * set of concurrent requests carrying one X-PAYMENT header exactly one claim
 * returns a row. Pass `outcome: 'failed_after_settle'` (with the settlement)
 * when the buyer was charged but the work did not complete, so the same header
 * can retry through claimPaidRetry.
 *
 * @param {object} args
 * @param {string|null|undefined} args.paymentHash
 * @param {string} args.endpoint Route the proof was spent on (audit context).
 * @param {string|number|null} [args.amountAtomics] Price paid, in asset atomics.
 * @param {'delivered'|'failed_after_settle'} [args.outcome]
 * @param {object|null} [args.settlement] { transaction, network, payer, asset, amount, header }
 * @param {string|null} [args.lastError]
 * @returns {Promise<{ granted: boolean, replay: boolean, unavailable: boolean }>}
 */
export async function claimSpentPayment({
	paymentHash,
	endpoint,
	amountAtomics = null,
	outcome = 'delivered',
	settlement = null,
	lastError = null,
}) {
	// No hash means no signed proof to key on (never produced by the paid-endpoint
	// path, which derives the hash before it gets here). Nothing to claim, and
	// nothing that could double-deliver under this key either.
	if (!paymentHash) return { granted: true, replay: false, unavailable: false };
	const failed = outcome === 'failed_after_settle';
	try {
		const rows = await sql`
			INSERT INTO x402_spent_payments
				(payment_hash, endpoint, amount_atomics, outcome, settlement, last_error, retry_until)
			VALUES (${paymentHash}, ${endpoint}, ${amountAtomics == null ? null : String(amountAtomics)},
				${failed ? 'failed_after_settle' : 'delivered'},
				${settlement ? JSON.stringify(settlement) : null}::jsonb,
				${lastError ? String(lastError).slice(0, 500) : null},
				${failed ? new Date(Date.now() + PAID_RETRY_WINDOW_SECONDS * 1000) : null})
			ON CONFLICT (payment_hash) DO NOTHING
			RETURNING payment_hash
		`;
		if (rows?.length) return { granted: true, replay: false, unavailable: false };
		return { granted: false, replay: true, unavailable: false };
	} catch (err) {
		logDegraded('claim', err);
		return { granted: true, replay: false, unavailable: true };
	}
}

/**
 * Record that a claimed proof's work failed after settlement. Opens (or keeps)
 * the retry window and stores the settlement the retry will re-emit.
 *
 * @returns {Promise<{ retriesLeft: number, retryUntil: string|null }>}
 */
export async function markFailedAfterSettle({ paymentHash, settlement = null, lastError = null }) {
	if (!paymentHash) return { retriesLeft: 0, retryUntil: null };
	try {
		const rows = await sql`
			UPDATE x402_spent_payments
			SET outcome = 'failed_after_settle',
			    settlement = coalesce(settlement, ${settlement ? JSON.stringify(settlement) : null}::jsonb),
			    last_error = ${lastError ? String(lastError).slice(0, 500) : null},
			    retry_until = coalesce(retry_until, ${new Date(Date.now() + PAID_RETRY_WINDOW_SECONDS * 1000)}),
			    updated_at = now()
			WHERE payment_hash = ${paymentHash}
			RETURNING retry_count, retry_until
		`;
		const row = rows?.[0];
		if (!row) return { retriesLeft: 0, retryUntil: null };
		const open = !row.retry_until || new Date(row.retry_until).getTime() > Date.now();
		return {
			retriesLeft: open ? Math.max(0, PAID_RETRY_MAX - Number(row.retry_count || 0)) : 0,
			retryUntil: row.retry_until ? new Date(row.retry_until).toISOString() : null,
		};
	} catch (err) {
		logDegraded('mark_failed', err);
		return { retriesLeft: 0, retryUntil: null };
	}
}

/**
 * Take one retry for a proof that failed after settlement. Atomic: two
 * concurrent retries of one header cannot both run. Returns the stored
 * settlement so the retry can answer with the original x-payment-response.
 *
 * @returns {Promise<{ granted: boolean, settlement: object|null, attempt: number }>}
 */
export async function claimPaidRetry({ paymentHash, endpoint }) {
	if (!paymentHash) return { granted: false, settlement: null, attempt: 0 };
	try {
		const rows = await sql`
			UPDATE x402_spent_payments
			SET outcome = 'retrying', retry_count = retry_count + 1, updated_at = now()
			WHERE payment_hash = ${paymentHash}
			  AND endpoint = ${endpoint}
			  AND outcome = 'failed_after_settle'
			  AND retry_count < ${PAID_RETRY_MAX}
			  AND (retry_until IS NULL OR retry_until > now())
			RETURNING settlement, retry_count
		`;
		const row = rows?.[0];
		if (!row) return { granted: false, settlement: null, attempt: 0 };
		const settlement = typeof row.settlement === 'string' ? JSON.parse(row.settlement) : row.settlement;
		return { granted: true, settlement: settlement || null, attempt: Number(row.retry_count) };
	} catch (err) {
		logDegraded('claim_retry', err);
		return { granted: false, settlement: null, attempt: 0 };
	}
}

/** A retried call delivered: from here on the proof answers 409 like any other. */
export async function markDelivered(paymentHash) {
	if (!paymentHash) return;
	try {
		await sql`
			UPDATE x402_spent_payments
			SET outcome = 'delivered', last_error = NULL, updated_at = now()
			WHERE payment_hash = ${paymentHash}
		`;
	} catch (err) {
		logDegraded('mark_delivered', err);
	}
}

export const PAID_RETRY_SENTENCE =
	'You were charged; repeat this exact request with the same payment to get your result.';
export const PAID_EXHAUSTED_SENTENCE =
	'You were charged, and this payment has used up its retries. Contact support with the settlement transaction and it will be made right.';

/**
 * The fields every failure after settlement carries, so a buyer's client can
 * tell "you paid, retry safely" from "you were not charged".
 *
 * @param {{ settlement: object|null, retriesLeft: number, retryUntil?: string|null }} ctx
 */
export function paidFailureFields({ settlement, retriesLeft, retryUntil = null }) {
	const retrySafe = retriesLeft > 0;
	return {
		paid: true,
		retry_safe: retrySafe,
		settlement: {
			transaction: settlement?.transaction ?? null,
			network: settlement?.network ?? null,
		},
		retries_left: Math.max(0, retriesLeft),
		...(retryUntil ? { retry_until: retryUntil } : {}),
		message: retrySafe ? PAID_RETRY_SENTENCE : PAID_EXHAUSTED_SENTENCE,
	};
}

/**
 * 409 for a proof that was already honoured. Distinct from the idempotency
 * conflict/in-flight 409s (`x-x402-idempotent: conflict` / `in-flight`) so a
 * client can tell "you replayed a spent payment" from "your id collided" and
 * from "your own request is still running".
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{ route: string }} ctx
 */
export function writeReplayed(res, { route }) {
	res.statusCode = 409;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.setHeader('x-x402-idempotent', 'replayed');
	res.end(
		JSON.stringify({
			error: 'payment_replayed',
			error_description:
				'this payment proof was already used for this resource; ' +
				'pay again to buy it a second time',
			route,
		}),
	);
}
