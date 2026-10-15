// Spend Governor — policy enforcement layer for Agent Payment Sessions.
//
// Design principle (from AWS AgentCore Payments architecture):
//   "The agent does not hold a wallet. It proposes spend. Governance enforces policy."
//
// This module is the single chokepoint every session-based payment must pass through.
// Five checks, in order:
//   1. Session exists and is active (not expired, cancelled, or exhausted)
//   2. Expiry time has not passed
//   3. URL is in the session's host allowlist (if set)
//   4. Amount does not exceed the per-transaction ceiling (if set)
//   5. Remaining budget is sufficient — atomically decrements spent_usdc
//
// The atomic budget decrement uses a SQL UPDATE ... RETURNING with a WHERE clause
// that checks (budget_usdc - spent_usdc >= amount), so concurrent payment requests
// can never collectively overspend a session. If two requests arrive simultaneously
// and both would fit individually but together would exceed the budget, exactly one
// wins the race; the other gets INSUFFICIENT_BUDGET.
//
// Governance errors throw SpendGovernorError with a machine-readable `code` so the
// API layer can return 402 vs 403 vs 429 appropriately. The caller must call
// rollbackReservation() if the downstream x402 payment fails after the budget has
// been reserved — otherwise the session bleeds budget on failed payments.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from '../db.js';
import { runLocked } from '../locked-sql.js';
import { env } from '../env.js';
import {
	usdToAtomics,
	atomicsToUsd,
	normalizeHost,
	evaluateCall,
	budgetVerdict,
	railDailyVerdict,
	resolveRailDailyCapAtomics,
	computePolicyDigest,
	computeRequestHash,
	NETWORK_TO_CAIP2,
} from './policy.js';

// The policy predicates below are shared with the dry-run simulator
// (api/pay/simulate.js) so a simulated verdict and an enforced one can never
// disagree. Re-exported here because this module was the original home of these
// helpers and several callers already import them from this path.
export { usdToAtomics, atomicsToUsd, normalizeHost };

export class SpendGovernorError extends Error {
	constructor(code, message, detail = {}) {
		super(message);
		this.name = 'SpendGovernorError';
		this.code = code;
		this.detail = detail;
		// Map each code to a sensible HTTP status
		this.status = {
			session_not_found: 404,
			session_inactive: 403,
			session_expired: 403,
			allowlist_blocked: 403,
			host_blocked: 403,
			per_tx_exceeded: 402,
			rail_daily_exceeded: 402,
			insufficient_budget: 402,
			requires_approval: 403,
			invalid_token: 401,
		}[code] ?? 403;
	}
}

// HMAC token signing. The token itself is never stored — only its SHA-256 HMAC.
// Format: `pss_<sessionId>_<random32hex>` — human-readable, prefix-scoped.
const TOKEN_PREFIX = 'pss_';

function hmacKey() {
	// env.PAYMENT_SESSION_SECRET already resolves the whole fallback chain
	// (PAYMENT_SESSION_SECRET -> WALLET_CAPABILITY_SECRET -> WALLET_ENCRYPTION_KEY
	// -> JWT_SECRET). Reading the raw process env here instead would silently ignore
	// a configured PAYMENT_SESSION_SECRET, which is exactly the bug this replaced.
	const k = env.PAYMENT_SESSION_SECRET;
	if (!k) throw new Error('PAYMENT_SESSION_SECRET is not configured');
	return k;
}

// Verdict signing. The HMAC needs its own key (PAY_VERDICT_HMAC_KEY), not
// PAYMENT_SESSION_SECRET: rotating the token secret must not also quietly
// invalidate every previously stored verdict signature, and vice versa.
function verdictHmacKey() {
	const k = env.PAY_VERDICT_HMAC_KEY;
	if (!k) throw new Error('PAY_VERDICT_HMAC_KEY is not configured');
	return k;
}

function verdictPayload({ verdictCode, policyDigest, requestHash, timestamp }) {
	return `${verdictCode}|${policyDigest}|${requestHash}|${timestamp}`;
}

/** HMAC-SHA256 over {verdict, policy digest, request hash, timestamp}, so a stored verdict is tamper-evident. */
export function signVerdict({ verdictCode, policyDigest, requestHash, timestamp }) {
	return createHmac('sha256', verdictHmacKey())
		.update(verdictPayload({ verdictCode, policyDigest, requestHash, timestamp }))
		.digest('hex');
}

/** Constant-time check that `signature` is what signVerdict() would produce for these exact fields. */
export function verifyVerdictSignature({ verdictCode, policyDigest, requestHash, timestamp, signature }) {
	const expected = Buffer.from(signVerdict({ verdictCode, policyDigest, requestHash, timestamp }), 'hex');
	const given = Buffer.from(String(signature ?? ''), 'hex');
	if (expected.length !== given.length) return false;
	return timingSafeEqual(expected, given);
}

