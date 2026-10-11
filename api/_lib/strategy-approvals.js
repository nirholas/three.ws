// Strategy ask mode and the candidate decision log.
//
// A Strategy Object in `mode: 'ask'` never buys on its own. When a candidate
// clears the entry filter, the research gates, and a dry run of every spend
// guard, the runtime files an approval request here instead, in the platform's
// shared `approval_requests` inbox (one row per gated action, shared with every
// other surface that asks the owner first). The request carries the exact buy
// that will run (`payload`) and its sha256 (`payload_hash`): approving must echo
// the hash the owner was shown, and the executor recomputes it from the stored
// payload, so neither a stale screen nor an edited row can buy something else.
// Expiry and deny fail closed: nothing is bought.
//
// The decision log (`strategy_candidate_decisions`) records, per equip and coin,
// the latest verdict and the check that decided it, with the cited gate report.
//
// Pure DB helpers only. The executor that runs an approved buy lives with the
// rest of the trading path in api/_lib/agent-strategy-runtime.js.

import { createHash } from 'node:crypto';
import { sql } from './db.js';
import { riskNotesFromReport } from './strategy-research.js';

// Meme-coin windows are short: an unanswered request expires rather than buying
// a coin at a price nobody looked at.
export const STRATEGY_APPROVAL_TTL_MINUTES = 15;
// A blocked or skipped candidate is re-checked after this pause, not every sweep.
export const DECISION_RECHECK_MINUTES = 5;
export const STRATEGY_APPROVAL_SOURCE = 'strategy';
export const STRATEGY_APPROVAL_ACTION = 'strategy_buy';

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace. For the
 * flat string/number/boolean/null payloads hashed here this is byte-identical to
 * RFC 8785 (JCS) output, so any JCS implementation reproduces the same hash.
 */
