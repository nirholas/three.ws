// Payment session policy predicates — the single source of truth for every
// "may this agent spend?" decision on the platform.
//
// Two callers depend on this module and they must never disagree:
//
//   api/_lib/pay/spend-governor.js  enforces policy on a real payment
//   api/pay/simulate.js             predicts policy on a hypothetical one
//
// Before this module existed, the simulator would have had to reimplement the
// allowlist and ceiling rules, and any later fix to one copy would silently
// leave the other lying. A dry run that says "this call is allowed" and an
// enforcer that then rejects it is worse than having no dry run at all, because
// the user authorizes a budget against a promise the platform does not keep.
// So the rules live here, as pure functions over plain values: no DB, no clock
// reads except the one passed in, no network. Both callers import them.
//
// One thing deliberately does NOT live here: the atomic budget reservation.
// Checking `remaining >= amount` in JavaScript is advisory only, because two
// concurrent requests can both read the same remaining balance and both pass.
// The authoritative check is the SQL `UPDATE ... WHERE (budget - spent) >= amt`
// in the governor. This module exposes `budgetVerdict()` for prediction and for
// building the error message, and the governor calls it only to describe a
// failure the database already decided. The same split applies to
// `railDailyVerdict()` below: authoritative enforcement is an atomic reserve
// against payment_session_rail_reservations, this is the advisory prediction.

import { createHash } from 'node:crypto';

/**
 * The limits session creation enforces (api/_lib/pay/payment-session.js).
 *
 * They live here, next to the rules, so the dry-run simulator can clamp a
 * proposed policy to exactly what the create endpoint will accept. A simulator
 * that blessed a $2000 budget would be recommending a session the API refuses.
 */
export const SESSION_LIMITS = Object.freeze({
	MAX_LABEL_LEN: 120,
	MAX_ALLOWED_HOSTS: 50,
	MIN_BUDGET_USD: 0.001,
	MAX_BUDGET_USD: 1000,
	MIN_TTL_SECONDS: 60,
	MAX_TTL_SECONDS: 90 * 24 * 3600, // 90 days
});

// USDC has 6 decimals everywhere we settle (Solana mainnet and Base mainnet).
export const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

export function usdToAtomics(usd) {
	return BigInt(Math.round(Number(usd) * USDC_SCALE));
}

export function atomicsToUsd(atomics) {
	return Number(atomics) / USDC_SCALE;
}

// CAIP-2 chain identifiers for the two networks sessions settle on, matching
// the literal strings x402 challenges quote in `accept.network` (and what
// payment_session_executions.network stores). per_rail_daily_usdc is keyed by
// these, not by the session's short 'solana'/'base' network name, so the cap
// still means the right thing if a session ever settles on more than one rail.
export const CAIP2_SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const CAIP2_BASE_MAINNET = 'eip155:8453';
export const NETWORK_TO_CAIP2 = Object.freeze({
	solana: CAIP2_SOLANA_MAINNET,
	base: CAIP2_BASE_MAINNET,
});

/**
 * Normalize a caller-supplied per-rail-daily-cap map to CAIP-2 keys.
 * Accepts either a short network name ('solana', 'base') or a literal CAIP-2
 * id as a key; drops anything that is not a positive number.
 */
export function canonicalizePerRailDaily(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out = {};
	for (const [key, value] of Object.entries(raw)) {
		const n = Number(value);
		if (!Number.isFinite(n) || n <= 0) continue;
		const caip2 = NETWORK_TO_CAIP2[key] ?? (key.includes(':') ? key : null);
		if (!caip2) continue;
		out[caip2] = n;
	}
	return out;
}

/** The per_rail_daily_usdc cap for the session's own settlement network, in atomics, or null if unset. */
export function resolveRailDailyCapAtomics(network, perRailDailyUsd) {
	if (!perRailDailyUsd || typeof perRailDailyUsd !== 'object') return null;
	const caip2 = NETWORK_TO_CAIP2[network] ?? null;
	if (!caip2) return null;
	const usd = perRailDailyUsd[caip2];
	if (usd == null) return null;
	const n = Number(usd);
	if (!Number.isFinite(n) || n <= 0) return null;
	return usdToAtomics(n);
}

/** Bare lowercase hostname from a URL or an already-bare host. Never throws. */
export function normalizeHost(raw) {
	const s = String(raw || '').trim().toLowerCase();
	if (!s) return '';
	try {
		const u = new URL(s.includes('://') ? s : `https://${s}`);
		return u.hostname;
	} catch {
		return s.split('/')[0].split(':')[0] || '';
	}
}

