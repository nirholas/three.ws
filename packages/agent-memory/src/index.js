// @three-ws/agent-memory — persistent, embeddings-backed memory for agents.
// Thin client over the live /api/agent-memory and /api/memory/* endpoints (the
// SDK twin of the three.ws Memory Studio). One agent's memories per client:
// remember() a fact, recall() it by meaning, walk the auto-mined entity graph,
// and curate the working core. See README.md for the full reference.

import { createHttp, ThreeWsError } from './http.js';

export { ThreeWsError, PaymentRequiredError, DEFAULT_BASE_URL } from './http.js';

// The README documents writes that throw a `MemoryError` with a `.code`. That
// is the platform's shared ThreeWsError under an ergonomic name — re-exported so
// `instanceof MemoryError` and `instanceof ThreeWsError` both hold.
export { ThreeWsError as MemoryError } from './http.js';

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];
const MEMORY_TIERS = ['working', 'recall', 'archival'];

/**
 * Create an AgentMemory client bound to one agent, a base URL, a fetch, and an
 * optional bearer token. The default exports (`remember`, `recall`, …) need an
 * `agentId` per call; this factory (and the `AgentMemory` class) bind it once so
 * every method targets the same agent.
 *
 * @param {object} options
 * @param {string} options.agentId        The agent these memories belong to.
 * @param {string} [options.token]        Bearer token for writes (server-to-server).
 * @param {string} [options.baseUrl]      API origin (default https://three.ws).
 * @param {typeof fetch} [options.fetch]  fetch implementation (e.g. an x402 payer).
 * @param {Record<string,string>} [options.headers]
 */