export function generateSessionToken(sessionId) {
	const rand = randomBytes(16).toString('hex');
	return `${TOKEN_PREFIX}${sessionId}_${rand}`;
}

export function hashToken(token) {
	return createHmac('sha256', hmacKey()).update(String(token)).digest('hex');
}

// A session id is a v4 UUID. The shape is checked, not just the length: the
// value goes straight into a `uuid` column comparison, and Postgres answers a
// non-UUID string with a cast error, not with "no rows". Without this, any
// 36-character blob inside a token turned an unauthenticated bad-token attempt
// into a 500 instead of the invalid_token the caller should see.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is this string safe to compare against a uuid column? */
export function isSessionId(value) {
	return UUID_RE.test(String(value ?? ''));
}

// Extract sessionId from a token without verifying it. Used for DB lookup before
// the constant-time hash comparison.
export function extractSessionId(token) {
	const s = String(token || '');
	if (!s.startsWith(TOKEN_PREFIX)) return null;
	const rest = s.slice(TOKEN_PREFIX.length);
	// Format after prefix: <uuid>_<random>, and a UUID is exactly 36 chars.
	if (rest.length < 37 || rest[36] !== '_') return null;
	const id = rest.slice(0, 36);
	return isSessionId(id) ? id : null;
}

/**
 * Turn a policy rejection from policy.js into the thrown governance error,
 * carrying a signature over the verdict so it can be stored tamper-evidently
 * alongside whatever execution record the caller writes.
 */
function throwSigned(verdict, { policyDigest, requestHash, timestamp }) {
	const signature = signVerdict({ verdictCode: verdict.code, policyDigest, requestHash, timestamp });
	throw new SpendGovernorError(verdict.code, verdict.message, {
		...verdict.detail,
		policy_digest: policyDigest,
		verdict_signature: signature,
		verdict_signed_at: timestamp,
	});
}

/**
 * Verify a session token and return the session row.
 * Throws SpendGovernorError on any auth / state failure.
 */
export async function verifySessionToken(token) {
	const sessionId = extractSessionId(token);
	if (!sessionId) throw new SpendGovernorError('invalid_token', 'Invalid session token format');

	const hash = hashToken(token);
	const [row] = await sql`
		SELECT id, user_id, agent_id, label, budget_usdc, spent_usdc,
		       max_per_tx_usdc, allowed_hosts, blocked_hosts,
		       approval_threshold_usdc, per_rail_daily_usdc,
		       network, connector_ref,
		       status, expires_at, session_metadata
		FROM payment_sessions
		WHERE id = ${sessionId} AND token_hash = ${hash}
		LIMIT 1
	`;

	if (!row) throw new SpendGovernorError('invalid_token', 'Session token not found or invalid');
	return row;
}

/**
 * Load a session by id with no token check.
 *
 * Used only to resume a call that already cleared authentication once: the
 * owner approval flow stores the session id (never the bearer token) on the
 * approval request's payload, and the executor that runs after the owner
 * clicks Approve re-enters the governor through here instead of re-deriving a
 * token the agent never gets to see again. Never expose this to a path that
 * takes a caller-supplied session id without its own authorization check.
 */
export async function verifySessionById(sessionId) {
	if (!isSessionId(sessionId)) throw new SpendGovernorError('invalid_token', 'Invalid session id format');
	const [row] = await sql`
		SELECT id, user_id, agent_id, label, budget_usdc, spent_usdc,
		       max_per_tx_usdc, allowed_hosts, blocked_hosts,
		       approval_threshold_usdc, per_rail_daily_usdc,
		       network, connector_ref,
		       status, expires_at, session_metadata
		FROM payment_sessions
		WHERE id = ${sessionId}
		LIMIT 1
	`;
	if (!row) throw new SpendGovernorError('invalid_token', 'Session not found');
	return row;
}

