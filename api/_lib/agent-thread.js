// One conversation per (agent, owner), shared by every surface that talks to
// the agent: the web copilot, the v1 messages API and every chat gateway
// (Telegram, Discord, Slack, WhatsApp, Signal, SMS, email). Rows
// live in agent_messages; `channel` says which surface a message came from so
// each surface can label the others ("via Telegram") while the model sees one
// continuous history.

import { sql } from './db.js';

export const THREAD_CHANNELS = ['web', 'api', 'telegram', 'discord', 'slack', 'whatsapp', 'signal', 'sms', 'email'];
const MAX_CONTENT = 8000;

/**
 * Append one message to the agent's thread.
 * @returns {Promise<{ id:number, created_at:string }>}
 */
export async function appendThreadMessage({
	agentId,
	userId,
	role,
	content,
	channel,
	toolCalls = [],
	signatures = [],
	model = null,
	provider = null,
	// Billing, written by the v1 messages API (api/_lib/agents-v1/messages.js):
	// free_tier rows are what the daily free allowance counts.
	freeTier = false,
	inputTokens = null,
	outputTokens = null,
	costMicroUsd = null,
	chargedUsd = 0,
}) {
	const text = String(content || '').slice(0, MAX_CONTENT);
	const [row] = await sql`
		INSERT INTO agent_messages
			(agent_id, user_id, role, content, channel, tool_calls, signatures, model, provider,
			 free_tier, input_tokens, output_tokens, cost_micro_usd, charged_usd)
		VALUES (${agentId}, ${userId}, ${role}, ${text}, ${channel}, ${JSON.stringify(toolCalls || [])}::jsonb,
		        ${signatures || []}, ${model}, ${provider},
		        ${freeTier}, ${inputTokens}, ${outputTokens}, ${costMicroUsd}, ${chargedUsd})
		RETURNING id, created_at
	`;
	return row;
}

/**
 * Page the thread newest first. `before` is a message id cursor.
 * @returns {Promise<{ messages:object[], hasMore:boolean }>}
 */
export async function listThread({ agentId, userId, limit = 30, before = null }) {
	const n = Math.max(1, Math.min(100, Number(limit) || 30));
	const cursor = before != null && /^\d+$/.test(String(before)) ? String(before) : null;
	const rows = cursor
		? await sql`
			SELECT id, role, content, channel, tool_calls, signatures, model, created_at
			FROM agent_messages
			WHERE agent_id = ${agentId} AND user_id = ${userId} AND id < ${cursor}
			ORDER BY id DESC LIMIT ${n + 1}`
		: await sql`
			SELECT id, role, content, channel, tool_calls, signatures, model, created_at
			FROM agent_messages
			WHERE agent_id = ${agentId} AND user_id = ${userId}
			ORDER BY id DESC LIMIT ${n + 1}`;
	const hasMore = rows.length > n;
	return {
		hasMore,
		messages: rows.slice(0, n).map((r) => ({
			id: Number(r.id),
			role: r.role,
			content: r.content,
			channel: r.channel,
			model: r.model || null,
			toolCalls: r.tool_calls || [],
			signatures: r.signatures || [],
			createdAt: r.created_at,
		})),
	};
}

/**
 * The trailing turns a model should see, oldest first, optionally only those
 * after `since` (a chat's /new reset point).
 * @returns {Promise<Array<{ role:'user'|'assistant', content:string }>>}
 */
export async function threadHistoryForModel({ agentId, userId, since = null, limit = 24 }) {
	const n = Math.max(1, Math.min(60, limit));
	const rows = since
		? await sql`
			SELECT role, content FROM agent_messages
			WHERE agent_id = ${agentId} AND user_id = ${userId} AND created_at > ${since}
			ORDER BY id DESC LIMIT ${n}`
		: await sql`
			SELECT role, content FROM agent_messages
			WHERE agent_id = ${agentId} AND user_id = ${userId}
			ORDER BY id DESC LIMIT ${n}`;
	return rows.reverse().map((r) => ({ role: r.role, content: String(r.content || '').slice(0, 4000) }));
}
