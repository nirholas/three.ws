// Independent evaluation, dispute window and automatic release for labor-market
// escrow. Drives the state machine (labor-escrow-machine.js) over the ledger
// (labor-escrow-ledger.js) and moves money only through the settlement path that
// already exists (labor-settle.js runSettlement, plus refundBounty below).
//
// The decision is durable the moment a case reaches released or refunded; the
// payout that follows is retried by the cron until paid_at is set. So a failed
// transfer never loses the decision and never pays twice: runSettlement claims
// the job (settle_key) and refundBounty claims the bounty ('refunding').

import { sql } from './db.js';
import { env } from './env.js';
import {
	getBounty, getJobByBounty, markJobFailed, setBountyStatus, atomicsToThree, _toBig as toBig,
} from './agent-labor.js';
import { verifyDeliverable } from './labor-match.js';
import { payFromEscrow, ensureEscrowGas } from './labor-escrow.js';
import { runSettlement } from './labor-settle.js';
import { loadAttesterKeypair } from './attest-event.js';
import { insertNotification } from './notify.js';
import {
	EscrowError, applyEvent, dueEvent, needsPayout, isTerminal, losingSide, assertCanDispute,
	attestDeadline, sha256Hex, validateAttestationInput, buildAttestationPayload, signAttestation,
	verifyAttestation, normalizeDisputeWindow, normalizeEvaluator, ARBITER_WINDOW_SECONDS,
} from './labor-escrow-machine.js';
import {
	ensureEscrowTables, getCase, getCaseByBounty, openCase, transition, markPaid, markNotified, trailFor,
} from './labor-escrow-ledger.js';

const DAY_MS = 86_400_000;
const REMINDER_MS = DAY_MS;
const ISSUED_AT_SKEW_MS = 10 * 60_000;

const nowIso = () => new Date().toISOString();

// Why a terminal case ended, as stored in labor_escrow_cases.outcome.
const OUTCOME_FOR_EVENT = {
	cooldown_pass: 'pass', cooldown_fail: 'fail', resolve_pass: 'pass', resolve_fail: 'fail',
	deadline: 'deadline', cancel: 'cancel', attest_timeout: 'attest_timeout', arbiter_timeout: 'arbiter_timeout',
	override_pass: 'pass', override_fail: 'moderator_refund',
};
// Outcomes where nobody is at fault, so the job is recorded 'refunded', not 'failed'.
const NEUTRAL_OUTCOMES = new Set(['deadline', 'cancel', 'attest_timeout', 'arbiter_timeout', 'moderator_refund']);

// ── Opening and advancing a case along the job ──────────────────────────────

/** The escrow settings a bounty was posted with (validated at post time). */
export function escrowConfigFor(bounty) {
	const cfg = bounty?.meta?.escrow || {};
	return {
		evaluator: normalizeEvaluator(cfg.evaluator, { posterAgentId: bounty?.poster_agent_id }),
		disputeWindowSeconds: normalizeDisputeWindow(cfg.dispute_window_seconds),
	};
}

/**
 * The case for a funded bounty, opened on first use. Bounties funded before the
 * evaluator layer shipped get one with the platform defaults, so every delivery
 * goes through the same path. A bounty with no funded escrow has no case.
 */
export async function ensureCase(bounty) {
	if (!bounty?.escrow_fund_sig) return null;
	const existing = await getCaseByBounty(bounty.id);
	if (existing) return existing;
	const cfg = escrowConfigFor(bounty);
	return openCase({ bounty, evaluator: cfg.evaluator, disputeWindowSeconds: cfg.disputeWindowSeconds });
}

/** Record that a worker was awarded the bounty (funded to working). Idempotent. */
export async function recordAward(bounty, job) {
	const c = await ensureCase(bounty);
	if (!c || c.state !== 'funded') return c;
	try {
		return await transition(c, 'award', {
			actor: 'poster', reason: 'worker awarded',
			data: { worker_agent_id: job.worker_agent_id, price_atomics: String(toBig(job.price_atomics)) },
			patch: { jobId: job.id },
		});
	} catch (e) {
		if (e?.code === 'state_changed') return getCase(c.id);
		throw e;
	}
}

/**
 * A delivered job enters evaluation: catch the case up to 'submitted', then ask
 * the platform checker when it is the evaluator. Safe to call repeatedly.
 */
