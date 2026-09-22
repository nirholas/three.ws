// v1 agents: create, read, update, delete, and the running/stopped lifecycle.
//
// Agents are the same agent_identities rows every other surface reads; creation
// goes through createAgentIdentity (api/_lib/agent-create.js) so a v1 agent gets
// the identical custodial wallets, identity-integrity check and discovery pings
// as one made in the Studio. v1-only settings (model, temperature, strategy)
// live under meta.runtime.

import { sql } from '../db.js';
import { createAgentIdentity } from '../agent-create.js';
import { MODEL_CATALOG } from '../chat-models.js';
import { env } from '../env.js';
import { apiError, strParam, numParam } from './http.js';
import { getStrategy } from './strategies.js';
import { createAutomation } from './automations.js';

const MAX_SKILLS = 30;

/** Public-safe v1 projection of an agent row, for its owner. */
export function serializeAgent(row) {
	const meta = row.meta || {};
	const runtime = meta.runtime || {};
	return {
		id: row.id,
		name: row.name,
		persona: row.description || null,
		systemPrompt: row.persona_prompt || null,
		model: runtime.model || null,
		temperature: runtime.temperature ?? null,
		strategy: runtime.strategy || null,
		skills: row.skills || [],
		status: row.status || 'running',
		statusChangedAt: row.status_changed_at || null,
		wallet: {
			solana: meta.solana_address || null,
			evm: row.wallet_address || null,
		},
		avatarId: row.avatar_id || null,
		isPublic: row.is_public !== false,
		url: `${env.APP_ORIGIN}/agents/${row.id}`,
		createdAt: row.created_at,
		updatedAt: row.updated_at || null,
	};
}

/**
 * Load an agent the caller owns, or throw 404 / 403.
 * @returns {Promise<object>} the agent_identities row
 */
