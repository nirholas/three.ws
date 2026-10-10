// spending_check and spending_setup: an agent reading its own spending limits
// and proposing changes to them.
//
// A proposal never changes anything. It becomes a pending request the owner
// answers on /commerce with a fresh step-up proof (password, recent
// re-authentication, or a linked-wallet signature over the exact change). The
// decide path takes only a browser session plus CSRF, so an agent's bearer
// token cannot reach it, and the agent has no tool that approves. On approve,
// the change is applied through setSpendLimits, the same owner-only writer the
// Limits & Safety panel uses, which records the custody limit_change event.

import { sql } from '../db.js';
import { logAudit } from '../audit.js';
import { insertNotification } from '../notify.js';
import { getDailySpendUsd, getSpendLimits, setSpendLimits } from '../agent-trade-guards.js';
import { canonicalJson, payloadHash } from '../approvals.js';
import { CommerceError } from './assets.js';
import { isUuid } from './invoices.js';
import { sameHash, verifyStepUp } from './step-up.js';

export const PROPOSAL_TTL_MS = 7 * 24 * 3600 * 1000;
export const MAX_PENDING_PER_AGENT = 3;
export const REASON_MAX = 500;
// Only these keys can be proposed. The destination allowlist has its own
// cooldown-gated flow and is never changed through a limits proposal.
export const PROPOSABLE_KEYS = Object.freeze(['daily_usd', 'per_tx_usd', 'per_counterparty_daily_usd', 'frozen', 'require_capabilities']);
const USD_KEYS = new Set(['daily_usd', 'per_tx_usd', 'per_counterparty_daily_usd']);
const MAX_USD = 10_000_000;

async function loadAgent(agentId) {
	const [row] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!row) throw new CommerceError('agent_not_found', 'agent not found', 404);
	return row;
}

function publicLimits(l) {
	return {
		daily_usd: l.daily_usd,
		per_tx_usd: l.per_tx_usd,
		per_counterparty_daily_usd: l.per_counterparty_daily_usd,
		frozen: l.frozen,
		require_capabilities: l.require_capabilities,
		updated_at: l.updated_at,
	};
}

/** Validate a proposed patch. Null on a USD key means "no cap". */
export function normalizePatch(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CommerceError('invalid_changes', 'changes must be an object');
	const out = {};
	for (const [k, v] of Object.entries(raw)) {
		if (!PROPOSABLE_KEYS.includes(k)) {
			throw new CommerceError('invalid_changes', `${k} cannot be proposed. Allowed: ${PROPOSABLE_KEYS.join(', ')}.${k === 'withdraw_allowlist' ? ' Destinations are added through the allowlist, which has its own cooldown.' : ''}`);
		}
		if (USD_KEYS.has(k)) {
			if (v === null) out[k] = null;
			else {
				const n = Number(v);
				if (!Number.isFinite(n) || n < 0 || n > MAX_USD) throw new CommerceError('invalid_changes', `${k} must be a USD amount from 0 to ${MAX_USD}, or null for no cap`);
				out[k] = Math.round(n * 100) / 100;
			}
		} else {
			if (typeof v !== 'boolean') throw new CommerceError('invalid_changes', `${k} must be true or false`);
			out[k] = v;
		}
	}
	if (!Object.keys(out).length) throw new CommerceError('invalid_changes', 'Propose at least one change.');
	return out;
}

function describeValue(k, v) {
	if (USD_KEYS.has(k)) return v == null ? 'no cap' : `$${Number(v).toFixed(2)}`;
	return v ? 'on' : 'off';
}

const LABELS = {
	daily_usd: 'Daily limit',
	per_tx_usd: 'Per-transaction limit',
	per_counterparty_daily_usd: 'Daily limit per recipient',
	frozen: 'Wallet freeze',
	require_capabilities: 'Require scoped capabilities',
};

export function diffRows(before, patch) {
	return Object.keys(patch).map((k) => ({
		key: k,
		label: LABELS[k],
		from: describeValue(k, before[k]),
		to: describeValue(k, patch[k]),
		loosens: loosens(k, before[k], patch[k]),
	}));
}

/** True when a change gives the agent more room to spend. */
function loosens(k, from, to) {
	if (USD_KEYS.has(k)) {
		if (to == null) return from != null;
		if (from == null) return false;
		return to > from;
	}
	if (k === 'frozen') return from === true && to === false;
	if (k === 'require_capabilities') return from === true && to === false;
	return false;
}

