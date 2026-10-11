// Short-lived quotes behind every two-step money action in the commerce layer:
// agent_send_preview -> agent_send, agent_buy -> agent_buy_confirm.
//
// A quote pins the exact action (recipient, amount, asset, network) the agent
// was shown. Confirming consumes it in one conditional UPDATE, so a quote runs
// at most once, never after it expires, and only for the agent that asked.

import { sql } from '../db.js';
import { randomToken } from '../crypto.js';
import { CommerceError } from './assets.js';

export const QUOTE_TTL_MS = 10 * 60 * 1000;

export function newQuoteId(kind) {
	return `${kind === 'buy' ? 'buy' : 'snd'}_${randomToken(16)}`;
}

/** Store a quote and return its id and expiry. */
export async function createQuote({ kind, agentId, userId, payload, ttlMs = QUOTE_TTL_MS }) {
	const id = newQuoteId(kind);
	const expiresAt = new Date(Date.now() + ttlMs);
	await sql`
		INSERT INTO agent_commerce_quotes (id, kind, agent_id, user_id, payload, expires_at)
		VALUES (${id}, ${kind}, ${agentId}, ${userId}, ${JSON.stringify(payload)}::jsonb, ${expiresAt.toISOString()})
	`;
	return { id, expires_at: expiresAt.toISOString() };
}

/**
 * Claim a quote for execution. Throws a precise error for each way it can be
 * unusable so the agent knows whether to re-quote or stop.
 */
export async function consumeQuote({ id, kind, agentId }) {
	if (typeof id !== 'string' || !id) throw new CommerceError('preview_required', 'Pass the preview_id from the quote step.');
	const [claimed] = await sql`
		UPDATE agent_commerce_quotes SET consumed_at = now()
		WHERE id = ${id} AND kind = ${kind} AND agent_id = ${agentId}
		  AND consumed_at IS NULL AND expires_at > now()
		RETURNING *
	`;
	if (claimed) return claimed;
	const [row] = await sql`SELECT * FROM agent_commerce_quotes WHERE id = ${id} AND agent_id = ${agentId}`;
	if (!row || row.kind !== kind) throw new CommerceError('preview_not_found', 'No such preview for this agent. Request a new one.', 404);
	if (row.consumed_at) {
		throw new CommerceError('preview_used', 'That preview was already confirmed. Each preview runs once.', 409, { result: row.result || null });
	}
	throw new CommerceError('preview_expired', 'That preview expired. Request a new one; prices and limits may have moved.', 410);
}

/** Store what a consumed quote produced, so a repeat confirm can report it. */
export async function recordQuoteResult(id, result) {
	await sql`UPDATE agent_commerce_quotes SET result = ${JSON.stringify(result)}::jsonb WHERE id = ${id}`;
}
