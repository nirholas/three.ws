// Preview-then-execute records for the venue stacks (perps, lending).
//
// Every fund-moving venue action runs in two calls. The preview prices the
// action against live venue state, runs every guard, and stores exactly what it
// showed the owner; the execution must present that preview's id. A preview is
// bound to one user, one agent and one action, expires after its TTL, and is
// consumed atomically by the execution that uses it, so a stale or replayed
// preview never moves money and the transaction that lands is the one the owner
// confirmed.
//
// Storage is the platform's shared preview ledger, `agent_market_previews`
// (id, user_id, action, params_hash, payload, consumed_at, created_at), the same
// table the agent marketplace's financial MCP tools cite. Venue actions are
// namespaced ("perps.order", "lending.deposit") so they can never satisfy a
// marketplace commit or each other. The agent id, parameters, quote and expiry
// live in `payload`.

import { createHash, randomUUID } from 'node:crypto';
import { sql } from './db.js';

export const DEFAULT_PREVIEW_TTL_MS = 10 * 60_000;

export class ActionPreviewError extends Error {
	constructor(code, message, status = 409) {
		super(message);
		this.name = 'ActionPreviewError';
		this.code = code;
		this.status = status;
		this.detail = null;
	}
}

/** Stable hash of the action and its canonical parameters. */
export function hashParams(action, params = {}) {
	const canon = JSON.stringify(
		Object.keys(params || {})
			.sort()
			.reduce((o, k) => {
				o[k] = params[k];
				return o;
			}, {}),
	);
	return createHash('sha256').update(`${action}:${canon}`).digest('hex');
}

/**
 * Decide whether a stored preview may authorize an execution. Pure, so the
 * expiry and binding rules are unit-tested without a database.
 *
 * @param {{ user_id: string, action: string, payload: object, consumed_at: string|Date|null } | null} row
 * @param {{ userId: string, agentId: string, action: string, hint: string, now?: number }} want
 * @returns {null | ActionPreviewError}
 */
export function actionPreviewProblem(row, { userId, agentId, action, hint, now = Date.now() }) {
	if (!row) return new ActionPreviewError('preview_not_found', `No preview with that id. ${hint}`, 404);
	if (row.user_id !== userId || row.payload?.agent_id !== agentId) {
		return new ActionPreviewError('preview_mismatch', `That preview belongs to a different agent. ${hint}`, 409);
	}
	if (row.action !== action) {
		return new ActionPreviewError('preview_mismatch', `That preview is for ${row.action}, not ${action}. ${hint}`, 409);
	}
	if (row.consumed_at) return new ActionPreviewError('preview_consumed', `That preview was already used. ${hint}`, 409);
	const expires = new Date(row.payload?.expires_at || 0).getTime();
	if (!(expires > now)) {
		const seconds = Math.round((Number(row.payload?.ttl_ms) || DEFAULT_PREVIEW_TTL_MS) / 1000);
		const age = seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`;
		return new ActionPreviewError('preview_expired', `That preview is more than ${age} old and the market has moved. ${hint}`, 409);
	}
	return null;
}

/**
 * Store a preview and return its id and expiry.
 * @param {{ userId: string, agentId: string, action: string, prefix: string, params: object, quote: object, ttlMs?: number }} o
 */
export async function createActionPreview({ userId, agentId, action, prefix, params, quote, ttlMs = DEFAULT_PREVIEW_TTL_MS }) {
	const id = `${prefix}_${randomUUID().replace(/-/g, '')}`;
	const expiresAt = new Date(Date.now() + ttlMs).toISOString();
	const payload = { agent_id: agentId, params, quote, expires_at: expiresAt, ttl_ms: ttlMs };
	await sql`
		INSERT INTO agent_market_previews (id, user_id, action, params_hash, payload)
		VALUES (${id}, ${userId}, ${action}, ${hashParams(action, params)}, ${JSON.stringify(payload)}::jsonb)
	`;
	return { preview_id: id, expires_at: expiresAt };
}

const ID_RE = /^[a-z]{2,8}_[0-9a-f]{32}$/;

/**
 * Load a preview and verify it may authorize `action` for `agentId`.
 * Returns `{ id, params, quote, expires_at }`. Throws ActionPreviewError.
 */
export async function loadActionPreview(previewId, { userId, agentId, action, hint }) {
	if (!previewId || !ID_RE.test(String(previewId))) {
		throw new ActionPreviewError('preview_required', `A preview_id is required. ${hint}`, 400);
	}
	const [row] = await sql`
		SELECT id, user_id, action, payload, consumed_at, created_at
		FROM agent_market_previews WHERE id = ${previewId}
	`;
	const problem = actionPreviewProblem(row || null, { userId, agentId, action, hint });
	if (problem) throw problem;
	return { id: row.id, params: row.payload.params || {}, quote: row.payload.quote || {}, expires_at: row.payload.expires_at };
}

/**
 * Mark a preview used. Atomic: of two concurrent executions presenting the same
 * preview, exactly one wins; the other gets preview_consumed.
 */
export async function consumeActionPreview(previewId, { hint }) {
	const rows = await sql`
		UPDATE agent_market_previews SET consumed_at = now()
		WHERE id = ${previewId} AND consumed_at IS NULL
		  AND (payload->>'expires_at')::timestamptz > now()
		RETURNING id
	`;
	if (!rows.length) throw new ActionPreviewError('preview_consumed', `That preview was already used or just expired. ${hint}`, 409);
}

/** Return a consumed preview to service when the execution moved nothing. */
export async function releaseActionPreview(previewId) {
	await sql`
		UPDATE agent_market_previews SET consumed_at = NULL
		WHERE id = ${previewId} AND (payload->>'expires_at')::timestamptz > now()
	`;
}
