// Persistence for labor-market escrow cases and their audit trail.
//
// One labor_escrow_cases row per funded bounty holds the state-machine position
// (api/_lib/labor-escrow-machine.js); labor_escrow_events is the append-only,
// hash-chained record of every transition. A state change is a compare-and-set
// on (id, from-state), so two writers racing for the same transition (a double
// attestation, a dispute against the cron's release) cannot both win: exactly
// one UPDATE matches and the loser gets a typed 409.
//
// No money moves here. api/_lib/labor-evaluation.js drives the cases and
// api/_lib/labor-settle.js moves the funds.

import { sql } from './db.js';
import {
	applyEvent, EscrowError, chainHash, verifyChain, normalizeDisputeWindow, normalizeEvaluator,
	DEFAULT_JOB_TTL_SECONDS,
} from './labor-escrow-machine.js';

let _ensured = null;
/** Create the escrow tables when the formal migration has not run yet. */
export function ensureEscrowTables() {
	if (_ensured) return _ensured;
	_ensured = (async () => {
		await sql`
			create table if not exists labor_escrow_cases (
				id uuid primary key default gen_random_uuid(),
				bounty_id uuid not null unique,
				job_id uuid,
				state text not null default 'funded',
				evaluator_kind text not null default 'platform',
				evaluator_agent_id uuid,
				dispute_window_seconds integer not null default 86400,
				deadline_at timestamptz not null,
				submitted_at timestamptz, attest_by timestamptz,
				attestation jsonb, attested_at timestamptz, release_at timestamptz,
				dispute jsonb, disputed_at timestamptz, arbiter_by timestamptz,
				resolution jsonb, resolved_at timestamptz,
				outcome text, settle_sig text, paid_at timestamptz,
				notified jsonb not null default '{}',
				version integer not null default 0,
				created_at timestamptz not null default now(), updated_at timestamptz not null default now()
			)`;
		await sql`create index if not exists labor_escrow_cases_open on labor_escrow_cases (state, updated_at) where state not in ('released','refunded')`;
		await sql`
			create table if not exists labor_escrow_events (
				id bigserial primary key,
				case_id uuid not null, seq integer not null,
				from_state text, to_state text not null, event text not null,
				actor text not null, reason text, data jsonb not null default '{}',
				at text not null, prev_hash text, hash text not null,
				created_at timestamptz not null default now(),
				constraint labor_escrow_events_seq unique (case_id, seq)
			)`;
		return true;
	})().catch((err) => {
		console.error('[labor-escrow-ledger] ensureEscrowTables failed:', err?.message);
		_ensured = null;
		throw err;
	});
	return _ensured;
}

export async function getCase(id) {
	await ensureEscrowTables();
	const [row] = await sql`SELECT * FROM labor_escrow_cases WHERE id = ${id} LIMIT 1`;
	return row || null;
}

export async function getCaseByBounty(bountyId) {
	await ensureEscrowTables();
	const [row] = await sql`SELECT * FROM labor_escrow_cases WHERE bounty_id = ${bountyId} LIMIT 1`;
	return row || null;
}

export async function listEvents(caseId) {
	await ensureEscrowTables();
	return sql`SELECT seq, from_state, to_state, event, actor, reason, data, at, prev_hash, hash
		FROM labor_escrow_events WHERE case_id = ${caseId} ORDER BY seq ASC`;
}

async function appendEvent(caseRow, { from, to, event, actor, reason = null, data = {} }) {
	const seq = Number(caseRow.version);
	const [prev] = await sql`SELECT hash FROM labor_escrow_events WHERE case_id = ${caseRow.id} AND seq < ${seq} ORDER BY seq DESC LIMIT 1`;
	const at = new Date().toISOString();
	const prevHash = prev?.hash || null;
	const hash = chainHash(prevHash, { seq, from, to, event, actor, reason, data, at });
	await sql`
		INSERT INTO labor_escrow_events (case_id, seq, from_state, to_state, event, actor, reason, data, at, prev_hash, hash)
		VALUES (${caseRow.id}, ${seq}, ${from}, ${to}, ${event}, ${actor}, ${reason}, ${JSON.stringify(data)}::jsonb, ${at}, ${prevHash}, ${hash})
		ON CONFLICT (case_id, seq) DO NOTHING`;
}

/**
 * Open the case for a funded bounty. Idempotent: a second call returns the
 * existing case. The deadline defaults to 14 days so no bounty can wait forever.
 */