export function createAgentMemory(options = {}) {
	const agentId = options.agentId;
	if (!agentId || typeof agentId !== 'string') {
		throw new ThreeWsError('createAgentMemory() needs an `agentId` string.', { code: 'invalid_input' });
	}
	// `token` is the README's name for the platform's bearer auth — createHttp
	// attaches whatever it gets as `apiKey` to the Authorization header.
	const request = createHttp({ ...options, apiKey: options.apiKey || options.token });

	/** Store (or upsert) a memory. Wraps `POST /api/agent-memory`. */
	async function remember(content, opts = {}) {
		const input = typeof content === 'string' ? { content } : { ...(content || {}) };
		const text = input.content;
		if (!text || typeof text !== 'string') {
			throw new ThreeWsError('remember() needs `content` text.', { code: 'invalid_input' });
		}
		const merged = { ...input, ...opts };

		const type = normalizeEnum(merged.type, MEMORY_TYPES, 'type', true); // soft: server falls back to 'project'
		const tier = normalizeEnum(merged.tier, MEMORY_TIERS, 'tier');
		if (merged.salience !== undefined) assertUnit(merged.salience, 'salience');

		const entry = prune({
			id: merged.id,
			type,
			content: text,
			tags: merged.tags,
			context: merged.context,
			salience: merged.salience,
			pinned: merged.pinned === true ? true : undefined,
			tier,
			createdAt: merged.createdAt,
			updatedAt: merged.updatedAt,
			expiresAt: merged.expiresAt,
		});

		const res = await request('/api/agent-memory', {
			method: 'POST',
			body: { agentId, entry },
			signal: merged.signal,
		});
		return shapeMemory(res?.entry);
	}

	/** Semantic search over the agent's memories. Wraps `POST /api/memory/search`. */
	async function recall(query, opts = {}) {
		const q = String(query || '').trim();
		if (!q) throw new ThreeWsError('recall() needs a non-empty query.', { code: 'invalid_input' });
		if (opts.minScore !== undefined) assertUnit(opts.minScore, 'minScore');

		const res = await request('/api/memory/search', {
			method: 'POST',
			body: prune({
				agentId,
				query: q,
				topK: opts.topK,
				minScore: opts.minScore,
				tiers: cleanTiers(opts.tiers),
				type: normalizeEnum(opts.type, MEMORY_TYPES, 'type'),
			}),
			signal: opts.signal,
		});
		return (res?.results || []).map(shapeMemory);
	}

	/** Every memory for the agent (newest, salience-first). Wraps `GET /api/agent-memory`. */
	async function list(opts = {}) {
		const res = await request('/api/agent-memory', {
			query: prune({
				agentId,
				type: normalizeEnum(opts.type, MEMORY_TYPES, 'type'),
				since: opts.since,
				limit: opts.limit,
			}),
			signal: opts.signal,
		});
		return (res?.entries || []).map(shapeMemory);
	}

	/** The full temporal knowledge graph. Wraps `GET /api/memory/graph`. */
	async function graph(opts = {}) {
		const res = await request('/api/memory/graph', { query: { agentId }, signal: opts.signal });
		return {
			nodes: (res?.nodes || []).map(shapeEntity),
			edges: (res?.edges || []).map((e) => ({ source: e.source, target: e.target, weight: e.weight ?? 1 })),
			stats: res?.stats || { entities: 0, edges: 0 },
		};
	}

	/** Knowledge-graph nodes ranked by mention count — convenience over `graph()`. */
	async function entities(opts = {}) {
		const { nodes } = await graph(opts);
		return [...nodes].sort((a, b) => (b.mentions || 0) - (a.mentions || 0));
	}

	/** Memories that mention a given entity node. Wraps `GET /api/memory/graph?entityId=`. */
	async function memoriesFor(entityId, opts = {}) {
		if (!entityId || typeof entityId !== 'string') {
			throw new ThreeWsError('memoriesFor() needs an `entityId` string.', { code: 'invalid_input' });
		}
		const res = await request('/api/memory/graph', { query: { agentId, entityId }, signal: opts.signal });
		return (res?.memories || []).map(shapeMemory);
	}

	/** The always-in-context working set + live token budget. Wraps `GET /api/memory/context`. */
	async function context(opts = {}) {
		const res = await request('/api/memory/context', { query: { agentId }, signal: opts.signal });
		return {
			entries: (res?.entries || []).map(shapeMemory),
			tokens: res?.tokens ?? 0,
			budget: res?.budget ?? 2000,
			overBudget: Boolean(res?.overBudget),
			counts: res?.counts || { total: 0, working: 0, recall: 0, archival: 0, embedded: 0 },
			raw: res,
		};
	}

	// ── Curation (owner-only, POST /api/memory/curate) ───────────────────────────

	async function curate(op, payload = {}, opts = {}) {
		const res = await request('/api/memory/curate', {
			method: 'POST',
			body: { agentId, op, ...payload },
			signal: opts.signal,
		});
		return res;
	}

	function requireId(id, label) {
		if (!id || typeof id !== 'string') {
			throw new ThreeWsError(`${label} needs a memory id string.`, { code: 'invalid_input' });
		}
	}

	/** Pin a memory to the working core (tier → working, pinned → true). */
	async function pin(id, opts) {
		requireId(id, 'pin()');
		return shapeMemory((await curate('pin', { memoryId: id }, opts))?.entry);
	}
	/** Unpin a memory (pinned → false, tier → recall). */
	async function unpin(id, opts) {
		requireId(id, 'unpin()');
		return shapeMemory((await curate('unpin', { memoryId: id }, opts))?.entry);
	}
	/** Move a memory to a tier (`working | recall | archival`). */
	async function retier(id, tier, opts) {
		requireId(id, 'retier()');
		normalizeEnum(tier, MEMORY_TIERS, 'tier'); // throws if invalid; required here
		if (!tier) throw new ThreeWsError('retier() needs a `tier`.', { code: 'invalid_input' });
		return shapeMemory((await curate('tier', { memoryId: id, tier }, opts))?.entry);
	}
	/** Set a memory's importance, `0..1`. */
	async function setSalience(id, salience, opts) {
		requireId(id, 'setSalience()');
		assertUnit(salience, 'salience');
		return shapeMemory((await curate('salience', { memoryId: id, salience }, opts))?.entry);
	}
	/** Edit a memory's content/tags — re-embeds + re-mines on content change. */
	async function edit(id, changes = {}, opts) {
		requireId(id, 'edit()');
		const hasContent = typeof changes.content === 'string';
		const hasTags = Array.isArray(changes.tags);
		if (!hasContent && !hasTags) {
			throw new ThreeWsError('edit() needs `content` or `tags` to change.', { code: 'invalid_input' });
		}
		return shapeMemory((await curate('edit', prune({ memoryId: id, content: changes.content, tags: changes.tags }), opts))?.entry);
	}
	/** Fold duplicate memories into the first id; re-indexes the survivor. */
	async function merge(memoryIds, opts) {
		const ids = Array.isArray(memoryIds) ? memoryIds.filter(Boolean) : [];
		if (ids.length < 2) {
			throw new ThreeWsError('merge() needs at least 2 memory ids: [target, ...dupes].', { code: 'invalid_input' });
		}
		const res = await curate('merge', { memoryIds: ids }, opts);
		return { entry: shapeMemory(res?.entry), merged: res?.merged ?? 0 };
	}
	/** Delete a memory. Returns `{ ok, id }`. */
	async function forget(id, opts) {
		requireId(id, 'forget()');
		const res = await curate('forget', { memoryId: id }, opts);
		return { ok: Boolean(res?.ok), id: res?.forgot ?? id };
	}

	return {
		agentId,
		remember, recall, list,
		graph, entities, memoriesFor, context,
		pin, unpin, retier, setSalience, edit, merge, forget,
	};
}