export async function intakeDelivery({ bounty, job }) {
	let c = await ensureCase(bounty);
	if (!c) return null;
	if (c.state === 'funded') c = await recordAward(bounty, job);
	if (c.state === 'working') {
		const submittedAt = nowIso();
		try {
			c = await transition(c, 'deliver', {
				actor: 'worker', reason: 'deliverable submitted',
				data: { job_id: job.id, deliverable_hash: sha256Hex(job.deliverable ?? {}) },
				patch: {
					jobId: job.id, submittedAt,
					attestBy: attestDeadline({ deadlineAt: c.deadline_at, submittedAt }),
				},
			});
		} catch (e) {
			if (e?.code !== 'state_changed') throw e;
			c = await getCase(c.id);
		}
		await notifyParties(c, bounty, job, 'delivered', 'delivered');
	}
	if (c.state === 'submitted' && c.evaluator_kind === 'platform') {
		c = (await platformEvaluate(c, bounty, job)) || c;
	}
	return c;
}

// ── Attestations ─────────────────────────────────────────────────────────────

function deliverableHashOf(job) {
	return sha256Hex(job?.deliverable ?? {});
}

function attesterOrNull() {
	try {
		return loadAttesterKeypair();
	} catch {
		return null;
	}
}

function requireAttester() {
	const kp = attesterOrNull();
	if (!kp) {
		throw new EscrowError('attester_unconfigured', 'the platform attestation key is not configured, so no attestation can be signed right now', 503);
	}
	return kp;
}

/** The exact object an evaluator signs for this case, for a self-signed attestation. */
export function attestationTemplate(c, job, { verdict, reasonCode, reasonDetail = null, evidenceUrl = null, signer, round = 1, issuedAt = nowIso() }) {
	return buildAttestationPayload({
		caseId: c.id, bountyId: c.bounty_id, jobId: job.id, deliverableHash: deliverableHashOf(job),
		evaluatorKind: c.evaluator_kind, evaluatorAgentId: c.evaluator_agent_id, signer,
		verdict, reasonCode, reasonDetail, evidenceUrl, issuedAt, round,
	});
}

/**
 * Record the first-round attestation. `signed` is { payload, signature } already
 * verified or produced by the caller. A second attempt, or one that loses a race
 * with the timeout, gets a typed 409 from the compare-and-set.
 */
async function recordAttestation(c, { payload, signature, signer, actor }) {
	if (c.state !== 'submitted') {
		const code = isTerminal(c.state) ? 'already_resolved' : 'already_attested';
		throw new EscrowError(code, c.state === 'working' || c.state === 'funded'
			? `nothing has been delivered yet; escrow is ${c.state}`
			: `this job already has an attestation; escrow is ${c.state}`);
	}
	const attestedAt = nowIso();
	const releaseAt = new Date(Date.parse(attestedAt) + Number(c.dispute_window_seconds) * 1000).toISOString();
	return transition(c, 'attest', {
		actor, reason: payload.reason_code,
		data: {
			verdict: payload.verdict, reason_code: payload.reason_code, evidence_url: payload.evidence_url,
			signer, deliverable_hash: payload.deliverable_hash, release_at: releaseAt,
		},
		patch: { attestation: { verdict: payload.verdict, payload, signature, signer }, attestedAt, releaseAt },
	});
}

/**
 * The platform checker evaluates a delivered job and attests. Returns the updated
 * case, or null when no verdict could be reached (checker unavailable): the case
 * stays 'submitted' and the sweep tries again until attest_by.
 */
export async function platformEvaluate(c, bounty, job) {
	const kp = attesterOrNull();
	if (!kp) return null;
	const v = await verifyDeliverable({ bounty, deliverable: job.deliverable });
	if (v.verifier === 'unavailable') return null;
	const empty = !String(job.deliverable?.output || '').trim();
	const input = validateAttestationInput({
		verdict: v.pass ? 'pass' : 'fail',
		reasonCode: v.pass ? 'meets_spec' : empty ? 'empty_deliverable' : 'off_spec',
		reasonDetail: v.reason,
		evidenceUrl: `${env.APP_ORIGIN}/api/labor/escrow?bountyId=${bounty.id}`,
	});
	const signer = kp.publicKey.toBase58();
	const payload = attestationTemplate(c, job, { ...input, signer });
	try {
		const next = await recordAttestation(c, {
			payload, signature: signAttestation(payload, kp), signer, actor: 'platform_checker',
		});
		await onAttested(next, bounty, job);
		return next;
	} catch (e) {
		if (e?.code === 'state_changed' || e?.code === 'already_attested') return getCase(c.id);
		throw e;
	}
}