export async function loadOwnedAgent(id, userId) {
	const [row] = await sql`SELECT * FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!row) throw apiError(404, 'not_found', 'No agent with that id.');
	if (row.user_id !== userId) throw apiError(403, 'forbidden', 'This agent belongs to another account.');
	return row;
}

function validateModel(model) {
	if (model == null) return null;
	if (typeof model !== 'string' || !MODEL_CATALOG[model]) {
		throw apiError(400, 'unknown_model', 'model must be an id from GET /api/v1/models.', { parameter: 'model' });
	}
	if (!MODEL_CATALOG[model].tools) {
		throw apiError(400, 'model_lacks_tools', 'That model has no tool-calling endpoint, so it cannot run an agent.', { parameter: 'model' });
	}
	return model;
}

function validateSkills(skills) {
	if (skills == null) return null;
	if (!Array.isArray(skills) || skills.length > MAX_SKILLS || skills.some((s) => typeof s !== 'string' || !/^[a-z0-9][a-z0-9-_]{0,39}$/i.test(s))) {
		throw apiError(400, 'invalid_parameter', `skills must be an array of up to ${MAX_SKILLS} skill ids.`, { parameter: 'skills' });
	}
	return [...new Set(skills)];
}

function readSettings(body, { partial }) {
	const out = {};
	if (!partial || 'name' in body) out.name = strParam(body.name, { name: 'name', max: 80, required: !partial });
	if ('persona' in body) out.persona = strParam(body.persona, { name: 'persona', max: 500 });
	if ('systemPrompt' in body) out.systemPrompt = strParam(body.systemPrompt, { name: 'systemPrompt', max: 8000 });
	if ('model' in body) out.model = validateModel(body.model);
	if ('temperature' in body) out.temperature = numParam(body.temperature, { name: 'temperature', min: 0, max: 2 });
	if ('skills' in body) out.skills = validateSkills(body.skills);
	if ('strategy' in body && body.strategy != null) {
		const s = getStrategy(body.strategy);
		if (!s) throw apiError(400, 'unknown_strategy', 'strategy must be an id from GET /api/v1/strategies.', { parameter: 'strategy' });
		out.strategy = s;
	}
	return out;
}

/** List the caller's agents, newest first, keyset-paginated. */
export async function listAgents(userId, { limit, cursor }) {
	let anchor = null;
	if (cursor) {
		[anchor] = await sql`SELECT created_at, id FROM agent_identities WHERE id = ${cursor} AND user_id = ${userId}`;
	}
	const rows = await sql`
		SELECT * FROM agent_identities
		WHERE user_id = ${userId} AND deleted_at IS NULL
		  AND (${anchor?.created_at ?? null}::timestamptz IS NULL
		       OR (created_at, id) < (${anchor?.created_at ?? null}::timestamptz, ${anchor?.id ?? null}::uuid))
		ORDER BY created_at DESC, id DESC
		LIMIT ${limit + 1}
	`;
	const hasMore = rows.length > limit;
	const items = rows.slice(0, limit);
	return { items: items.map(serializeAgent), hasMore, nextCursor: hasMore ? items.at(-1).id : null };
}

/**
 * Create an agent. A strategy preset fills skills, persona text and
 * temperature the caller left out, and installs its default automations
 * (which never spend). Returns `{ agent, automations }`.
 */
export async function createAgent(userId, body) {
	const s = readSettings(body, { partial: false });
	const strategy = s.strategy || null;
	const runtime = {
		model: s.model ?? null,
		temperature: s.temperature ?? strategy?.temperature ?? null,
		strategy: strategy?.id ?? null,
	};
	const created = await createAgentIdentity({
		userId,
		name: s.name,
		description: s.persona ?? null,
		skills: s.skills ?? strategy?.skills ?? null,
		personaPrompt: s.systemPrompt ?? strategy?.persona ?? null,
		meta: { runtime },
	});
	if (created.blocked) {
		throw apiError(409, 'identity_conflict', created.blocked.message, { integrity: created.blocked.integrity });
	}
	const agent = created.agent;
	const automations = [];
	for (const preset of strategy?.automations || []) {
		automations.push(await createAutomation({ agent, userId, body: preset, source: `strategy:${strategy.id}` }));
	}
	return { agent: serializeAgent(agent), automations };
}

/** Patch an agent's settings. Unknown fields are ignored; meta is merged. */
export async function updateAgent(agent, body) {
	const s = readSettings(body, { partial: true });
	const runtime = { ...(agent.meta?.runtime || {}) };
	if ('model' in s) runtime.model = s.model;
	if ('temperature' in s) runtime.temperature = s.temperature;
	if (s.strategy) runtime.strategy = s.strategy.id;
	if ('strategy' in body && body.strategy == null) runtime.strategy = null;
	const [row] = await sql`
		UPDATE agent_identities SET
			name = COALESCE(${s.name ?? null}, name),
			description = CASE WHEN ${'persona' in s} THEN ${s.persona ?? null} ELSE description END,
			persona_prompt = CASE WHEN ${'systemPrompt' in s} THEN ${s.systemPrompt ?? null} ELSE persona_prompt END,
			skills = COALESCE(${s.skills ?? null}::text[], skills),
			meta = meta || ${JSON.stringify({ runtime })}::jsonb,
			updated_at = now()
		WHERE id = ${agent.id} AND deleted_at IS NULL
		RETURNING *
	`;
	return serializeAgent(row);
}

/** Soft-delete an agent; its automations stop and its open runs are cancelled. */
export async function deleteAgent(agent) {
	await sql.transaction([
		sql`UPDATE agent_identities SET deleted_at = now() WHERE id = ${agent.id}`,
		sql`UPDATE agent_automations SET enabled = false, updated_at = now() WHERE agent_id = ${agent.id}`,
		sql`
			UPDATE agent_runs SET status = 'cancelled', error = 'agent deleted', finished_at = now(), updated_at = now()
			WHERE agent_id = ${agent.id} AND status IN ('scheduled', 'queued', 'running', 'paused')
		`,
		sql`DELETE FROM agent_actions WHERE agent_id = ${agent.id}`,
		sql`DELETE FROM agent_memories WHERE agent_id = ${agent.id}`,
	]);
	return { id: agent.id, deleted: true };
}

/**
 * Move an agent between running and stopped. Stopping pauses its automations,
 * wallet intents and runs where they stand; starting resumes all of them.
 */
export async function setAgentStatus(agent, status) {
	const [row] = await sql`
		UPDATE agent_identities SET status = ${status}, status_changed_at = now(), updated_at = now()
		WHERE id = ${agent.id} AND deleted_at IS NULL
		RETURNING *
	`;
	return serializeAgent(row);
}