/**
 * Enforce governance policy and atomically reserve budget for a payment.
 *
 * Every advisory rule (status, expiry, allowlist, blocked hosts, per-tx
 * ceiling, rolling rail cap, budget, approval threshold) runs through the
 * exact same evaluateCall() the simulator calls, in the exact same order, so
 * a verdict here and a predicted one can never disagree (that parity is
 * covered by tests/payment-session-governor.test.js). Only the two atomic
 * reservations after that, the rail-daily insert and the budget UPDATE,
 * are enforcement-only; evaluateCall's budget/rail checks above were already
 * advisory predictions of what those statements are about to decide for real.
 *
 * @param {object} opts
 * @param {string} [opts.token]      - Session bearer token (mutually exclusive with sessionId)
 * @param {string} [opts.sessionId]  - Session id, for resuming an approved call that has no token
 * @param {string} opts.url          - Target endpoint URL (for allowlist check)
 * @param {bigint} opts.amountAtomics - Payment amount in USDC atomics (6 decimals)
 * @param {boolean} [opts.approvalGranted] - Skip the approval-threshold rule: the owner
 *   already approved this exact call through the approval inbox.
 * @returns {Promise<{ session: object, reservationId: string, railReservationId: string|null, policyDigest: string, verdictCode: string, verdictSignature: string, verdictSignedAt: string }>}
 * @throws {SpendGovernorError} on any policy violation
 */
export async function reserveSessionSpend({ token = null, sessionId = null, url, amountAtomics, approvalGranted = false }) {
	const session = token ? await verifySessionToken(token) : await verifySessionById(sessionId);
	const now = new Date();
	const amount = BigInt(amountAtomics);

	const railCaip2 = NETWORK_TO_CAIP2[session.network] ?? null;
	const railCapAtomics = resolveRailDailyCapAtomics(session.network, session.per_rail_daily_usdc);

	let railSpentAtomics = 0n;
	if (railCapAtomics != null && railCaip2) {
		const [row] = await sql`
			SELECT coalesce(sum(amount_usdc), 0) AS spent
			FROM payment_session_rail_reservations
			WHERE session_id = ${session.id}
			  AND network = ${railCaip2}
			  AND created_at > now() - interval '24 hours'
		`;
		railSpentAtomics = BigInt(row?.spent ?? 0);
	}

	const remainingAtomics = BigInt(session.budget_usdc) - BigInt(session.spent_usdc);
	const policy = {
		status: session.status,
		expiresAt: session.expires_at,
		allowedHosts: session.allowed_hosts,
		blockedHosts: session.blocked_hosts,
		maxPerTxAtomics: session.max_per_tx_usdc,
		railDailyCapAtomics: railCapAtomics,
		railSpentAtomics,
		approvalThresholdAtomics: session.approval_threshold_usdc,
	};

	const verdict = evaluateCall({ url, amountAtomics: amount, policy, remainingAtomics, now, approvalGranted });

	const policyDigest = computePolicyDigest(session);
	const requestHash = computeRequestHash({ sessionId: session.id, url, amountAtomics: amount });
	const timestamp = now.toISOString();

	if (verdict?.code === 'session_expired') {
		// Belt-and-suspenders; a DB sweep also marks expired rows. Mark it now
		// so the next call skips straight to this same rejection.
		await sql`
			UPDATE payment_sessions SET status = 'expired', updated_at = now()
			WHERE id = ${session.id} AND status = 'active'
		`.catch(() => {});
	}

	if (verdict) throwSigned(verdict, { policyDigest, requestHash, timestamp });

	// Atomic rail-daily reservation, ahead of the budget reservation so a
	// rail-cap miss never touches spent_usdc. The advisory lock is taken in
	// its own statement (see api/_lib/locked-sql.js) so a request that waited
	// on it re-reads the window sum fresh, after the winner's reservation
	// landed, instead of against a stale pre-commit snapshot.
	let railReservationId = null;
	if (railCapAtomics != null && railCaip2) {
		const rows = await runLocked(
			[`pay_rail:${session.id}:${railCaip2}`],
			sql`
				WITH window_spend AS (
					SELECT coalesce(sum(amount_usdc), 0) AS spent
					FROM payment_session_rail_reservations
					WHERE session_id = ${session.id}
					  AND network = ${railCaip2}
					  AND created_at > now() - interval '24 hours'
				)
				INSERT INTO payment_session_rail_reservations (session_id, network, amount_usdc)
				SELECT ${session.id}, ${railCaip2}, ${amount.toString()}
				FROM window_spend
				WHERE window_spend.spent + ${amount.toString()}::bigint <= ${railCapAtomics.toString()}::bigint
				RETURNING id
			`,
		);
		if (!rows[0]) {
			const failVerdict = railDailyVerdict(amount, railSpentAtomics, railCapAtomics) ?? {
				code: 'rail_daily_exceeded',
				message: "This rail's 24h spend cap was reached by a concurrent payment",
				detail: {},
			};
			throwSigned(failVerdict, { policyDigest, requestHash, timestamp });
		}
		railReservationId = rows[0].id;
	}

	// Atomic budget reservation. The WHERE clause ensures
	// (budget_usdc - spent_usdc) >= amountAtomics before incrementing,
	// race-safe: two concurrent requests cannot both succeed if only one fits
	// in the remaining budget.
	const [updated] = await sql`
		UPDATE payment_sessions
		SET spent_usdc = spent_usdc + ${amount.toString()},
		    updated_at = now()
		WHERE id = ${session.id}
		  AND status = 'active'
		  AND (budget_usdc - spent_usdc) >= ${amount.toString()}
		RETURNING id, spent_usdc, budget_usdc
	`;

	if (!updated) {
		if (railReservationId) {
			await sql`DELETE FROM payment_session_rail_reservations WHERE id = ${railReservationId}`.catch(() => {});
		}
		// Could be exhausted mid-race; check to give a precise error
		const [fresh] = await sql`
			SELECT budget_usdc, spent_usdc FROM payment_sessions WHERE id = ${session.id}
		`;
		const remaining = fresh ? BigInt(fresh.budget_usdc) - BigInt(fresh.spent_usdc) : 0n;
		// The SQL predicate already decided; budgetVerdict only phrases the failure,
		// using the same wording the simulator shows for a predicted shortfall.
		const failVerdict = budgetVerdict(amount, remaining) ?? {
			code: 'insufficient_budget',
			message: 'Session was not active when the payment was reserved',
			detail: { need_usd: atomicsToUsd(amount), remaining_usd: atomicsToUsd(remaining) },
		};
		throwSigned(failVerdict, { policyDigest, requestHash, timestamp });
	}

	// If the session is now fully consumed, mark it exhausted
	if (BigInt(updated.spent_usdc) >= BigInt(updated.budget_usdc)) {
		await sql`
			UPDATE payment_sessions SET status = 'exhausted', updated_at = now()
			WHERE id = ${session.id} AND status = 'active'
		`.catch(() => {});
	}

	const verdictCode = 'allowed';
	const verdictSignature = signVerdict({ verdictCode, policyDigest, requestHash, timestamp });
	const reservationId = `res_${session.id}_${Date.now()}`;
	return {
		session: { ...session, spent_usdc: updated.spent_usdc },
		reservationId,
		railReservationId,
		policyDigest,
		verdictCode,
		verdictSignature,
		verdictSignedAt: timestamp,
	};
}