/**
 * Canonicalize a session's allowlist for comparison.
 * Entries may be written as bare hosts, full URLs, or hosts with a port.
 */
export function canonicalizeAllowlist(allowedHosts) {
	if (!Array.isArray(allowedHosts)) return [];
	return allowedHosts.map(normalizeHost).filter(Boolean);
}

/**
 * Does `targetHost` match `entry`, treating the entry as a domain suffix?
 *
 * `api.example.com` matches the entry `example.com` because it is a true
 * subdomain. `evil-example.com` does NOT, which is the whole reason this is a
 * named function with a test rather than an inline `endsWith`: `endsWith` alone
 * would hand an attacker every domain that merely ends in the allowed string.
 */
export function hostMatches(targetHost, entry) {
	if (!targetHost || !entry) return false;
	return targetHost === entry || targetHost.endsWith(`.${entry}`);
}

// ── Individual verdicts ─────────────────────────────────────────────────────
// Each returns either null (this rule permits the call) or a rejection object
// { code, message, detail }. `code` is the machine-readable governance error the
// API layer maps to an HTTP status; the strings are user-facing.

const INACTIVE_MESSAGES = {
	exhausted: 'Session budget is exhausted',
	expired: 'Session has expired',
	cancelled: 'Session has been cancelled',
};

/** Rule 1: the session must be in the `active` state. */
export function statusVerdict(status) {
	if (status === 'active') return null;
	return {
		code: 'session_inactive',
		message: INACTIVE_MESSAGES[status] ?? `Session is ${status}`,
		detail: { status },
	};
}

/** Rule 2: the session's TTL must not have elapsed. */
export function expiryVerdict(expiresAt, now = new Date()) {
	if (expiresAt == null) return null;
	const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
	if (Number.isNaN(expiry.getTime())) return null;
	if (expiry >= now) return null;
	return { code: 'session_expired', message: 'Session has expired', detail: {} };
}

/** Rule 3: the target host must be on the allowlist, when one is set. */
export function allowlistVerdict(url, allowedHosts) {
	const canonical = canonicalizeAllowlist(allowedHosts);
	if (canonical.length === 0) return null; // empty allowlist means "any host"

	let targetHost;
	try {
		targetHost = new URL(url).hostname.toLowerCase();
	} catch {
		return {
			code: 'allowlist_blocked',
			message: `Invalid target URL: ${url}`,
			detail: {},
		};
	}

	if (canonical.some((entry) => hostMatches(targetHost, entry))) return null;

	return {
		code: 'allowlist_blocked',
		message: `Host ${targetHost} is not in this session's allowlist`,
		detail: { host: targetHost, allowlist: canonical },
	};
}

/** Rule 4: a single payment must not exceed the per-transaction ceiling. */
export function perTxVerdict(amountAtomics, maxPerTxAtomics) {
	if (maxPerTxAtomics == null) return null;
	const cap = BigInt(maxPerTxAtomics);
	const amount = BigInt(amountAtomics);
	if (amount <= cap) return null;
	return {
		code: 'per_tx_exceeded',
		message: `Payment $${atomicsToUsd(amount)} exceeds the per-transaction limit $${atomicsToUsd(cap)}`,
		detail: { amount_usd: atomicsToUsd(amount), cap_usd: atomicsToUsd(cap) },
	};
}

/**
 * Rule 5: the remaining budget must cover the payment.
 *
 * Advisory in the enforcer (the SQL predicate is authoritative), authoritative
 * in the simulator, where the spend curve is replayed in memory and nothing is
 * concurrent. Callers pass `remainingAtomics` so this stays a pure function.
 */
export function budgetVerdict(amountAtomics, remainingAtomics) {
	const amount = BigInt(amountAtomics);
	const remaining = BigInt(remainingAtomics);
	if (remaining >= amount) return null;
	return {
		code: 'insufficient_budget',
		message: `Insufficient session budget. Need $${atomicsToUsd(amount)}, remaining $${atomicsToUsd(remaining)}`,
		detail: { need_usd: atomicsToUsd(amount), remaining_usd: atomicsToUsd(remaining) },
	};
}

/**
 * Rule (denylist): the target host must NOT be on the session's blocked list.
 *
 * Checked right after the allowlist, and wins over it: a host that somehow
 * matches both an allow entry and a block entry is blocked. An operator who
 * explicitly denylists a merchant expects that to be the final word even if
 * the allowlist was written broadly (e.g. `*.example.com` allowed, one bad
 * sub-merchant blocked).
 */