/**
 * The README's headline ergonomic surface: `new AgentMemory({ agentId, token })`.
 * A thin class wrapper over `createAgentMemory` so methods read like an object
 * the agent owns.
 */
export class AgentMemory {
	constructor(options = {}) {
		const client = createAgentMemory(options);
		this.agentId = client.agentId;
		this.remember = client.remember;
		this.recall = client.recall;
		this.list = client.list;
		this.graph = client.graph;
		this.entities = client.entities;
		this.memoriesFor = client.memoriesFor;
		this.context = client.context;
		this.pin = client.pin;
		this.unpin = client.unpin;
		this.retier = client.retier;
		this.setSalience = client.setSalience;
		this.edit = client.edit;
		this.merge = client.merge;
		this.forget = client.forget;
	}
}

// ── Shaping ─────────────────────────────────────────────────────────────────

// The store's decorateMemory() already emits a mostly-camelCase memory (with a
// snake_case `agent_id`). Normalize that one stray field and keep a `.raw`
// escape hatch; pass score/match through untouched for recall() hits.
function shapeMemory(row) {
	if (!row || typeof row !== 'object') return null;
	const memory = {
		id: row.id,
		agentId: row.agentId ?? row.agent_id ?? null,
		type: row.type,
		content: row.content,
		tags: row.tags || [],
		context: row.context || {},
		salience: row.salience,
		tier: row.tier || 'recall',
		pinned: Boolean(row.pinned),
		embedder: row.embedder ?? null,
		hasEmbedding: Boolean(row.hasEmbedding),
		accessCount: row.accessCount ?? 0,
		isPublic: Boolean(row.isPublic),
		tokens: row.tokens ?? 0,
		createdAt: row.createdAt ?? null,
		updatedAt: row.updatedAt ?? null,
		lastAccessedAt: row.lastAccessedAt ?? null,
		expiresAt: row.expiresAt ?? null,
		raw: row,
	};
	if ('score' in row) memory.score = row.score;
	if ('match' in row) memory.match = row.match;
	if ('rankScore' in row) memory.rankScore = row.rankScore;
	if (row.outcome && typeof row.outcome === 'object') memory.outcome = row.outcome;
	return memory;
}

function shapeEntity(node) {
	return {
		id: node.id,
		kind: node.kind,
		label: node.label,
		salience: node.salience ?? null,
		mentions: node.mentions ?? 0,
		firstSeenAt: node.firstSeenAt ?? null,
		lastSeenAt: node.lastSeenAt ?? null,
		meta: node.meta || {},
		raw: node,
	};
}

// ── Validation helpers (mirror forge's enum/unit checks; throw before network) ──

function normalizeEnum(value, allowed, label, soft = false) {
	if (value === undefined || value === null) return undefined;
	if (!allowed.includes(value)) {
		if (soft) return undefined; // server clamps invalid values to a default
		throw new ThreeWsError(`Invalid ${label} "${value}". Expected one of: ${allowed.join(', ')}.`, { code: 'invalid_input' });
	}
	return value;
}

function assertUnit(value, label) {
	const n = Number(value);
	if (!Number.isFinite(n) || n < 0 || n > 1) {
		throw new ThreeWsError(`${label} must be a number in 0..1.`, { code: 'invalid_input' });
	}
}

function cleanTiers(tiers) {
	if (!Array.isArray(tiers)) return undefined;
	const list = tiers.map((t) => String(t).trim()).filter((t) => MEMORY_TIERS.includes(t));
	return list.length ? list : undefined;
}

function prune(obj) {
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined || v === null) continue;
		if (Array.isArray(v) && v.length === 0) continue;
		out[k] = v;
	}
	return out;
}
