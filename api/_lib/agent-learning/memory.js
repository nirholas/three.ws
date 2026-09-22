// Agent-curated memory: what an agent chooses to keep about its work and the
// person it works for, and how that memory reaches the next prompt.
//
// Storage is the existing agent_memories table (the Memory Studio engine in
// ../memory-store.js embeds, tiers and graphs every row regardless of who
// wrote it). This module adds the agent-facing vocabulary on top:
//
//   kind        fact | preference | procedure   (rows in agent_memories)
//               user-model                      (lines in user_model_entries)
//   provenance  source (tool, chat, run, mcp, owner), source_run_id,
//               source_message_id, confidence
//   ownership   user_id: the account the memory was written for
//
// Reads and writes are scoped to (agent, account). A memory written for one
// account never reaches another account's prompt, even on the same agent.
// Every write checks the account's off switch first.

import { sql } from '../db.js';
import { isUuid } from '../validate.js';
import { searchMemories, estimateTokens } from '../memory-store.js';
import { LearningError, memoryOffError } from './errors.js';
import { memoryEnabled } from './settings.js';
import { addUserModelEntry, userModelForPrompt, SECTION_IDS } from './user-model.js';

export const MEMORY_KINDS = Object.freeze(['fact', 'preference', 'procedure', 'user-model']);
export const ROW_KINDS = Object.freeze(['fact', 'preference', 'procedure']);
export const MEMORY_SOURCES = Object.freeze(['tool', 'chat', 'run', 'mcp', 'owner']);
export const MAX_MEMORY_CHARS = 1000;

// Legacy `type` each kind maps onto, so the Memory Studio, the brain bundle
// and the reflection pass keep reading these rows correctly.
const TYPE_FOR_KIND = { fact: 'reference', preference: 'feedback', procedure: 'project' };
// How much a freshly saved memory weighs before any use reinforces it.
const SALIENCE_FOR_KIND = { fact: 0.6, preference: 0.8, procedure: 0.7 };
// Kind priority in the prompt: a stated preference outranks an old fact.
const KIND_WEIGHT = { preference: 0.15, procedure: 0.08, fact: 0 };

/** Prompt budget for the memory section, in tokens (about 4 chars each). */
export const MEMORY_PROMPT_TOKENS = 900;
export const USER_MODEL_PROMPT_CHARS = 2400;
const RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

const COLUMNS = sql`
	id, agent_id, user_id, kind, type, content, tags, salience, confidence, source,
	source_run_id, source_message_id, access_count, last_accessed_at, created_at, updated_at
`;

function normalize(text) {
	return String(text || '').replace(/\s+/g, ' ').trim();
}

export function presentMemory(row, extra = {}) {
	return {
		id: row.id,
		agent_id: row.agent_id,
		kind: row.kind || kindFromType(row.type),
		content: row.content,
		tags: row.tags || [],
		confidence: row.confidence ?? 0.7,
		salience: row.salience,
		source: row.source || null,
		source_run_id: row.source_run_id || null,
		source_message_id: row.source_message_id != null ? Number(row.source_message_id) : null,
		use_count: row.access_count ?? 0,
		last_used_at: row.last_accessed_at || null,
		created_at: row.created_at,
		updated_at: row.updated_at,
		...extra,
	};
}

/** Kind for a row written before kinds existed. */
export function kindFromType(type) {
	if (type === 'feedback' || type === 'user') return 'preference';
	if (type === 'project') return 'procedure';
	return 'fact';
}

/**
 * Score for the prompt ranking: recency of use, amount of use, and how much
 * the memory is trusted, plus a small kind bias. Pure; exported for tests.
 */