export function canonicalJson(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function payloadHash(payload) {
	return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/** The exact buy an approval will run. Everything the executor needs, nothing it doesn't. */
export function buildStrategyBuyPayload({ equip, agentId, config, network, mint, idempotencyKey }) {
	return {
		kind: STRATEGY_APPROVAL_ACTION,
		agent_id: agentId,
		equip_id: equip.id,
		strategy_id: equip.strategy_id,
		network,
		mint,
		side: 'buy',
		amount_sol: config.sizing.amount_sol,
		slippage_bps: config.sizing.max_slippage_bps,
		max_price_impact_pct: config.sizing.max_price_impact_bps == null ? null : config.sizing.max_price_impact_bps / 100,
		idempotency_key: idempotencyKey,
	};
}

const shortMint = (m) => (m && m.length > 12 ? `${m.slice(0, 4)}...${m.slice(-4)}` : m || '');

/**
 * File an approval request for one strategy buy. Deduped per (equip, coin): a
 * coin is asked about once, and a denied or expired request is never re-filed.
 * Returns { ok, id, created } or { ok:false, code } when the inbox is unreachable
 * (the caller then buys nothing).
 */
export async function createStrategyApproval({ equip, agent, config, launch, network, quote, usd, impactCap, idempotencyKey, report }) {
	const payload = buildStrategyBuyPayload({ equip, agentId: agent.id, config, network, mint: launch.mint, idempotencyKey });
	const hash = payloadHash(payload);
	const approvalKey = `strategy-approval:${equip.id}:${launch.mint}`;
	const expiresAt = new Date(Date.now() + STRATEGY_APPROVAL_TTL_MINUTES * 60_000).toISOString();
	// Token names and symbols are untrusted data, so the summary names the coin by
	// its address only. The strategy name is the owner's own text.
	const summary = `Buy ${config.sizing.amount_sol} SOL of ${shortMint(launch.mint)} for strategy "${String(equip.strategy_name || equip.slug || 'strategy').slice(0, 60)}"`;
	const notes = riskNotesFromReport(report, report?.evaluation);
	if (quote?.priceImpactPct != null) notes.unshift(`Quoted price impact ${Number(quote.priceImpactPct).toFixed(2)}% (limit ${impactCap ?? 'none'}%).`);
	try {
		const inserted = await sql`
			INSERT INTO approval_requests
				(user_id, agent_id, requester_role, source, source_ref, action_type, venue,
				 payload, payload_hash, summary, amount, amount_usd, asset, chain, network,
				 recipient, recipient_label, risk_notes, gate_reason, idempotency_key, expires_at)
			VALUES (
				${agent.ownerId}, ${agent.id}, 'strategy', ${STRATEGY_APPROVAL_SOURCE}, ${String(equip.id)},
				${STRATEGY_APPROVAL_ACTION}, 'pumpfun',
				${JSON.stringify(payload)}::jsonb, ${hash}, ${summary},
				${config.sizing.amount_sol}, ${usd ?? null}, 'SOL', 'solana', ${network},
				${launch.mint}, 'pump.fun bonding curve buy',
				${JSON.stringify(notes)}::jsonb,
				'This strategy is in ask mode: every buy waits for your approval.',
				${approvalKey}, ${expiresAt}
			)
			ON CONFLICT (idempotency_key) DO NOTHING
			RETURNING id
		`;
		if (inserted.length) return { ok: true, id: inserted[0].id, created: true };
		const [existing] = await sql`SELECT id FROM approval_requests WHERE idempotency_key = ${approvalKey} LIMIT 1`;
		return existing ? { ok: true, id: existing.id, created: false } : { ok: false, code: 'approval_conflict' };
	} catch (err) {
		console.warn('[strategy-approvals] could not file approval:', err?.message);
		return { ok: false, code: 'approval_unavailable' };
	}
}

/** Pending, unexpired approvals holding a slot for one equip. */
export async function pendingApprovalCount(equipId) {
	try {
		const [r] = await sql`
			SELECT count(*)::int AS n FROM approval_requests
			WHERE source = ${STRATEGY_APPROVAL_SOURCE} AND source_ref = ${String(equipId)}
			  AND status = 'pending' AND expires_at > now()
		`;
		return Number(r?.n || 0);
	} catch {
		return 0;
	}
}

/**
 * Mints this equip decided recently enough to skip this sweep: an approval or a
 * buy is final for that coin; a block, skip, or failure is re-checked after
 * DECISION_RECHECK_MINUTES.
 */
export async function recentDecisions(equipId, mints) {
	if (!mints.length) return new Set();
	try {
		const rows = await sql`
			SELECT mint FROM strategy_candidate_decisions
			WHERE equip_id = ${equipId} AND mint = ANY(${mints})
			  AND (decision IN ('approval', 'executed')
			       OR updated_at > now() - (${DECISION_RECHECK_MINUTES} || ' minutes')::interval)
		`;
		return new Set(rows.map((r) => r.mint));
	} catch {
		return new Set();
	}
}

/** Upsert the latest verdict for (equip, coin). Never throws: the log must not stop a sweep. */
export async function recordCandidateDecision({
	equip, agentId, network, mint, decision, check = null, reason = null,
	blockedBy = [], report = null, approvalId = null, signature = null,
}) {
	try {
		await sql`
			INSERT INTO strategy_candidate_decisions
				(equip_id, strategy_id, agent_id, owner_id, network, mint, decision, check_name, reason,
				 blocked_by, report, approval_id, signature)
			VALUES (
				${equip.id}, ${equip.strategy_id || null}, ${agentId}, ${equip.owner_id}, ${network}, ${mint},
				${decision}, ${check}, ${reason ? String(reason).slice(0, 600) : null},
				${JSON.stringify(blockedBy || [])}::jsonb, ${report ? JSON.stringify(report) : null}::jsonb,
				${approvalId}, ${signature}
			)
			ON CONFLICT (equip_id, mint) DO UPDATE SET
				decision = excluded.decision, check_name = excluded.check_name, reason = excluded.reason,
				blocked_by = excluded.blocked_by, report = coalesce(excluded.report, strategy_candidate_decisions.report),
				approval_id = coalesce(excluded.approval_id, strategy_candidate_decisions.approval_id),
				signature = coalesce(excluded.signature, strategy_candidate_decisions.signature),
				seen_count = strategy_candidate_decisions.seen_count + 1, updated_at = now()
		`;
	} catch (err) {
		console.warn('[strategy-approvals] decision log write failed:', err?.message);
	}
}

/** The decision log for one agent, newest first. */
export async function listCandidateDecisions({ agentId, ownerId, decision = null, limit = 50 }) {
	const lim = Math.min(200, Math.max(1, Number(limit) || 50));
	const rows = await sql`
		SELECT d.id, d.equip_id, d.strategy_id, d.network, d.mint, d.decision, d.check_name, d.reason,
		       d.blocked_by, d.report, d.approval_id, d.signature, d.seen_count, d.created_at, d.updated_at,
		       s.name AS strategy_name, s.slug AS strategy_slug
		FROM strategy_candidate_decisions d
		LEFT JOIN agent_strategies s ON s.id = d.strategy_id
		WHERE d.agent_id = ${agentId} AND d.owner_id = ${ownerId}
		  AND (${decision}::text IS NULL OR d.decision = ${decision})
		ORDER BY d.updated_at DESC
		LIMIT ${lim}
	`;
	return rows;
}

/**
 * Strategy approval requests for one agent. A pending row past its expiry is
 * marked expired first, so the list never shows an approvable request that the
 * executor would refuse.
 */
export async function listStrategyApprovals({ agentId, ownerId, status = null, limit = 50 }) {
	const lim = Math.min(200, Math.max(1, Number(limit) || 50));
	await expireStaleStrategyApprovals(ownerId);
	return sql`
		SELECT id, agent_id, source_ref AS equip_id, action_type, venue, payload, payload_hash, summary,
		       amount, amount_usd, asset, chain, network, recipient, recipient_label, risk_notes,
		       gate_reason, status, expires_at, decided_at, decided_via, executed_at, signature, result, created_at
		FROM approval_requests
		WHERE user_id = ${ownerId} AND agent_id = ${agentId} AND source = ${STRATEGY_APPROVAL_SOURCE}
		  AND (${status}::text IS NULL OR status = ${status})
		ORDER BY created_at DESC
		LIMIT ${lim}
	`;
}

export async function expireStaleStrategyApprovals(ownerId) {
	await sql`
		UPDATE approval_requests SET status = 'expired', updated_at = now()
		WHERE user_id = ${ownerId} AND source = ${STRATEGY_APPROVAL_SOURCE}
		  AND status = 'pending' AND expires_at <= now()
	`.catch(() => {});
}