export function blockedHostVerdict(url, blockedHosts) {
	const canonical = canonicalizeAllowlist(blockedHosts);
	if (canonical.length === 0) return null;

	let targetHost;
	try {
		targetHost = new URL(url).hostname.toLowerCase();
	} catch {
		return null; // an unparseable URL is already reported by allowlistVerdict when an allowlist is set
	}

	if (!canonical.some((entry) => hostMatches(targetHost, entry))) return null;

	return {
		code: 'host_blocked',
		message: `Host ${targetHost} is on this session's blocked list`,
		detail: { host: targetHost, blocked_hosts: canonical },
	};
}

/**
 * Rule: this payment must not push the session's rolling 24h spend on its
 * settlement rail over `railDailyCapAtomics`.
 *
 * Advisory here (see the module header): the authoritative check is an
 * atomic reserve in the governor. `railSpentAtomics` is spend already
 * reserved in the current window, passed in so this stays a pure function.
 */
export function railDailyVerdict(amountAtomics, railSpentAtomics, railDailyCapAtomics) {
	if (railDailyCapAtomics == null) return null;
	const cap = BigInt(railDailyCapAtomics);
	const spent = BigInt(railSpentAtomics ?? 0);
	const amount = BigInt(amountAtomics);
	if (spent + amount <= cap) return null;
	return {
		code: 'rail_daily_exceeded',
		message: `Payment would push this rail's 24h spend to $${atomicsToUsd(spent + amount)}, over the $${atomicsToUsd(cap)} daily cap`,
		detail: {
			would_spend_usd: atomicsToUsd(spent + amount),
			spent_so_far_usd: atomicsToUsd(spent),
			cap_usd: atomicsToUsd(cap),
		},
	};
}

/**
 * Rule (last): a payment over the approval threshold does not settle on its
 * own, it needs a human to approve it first.
 *
 * Deliberately evaluated last: a call that is going to be rejected anyway
 * (bad host, expired session, insufficient budget) should fail with that
 * reason, not interrupt a human for an approval that would not have mattered.
 */
export function approvalVerdict(amountAtomics, approvalThresholdAtomics) {
	if (approvalThresholdAtomics == null) return null;
	const threshold = BigInt(approvalThresholdAtomics);
	const amount = BigInt(amountAtomics);
	if (amount <= threshold) return null;
	return {
		code: 'requires_approval',
		message: `Payment $${atomicsToUsd(amount)} exceeds the $${atomicsToUsd(threshold)} approval threshold and needs human approval`,
		detail: { amount_usd: atomicsToUsd(amount), threshold_usd: atomicsToUsd(threshold) },
	};
}

/**
 * Run every rule in enforcement order and return the first rejection, or null.
 *
 * Order matters and mirrors the governor exactly: state, then expiry, then
 * allowlist, then the block denylist, then the per-transaction ceiling, then
 * the rolling rail cap, then budget, then approval last. A caller that
 * reordered these would report "insufficient budget" for a call that is
 * actually blocked by the allowlist, which sends the user off to fund a
 * session that still would not work, or would interrupt a human for
 * approval on a call that was always going to be refused for another reason.
 *
 * @param {object} call
 * @param {string} call.url                 target endpoint
 * @param {bigint|string|number} call.amountAtomics  price in USDC atomics
 * @param {object} call.policy              { status, expiresAt, allowedHosts, blockedHosts, maxPerTxAtomics, railSpentAtomics, railDailyCapAtomics, approvalThresholdAtomics }
 * @param {bigint|string|number} call.remainingAtomics budget left before this call
 * @param {Date} [call.now]
 * @returns {{code: string, message: string, detail: object} | null}
 */
export function evaluateCall({ url, amountAtomics, policy, remainingAtomics, now = new Date() }) {
	return (
		statusVerdict(policy.status ?? 'active') ??
		expiryVerdict(policy.expiresAt ?? null, now) ??
		allowlistVerdict(url, policy.allowedHosts) ??
		blockedHostVerdict(url, policy.blockedHosts) ??
		perTxVerdict(amountAtomics, policy.maxPerTxAtomics ?? null) ??
		railDailyVerdict(amountAtomics, policy.railSpentAtomics ?? 0, policy.railDailyCapAtomics ?? null) ??
		budgetVerdict(amountAtomics, remainingAtomics) ??
		approvalVerdict(amountAtomics, policy.approvalThresholdAtomics ?? null)
	);
}

