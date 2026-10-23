// Pure state machine for labor-market escrow with an independent evaluator.
//
// A bounty's escrow is a case that walks one explicit path:
//
//   funded --award--> working --deliver--> submitted --attest--> attested
//   attested --cooldown_elapsed--> released (pass) | refunded (fail)
//   attested --dispute (inside the window)--> disputed
//   disputed --resolve--> released | refunded   (second evaluator or arbiter)
//   disputed --arbiter_timeout--> refunded
//   funded | working --deadline--> refunded
//   any open state --moderator override--> released | refunded
//   submitted --attest_timeout--> refunded
//
// released and refunded are terminal. Every non-terminal state has a time-driven
// exit (dueEvent), so no case can wait on a human forever: that is the property
// the tests check by simulation. No I/O and no clock here; callers pass `now`.

import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { createRequire } from 'node:module';
import bs58 from 'bs58';

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');

export const ESCROW_STATES = ['funded', 'working', 'submitted', 'attested', 'disputed', 'released', 'refunded'];
export const TERMINAL_STATES = new Set(['released', 'refunded']);
export const EVALUATOR_KINDS = ['platform', 'poster', 'agent'];
export const VERDICTS = ['pass', 'fail'];
export const PASS_REASON_CODES = ['meets_spec'];
export const FAIL_REASON_CODES = ['off_spec', 'incomplete', 'empty_deliverable', 'unverifiable', 'other'];
export const REASON_CODES = [...PASS_REASON_CODES, ...FAIL_REASON_CODES];

const DAY = 86_400;
export const DEFAULT_DISPUTE_WINDOW_SECONDS = DAY;
export const MAX_DISPUTE_WINDOW_SECONDS = 30 * DAY;
// How long a dispute may sit with the second evaluator or arbiter before the
// case refunds the buyer on its own.
export const ARBITER_WINDOW_SECONDS = 7 * DAY;
// A worker who delivers at the last minute still gets this long for the
// evaluator to look at it before the no-attestation refund fires.
export const ATTEST_GRACE_SECONDS = 3 * DAY;
// A bounty posted without a deadline still expires.
export const DEFAULT_JOB_TTL_SECONDS = 14 * DAY;

export class EscrowError extends Error {
	constructor(code, message, status = 409) {
		super(message);
		this.name = 'EscrowError';
		this.code = code;
		this.status = status;
	}
}

// override_pass / override_fail are the platform moderator's escape hatch
// (api/labor/release.js): they end any open case immediately.
const OVERRIDE = { override_pass: 'released', override_fail: 'refunded' };

const TRANSITIONS = {
	funded: { award: 'working', deadline: 'refunded', cancel: 'refunded', ...OVERRIDE },
	working: { deliver: 'submitted', deadline: 'refunded', ...OVERRIDE },
	submitted: { attest: 'attested', attest_timeout: 'refunded', ...OVERRIDE },
	attested: { dispute: 'disputed', cooldown_pass: 'released', cooldown_fail: 'refunded', ...OVERRIDE },
	disputed: { resolve_pass: 'released', resolve_fail: 'refunded', arbiter_timeout: 'refunded', ...OVERRIDE },
	released: {},
	refunded: {},
};

export const ESCROW_EVENTS = [...new Set(Object.values(TRANSITIONS).flatMap((t) => Object.keys(t)))];

/** The state `event` leads to from `state`; throws a typed 409 when illegal. */
export function applyEvent(state, event) {
	const to = TRANSITIONS[state]?.[event];
	if (!to) {
		if (TERMINAL_STATES.has(state)) {
			throw new EscrowError('already_resolved', `escrow is already ${state}`);
		}
		throw new EscrowError('illegal_transition', `cannot ${event} while escrow is ${state}`);
	}
	return to;
}

export function isTerminal(state) {
	return TERMINAL_STATES.has(state);
}

/**
 * A terminal case whose funds have not moved yet. The decision is durable the
 * moment the state is terminal; the payout is retried by the cron until it lands.
 */