export function rankScore(row, nowMs = Date.now()) {
	const lastMs = new Date(row.last_accessed_at || row.updated_at || row.created_at || nowMs).getTime();
	const recency = Math.exp((-Math.LN2 * Math.max(0, nowMs - lastMs)) / RECENCY_HALF_LIFE_MS);
	const use = Math.min(1, Math.log1p(row.access_count || 0) / Math.log(21));
	const trust = (row.confidence ?? 0.7) * 0.5 + (row.salience ?? 0.5) * 0.5;
	const kind = row.kind || kindFromType(row.type);
	return 0.4 * recency + 0.25 * use + 0.35 * trust + (KIND_WEIGHT[kind] || 0);
}

async function assertAgentOwner(agentId, userId) {
	if (!isUuid(agentId)) throw new LearningError(400, 'validation_error', 'agent_id must be a uuid');
	const [agent] = await sql`SELECT id, user_id FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!agent) throw new LearningError(404, 'not_found', 'agent not found');
	if (agent.user_id !== userId) throw new LearningError(403, 'forbidden', 'not your agent');
	return agent;
}

/**
 * Save a memory. kind 'user-model' writes a line to the account's user model
 * (requires `section`); every other kind writes an agent_memories row. An
 * identical memory already on file is reinforced instead of duplicated.
 *
 * @returns {Promise<{ status: 'saved'|'reinforced', kind: string, memory?: object, entry?: object }>}
 */
export async function saveMemory({
	agentId,
	userId,
	kind,
	content,
	section = null,
	tags = [],
	confidence = 0.7,
	source = 'tool',
	sourceRunId = null,
	sourceMessageId = null,
}) {
	if (!MEMORY_KINDS.includes(kind)) {
		throw new LearningError(400, 'validation_error', `kind must be one of: ${MEMORY_KINDS.join(', ')}`);
	}
	await assertAgentOwner(agentId, userId);
	if (!(await memoryEnabled(userId))) throw memoryOffError();

	if (kind === 'user-model') {
		if (!section) {
			throw new LearningError(400, 'validation_error', `kind user-model needs a section: ${SECTION_IDS.join(', ')}`);
		}
		const { entry, reinforced } = await addUserModelEntry(userId, {
			section,
			content,
			source: 'agent',
			agentId,
			runId: isUuid(sourceRunId) ? sourceRunId : null,
			confidence,
		});
		return { status: reinforced ? 'reinforced' : 'saved', kind, entry };
	}

	const text = normalize(content);
	if (!text) throw new LearningError(400, 'validation_error', 'content is required');
	if (text.length > MAX_MEMORY_CHARS) {
		throw new LearningError(400, 'validation_error', `a memory is at most ${MAX_MEMORY_CHARS} characters; keep one idea per memory`);
	}
	const conf = Math.min(1, Math.max(0, Number(confidence) || 0.7));
	const cleanTags = (Array.isArray(tags) ? tags : [])
		.map((t) => String(t).toLowerCase().trim().slice(0, 40))
		.filter(Boolean)
		.slice(0, 8);
	const src = MEMORY_SOURCES.includes(source) ? source : 'tool';
	const runId = isUuid(sourceRunId) ? sourceRunId : null;
	const messageId = sourceMessageId != null && /^\d+$/.test(String(sourceMessageId)) ? String(sourceMessageId) : null;

	const [dupe] = await sql`
		SELECT id FROM agent_memories
		WHERE agent_id = ${agentId} AND user_id = ${userId}
		  AND lower(content) = lower(${text})
		  AND (expires_at IS NULL OR expires_at > now())
		LIMIT 1
	`;
	if (dupe) {
		const [row] = await sql`
			UPDATE agent_memories
			SET confidence = LEAST(1.0, (confidence + ${conf}) / 2 + 0.05),
			    salience = LEAST(1.0, salience + 0.05),
			    kind = ${kind},
			    type = ${TYPE_FOR_KIND[kind]},
			    updated_at = now()
			WHERE id = ${dupe.id}
			RETURNING ${COLUMNS}
		`;
		return { status: 'reinforced', kind, memory: presentMemory(row) };
	}

	const [row] = await sql`
		INSERT INTO agent_memories
			(agent_id, user_id, type, kind, content, tags, context, salience, confidence, tier,
			 source, source_run_id, source_message_id)
		VALUES
			(${agentId}, ${userId}, ${TYPE_FOR_KIND[kind]}, ${kind}, ${text}, ${cleanTags},
			 ${JSON.stringify({ source: src, ...(runId ? { run_id: runId } : {}) })}::jsonb,
			 ${SALIENCE_FOR_KIND[kind]}, ${conf}, 'recall', ${src}, ${runId}, ${messageId})
		RETURNING ${COLUMNS}
	`;
	return { status: 'saved', kind, memory: presentMemory(row) };
}

/**
 * Search one agent's memories for one account. Semantic ranking comes from the
 * Memory Studio engine when an embedder is configured; a token-overlap pass
 * fills the rest so search works with no provider at all.
 */
export async function searchAgentMemory({ agentId, userId, query, kind = null, limit = 8 }) {
	await assertAgentOwner(agentId, userId);
	const q = normalize(query);
	if (!q) throw new LearningError(400, 'validation_error', 'query is required');
	if (kind && !ROW_KINDS.includes(kind)) {
		throw new LearningError(400, 'validation_error', `kind filter must be one of: ${ROW_KINDS.join(', ')}`);
	}
	const n = Math.min(Math.max(Number(limit) || 8, 1), 25);

	const pool = await sql`
		SELECT ${COLUMNS} FROM agent_memories
		WHERE agent_id = ${agentId}
		  AND (user_id = ${userId} OR user_id IS NULL)
		  AND (expires_at IS NULL OR expires_at > now())
		ORDER BY created_at DESC
		LIMIT 1500
	`;
	const byId = new Map(pool.map((r) => [r.id, r]));
	const matchesKind = (r) => !kind || (r.kind || kindFromType(r.type)) === kind;

	const out = [];
	const seen = new Set();
	try {
		const semantic = await searchMemories(agentId, q, { topK: n * 3, bump: false });
		for (const hit of semantic.results) {
			const row = byId.get(hit.id);
			if (!row || !matchesKind(row) || seen.has(row.id)) continue;
			seen.add(row.id);
			out.push(presentMemory(row, { score: hit.score, match: hit.match }));
			if (out.length >= n) break;
		}
	} catch (err) {
		console.warn('[agent-learning] semantic search failed', err?.message);
	}

	if (out.length < n) {
		const qTokens = tokens(q);
		const lexical = pool
			.filter((r) => !seen.has(r.id) && matchesKind(r))
			.map((r) => ({ r, overlap: overlap(qTokens, tokens(`${r.content} ${(r.tags || []).join(' ')}`)) }))
			.filter((x) => x.overlap > 0)
			.sort((a, b) => b.overlap - a.overlap || rankScore(b.r) - rankScore(a.r));
		for (const { r, overlap: o } of lexical) {
			out.push(presentMemory(r, { score: Number(o.toFixed(3)), match: 'lexical' }));
			if (out.length >= n) break;
		}
	}

	if (out.length) {
		const ids = out.map((m) => m.id);
		sql`
			UPDATE agent_memories SET access_count = access_count + 1, last_accessed_at = now()
			WHERE id = ANY(${ids}::uuid[])
		`.catch(() => {});
	}
	return { query: q, results: out };
}

function tokens(text) {
	return new Set(
		String(text || '')
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter((t) => t.length > 2),
	);
}

function overlap(a, b) {
	if (!a.size) return 0;
	let hits = 0;
	for (const t of a) if (b.has(t)) hits++;
	return hits / a.size;
}

/** Newest-first page of one agent's memories for one account. */
export async function listAgentMemory({ agentId, userId, kind = null, limit = 25, before = null }) {
	await assertAgentOwner(agentId, userId);
	return listMemories({ userId, agentId, kind, limit, before });
}

/**
 * Newest-first page across every agent the account owns (the settings page),
 * or one agent when `agentId` is given. `before` is an ISO created_at cursor.
 */
export async function listMemories({ userId, agentId = null, kind = null, q = null, limit = 25, before = null }) {
	if (kind && !ROW_KINDS.includes(kind)) {
		throw new LearningError(400, 'validation_error', `kind must be one of: ${ROW_KINDS.join(', ')}`);
	}
	if (agentId && !isUuid(agentId)) throw new LearningError(400, 'validation_error', 'agent_id must be a uuid');
	const n = Math.min(Math.max(Number(limit) || 25, 1), 100);
	const cursor = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null;
	const like = q ? `%${String(q).replace(/[%_\\]/g, (c) => `\\${c}`).slice(0, 200)}%` : null;
	const legacyTypes = kind === 'preference' ? ['feedback', 'user'] : kind === 'procedure' ? ['project'] : kind === 'fact' ? ['reference'] : null;

	const rows = await sql`
		SELECT m.id, m.agent_id, m.user_id, m.kind, m.type, m.content, m.tags, m.salience, m.confidence,
		       m.source, m.source_run_id, m.source_message_id, m.access_count, m.last_accessed_at,
		       m.created_at, m.updated_at, a.name AS agent_name
		FROM agent_memories m
		JOIN agent_identities a ON a.id = m.agent_id
		WHERE a.user_id = ${userId} AND a.deleted_at IS NULL
		  AND (m.user_id = ${userId} OR m.user_id IS NULL)
		  AND (m.expires_at IS NULL OR m.expires_at > now())
		  AND (${agentId}::uuid IS NULL OR m.agent_id = ${agentId}::uuid)
		  AND (${kind}::text IS NULL OR m.kind = ${kind} OR (m.kind IS NULL AND m.type = ANY(${legacyTypes}::text[])))
		  AND (${like}::text IS NULL OR m.content ILIKE ${like})
		  AND (${cursor}::timestamptz IS NULL OR m.created_at < ${cursor}::timestamptz)
		ORDER BY m.created_at DESC, m.id DESC
		LIMIT ${n + 1}
	`;
	const hasMore = rows.length > n;
	const page = rows.slice(0, n);
	return {
		memories: page.map((r) => presentMemory(r, { agent_name: r.agent_name })),
		has_more: hasMore,
		next_before: hasMore ? new Date(page[page.length - 1].created_at).toISOString() : null,
	};
}

/** The memory row, when the account owns its agent. */
export async function getMemory(userId, memoryId) {
	if (!isUuid(memoryId)) throw new LearningError(400, 'validation_error', 'memory id must be a uuid');
	const [row] = await sql`
		SELECT m.id, m.agent_id, m.user_id, m.kind, m.type, m.content, m.tags, m.salience, m.confidence,
		       m.source, m.source_run_id, m.source_message_id, m.access_count, m.last_accessed_at,
		       m.created_at, m.updated_at
		FROM agent_memories m
		JOIN agent_identities a ON a.id = m.agent_id
		WHERE m.id = ${memoryId} AND a.user_id = ${userId} AND (m.user_id = ${userId} OR m.user_id IS NULL)
	`;
	if (!row) throw new LearningError(404, 'not_found', 'no such memory, or it does not belong to you');
	return presentMemory(row);
}

/** Permanently delete one memory. Deletion is allowed with memory switched off. */
export async function forgetMemory(userId, memoryId) {
	const memory = await getMemory(userId, memoryId);
	await sql`DELETE FROM agent_memories WHERE id = ${memory.id}`;
	return memory;
}

/** Count of memories per kind for an account (settings page header). */
export async function memoryCounts(userId) {
	const rows = await sql`
		SELECT coalesce(m.kind, CASE m.type WHEN 'feedback' THEN 'preference' WHEN 'user' THEN 'preference'
		                                    WHEN 'project' THEN 'procedure' ELSE 'fact' END) AS kind,
		       count(*)::int AS n
		FROM agent_memories m
		JOIN agent_identities a ON a.id = m.agent_id
		WHERE a.user_id = ${userId} AND a.deleted_at IS NULL
		  AND (m.user_id = ${userId} OR m.user_id IS NULL)
		  AND (m.expires_at IS NULL OR m.expires_at > now())
		GROUP BY 1
	`;
	const out = { fact: 0, preference: 0, procedure: 0 };
	for (const r of rows) out[r.kind] = r.n;
	return out;
}

/**
 * Pick memories for a prompt from a candidate pool. Pure: ranks by
 * rankScore, pins query-relevant hits first, and fills a token budget without
 * ever cutting a memory in half. Exported for tests.
 */
export function selectForPrompt(pool, { relevantIds = [], budgetTokens = MEMORY_PROMPT_TOKENS, nowMs = Date.now() } = {}) {
	const relevant = new Set(relevantIds);
	const ordered = [...pool].sort((a, b) => {
		const ra = relevant.has(a.id) ? 1 : 0;
		const rb = relevant.has(b.id) ? 1 : 0;
		if (ra !== rb) return rb - ra;
		return rankScore(b, nowMs) - rankScore(a, nowMs);
	});
	const chosen = [];
	let used = 0;
	for (const row of ordered) {
		const cost = estimateTokens(row.content) + 4;
		if (used + cost > budgetTokens) continue;
		used += cost;
		chosen.push(row);
	}
	return { chosen, usedTokens: used };
}

/**
 * The memory section of a system prompt for (agent, account): the user model
 * followed by the agent's own memories, ranked by recency and use, pinned
 * toward what is relevant to `query`, inside a fixed budget. Returns an empty
 * block when memory is off. The chosen memories are marked used, which is
 * what feeds the ranking next time.
 *
 * @returns {Promise<{ block: string, memoryIds: string[], userModelIds: string[], enabled: boolean }>}
 */
export async function memoryPromptSection({ agentId, userId, query = '' }) {
	const empty = { block: '', memoryIds: [], userModelIds: [], enabled: false };
	if (!isUuid(agentId) || !isUuid(userId)) return empty;
	if (!(await memoryEnabled(userId))) return empty;

	const pool = await sql`
		SELECT ${COLUMNS} FROM agent_memories
		WHERE agent_id = ${agentId}
		  AND (user_id = ${userId} OR user_id IS NULL)
		  AND (expires_at IS NULL OR expires_at > now())
		ORDER BY last_accessed_at DESC NULLS LAST, created_at DESC
		LIMIT 400
	`;

	let relevantIds = [];
	const q = normalize(query);
	if (q && pool.length) {
		const qTokens = tokens(q);
		relevantIds = pool
			.map((r) => ({ id: r.id, o: overlap(qTokens, tokens(r.content)) }))
			.filter((x) => x.o >= 0.34)
			.sort((a, b) => b.o - a.o)
			.slice(0, 5)
			.map((x) => x.id);
	}

	const { chosen } = selectForPrompt(pool, { relevantIds });
	const model = await userModelForPrompt(userId, { maxChars: USER_MODEL_PROMPT_CHARS });

	if (!chosen.length && !model.lines.length) return { ...empty, enabled: true };

	const ids = chosen.map((r) => r.id);
	if (ids.length) {
		sql`
			UPDATE agent_memories SET access_count = access_count + 1, last_accessed_at = now()
			WHERE id = ANY(${ids}::uuid[])
		`.catch(() => {});
	}

	const lines = [
		'Memory: what you have learned working with this person. Apply it without being asked; never recite it or mention that you have a memory store. If something here conflicts with what they say now, what they say now wins, and update the memory.',
	];
	if (model.lines.length) lines.push('', 'About the person you work for:', ...model.lines);
	if (chosen.length) {
		lines.push('', 'What you remember:');
		for (const r of chosen) lines.push(`- (${r.kind || kindFromType(r.type)}) ${normalize(r.content)}`);
	}
	return { block: lines.join('\n'), memoryIds: ids, userModelIds: model.ids, enabled: true };
}
