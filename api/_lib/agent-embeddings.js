// agent-embeddings: a durable cache of embedding vectors for agent identities,
// the data layer behind the Agent Galaxy.
//
// Embedding every agent on every page load would be slow and wasteful, so each
// agent's vector is persisted in Postgres keyed by a content hash of the exact
// text that was embedded (plus the model id). On rebuild we re-embed only the
// agents whose text actually changed; everything else is read straight from the
// cache. The same stored vectors power semantic search (query vector vs. agent
// vectors) without a second embedding pass.
//
// IBM Granite on watsonx.ai is the preferred embedder. When watsonx is not
// configured, or fails, the platform's tagged embedding lanes (NVIDIA NIM,
// Vertex AI, OpenAI; see ./embeddings.js) serve instead. Every stored row
// records the exact model or lane tag that produced it, and reads always filter
// by that tag, so vectors from different spaces are never compared. There is no
// mock path: when no embedder is configured the caller reports the feature
// unavailable rather than inventing data.

import { createHash } from 'node:crypto';
import { sql } from './db.js';
import { watsonxEmbed } from './watsonx.js';
import {
	NIM_EMBED_TAG_PREVIOUS,
	VERTEX_EMBED_TAG,
	OPENAI_EMBED_TAG,
	embedderConfigured,
	embedPassages,
	embedQuery,
} from './embeddings.js';

// watsonx accepts many inputs per embeddings call; keep request bodies modest so
// a large galaxy rebuild splits into a handful of calls instead of one giant one.
const WATSONX_EMBED_CHUNK = 96;
// Vertex caps a request at 20k input tokens and NIM at 512 tokens per input, so
// the platform lanes take smaller batches of the (up to 2000 char) agent texts.
const PLATFORM_EMBED_CHUNK = 16;

// Platform lanes, free first. The galaxy pins NIM's nemotron-3-embed-1b rather
// than following embeddings.js to nemotron-3.5-embed-8b: a galaxy is one map
// of the whole population in ONE space, and the 8b model's content screen
// refuses some inputs (a 422 per request), which would fail the 8b lane for
// every agent and flip the cache between two models on each rebuild. Agent
// memory and knowledge store a space per row, so they take the 8b model.
const PLATFORM_EMBED_TAGS = [NIM_EMBED_TAG_PREVIOUS, VERTEX_EMBED_TAG, OPENAI_EMBED_TAG];

function watsonxEmbedder(cfg, model = cfg.embedModel) {
	return {
		provider: 'watsonx',
		model,
		chunk: WATSONX_EMBED_CHUNK,
		async embed(inputs) {
			const { vectors } = await watsonxEmbed(cfg, { inputs, model });
			return vectors;
		},
		async embedQuery(text) {
			const { vectors } = await watsonxEmbed(cfg, { inputs: [text], model });
			return vectors[0] || null;
		},
	};
}

function platformEmbedder(tag) {
	return {
		provider: 'platform',
		model: tag,
		chunk: PLATFORM_EMBED_CHUNK,
		async embed(inputs) {
			// Float64Array serializes to an object in JSON, so store plain arrays.
			return (await embedPassages(tag, inputs)).map((v) => Array.from(v));
		},
		async embedQuery(text) {
			const vec = await embedQuery(tag, text);
			return vec ? Array.from(vec) : null;
		},
	};
}

/**
 * Every embedder able to serve right now, in preference order: watsonx Granite
 * first when configured, then each configured platform lane. Empty when none is.
 * `cfg` is a watsonxConfig() result.
 */
export function agentEmbedders(cfg) {
	const out = [];
	if (cfg?.configured) out.push(watsonxEmbedder(cfg));
	for (const tag of PLATFORM_EMBED_TAGS) {
		if (embedderConfigured(tag)) out.push(platformEmbedder(tag));
	}
	return out;
}

// Accept either an embedder from agentEmbedders() or a bare watsonxConfig()
// result (optionally with a Granite model override), which callers that only
// ever use Granite still pass.
function toEmbedder(cfgOrEmbedder, model) {
	return typeof cfgOrEmbedder?.embed === 'function'
		? cfgOrEmbedder
		: watsonxEmbedder(cfgOrEmbedder, model || cfgOrEmbedder.embedModel);
}

let _ready = null;

// Lazily create the cache table (mirrors the CREATE-TABLE-IF-NOT-EXISTS pattern
// used across api/_lib). Cached so concurrent callers in a warm instance share
// one round-trip.
function ensureTable() {
	if (_ready) return _ready;
	_ready = sql`
		CREATE TABLE IF NOT EXISTS agent_embeddings (
			agent_id     uuid PRIMARY KEY REFERENCES agent_identities(id) ON DELETE CASCADE,
			content_hash text NOT NULL,
			model        text NOT NULL,
			dims         int  NOT NULL,
			vector       jsonb NOT NULL,
			updated_at   timestamptz NOT NULL DEFAULT now()
		)
	`.then(() => true);
	return _ready;
}

// The canonical text we embed for an agent: its name and description, plus any
// persona tone tags, joined deterministically. Two agents with identical text
// hash identically; editing a description re-embeds only that agent.
export function agentEmbedText(agent) {
	const parts = [];
	if (agent.name) parts.push(String(agent.name).trim());
	if (agent.description) parts.push(String(agent.description).trim());
	const tags = Array.isArray(agent.persona_tone_tags) ? agent.persona_tone_tags : [];
	if (tags.length) parts.push(tags.map((t) => String(t).trim()).filter(Boolean).join(', '));
	return parts.filter(Boolean).join('. ').slice(0, 2000);
}