/**
 * Replay a sequence of priced calls against a policy, in order.
 *
 * This is what makes a dry run more useful than checking each call in
 * isolation: a call can be individually affordable and still fail because the
 * eleven calls before it drained the budget. The returned steps carry the
 * running balance so a UI can draw the exact point of exhaustion.
 *
 * A denied call consumes nothing, which matches the enforcer: the atomic
 * reservation only increments `spent_usdc` on the success path, and every
 * failure path either never reserved or rolled back.
 *
 * @param {Array<{url: string, amountAtomics: bigint|string|number, [k: string]: any}>} calls
 * @param {object} policy { budgetAtomics, maxPerTxAtomics, allowedHosts, blockedHosts, status, expiresAt, railDailyCapAtomics, railSpentAtomics, approvalThresholdAtomics }
 * @param {Date} [now]
 */
export function replay(calls, policy, now = new Date()) {
	const budget = BigInt(policy.budgetAtomics ?? 0);
	const railCap = policy.railDailyCapAtomics != null ? BigInt(policy.railDailyCapAtomics) : null;
	let spent = 0n;
	// Starting point is whatever the rail already spent in the current window
	// before this replay began, so a simulation can model "half the daily cap
	// is already used" the same way the governor's own pre-check does.
	let railSpent = BigInt(policy.railSpentAtomics ?? 0);
	const steps = [];

	for (const call of calls) {
		const amount = BigInt(call.amountAtomics ?? 0);
		const remainingBefore = budget - spent;
		const rejection = evaluateCall({
			url: call.url,
			amountAtomics: amount,
			policy: { ...policy, railDailyCapAtomics: railCap, railSpentAtomics: railSpent },
			remainingAtomics: remainingBefore,
			now,
		});

		// A denied call (including one that only needs approval) consumes
		// nothing, matching the enforcer: budget and the rail reservation are
		// only taken on the success path.
		if (!rejection) {
			spent += amount;
			railSpent += amount;
		}

		steps.push({
			call,
			allowed: rejection === null,
			rejection,
			amountAtomics: amount,
			remainingBeforeAtomics: remainingBefore,
			remainingAfterAtomics: budget - spent,
			railSpentAfterAtomics: railSpent,
		});
	}

	return { steps, spentAtomics: spent, remainingAtomics: budget - spent, railSpentAtomics: railSpent };
}

// ── Signed verdicts ─────────────────────────────────────────────────────────
// Every verdict the governor produces (allow or reject) is stored next to its
// execution with a digest of the policy it was judged against and an HMAC
// over {verdict, digest, request hash, timestamp}. Hashing is pure and lives
// here so the digest a simulator shows and the one the governor signs are
// computed by the same code; the HMAC itself needs a server secret and lives
// in spend-governor.js, the only place in this module graph allowed to touch one.

/** Deterministic JSON: object keys sorted, so the same policy always hashes the same way. */
function stableStringify(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const keys = Object.keys(value).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** The exact fields that govern a verdict, normalized so unrelated row noise (timestamps, ids) can't shift the digest. */
export function canonicalPolicySnapshot(session) {
	return {
		status: session.status,
		expires_at: session.expires_at ? new Date(session.expires_at).toISOString() : null,
		budget_usdc: String(session.budget_usdc ?? '0'),
		max_per_tx_usdc: session.max_per_tx_usdc != null ? String(session.max_per_tx_usdc) : null,
		allowed_hosts: canonicalizeAllowlist(session.allowed_hosts),
		blocked_hosts: canonicalizeAllowlist(session.blocked_hosts),
		approval_threshold_usdc: session.approval_threshold_usdc != null ? String(session.approval_threshold_usdc) : null,
		per_rail_daily_usdc: session.per_rail_daily_usdc ?? {},
		network: session.network,
	};
}

/** sha256 hex digest of the canonical policy snapshot. Tampering with any governed field changes this. */
export function computePolicyDigest(session) {
	return createHash('sha256').update(stableStringify(canonicalPolicySnapshot(session))).digest('hex');
}

/** sha256 hex digest binding a verdict to the specific call it was judged for. */
export function computeRequestHash({ sessionId, url, amountAtomics }) {
	return createHash('sha256')
		.update(stableStringify({ session_id: sessionId, url, amount_atomics: String(amountAtomics) }))
		.digest('hex');
}
