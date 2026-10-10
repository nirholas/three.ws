// Coordinator preferences, stored as the policy agent's own memories.
//
// "Remember my default trade size is 0.1 SOL" lands in agent_memories on the
// agent whose wallet the squad trades from, as a pinned `user` memory tagged
// team-pref / squad:<id> / pref:<key>. Reusing agent memory (rather than a
// side table) means the preference shows up in that agent's Memory studio, is
// exportable with the rest of its memory, and survives across chat sessions,
// devices and squads built on the same agent.
//
// Three keys exist, each with one value per squad:
//   default_trade_sol  number, the buy size used when a message names none
//   risk               low | medium | high, shapes slippage and caution trades
//   venues             the owner's own words about where they like to trade

import { sql } from '../db.js';
import { PREF_KEYS, RISK_LEVELS } from './plan.js';
import { quarantineText } from './untrusted.js';

const PREF_TAG = 'team-pref';

function describe(key, value) {
	if (key === 'default_trade_sol') return `Default trade size for squad chat: ${value} SOL.`;
	if (key === 'risk') return `Risk preference for squad chat: ${value}.`;
	return `Favorite trading venues for squad chat: ${value}.`;
}

/** Coerce one preference value, or null when it is not a legal value for its key. */
export function cleanPrefValue(key, value) {
	if (key === 'default_trade_sol') {
		const n = Number(value);
		return Number.isFinite(n) && n > 0 && n <= 1000 ? n : null;
	}
	if (key === 'risk') {
		const v = String(value || '').toLowerCase();
		return RISK_LEVELS.includes(v) ? v : null;
	}
	if (key === 'venues') {
		const v = quarantineText(value, 80);
		return v.length >= 2 ? v : null;
	}
	return null;
}

function shapeEntry(row) {
	const ctx = row.context || {};
	return {
		key: ctx.key,
		value: ctx.value,
		memory_id: row.id,
		content: row.content,
		updated_at: row.updated_at,
	};
}

/**
 * Load the squad's remembered preferences from the policy agent's memory.
 * @returns {Promise<{ values: Record<string, any>, entries: object[] }>}
 */
export async function loadPrefs(agentId, squadId) {
	if (!agentId) return { values: {}, entries: [] };
	const rows = await sql`
		select id, content, context, updated_at
		from agent_memories
		where agent_id = ${agentId}
		  and tags @> ${[PREF_TAG, `squad:${squadId}`]}::text[]
		  and (expires_at is null or expires_at > now())
		order by updated_at desc
		limit 20
	`;
	const values = {};
	const entries = [];
	for (const row of rows) {
		const entry = shapeEntry(row);
		if (!PREF_KEYS.includes(entry.key) || entry.key in values) continue;
		const v = cleanPrefValue(entry.key, entry.value);
		if (v == null) continue;
		values[entry.key] = v;
		entries.push({ ...entry, value: v });
	}
	return { values, entries };
}

/** Upsert one preference (one row per key per squad). */
export async function savePref(agentId, squadId, key, value) {
	const clean = cleanPrefValue(key, value);
	if (!agentId || !PREF_KEYS.includes(key) || clean == null) return null;
	const tags = [PREF_TAG, `squad:${squadId}`, `pref:${key}`];
	await sql`
		delete from agent_memories
		where agent_id = ${agentId} and tags @> ${tags}::text[]
	`;
	const [row] = await sql`
		insert into agent_memories (agent_id, type, content, tags, context, salience, tier, pinned, updated_at)
		values (
			${agentId}, 'user', ${describe(key, clean)}, ${tags},
			${JSON.stringify({ source: 'team-chat', squad_id: squadId, key, value: clean })}::jsonb,
			0.9, 'recall', true, now()
		)
		returning id, content, context, updated_at
	`;
	return row ? shapeEntry(row) : null;
}

/** Forget one preference. Returns true when something was removed. */
export async function forgetPref(agentId, squadId, key) {
	if (!agentId || !PREF_KEYS.includes(key)) return false;
	const rows = await sql`
		delete from agent_memories
		where agent_id = ${agentId} and tags @> ${[PREF_TAG, `squad:${squadId}`, `pref:${key}`]}::text[]
		returning id
	`;
	return rows.length > 0;
}