function contentHash(text, model) {
	return createHash('sha256').update(`${model}\n${text}`).digest('hex');
}

// Ensure every agent in `agents` has a current embedding, re-embedding only
// those whose text changed since last time. Returns { vectors, model, dims,
// embedded } where `vectors` is aligned 1:1 with the input `agents` (agents with
// empty embeddable text are skipped, see `usable`).
//
// `cfgOrEmbedder` is an embedder from agentEmbedders(), or a watsonxConfig()
// result the caller guarantees is configured.
export async function ensureAgentEmbeddings(cfgOrEmbedder, agents, { model } = {}) {
	await ensureTable();
	const embedder = toEmbedder(cfgOrEmbedder, model);
	const embedModel = embedder.model;

	// Build the embed text + hash for each agent up front.
	const prepared = agents.map((a) => {
		const text = agentEmbedText(a);
		return { agent: a, text, hash: text ? contentHash(text, embedModel) : null };
	});
	const usable = prepared.filter((p) => p.text && p.hash);
	const ids = usable.map((p) => p.agent.id);

	// Read whatever we already have for these agents.
	const cached = new Map(); // agent_id → { hash, vector }
	if (ids.length) {
		const rows = await sql`
			SELECT agent_id, content_hash, vector
			FROM agent_embeddings
			WHERE agent_id = ANY(${ids}::uuid[]) AND model = ${embedModel}
		`;
		for (const r of rows) cached.set(r.agent_id, { hash: r.content_hash, vector: r.vector });
	}

	// Stale = missing from cache or hash drifted (text edited).
	const stale = usable.filter((p) => {
		const hit = cached.get(p.agent.id);
		return !hit || hit.hash !== p.hash;
	});

	let embeddedCount = 0;
	let dims = 0;
	for (const c of cached.values()) if (c.vector?.length) dims = c.vector.length;

	// Re-embed stale agents in chunks, then upsert and merge into the cache map.
	for (let i = 0; i < stale.length; i += embedder.chunk) {
		const batch = stale.slice(i, i + embedder.chunk);
		const vectors = await embedder.embed(batch.map((p) => p.text));
		dims = vectors[0]?.length || dims;
		const recs = [];
		for (let j = 0; j < batch.length; j++) {
			const vec = vectors[j];
			if (!vec?.length) continue;
			cached.set(batch[j].agent.id, { hash: batch[j].hash, vector: vec });
			recs.push({ id: batch[j].agent.id, hash: batch[j].hash, dims: vec.length, vector: vec });
			embeddedCount++;
		}
		if (recs.length) await upsertEmbeddings(recs, embedModel);
	}

	// Align output to the original agents order; agents without usable text or a
	// vector are returned as null so the caller can drop them cleanly.
	const vectors = prepared.map((p) => cached.get(p.agent?.id)?.vector ?? null);
	return { vectors, model: embedModel, dims, embedded: embeddedCount, total: usable.length };
}

// One round-trip multi-row upsert via unnest — keeps a full first-build (a few
// hundred agents) to a single statement instead of N inserts.
async function upsertEmbeddings(records, model) {
	const ids = records.map((r) => r.id);
	const hashes = records.map((r) => r.hash);
	const models = records.map(() => model);
	const dims = records.map((r) => r.dims);
	// Vectors ride as a text[] of JSON strings and are cast to jsonb per-row in
	// the SELECT — both `::text[]` array params and single-value `::jsonb` casts
	// are established Neon patterns here, unlike an unproven `::jsonb[]` param.
	const vectors = records.map((r) => JSON.stringify(r.vector));
	await sql`
		INSERT INTO agent_embeddings (agent_id, content_hash, model, dims, vector)
		SELECT u.id, u.hash, u.model, u.dims, u.vec::jsonb
		FROM unnest(
			${ids}::uuid[],
			${hashes}::text[],
			${models}::text[],
			${dims}::int[],
			${vectors}::text[]
		) AS u(id, hash, model, dims, vec)
		ON CONFLICT (agent_id) DO UPDATE SET
			content_hash = EXCLUDED.content_hash,
			model        = EXCLUDED.model,
			dims         = EXCLUDED.dims,
			vector       = EXCLUDED.vector,
			updated_at   = now()
	`;
}

// Read stored vectors for a set of agent ids, the read path for semantic
// search. Returns Map agent_id → vector (number[]); agents without a cached
// vector in that model's space are simply absent. `model` is required: the
// table holds vectors from several models (some of the same length), and the
// caller is about to compare them against a query from exactly one of them.
export async function readAgentVectors(agentIds, { model } = {}) {
	if (!model) throw new Error('readAgentVectors: model is required (the space the caller will query)');
	if (!agentIds?.length) return new Map();
	await ensureTable();
	const rows = await sql`SELECT agent_id, vector FROM agent_embeddings WHERE agent_id = ANY(${agentIds}::uuid[]) AND model = ${model}`;
	const out = new Map();
	for (const r of rows) out.set(r.agent_id, r.vector);
	return out;
}