export function needsPayout(c) {
	return TERMINAL_STATES.has(c.state) && !c.paid_at;
}

/** Clamp a requested dispute window to [0, 30 days]; undefined/null means default. */
export function normalizeDisputeWindow(seconds) {
	if (seconds == null || seconds === '') return DEFAULT_DISPUTE_WINDOW_SECONDS;
	const n = Number(seconds);
	if (!Number.isFinite(n) || n < 0 || n > MAX_DISPUTE_WINDOW_SECONDS) {
		throw new EscrowError(
			'bad_dispute_window',
			`disputeWindowSeconds must be between 0 and ${MAX_DISPUTE_WINDOW_SECONDS}`,
			400,
		);
	}
	return Math.floor(n);
}

/** Validate the evaluator choice made when a bounty is posted. */
export function normalizeEvaluator(input, { posterAgentId = null } = {}) {
	if (input == null || input === '' || input === 'platform') return { kind: 'platform', agentId: null };
	if (input === 'poster') return { kind: 'poster', agentId: posterAgentId };
	const kind = typeof input === 'string' ? input : input.kind;
	if (!EVALUATOR_KINDS.includes(kind)) {
		throw new EscrowError('bad_evaluator', `evaluator must be one of ${EVALUATOR_KINDS.join(', ')}`, 400);
	}
	if (kind === 'platform') return { kind, agentId: null };
	if (kind === 'poster') return { kind, agentId: posterAgentId };
	const agentId = typeof input === 'object' ? input.agentId : null;
	if (!agentId || typeof agentId !== 'string') {
		throw new EscrowError('bad_evaluator', 'a registry evaluator needs an agentId', 400);
	}
	return { kind, agentId };
}

const ms = (iso) => (iso ? new Date(iso).getTime() : NaN);

/** The instant by which a submitted job must have an attestation. */
export function attestDeadline({ deadlineAt, submittedAt }) {
	const grace = ms(submittedAt) + ATTEST_GRACE_SECONDS * 1000;
	const hard = ms(deadlineAt);
	return new Date(Math.max(Number.isNaN(hard) ? 0 : hard, grace)).toISOString();
}

/**
 * The time-driven event a case is due for at `now`, or null. This is the cron's
 * whole decision: it never has to reason about anything else.
 */
export function dueEvent(c, now = new Date()) {
	const t = now instanceof Date ? now.getTime() : ms(now);
	switch (c.state) {
		case 'funded':
		case 'working':
			return t >= ms(c.deadline_at) ? 'deadline' : null;
		case 'submitted':
			return t >= ms(c.attest_by) ? 'attest_timeout' : null;
		case 'attested':
			if (t < ms(c.release_at)) return null;
			return c.attestation?.verdict === 'pass' ? 'cooldown_pass' : 'cooldown_fail';
		case 'disputed':
			return t >= ms(c.arbiter_by) ? 'arbiter_timeout' : null;
		default:
			return null;
	}
}

/** Which side may open a dispute: the one the attestation went against. */
export function losingSide(attestation) {
	return attestation?.verdict === 'pass' ? 'poster' : 'worker';
}

/** Throws unless `side` may dispute this case right now. */
export function assertCanDispute(c, side, now = new Date()) {
	if (c.state === 'disputed') throw new EscrowError('already_disputed', 'this case is already in dispute');
	if (c.state !== 'attested') {
		throw new EscrowError('not_disputable', `only an attested case can be disputed; escrow is ${c.state}`);
	}
	const t = now instanceof Date ? now.getTime() : ms(now);
	if (t >= ms(c.release_at)) {
		throw new EscrowError('dispute_window_closed', 'the dispute window has closed');
	}
	if (side !== losingSide(c.attestation)) {
		throw new EscrowError('not_losing_side', `only the ${losingSide(c.attestation)} can dispute this verdict`, 403);
	}
}

// ── Attestations ─────────────────────────────────────────────────────────────