/**
 * Roll back a reservation after a failed payment.
 * Decrements spent_usdc by the reserved amount and restores 'active' if
 * exhausted, and releases the rail-daily reservation (if any) so a failed
 * call never permanently eats into the next day's rail budget.
 */
export async function rollbackReservation(sessionId, amountAtomics, { railReservationId } = {}) {
	const amount = BigInt(amountAtomics);
	await sql`
		UPDATE payment_sessions
		SET spent_usdc = greatest(0, spent_usdc - ${amount.toString()}),
		    status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
		    updated_at = now()
		WHERE id = ${sessionId}
		  AND status IN ('active', 'exhausted')
	`;
	if (railReservationId) {
		await sql`DELETE FROM payment_session_rail_reservations WHERE id = ${railReservationId}`.catch(() => {});
	}
}

/**
 * Mark a session execution record and finalize its outcome.
 */
export async function recordExecution({
	sessionId,
	userId,
	endpointUrl,
	method,
	amountAtomics,
	network,
	txHash,
	payerAddress,
	payeeAddress,
	status,
	errorCode,
	errorMessage,
	responseBody,
	durationMs,
	idempotencyKey,
	policyDigest,
	verdictCode,
	verdictSignature,
	verdictSignedAt,
}) {
	const host = (() => {
		try { return new URL(endpointUrl).hostname; }
		catch { return ''; }
	})();

	await sql`
		INSERT INTO payment_session_executions
			(session_id, user_id, endpoint_url, endpoint_host, method,
			 amount_usdc, network, tx_hash, payer_address, payee_address,
			 status, error_code, error_message, response_body,
			 duration_ms, idempotency_key,
			 policy_digest, verdict_code, verdict_signature, verdict_signed_at)
		VALUES
			(${sessionId}, ${userId}, ${endpointUrl}, ${host}, ${method ?? 'GET'},
			 ${amountAtomics.toString()}, ${network}, ${txHash ?? null},
			 ${payerAddress ?? null}, ${payeeAddress ?? null},
			 ${status}, ${errorCode ?? null}, ${errorMessage ?? null},
			 ${responseBody != null ? JSON.stringify(responseBody) : null},
			 ${durationMs ?? null}, ${idempotencyKey ?? null},
			 ${policyDigest ?? null}, ${verdictCode ?? null},
			 ${verdictSignature ?? null}, ${verdictSignedAt ?? null})
		ON CONFLICT (idempotency_key) DO NOTHING
	`;
}