async function userOwnsAgent(userId, agentId) {
	if (!userId || !agentId) return false;
	const [row] = await sql`SELECT 1 AS ok FROM agent_identities WHERE id = ${agentId} AND user_id = ${userId} AND deleted_at IS NULL`;
	return !!row;
}

async function agentSolanaAddress(agentId) {
	const [row] = await sql`SELECT meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	return row?.meta?.solana_address || null;
}

/**
 * An evaluator (the hiring agent's owner, or a registry agent's owner) submits a
 * verdict. The server countersigns it with the platform key; a caller who signs
 * the payload themselves (`signature` + `signer` + `issuedAt`) is verified against
 * the evaluator agent's own wallet instead.
 */
export async function submitAttestation({ bountyId, userId, input, signature = null, signer = null, issuedAt = null }) {
	await ensureEscrowTables();
	const c = await getCaseByBounty(bountyId);
	if (!c) throw new EscrowError('no_case', 'this bounty has no funded escrow to evaluate', 404);
	const [bounty, job] = await Promise.all([getBounty(bountyId), getJobByBounty(bountyId)]);
	if (!job) throw new EscrowError('no_job', 'no worker has been awarded, so there is nothing to evaluate', 409);

	if (c.evaluator_kind === 'platform') {
		throw new EscrowError('platform_evaluates', 'this job is evaluated by the platform checker; you cannot attest it', 403);
	}
	const evaluatorAgentId = c.evaluator_kind === 'poster' ? bounty.poster_agent_id : c.evaluator_agent_id;
	if (!(await userOwnsAgent(userId, evaluatorAgentId))) {
		throw new EscrowError('not_evaluator', 'only the owner of the named evaluator can attest this job', 403);
	}
	if (evaluatorAgentId === job.worker_agent_id) {
		throw new EscrowError('conflict_of_interest', 'the worker cannot evaluate its own delivery', 403);
	}

	const clean = validateAttestationInput(input);
	let payload;
	let sig;
	let signedBy;
	if (signature) {
		const expected = await agentSolanaAddress(evaluatorAgentId);
		if (!signer || signer !== expected) {
			throw new EscrowError('bad_signer', "signer must be the evaluator agent's own Solana wallet address", 400);
		}
		const at = Date.parse(issuedAt);
		if (!Number.isFinite(at) || Math.abs(Date.now() - at) > ISSUED_AT_SKEW_MS) {
			throw new EscrowError('bad_issued_at', 'issuedAt must be an ISO timestamp within ten minutes of now', 400);
		}
		payload = attestationTemplate(c, job, { ...clean, signer, issuedAt: new Date(at).toISOString() });
		if (!verifyAttestation({ payload, signature, signer })) {
			throw new EscrowError('bad_signature', 'the signature does not match the attestation payload', 400);
		}
		sig = signature;
		signedBy = signer;
	} else {
		const kp = requireAttester();
		signedBy = kp.publicKey.toBase58();
		payload = attestationTemplate(c, job, { ...clean, signer: signedBy });
		sig = signAttestation(payload, kp);
	}

	const next = await recordAttestation(c, { payload, signature: sig, signer: signedBy, actor: `evaluator:${evaluatorAgentId}` });
	await onAttested(next, bounty, job);
	return next;
}

async function onAttested(c, bounty, job) {
	const verdict = c.attestation?.verdict;
	await notifyParties(c, bounty, job, 'attested', 'attested', {
		verdict, release_at: c.release_at,
		message: verdict === 'pass'
			? `The evaluator passed "${bounty.title}". Funds release to the worker at the end of the dispute window unless the poster disputes.`
			: `The evaluator failed "${bounty.title}". The reward refunds to the poster at the end of the dispute window unless the worker disputes.`,
	});
	// A zero-length window means there is nothing to wait for.
	if (Date.parse(c.release_at) <= Date.now()) await advanceCase(c.id);
}

// ── Disputes ─────────────────────────────────────────────────────────────────

async function sideForUser(userId, bounty, job) {
	const poster = await userOwnsAgent(userId, bounty.poster_agent_id);
	const worker = job ? await userOwnsAgent(userId, job.worker_agent_id) : false;
	return { poster, worker };
}

/**
 * The losing side disputes the verdict while the window is open. The case freezes
 * (the cron cannot release it) and routes to a second evaluator: the platform
 * checker when the first evaluator was the poster or a registry agent, otherwise
 * the platform arbiter. With no ruling by arbiter_by the buyer is refunded.
 */
export async function openDispute({ bountyId, userId, reason, evidenceUrl = null }) {
	await ensureEscrowTables();
	const c = await getCaseByBounty(bountyId);
	if (!c) throw new EscrowError('no_case', 'this bounty has no funded escrow', 404);
	const [bounty, job] = await Promise.all([getBounty(bountyId), getJobByBounty(bountyId)]);
	const sides = await sideForUser(userId, bounty, job);
	if (!sides.poster && !sides.worker) {
		throw new EscrowError('forbidden', 'only the poster or the worker can dispute this job', 403);
	}
	const text = String(reason || '').trim();
	if (text.length < 10) throw new EscrowError('reason_required', 'say why you dispute the verdict (at least 10 characters)', 400);
	let evidence = null;
	if (evidenceUrl) {
		try {
			const u = new URL(String(evidenceUrl));
			if (u.protocol !== 'https:') throw new Error('scheme');
			evidence = u.toString();
		} catch {
			throw new EscrowError('bad_evidence_url', 'evidenceUrl must be an https URL', 400);
		}
	}
	const losing = c.attestation ? losingSide(c.attestation) : null;
	const side = sides.poster && sides.worker ? losing : sides.poster ? 'poster' : 'worker';
	assertCanDispute(c, side);

	const at = nowIso();
	const next = await transition(c, 'dispute', {
		actor: side, reason: 'verdict disputed',
		data: { reason: text.slice(0, 500), evidence_url: evidence, route: c.evaluator_kind === 'platform' ? 'arbiter' : 'platform_recheck' },
		patch: {
			dispute: { by: side, reason: text.slice(0, 500), evidence_url: evidence, at },
			disputedAt: at,
			arbiterBy: new Date(Date.parse(at) + ARBITER_WINDOW_SECONDS * 1000).toISOString(),
		},
	});
	await notifyParties(next, bounty, job, 'disputed', 'disputed', {
		by: side, arbiter_by: next.arbiter_by,
		message: `The ${side} disputed the verdict on "${bounty.title}". Funds are frozen until a second evaluation rules.`,
	});
	if (next.evaluator_kind !== 'platform') {
		return (await recheckDispute(next, bounty, job)) || next;
	}
	return next;
}

/** Second evaluation by the platform checker (independent of the first evaluator). */
async function recheckDispute(c, bounty, job) {
	const kp = attesterOrNull();
	if (!kp || c.state !== 'disputed') return null;
	const v = await verifyDeliverable({ bounty, deliverable: job.deliverable });
	if (v.verifier === 'unavailable') return null;
	return rule(c, bounty, job, {
		verdict: v.pass ? 'pass' : 'fail',
		reasonCode: v.pass ? 'meets_spec' : 'off_spec',
		reasonDetail: v.reason, actor: 'platform_checker',
	});
}

/** The platform arbiter (an admin) rules on a disputed case. */
export async function arbitrate({ bountyId, adminId, input }) {
	await ensureEscrowTables();
	const c = await getCaseByBounty(bountyId);
	if (!c) throw new EscrowError('no_case', 'this bounty has no funded escrow', 404);
	if (c.state !== 'disputed') {
		throw new EscrowError(isTerminal(c.state) ? 'already_resolved' : 'not_disputed', `only a disputed case can be arbitrated; escrow is ${c.state}`);
	}
	const [bounty, job] = await Promise.all([getBounty(bountyId), getJobByBounty(bountyId)]);
	return rule(c, bounty, job, { ...input, actor: `arbiter:${adminId}` });
}

async function rule(c, bounty, job, { verdict, reasonCode, reasonDetail = null, evidenceUrl = null, actor }) {
	const clean = validateAttestationInput({ verdict, reasonCode, reasonDetail, evidenceUrl });
	const kp = requireAttester();
	const signer = kp.publicKey.toBase58();
	const payload = attestationTemplate(c, job, { ...clean, signer, round: 2 });
	const resolvedAt = nowIso();
	const event = clean.verdict === 'pass' ? 'resolve_pass' : 'resolve_fail';
	let next;
	try {
		next = await transition(c, event, {
			actor, reason: clean.reasonCode,
			data: { verdict: clean.verdict, reason_code: clean.reasonCode, evidence_url: clean.evidenceUrl, signer },
			patch: {
				resolution: { verdict: clean.verdict, payload, signature: signAttestation(payload, kp), signer },
				resolvedAt, outcome: OUTCOME_FOR_EVENT[event],
			},
		});
	} catch (e) {
		if (e?.code === 'state_changed') return getCase(c.id);
		throw e;
	}
	await notifyParties(next, bounty, job, 'resolved', 'resolved', {
		verdict: clean.verdict,
		message: `The dispute on "${bounty.title}" was ruled ${clean.verdict === 'pass' ? 'for the worker' : 'for the poster'}.`,
	});
	return (await payoutCase(next)) || next;
}

/**
 * A platform moderator force-resolves a bounty's escrow (release to the worker or
 * refund to the poster), whatever state the case is in. The override is a normal
 * transition, so it lands in the same trail as everything else.
 */
export async function moderatorOverride({ bountyId, adminId, action, reason = null }) {
	await ensureEscrowTables();
	const bounty = await getBounty(bountyId);
	if (!bounty) throw new EscrowError('no_case', 'bounty not found', 404);
	const c = await ensureCase(bounty);
	if (!c) throw new EscrowError('no_escrow', 'this bounty has no funded escrow to move', 409);
	const job = await getJobByBounty(bountyId);
	if (action === 'release' && !job) {
		throw new EscrowError('no_worker', 'no worker has been awarded, so only refund is available', 409);
	}
	const event = action === 'release' ? 'override_pass' : 'override_fail';
	applyEvent(c.state, event); // typed 409 for an already-resolved case, before any side effect
	if (action === 'release' && job.status === 'working') {
		const { markJobDelivered } = await import('./agent-labor.js');
		await markJobDelivered(job.id, { moderator_override: true, action, by: { admin_id: adminId } });
	}
	const next = await transition(c, event, {
		actor: `moderator:${adminId}`, reason: reason ? String(reason).slice(0, 280) : `moderator ${action}`,
		patch: { outcome: OUTCOME_FOR_EVENT[event], resolvedAt: nowIso() },
	});
	await notifyParties(next, bounty, job, 'resolved', 'resolved', {
		verdict: next.outcome, message: resolutionCopy(next.outcome, bounty.title),
	});
	return (await payoutCase(next)) || next;
}

/** The poster withdraws a funded bounty that nobody has been awarded. */
export async function cancelBounty({ bountyId, userId }) {
	await ensureEscrowTables();
	const bounty = await getBounty(bountyId);
	if (!bounty) throw new EscrowError('no_case', 'bounty not found', 404);
	if (!(await userOwnsAgent(userId, bounty.poster_agent_id))) {
		throw new EscrowError('forbidden', 'only the poster can cancel this bounty', 403);
	}
	const c = await ensureCase(bounty);
	if (!c) throw new EscrowError('no_escrow', 'this bounty has no funded escrow', 409);
	const next = await transition(c, 'cancel', {
		actor: 'poster', reason: 'cancelled before award', patch: { outcome: 'cancel', resolvedAt: nowIso() },
	});
	return (await payoutCase(next)) || next;
}

// ── Time-driven progress (the cron) ─────────────────────────────────────────

/**
 * Take one case as far as the clock allows: evaluate a pending delivery, apply a
 * due timeout or cooldown event, and pay out a terminal decision. Returns the
 * case as it stands. Losing a race to another writer is fine; the loser rereads.
 */
export async function advanceCase(caseId, now = new Date()) {
	let c = await getCase(caseId);
	if (!c) return null;
	const bounty = await getBounty(c.bounty_id);
	const job = await getJobByBounty(c.bounty_id);

	if (!isTerminal(c.state)) {
		if (c.state === 'submitted' && c.evaluator_kind === 'platform' && job) {
			c = (await platformEvaluate(c, bounty, job)) || c;
		}
		if (c.state === 'disputed' && c.evaluator_kind !== 'platform' && job) {
			c = (await recheckDispute(c, bounty, job)) || c;
		}
		const ev = c.state === 'attested' || c.state === 'submitted' || c.state === 'disputed' || c.state === 'funded' || c.state === 'working'
			? dueEvent(c, now) : null;
		if (ev) {
			try {
				c = await transition(c, ev, {
					actor: 'cron', reason: OUTCOME_FOR_EVENT[ev],
					patch: { outcome: OUTCOME_FOR_EVENT[ev], resolvedAt: nowIso() },
				});
				await notifyParties(c, bounty, job, 'resolved', 'resolved', {
					verdict: c.outcome, message: resolutionCopy(c.outcome, bounty.title),
				});
			} catch (e) {
				if (e?.code !== 'state_changed') throw e;
				c = await getCase(caseId);
			}
		} else {
			await remind(c, bounty, job, now);
		}
	}
	if (needsPayout(c)) c = (await payoutCase(c)) || c;
	return c;
}

function resolutionCopy(outcome, title) {
	switch (outcome) {
		case 'pass': return `"${title}" passed and the dispute window closed. Funds are releasing to the worker.`;
		case 'fail': return `"${title}" failed and the dispute window closed. The reward is refunding to the poster.`;
		case 'deadline': return `"${title}" reached its deadline without a delivery. The reward is refunding to the poster.`;
		case 'attest_timeout': return `"${title}" was delivered but never evaluated in time. The reward is refunding to the poster.`;
		case 'arbiter_timeout': return `The dispute on "${title}" was not ruled in time. The reward is refunding to the poster.`;
		case 'moderator_refund': return `A platform moderator refunded "${title}" to the poster.`;
		case 'cancel': return `"${title}" was cancelled. The reward is refunding to the poster.`;
		default: return `"${title}" is resolved.`;
	}
}

async function remind(c, bounty, job, now) {
	const t = now.getTime();
	let target = null;
	let what = null;
	if ((c.state === 'funded' || c.state === 'working') && c.deadline_at) {
		target = Date.parse(c.deadline_at);
		what = c.state === 'funded' ? 'The bounty has no worker yet and its deadline is near.' : 'The worker has not delivered and the deadline is near.';
	} else if (c.state === 'submitted' && c.attest_by) {
		target = Date.parse(c.attest_by);
		what = 'The delivery has not been evaluated yet. With no verdict by then the reward refunds to the poster.';
	} else if (c.state === 'disputed' && c.arbiter_by) {
		target = Date.parse(c.arbiter_by);
		what = 'The dispute has not been ruled on. With no ruling by then the reward refunds to the poster.';
	}
	if (!target || target - t > REMINDER_MS || target <= t) return;
	await notifyParties(c, bounty, job, 'deadline_soon', `deadline_soon:${c.state}`, {
		deadline: new Date(target).toISOString(),
		message: `"${bounty.title}": ${what}`,
	});
}

/** Cases the cron can act on now. Pre-filtered in SQL so idle cases never take a slot. */
export async function dueCaseIds(limit = 50) {
	await ensureEscrowTables();
	const rows = await sql`
		SELECT id FROM labor_escrow_cases
		WHERE (state IN ('released','refunded') AND paid_at IS NULL)
		   OR (state IN ('funded','working') AND deadline_at <= now() + interval '24 hours')
		   OR (state = 'submitted' AND (evaluator_kind = 'platform' OR attest_by <= now() + interval '24 hours'))
		   OR (state = 'attested' AND release_at <= now())
		   OR (state = 'disputed' AND (evaluator_kind <> 'platform' OR arbiter_by <= now() + interval '24 hours'))
		ORDER BY updated_at ASC
		LIMIT ${limit}`;
	return rows.map((r) => r.id);
}

/** One cron pass. Never throws on a single bad case. */
export async function sweepCases({ limit = 50 } = {}) {
	const ids = await dueCaseIds(limit);
	const out = { scanned: ids.length, resolved: 0, paid: 0, failed: 0, errors: [] };
	for (const id of ids) {
		try {
			const before = await getCase(id);
			const after = await advanceCase(id);
			if (before && after && !isTerminal(before.state) && isTerminal(after.state)) out.resolved++;
			if (before && after && !before.paid_at && after.paid_at) out.paid++;
		} catch (e) {
			out.failed++;
			console.error('[labor-escrow-sweep] case failed', id, e?.message);
			if (out.errors.length < 5) out.errors.push(`${id}: ${String(e?.message || e).slice(0, 160)}`);
		}
	}
	return out;
}

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * Pay a terminal case out exactly once. Returns the case (paid) or null when the
 * transfer is still pending; a failed transfer is left for the next sweep, and the
 * parties are told once that it is delayed.
 */
export async function payoutCase(c) {
	if (!needsPayout(c)) return c;
	const bounty = await getBounty(c.bounty_id);
	const job = await getJobByBounty(c.bounty_id);
	const outcome = c.outcome || (c.state === 'released' ? 'pass' : 'fail');
	let moved;
	try {
		if (job && ['delivered', 'verifying', 'settled', 'failed', 'refunded'].includes(job.status)) {
			const verdict = {
				pass: c.state === 'released',
				score: c.state === 'released' ? 1 : 0,
				reason: resolutionCopy(outcome, bounty.title),
				evaluation: { case_id: c.id, outcome },
				...(NEUTRAL_OUTCOMES.has(outcome) ? { neutral: { case_id: c.id, outcome } } : {}),
			};
			const r = await runSettlement({ job, bounty, verdict });
			if (r.idempotent && ['delivered', 'verifying'].includes(r.status)) return null; // another sweep mid-claim
			moved = {
				sig: r.settlement_sig || r.refund_sig || r.job?.settlement_sig || r.job?.refund_sig || null,
				status: r.status, result: r,
			};
		} else {
			const r = await refundBounty({ bounty, job, reason: resolutionCopy(outcome, bounty.title) });
			if (r.pending) return null;
			moved = { sig: r.sig, status: 'refunded' };
		}
	} catch (e) {
		console.error('[labor-escrow] payout failed, will retry', c.id, e?.message);
		await notifyParties(c, bounty, job, 'payout_delayed', 'payout_delayed', {
			message: `The payout for "${bounty.title}" could not be sent yet (the escrow wallet may be low on funds or fees). It retries automatically and nothing is lost.`,
		});
		return null;
	}
	const paid = await markPaid(c, { sig: moved.sig, data: { status: moved.status, outcome } });
	const fresh = paid || (await getCase(c.id));
	await notifyParties(fresh, bounty, job, 'paid', 'paid', {
		status: moved.status, signature: moved.sig,
		message: moved.status === 'settled'
			? `"${bounty.title}" paid out: the worker received the reward.`
			: `"${bounty.title}" refunded: ${atomicsToThree(bounty.reward_atomics)} $THREE returned to the poster.`,
	});
	return fresh;
}

/**
 * Return a bounty's whole reward to the poster when no delivered job exists to
 * settle through runSettlement (no worker, or a worker who never delivered).
 * Claims the bounty ('refunding') so concurrent sweeps cannot both transfer.
 */
export async function refundBounty({ bounty, job = null, reason }) {
	const [claimed] = await sql`
		UPDATE agent_bounties SET status = 'refunding', updated_at = now()
		WHERE id = ${bounty.id} AND status IN ('open','working') RETURNING status`;
	if (!claimed) {
		const cur = await getBounty(bounty.id);
		if (cur?.status === 'refunding') return { pending: true };
		return { already: true, sig: cur?.refund_sig || null };
	}
	const prior = bounty.status === 'working' ? 'working' : 'open';
	let sig = null;
	try {
		const to = await agentSolanaAddress(bounty.poster_agent_id);
		if (!to) throw new Error('poster has no Solana wallet to refund to');
		await ensureEscrowGas().catch(() => {});
		sig = await payFromEscrow({ toAddress: to, amountAtomics: toBig(bounty.reward_atomics) });
	} catch (e) {
		await sql`UPDATE agent_bounties SET status = ${prior}, updated_at = now() WHERE id = ${bounty.id} AND status = 'refunding'`;
		throw e;
	}
	await setBountyStatus(bounty.id, 'refunded', { refundSig: sig });
	if (job && job.status === 'working') await markJobFailed(job.id, { reason, refundSig: sig, status: 'refunded' });
	return { sig };
}

// ── Notifications ────────────────────────────────────────────────────────────

const NOTIFY_TITLES = {
	delivered: 'Delivery submitted',
	attested: 'Verdict recorded',
	disputed: 'Verdict disputed',
	resolved: 'Escrow resolved',
	deadline_soon: 'Deadline approaching',
	payout_delayed: 'Payout delayed',
	paid: 'Escrow paid out',
};

/** Tell the poster and the worker once per milestone, through the notification gateway. */
export async function notifyParties(c, bounty, job, kind, key, extra = {}) {
	if (!c || !bounty) return;
	const first = await markNotified(c.id, key).catch(() => false);
	if (!first) return;
	const type = kind === 'deadline_soon' ? 'labor_deadline_soon' : kind === 'payout_delayed' ? 'labor_payout_delayed' : 'labor_escrow_update';
	const users = new Set([bounty.poster_user_id, job?.worker_user_id].filter(Boolean));
	for (const userId of users) {
		await insertNotification(userId, type, {
			title: NOTIFY_TITLES[kind] || 'Escrow update',
			message: extra.message || `${NOTIFY_TITLES[kind] || 'Escrow update'}: "${bounty.title}"`,
			bounty_id: bounty.id, case_id: c.id, state: c.state, kind,
			link: `/labor-market?bounty=${bounty.id}`,
			...(extra.signature ? { tx_signature: extra.signature } : {}),
		});
	}
}

// ── Read model ───────────────────────────────────────────────────────────────

/** Case, trail and what the viewer may do, for the job page and the API. */
export async function caseView(bountyId, userId = null) {
	await ensureEscrowTables();
	const c = await getCaseByBounty(bountyId);
	if (!c) return null;
	const [bounty, job] = await Promise.all([getBounty(bountyId), getJobByBounty(bountyId)]);
	const { events, chain } = await trailFor(c.id);
	const sides = userId ? await sideForUser(userId, bounty, job) : { poster: false, worker: false };
	const evaluatorAgentId = c.evaluator_kind === 'poster' ? bounty.poster_agent_id : c.evaluator_agent_id;
	const isEvaluator = userId && c.evaluator_kind !== 'platform' ? await userOwnsAgent(userId, evaluatorAgentId) : false;
	const losing = c.attestation ? losingSide(c.attestation) : null;
	const windowOpen = c.state === 'attested' && Date.parse(c.release_at) > Date.now();
	return {
		id: c.id, bounty_id: c.bounty_id, job_id: c.job_id, state: c.state, outcome: c.outcome,
		evaluator: { kind: c.evaluator_kind, agent_id: evaluatorAgentId || null },
		dispute_window_seconds: c.dispute_window_seconds,
		deadline_at: c.deadline_at, submitted_at: c.submitted_at, attest_by: c.attest_by,
		attested_at: c.attested_at, release_at: c.release_at, disputed_at: c.disputed_at,
		arbiter_by: c.arbiter_by, resolved_at: c.resolved_at, paid_at: c.paid_at, settle_sig: c.settle_sig,
		attestation: c.attestation ? {
			verdict: c.attestation.verdict, signer: c.attestation.signer, signature: c.attestation.signature,
			reason_code: c.attestation.payload?.reason_code, reason_detail: c.attestation.payload?.reason_detail,
			evidence_url: c.attestation.payload?.evidence_url, issued_at: c.attestation.payload?.issued_at,
			payload: c.attestation.payload,
		} : null,
		dispute: c.dispute ? { by: c.dispute.by, reason: c.dispute.reason, evidence_url: c.dispute.evidence_url, at: c.dispute.at } : null,
		resolution: c.resolution ? {
			verdict: c.resolution.verdict, signer: c.resolution.signer, reason_code: c.resolution.payload?.reason_code,
			reason_detail: c.resolution.payload?.reason_detail,
		} : null,
		trail: events.map((e) => ({
			seq: e.seq, from: e.from_state, to: e.to_state, event: e.event, actor: e.actor,
			reason: e.reason, at: e.at, hash: e.hash,
		})),
		chain,
		viewer: {
			is_poster: sides.poster, is_worker: sides.worker, is_evaluator: !!isEvaluator,
			can_attest: c.state === 'submitted' && !!isEvaluator,
			can_dispute: windowOpen && ((losing === 'poster' && sides.poster) || (losing === 'worker' && sides.worker)),
			can_cancel: c.state === 'funded' && sides.poster,
		},
	};
}
