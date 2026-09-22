// Preview-then-execute for prediction orders.
//
// Every fund-moving prediction action (open, close, redeem) runs in two calls.
// The preview prices it against the live venue and stores what it showed; the
// execution must present that preview's id. A preview is bound to one agent
// and one action, expires after PREVIEW_TTL_MS, and is consumed atomically by
// the execution that uses it, so a stale or replayed preview never moves money
// and the order that lands is the one the owner saw.

import { sql } from '../db.js';

export const PREVIEW_TTL_MS = 10 * 60_000;

export class PreviewError extends Error {
	constructor(code, message, status = 409) {
		super(message);
		this.name = 'PreviewError';
		this.code = code;
		this.status = status;
	}
}

const PREVIEW_TOOL = { open: 'predictions_open_preview', close: 'predictions_close_preview', redeem: 'predictions_redeem_preview' };
const PREVIEW_ROUTE = { open: 'open/preview', close: 'close/preview', redeem: 'redeem/preview' };

/** Where to get a fresh preview for `kind`, for error messages. */
export function previewHint(kind) {
	return `Call ${PREVIEW_TOOL[kind]} (POST .../predictions/${PREVIEW_ROUTE[kind]}) first and pass its preview_id.`;
}

/**
 * Decide whether a stored preview may authorize an execution. Pure.
 * @param {{ agent_id: string, kind: string, expires_at: string|Date, consumed_at: string|Date|null } | null} row
 * @param {{ agentId: string, kind: string, now?: number }} want
 * @returns {null | PreviewError}
 */
export function previewProblem(row, { agentId, kind, now = Date.now() }) {
	if (!row) return new PreviewError('preview_not_found', `No preview with that id. ${previewHint(kind)}`, 404);
	if (row.agent_id !== agentId) return new PreviewError('preview_mismatch', `That preview belongs to a different agent. ${previewHint(kind)}`, 409);
	if (row.kind !== kind) return new PreviewError('preview_mismatch', `That preview is for a ${row.kind}, not a ${kind}. ${previewHint(kind)}`, 409);
	if (row.consumed_at) return new PreviewError('preview_consumed', `That preview was already used. ${previewHint(kind)}`, 409);
	if (new Date(row.expires_at).getTime() <= now) {
		return new PreviewError('preview_expired', `That preview is more than ${PREVIEW_TTL_MS / 60_000} minutes old and prices have moved. ${previewHint(kind)}`, 409);
	}
	return null;
}

export async function createPreview({ agentId, userId, venue, kind, params, quote }) {
	const expires = new Date(Date.now() + PREVIEW_TTL_MS);
	const [row] = await sql`
		INSERT INTO prediction_previews (agent_id, user_id, venue, kind, params, quote, expires_at)
		VALUES (${agentId}, ${userId ?? null}, ${venue}, ${kind}, ${JSON.stringify(params)}::jsonb, ${JSON.stringify(quote)}::jsonb, ${expires.toISOString()})
		RETURNING id, expires_at
	`;
	return { preview_id: row.id, expires_at: new Date(row.expires_at).toISOString() };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Load a preview and verify it may authorize `kind` for `agentId`. Throws PreviewError. */
export async function loadPreview(previewId, { agentId, kind }) {
	if (!previewId || !UUID_RE.test(String(previewId))) {
		throw new PreviewError('preview_required', `A preview_id is required. ${previewHint(kind)}`, 400);
	}
	const [row] = await sql`
		SELECT id, agent_id, user_id, venue, kind, params, quote, created_at, expires_at, consumed_at
		FROM prediction_previews WHERE id = ${previewId}
	`;
	const problem = previewProblem(row || null, { agentId, kind });
	if (problem) throw problem;
	return row;
}

/**
 * Mark a preview used. Atomic: of two concurrent executions presenting the same
 * preview, exactly one wins; the other gets preview_consumed.
 */
export async function consumePreview(previewId, kind) {
	const rows = await sql`
		UPDATE prediction_previews SET consumed_at = now()
		WHERE id = ${previewId} AND consumed_at IS NULL AND expires_at > now()
		RETURNING id
	`;
	if (!rows.length) throw new PreviewError('preview_consumed', `That preview was already used or just expired. ${previewHint(kind)}`, 409);
}

/** Return a consumed preview to service when the execution moved nothing. */
export async function releasePreview(previewId) {
	await sql`UPDATE prediction_previews SET consumed_at = NULL WHERE id = ${previewId} AND expires_at > now()`;
}

export async function prunePreviews() {
	await sql`DELETE FROM prediction_previews WHERE created_at < now() - interval '2 days'`;
}