/** spending_check: the agent's limits, today's spend, headroom and open proposals. */
export async function spendingCheck({ agentId, network = 'mainnet' }) {
	const agent = await loadAgent(agentId);
	const limits = getSpendLimits(agent.meta || {});
	const spent = await getDailySpendUsd(agentId, network).catch(() => null);
	const pending = await sql`
		SELECT id, payload, summary, created_at, expires_at FROM agent_commerce_requests
		WHERE agent_id = ${agentId} AND kind = 'limits' AND status = 'pending' AND expires_at > now()
		ORDER BY created_at DESC
	`;
	const headroom = limits.daily_usd == null || spent == null ? null : Math.max(0, Math.round((limits.daily_usd - spent) * 100) / 100);
	return {
		agent: { id: agent.id, name: agent.name },
		network,
		limits: publicLimits(limits),
		spent_today_usd: spent == null ? null : Math.round(spent * 100) / 100,
		headroom_today_usd: headroom,
		can_spend_now: !limits.frozen && (headroom == null || headroom > 0),
		allowlist_note: 'Recipients the owner approved are managed on the destination allowlist. agent_send to any other address asks the owner first.',
		pending_proposals: pending.map((r) => ({
			id: r.id,
			summary: r.summary,
			changes: r.payload?.changes || {},
			created_at: new Date(r.created_at).toISOString(),
			expires_at: new Date(r.expires_at).toISOString(),
		})),
	};
}

/** spending_setup: propose a change. Returns the pending request; changes nothing. */
export async function proposeLimits({ agentId, changes, reason = null }) {
	const agent = await loadAgent(agentId);
	const patch = normalizePatch(changes);
	const before = publicLimits(getSpendLimits(agent.meta || {}));
	const effective = Object.keys(patch).filter((k) => before[k] !== patch[k]);
	if (!effective.length) throw new CommerceError('no_change', 'Those are already the current limits.');
	const trimmed = Object.fromEntries(effective.map((k) => [k, patch[k]]));
	const why = reason == null ? null : String(reason).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, REASON_MAX) || null;

	const [{ n }] = await sql`
		SELECT count(*)::int AS n FROM agent_commerce_requests
		WHERE agent_id = ${agentId} AND kind = 'limits' AND status = 'pending' AND expires_at > now()
	`;
	if (n >= MAX_PENDING_PER_AGENT) {
		throw new CommerceError('too_many_proposals', `This agent already has ${n} limit proposals waiting for the owner. Wait for an answer first.`, 429);
	}

	const payload = { agent_id: agentId, changes: trimmed, before: Object.fromEntries(effective.map((k) => [k, before[k]])) };
	const hash = payloadHash(payload);
	const rows = diffRows(before, trimmed);
	const summary = `${agent.name || 'Your agent'} proposes: ${rows.map((r) => `${r.label} ${r.from} to ${r.to}`).join('; ')}`.slice(0, 400);
	const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS).toISOString();
	const [row] = await sql`
		INSERT INTO agent_commerce_requests (kind, agent_id, user_id, payload, payload_hash, reason, summary, expires_at)
		VALUES ('limits', ${agentId}, ${agent.user_id}, ${canonicalJson(payload)}::jsonb, ${hash}, ${why}, ${summary}, ${expiresAt})
		RETURNING *
	`;
	await insertNotification(agent.user_id, 'commerce_limits_request', {
		request_id: row.id,
		agent_id: agentId,
		agent_name: agent.name || null,
		summary,
		loosens: rows.some((r) => r.loosens),
		link: `/commerce?tab=requests#request-${row.id}`,
	});
	return {
		status: 'pending_owner_approval',
		request_id: row.id,
		changes: rows,
		expires_at: expiresAt,
		message: 'Proposal sent. Nothing changed: the owner approves or denies it on three.ws with a fresh identity check. Read spending_check to see the answer.',
	};
}

function shapeRequest(r) {
	const p = r.payload || {};
	const status = r.status === 'pending' && new Date(r.expires_at).getTime() <= Date.now() ? 'expired' : r.status;
	return {
		id: r.id,
		kind: r.kind,
		status,
		agent: { id: r.agent_id, name: r.agent_name || null },
		summary: r.summary,
		reason: r.reason || null,
		changes: diffRows(p.before || {}, p.changes || {}),
		payload_hash: r.payload_hash,
		created_at: new Date(r.created_at).toISOString(),
		expires_at: new Date(r.expires_at).toISOString(),
		decided_at: r.decided_at ? new Date(r.decided_at).toISOString() : null,
		decided_via: r.decided_via || null,
		result: r.result || null,
	};
}

