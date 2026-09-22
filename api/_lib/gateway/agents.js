// Which agent a paired chat talks to. A chat has a default agent; an account
// with exactly one agent never has to choose.

import { sql } from '../db.js';
import { setLinkDefaultAgent } from './store.js';

export async function listAccountAgents(userId) {
	return sql`
		SELECT id, name, meta, created_at FROM agent_identities
		WHERE user_id = ${userId} AND deleted_at IS NULL
		ORDER BY created_at ASC
		LIMIT 50`;
}

/**
 * The chat's agent: its default when that agent is still owned and live, the
 * account's only agent otherwise (remembered as the default), or null when the
 * owner has to pick one with /use.
 */
export async function resolveChatAgent(link) {
	if (link.default_agent_id) {
		const [row] = await sql`
			SELECT id, user_id, name, persona_prompt, meta FROM agent_identities
			WHERE id = ${link.default_agent_id} AND user_id = ${link.user_id} AND deleted_at IS NULL`;
		if (row) return row;
	}
	const agents = await listAccountAgents(link.user_id);
	if (agents.length !== 1) return null;
	await setLinkDefaultAgent(link.id, agents[0].id);
	const [row] = await sql`
		SELECT id, user_id, name, persona_prompt, meta FROM agent_identities WHERE id = ${agents[0].id}`;
	return row || null;
}

/** Match `/use <arg>`: a list number, a full or prefix id, or a name. */
export function pickAgent(agents, arg) {
	const a = String(arg || '').trim();
	if (!a) return null;
	if (/^\d+$/.test(a)) {
		const i = Number(a) - 1;
		if (i >= 0 && i < agents.length) return agents[i];
	}
	const lower = a.toLowerCase();
	return agents.find((x) => x.id === a)
		|| agents.find((x) => x.id.startsWith(lower) && lower.length >= 6)
		|| agents.find((x) => String(x.name || '').toLowerCase() === lower)
		|| agents.filter((x) => String(x.name || '').toLowerCase().includes(lower)).at(0)
		|| null;
}