/** Deterministic, key-order-independent JSON (signing and hashing input). */
export function canonicalJson(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256Hex(value) {
	return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

/** Validate caller-supplied attestation fields; returns the cleaned set. */
export function validateAttestationInput({ verdict, reasonCode, reasonDetail, evidenceUrl }) {
	if (!VERDICTS.includes(verdict)) throw new EscrowError('bad_verdict', "verdict must be 'pass' or 'fail'", 400);
	const allowed = verdict === 'pass' ? PASS_REASON_CODES : FAIL_REASON_CODES;
	const code = reasonCode || (verdict === 'pass' ? 'meets_spec' : null);
	if (!allowed.includes(code)) {
		throw new EscrowError('bad_reason_code', `reasonCode for a ${verdict} must be one of ${allowed.join(', ')}`, 400);
	}
	let evidence = null;
	if (evidenceUrl != null && evidenceUrl !== '') {
		let u;
		try {
			u = new URL(String(evidenceUrl));
		} catch {
			throw new EscrowError('bad_evidence_url', 'evidenceUrl must be an https URL', 400);
		}
		if (u.protocol !== 'https:' || String(evidenceUrl).length > 500) {
			throw new EscrowError('bad_evidence_url', 'evidenceUrl must be an https URL of at most 500 characters', 400);
		}
		evidence = u.toString();
	}
	return {
		verdict,
		reasonCode: code,
		reasonDetail: reasonDetail ? String(reasonDetail).slice(0, 280) : null,
		evidenceUrl: evidence,
	};
}

/** The exact object an evaluator signs. */
export function buildAttestationPayload({
	caseId, bountyId, jobId, deliverableHash, evaluatorKind, evaluatorAgentId, signer,
	verdict, reasonCode, reasonDetail = null, evidenceUrl = null, issuedAt, round = 1,
}) {
	return {
		v: 1,
		case_id: caseId,
		bounty_id: bountyId,
		job_id: jobId,
		deliverable_hash: deliverableHash,
		evaluator_kind: evaluatorKind,
		evaluator_agent_id: evaluatorAgentId || null,
		signer,
		verdict,
		reason_code: reasonCode,
		reason_detail: reasonDetail,
		evidence_url: evidenceUrl,
		round,
		issued_at: issuedAt,
	};
}

/** Sign a payload with an ed25519 keypair (web3.js Keypair shape). Returns base64. */
export function signAttestation(payload, keypair) {
	const sig = nacl.sign.detached(Buffer.from(canonicalJson(payload), 'utf8'), keypair.secretKey);
	return Buffer.from(sig).toString('base64');
}

/** True when `signature` (base64) is `signer`'s (base58) ed25519 signature over payload. */
export function verifyAttestation({ payload, signature, signer }) {
	try {
		if (!payload || payload.signer !== signer) return false;
		const raw = Buffer.from(bs58.decode(signer));
		if (raw.length !== 32) return false;
		const key = createPublicKey({
			key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
			format: 'der',
			type: 'spki',
		});
		return nodeVerify(null, Buffer.from(canonicalJson(payload), 'utf8'), key, Buffer.from(signature, 'base64'));
	} catch {
		return false;
	}
}

// ── Audit chain ──────────────────────────────────────────────────────────────

/** Hash that links a trail entry to the one before it. */
export function chainHash(prevHash, entry) {
	return sha256Hex(`${prevHash || ''}|${canonicalJson(entry)}`);
}

/** Recompute a trail's hashes; returns { ok, brokenAt }. Rows must be in seq order. */
export function verifyChain(events) {
	let prev = null;
	for (const e of events) {
		const expected = chainHash(prev, {
			seq: e.seq, from: e.from_state, to: e.to_state, event: e.event,
			actor: e.actor, reason: e.reason || null, data: e.data || {},
			at: e.at,
		});
		if (e.prev_hash !== prev || e.hash !== expected) return { ok: false, brokenAt: e.seq };
		prev = e.hash;
	}
	return { ok: true, brokenAt: null };
}