/** The owner's proposals, pending first. */
export async function listLimitRequests({ userId, status = null, limit = 50 }) {
	const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
	const rows = await sql`
		SELECT r.*, a.name AS agent_name FROM agent_commerce_requests r
		LEFT JOIN agent_identities a ON a.id = r.agent_id
		WHERE r.user_id = ${userId} AND r.kind = 'limits'
		  AND (${status}::text IS NULL OR r.status = ${status}::text)
		ORDER BY (r.status = 'pending' AND r.expires_at > now()) DESC, r.created_at DESC
		LIMIT ${lim}
	`;
	return rows.map(shapeRequest);
}

export async function getLimitRequest({ userId, id }) {
	if (!isUuid(id)) throw new CommerceError('not_found', 'request not found', 404);
	const [row] = await sql`
		SELECT r.*, a.name AS agent_name FROM agent_commerce_requests r
		LEFT JOIN agent_identities a ON a.id = r.agent_id
		WHERE r.id = ${id} AND r.user_id = ${userId}
	`;
	if (!row) throw new CommerceError('not_found', 'request not found', 404);
	return row;
}

/**
 * Approve or deny a proposal. Approve needs the payload hash the owner saw and
 * a step-up proof; deny needs neither (refusing is always safe).
 */
export async function decideLimitRequest({ req, userId, id, decision, shownHash, stepUp }) {
	if (decision !== 'approve' && decision !== 'deny') throw new CommerceError('invalid_decision', 'decision must be "approve" or "deny"');
	const row = await getLimitRequest({ userId, id });

	if (decision === 'deny') {
		const [updated] = await sql`
			UPDATE agent_commerce_requests SET status = 'denied', decided_at = now(), decided_via = 'web', updated_at = now()
			WHERE id = ${row.id} AND user_id = ${userId} AND status = 'pending'
			RETURNING *
		`;
		if (!updated) return shapeRequest({ ...(await getLimitRequest({ userId, id })), agent_name: row.agent_name });
		logAudit({ userId, action: 'agent_commerce.limits_denied', resourceId: row.id, meta: { agent_id: row.agent_id, summary: row.summary }, req });
		return shapeRequest({ ...updated, agent_name: row.agent_name });
	}

	if (!sameHash(shownHash, row.payload_hash)) {
		throw new CommerceError('payload_mismatch', 'The change on file differs from the one you reviewed. Reload and review it again.', 409);
	}
	if (payloadHash(row.payload) !== row.payload_hash) {
		throw new CommerceError('integrity_failed', 'The stored change no longer matches its fingerprint, so it was not applied.', 409);
	}
	if (row.status !== 'pending') throw new CommerceError('not_pending', `This request is already ${row.status}.`, 409);
	if (new Date(row.expires_at).getTime() <= Date.now()) {
		await sql`UPDATE agent_commerce_requests SET status = 'expired', updated_at = now() WHERE id = ${row.id} AND status = 'pending'`;
		throw new CommerceError('expired', 'This proposal expired. The agent can propose it again.', 410);
	}
	const via = await verifyStepUp({ req, userId, requestId: row.id, payloadHash: row.payload_hash, proof: stepUp });

	const [claimed] = await sql`
		UPDATE agent_commerce_requests SET status = 'approved', decided_at = now(), decided_via = ${via}, updated_at = now()
		WHERE id = ${row.id} AND user_id = ${userId} AND status = 'pending' AND expires_at > now()
		RETURNING *
	`;
	if (!claimed) throw new CommerceError('not_pending', 'This request was decided elsewhere a moment ago. Reload it.', 409);

	let next;
	try {
		next = await setSpendLimits(row.agent_id, userId, row.payload.changes, { req });
	} catch (err) {
		const [failed] = await sql`
			UPDATE agent_commerce_requests SET status = 'failed', result = ${JSON.stringify({ error: (err?.message || 'failed').slice(0, 240) })}::jsonb, updated_at = now()
			WHERE id = ${row.id} RETURNING *
		`;
		return shapeRequest({ ...failed, agent_name: row.agent_name });
	}
	const [done] = await sql`
		UPDATE agent_commerce_requests SET status = 'executed', result = ${JSON.stringify({ limits: publicLimits(next) })}::jsonb, updated_at = now()
		WHERE id = ${row.id} RETURNING *
	`;
	logAudit({ userId, action: 'agent_commerce.limits_approved', resourceId: row.id, meta: { agent_id: row.agent_id, via, changes: row.payload.changes }, req });
	return shapeRequest({ ...done, agent_name: row.agent_name });
}