export async function openCase({ bounty, evaluator, disputeWindowSeconds, actor = 'poster' }) {
	await ensureEscrowTables();
	const existing = await getCaseByBounty(bounty.id);
	if (existing) return existing;
	const ev = normalizeEvaluator(evaluator, { posterAgentId: bounty.poster_agent_id });
	const windowS = normalizeDisputeWindow(disputeWindowSeconds);
	const deadline = bounty.deadline
		? new Date(bounty.deadline).toISOString()
		: new Date(Date.now() + DEFAULT_JOB_TTL_SECONDS * 1000).toISOString();
	const [row] = await sql`
		INSERT INTO labor_escrow_cases (bounty_id, state, evaluator_kind, evaluator_agent_id, dispute_window_seconds, deadline_at, version)
		VALUES (${bounty.id}, 'funded', ${ev.kind}, ${ev.agentId}, ${windowS}, ${deadline}, 1)
		ON CONFLICT (bounty_id) DO NOTHING
		RETURNING *`;
	if (!row) return getCaseByBounty(bounty.id);
	await appendEvent(row, {
		from: null, to: 'funded', event: 'fund', actor,
		data: { evaluator: ev, dispute_window_seconds: windowS, deadline_at: deadline, fund_sig: bounty.escrow_fund_sig || null },
	});
	return row;
}

/**
 * Compare-and-set the case from its current state along `event`. `patch` carries
 * the columns the transition sets. Throws EscrowError 409 when the case moved
 * first (or the transition is illegal), so the caller can report "too late".
 */
export async function transition(caseRow, event, { actor, reason = null, data = {}, patch = {} } = {}) {
	const to = applyEvent(caseRow.state, event);
	const p = (k) => (patch[k] === undefined ? null : patch[k]);
	const json = (k) => (patch[k] === undefined ? null : JSON.stringify(patch[k]));
	const [row] = await sql`
		UPDATE labor_escrow_cases SET
			state = ${to},
			job_id = COALESCE(${p('jobId')}, job_id),
			submitted_at = COALESCE(${p('submittedAt')}::timestamptz, submitted_at),
			attest_by = COALESCE(${p('attestBy')}::timestamptz, attest_by),
			attestation = COALESCE(${json('attestation')}::jsonb, attestation),
			attested_at = COALESCE(${p('attestedAt')}::timestamptz, attested_at),
			release_at = COALESCE(${p('releaseAt')}::timestamptz, release_at),
			dispute = COALESCE(${json('dispute')}::jsonb, dispute),
			disputed_at = COALESCE(${p('disputedAt')}::timestamptz, disputed_at),
			arbiter_by = COALESCE(${p('arbiterBy')}::timestamptz, arbiter_by),
			resolution = COALESCE(${json('resolution')}::jsonb, resolution),
			resolved_at = COALESCE(${p('resolvedAt')}::timestamptz, resolved_at),
			outcome = COALESCE(${p('outcome')}, outcome),
			settle_sig = COALESCE(${p('settleSig')}, settle_sig),
			version = version + 1,
			updated_at = now()
		WHERE id = ${caseRow.id} AND state = ${caseRow.state}
		RETURNING *`;
	if (!row) {
		const [cur] = await sql`SELECT state FROM labor_escrow_cases WHERE id = ${caseRow.id}`;
		throw new EscrowError('state_changed', `escrow is already ${cur?.state || 'resolved'}; this action came too late`);
	}
	await appendEvent(row, { from: caseRow.state, to, event, actor, reason, data });
	return row;
}

/**
 * Record that a terminal case's funds moved. Exactly one caller wins (paid_at is
 * set once), so the trail carries one payout entry however many sweeps raced.
 */
export async function markPaid(caseRow, { sig = null, data = {}, actor = 'platform' } = {}) {
	const [row] = await sql`
		UPDATE labor_escrow_cases SET paid_at = now(), settle_sig = COALESCE(${sig}, settle_sig),
		       version = version + 1, updated_at = now()
		WHERE id = ${caseRow.id} AND paid_at IS NULL AND state IN ('released','refunded')
		RETURNING *`;
	if (!row) return null;
	await appendEvent(row, { from: caseRow.state, to: caseRow.state, event: 'payout', actor, data: { sig, ...data } });
	return row;
}

/** Set a once-only notification flag; true only for the caller that set it. */
export async function markNotified(caseId, key) {
	const [row] = await sql`
		UPDATE labor_escrow_cases
		SET notified = notified || jsonb_build_object(${key}::text, ${new Date().toISOString()}::text)
		WHERE id = ${caseId} AND NOT (notified ? ${key}::text)
		RETURNING id`;
	return !!row;
}

/** Trail for display: events plus whether the hash chain is intact. */
export async function trailFor(caseId) {
	const events = await listEvents(caseId);
	return { events, chain: verifyChain(events) };
}
