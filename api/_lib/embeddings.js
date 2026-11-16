// Multi-provider text embeddings with vector-space tagging.
//
// Provider policy (free-first, per the platform LLM policy): NVIDIA NIM's
// nemotron-3.5-embed-8b (requested at 2048 dims, free with one nvapi key) is the
// default for new ingests, with nemotron-3-embed-1b (the model it replaced,
// also 2048-dim) kept live right behind it; Vertex AI's text-embedding-005 (768-dim, service-account auth,
// billed to the platform's GCP credit pool — no vendor quota to exhaust) is
// the second-choice ingest lane when NIM is unconfigured; OpenAI
// text-embedding-3-small @ 256 dims (Matryoshka truncation) is the last-resort
// paid backstop and, critically, the space every pre-tagging legacy row lives
// in (LEGACY_EMBED_TAG) — its entry in EMBEDDERS must never be removed even
// if it stops being used for new ingests, or legacy-row resolution breaks.
//
// THE TRAP this module exists to prevent: embeddings from different models are
// different vector spaces. A query embedded with model A compared against
// passages embedded with model B returns garbage similarity scores that look
// plausible. So every embed call here names its embedder explicitly via a
// `tag` (model id + dimension, e.g. "nvidia/nemotron-3-embed-1b@2048"), callers
// persist that tag next to every stored vector, and query-time code must
// resolve the stored tag back through this module — never pick a provider ad
// hoc. Untagged legacy rows are OpenAI text-embedding-3-small@256 by
// definition (`LEGACY_EMBED_TAG`): that was the only embedder before tagging
// shipped.
//
// We keep this zero-dep (plain fetch, no SDK) so the talking-agent chat path
// stays a single cheap import — matching api/widgets/[id]/[action].js.

const NIM_EMBED_URL = 'https://integrate.api.nvidia.com/v1/embeddings';
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';

// text-embedding-005 is a regional model (verified live: us-central1 serves
// it; "global" does not for this model family, unlike the Gemini chat/image
// models elsewhere in the codebase) — default to the region every other
// GCP-hosted worker in this platform already runs in.
import {
	AUTH_COOLDOWN_SECONDS,
	clearProviderCooldown,
	markProviderCooldown,
	providersInCooldown,
} from './provider-health.js';

function vertexEmbedUrl() {
	const project = process.env.GOOGLE_CLOUD_PROJECT;
	const location = process.env.GOOGLE_CLOUD_LOCATION_EMBED || 'us-central1';
	return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/text-embedding-005:predict`;
}

// The NIM embedding lane hard-caps inputs at 512 tokens (probed on
// nv-embedqa-e5-v5: longer inputs 400 with "exceeds maximum allowed token
// size"). Kept at that bound for nemotron-3-embed-1b rather than raised on
// assumption: a cap that is too low costs a little recall, one that is too high
// fails the call. The chunker already targets
// ≤512 estimated tokens (4 chars/token), but dense text (code, CJK) can run
// more tokens per char — so the NIM lane retries an over-length 400 once with
// inputs truncated to a conservative 3 chars/token budget.
const NIM_MAX_TOKENS = 512;
const NIM_SAFE_CHARS = NIM_MAX_TOKENS * 3;

// The current free NIM embedder. Promoted 2026-11-16 on a measured win
// (docs/nvidia/evals/embeddings-2026-11-16.md): on the three.ws docs set it
// lifts nDCG@10 from 81.3 to 91.3 and recall@5 from 92.0 to 100. It is a
// Matryoshka model (native 4096); it is asked for 2048 dims, which keeps the
// stored size of the space it replaced and costs under a point of nDCG.
export const NIM_EMBED_TAG = 'nvidia/nemotron-3.5-embed-8b@2048';
// The embedder this tag replaced: rows written before the re-pin carry it,
// so it stays resolvable and stays the ingest rung behind the new one.
// It also catches what the new model's content screen refuses (a 422 on some
// inputs, such as API docs with bearer tokens), so a refused text still gets
// a vector. Do not retire it while rows carry it (npm run nvidia:reembed -- --status).
export const NIM_EMBED_TAG_PREVIOUS = 'nvidia/nemotron-3-embed-1b@2048';
// The retired NIM embedder. Rows embedded before 2026-09-10 carry this tag and
// resolve through it forever: like LEGACY_EMBED_TAG below, this must never be
// removed even though nothing new is written with it. It is deliberately absent
// from INGEST_PREFERENCE, so it is resolvable but never chosen.
export const NIM_EMBED_TAG_RETIRED = 'nvidia/nv-embedqa-e5-v5@1024';
export const VERTEX_EMBED_TAG = 'vertex/text-embedding-005@768';
export const OPENAI_EMBED_TAG = 'text-embedding-3-small@256';

// Rows written before embedder tagging existed were embedded with OpenAI
// text-embedding-3-small @ 256 — encode that assumption in exactly one place.
// This tag (and its EMBEDDERS entry below) must never be removed, even after
// it stops being the ingest default, or legacy-row resolution breaks.
export const LEGACY_EMBED_TAG = OPENAI_EMBED_TAG;

const EMBEDDERS = Object.freeze({
	[NIM_EMBED_TAG]: Object.freeze({
		tag: NIM_EMBED_TAG,
		provider: 'nim',
		model: 'nvidia/nemotron-3.5-embed-8b',
		dim: 2048,
		// Send `dimensions`: the API truncates and renormalizes server-side
		// (verified equal to client-side truncation, cosine 1.000000).
		matryoshka: true,
		free: true,
		configured: () => !!process.env.NVIDIA_API_KEY,
	}),
	[NIM_EMBED_TAG_PREVIOUS]: Object.freeze({
		tag: NIM_EMBED_TAG_PREVIOUS,
		provider: 'nim',
		model: 'nvidia/nemotron-3-embed-1b',
		dim: 2048,
		free: true,
		configured: () => !!process.env.NVIDIA_API_KEY,
	}),
	// Resolvable for the rows that carry it, never selected for new work.
	[NIM_EMBED_TAG_RETIRED]: Object.freeze({
		tag: NIM_EMBED_TAG_RETIRED,
		provider: 'nim',
		model: 'nvidia/nv-embedqa-e5-v5',
		dim: 1024,
		free: true,
		// The upstream model is gone, so this can never be re-embedded against.
		// Reporting it unconfigured keeps it out of every automatic selection
		// path while leaving its dimension readable for existing rows.
		configured: () => false,
	}),
	[VERTEX_EMBED_TAG]: Object.freeze({
		tag: VERTEX_EMBED_TAG,
		provider: 'vertex',
		model: 'text-embedding-005',
		dim: 768,
		// Not vendor-free like NIM, but billed to the platform's GCP credit pool
		// rather than a metered API key — no quota to exhaust, same reasoning
		// api/_lib/llm.js's vertexGeminiProvider() documents for the LLM chain.
		free: false,
		configured: () => !!process.env.GOOGLE_CLOUD_PROJECT,
	}),
	[OPENAI_EMBED_TAG]: Object.freeze({
		tag: OPENAI_EMBED_TAG,
		provider: 'openai',
		model: 'text-embedding-3-small',
		dim: 256,
		free: false,
		configured: () => !!process.env.OPENAI_API_KEY,
	}),
});

// Free lanes first (the new NIM model, then the one it replaced), then the
// credit-funded Vertex lane (no vendor quota to exhaust), OpenAI as the true
// last-resort paid backstop.
const INGEST_PREFERENCE = Object.freeze([NIM_EMBED_TAG, NIM_EMBED_TAG_PREVIOUS, VERTEX_EMBED_TAG, OPENAI_EMBED_TAG]);

/** True when at least one embedding provider can actually serve. */
export function embeddingsConfigured() {
	return INGEST_PREFERENCE.some((tag) => EMBEDDERS[tag].configured());
}

/**
 * The embedder tag new document sets should be ingested with: free NIM when
 * the key is present, then Vertex, then OpenAI, null when nothing is configured.
 */
export function defaultIngestEmbedderTag() {
	for (const tag of INGEST_PREFERENCE) {
		if (EMBEDDERS[tag].configured()) return tag;
	}
	return null;
}

/**
 * Normalize a stored embedder tag (null/'' = legacy OpenAI) to a known tag,
 * or null when the tag names an embedder this build doesn't know — an unknown
 * space can never be queried, only re-embedded.
 */
export function resolveEmbedderTag(storedTag) {
	const tag = storedTag || LEGACY_EMBED_TAG;
	return EMBEDDERS[tag] ? tag : null;
}

/** Embedder metadata ({tag, provider, model, dim, free}) or null if unknown. */
export function embedderInfo(storedTag) {
	const tag = resolveEmbedderTag(storedTag);
	return tag ? EMBEDDERS[tag] : null;
}

/** True when the provider behind `storedTag`'s space can serve right now. */
export function embedderConfigured(storedTag) {
	const tag = resolveEmbedderTag(storedTag);
	return !!tag && EMBEDDERS[tag].configured();
}

/**
 * Embed `texts` in the vector space named by `tag`.
 * `inputType` is 'passage' for corpus chunks at ingest and 'query' for search
 * strings — NIM's retrieval models are asymmetric and REQUIRE the distinction;
 * the OpenAI lane ignores it. Returns Float64Array[] aligned with `texts`.
 * Throws { code: 'unknown_embedder' | 'no_embedder' | 'embedder_error' }.
 */
export async function embedWith(tag, texts, inputType) {
	const embedder = EMBEDDERS[resolveEmbedderTag(tag) || ''];
	if (!embedder) {
		throw Object.assign(new Error(`unknown embedder tag: ${tag}`), {
			code: 'unknown_embedder',
		});
	}
	if (!embedder.configured()) {
		throw Object.assign(new Error(`${embedder.provider} embedder not configured (${embedder.tag})`), {
			code: 'no_embedder',
		});
	}
	if (inputType !== 'passage' && inputType !== 'query') {
		throw Object.assign(new Error(`inputType must be 'passage' or 'query', got: ${inputType}`), {
			code: 'embedder_error',
		});
	}
	if (!texts.length) return [];

	if (embedder.provider === 'nim') return embedNim(embedder, texts, inputType);
	if (embedder.provider === 'vertex') return embedVertex(embedder, texts, inputType);
	return embedOpenAi(embedder, texts);
}

/** Convenience: embed corpus chunks at ingest time. */
export function embedPassages(tag, texts) {
	return embedWith(tag, texts, 'passage');
}

// ── Ingest-time provider walk ───────────────────────────────────────────────
//
// embedWith is deliberately strict: a stored vector space has ONE embedder, and
// the lanes have different dimensions (NIM 2048, Vertex 768, OpenAI 256, plus
// the retired NIM space at 1024), so answering a query against an existing
// space with another lane's
// vectors would compare points in unrelated geometries. Nothing here weakens
// that, and this must never be used to query an existing space.
//
// What was missing is the case where no space is fixed yet. At INGEST the caller
// is free to choose any lane, but defaultIngestEmbedderTag() picked the first
// CONFIGURED one and embedWith threw when that provider was down, so a single
// NIM 429 failed the whole embed with Vertex and OpenAI configured and idle
// (the /api/watsonx/embed 502s of 2026-08-27). This walks the preference order
// instead and returns the tag that actually answered, so the caller records the
// space it really got rather than the one it asked for.
const EMBED_LANE_COOLDOWN_SECONDS = 45;
const embedLaneKey = (tag) => `embed:${tag}`;

/**
 * Embed `texts` as passages with the first lane that answers, preferring
 * `preferredTag` and then the standard free-first order.
 *
 * @param {string|null} preferredTag  tried first when configured
 * @param {string[]} texts
 * @returns {Promise<{ tag: string, info: object, vectors: Float64Array[] }>}
 * @throws the last lane's error, or { code: 'no_embedder' } when none is configured
 */
export async function embedPassagesAny(preferredTag, texts) {
	return walkLanes(laneOrder(preferredTag), texts);
}

function laneOrder(preferredTag, exclude = null) {
	const resolved = resolveEmbedderTag(preferredTag);
	return [
		...(resolved && EMBEDDERS[resolved].configured() ? [resolved] : []),
		...INGEST_PREFERENCE.filter((t) => t !== resolved && EMBEDDERS[t].configured()),
	].filter((t) => t !== exclude);
}

async function walkLanes(order, texts) {
	if (!order.length) {
		throw Object.assign(new Error('no embedding provider is configured'), { code: 'no_embedder' });
	}
	if (!texts.length) return { tag: order[0], info: EMBEDDERS[order[0]], vectors: [] };

	// A lane a recent request found throttled goes to the back rather than being
	// dropped, so a chain whose lanes are all cooling still answers.
	let lanes = order;
	if (order.length > 1) {
		const cooling = await providersInCooldown(order.map(embedLaneKey));
		if (cooling.size) {
			const hot = order.filter((t) => !cooling.has(embedLaneKey(t)));
			if (hot.length) lanes = [...hot, ...order.filter((t) => cooling.has(embedLaneKey(t)))];
		}
	}

	let lastErr;
	for (const tag of lanes) {
		try {
			const vectors = await embedWith(tag, texts, 'passage');
			void clearProviderCooldown(embedLaneKey(tag));
			return { tag, info: EMBEDDERS[tag], vectors };
		} catch (err) {
			// A misconfigured or unknown lane is not a health signal, it simply
			// cannot serve, and a content refusal is about the input, not the lane;
			// only a real upstream failure earns a cooldown.
			if (err?.code !== 'no_embedder' && err?.code !== 'unknown_embedder' && err?.code !== 'content_refused') {
				const authFault = err?.status === 401 || err?.status === 403 || err?.status === 402;
				void markProviderCooldown(
					embedLaneKey(tag),
					authFault ? AUTH_COOLDOWN_SECONDS : EMBED_LANE_COOLDOWN_SECONDS,
					authFault ? 'auth' : 'health',
				);
			}
			lastErr = err;
		}
	}
	throw lastErr || Object.assign(new Error('every embedding lane failed'), { code: 'embedder_error' });
}

/**
 * Embed `texts` as passages, one vector space per text. Every text the
 * preferred lane accepts lands in that space; a text its content screen
 * refuses (code `content_refused`) is isolated by bisection and embedded by the
 * next lane that answers, so one refused input never fails or demotes the rest.
 * Any other failure of the preferred lane walks the lanes for the whole batch,
 * exactly like embedPassagesAny, unless `strict` is set: then it throws, so a
 * migration can back off and retry instead of writing a whole batch into the
 * fallback space because of one 429. Callers store each result's tag next to
 * its vector.
 *
 * @param {string|null} preferredTag
 * @param {string[]} texts
 * @param {{ strict?: boolean }} [opts]
 * @returns {Promise<Array<{ tag: string, vector: Float64Array }>>} aligned with `texts`
 */
export async function embedPassagesEach(preferredTag, texts, { strict = false } = {}) {
	if (!texts.length) return [];
	const order = laneOrder(preferredTag);
	if (!order.length) {
		throw Object.assign(new Error('no embedding provider is configured'), { code: 'no_embedder' });
	}
	const first = order[0];
	const isolate = async (slice) => {
		try {
			const vectors = await embedWith(first, slice, 'passage');
			return vectors.map((vector) => ({ tag: first, vector }));
		} catch (err) {
			if (err?.code !== 'content_refused') throw err;
			if (slice.length === 1) {
				const { tag, vectors } = await walkLanes(laneOrder(first, first), slice);
				return [{ tag, vector: vectors[0] }];
			}
			const mid = Math.ceil(slice.length / 2);
			return [...(await isolate(slice.slice(0, mid))), ...(await isolate(slice.slice(mid)))];
		}
	};
	try {
		return await isolate(texts);
	} catch (err) {
		if (strict || err?.code === 'no_embedder') throw err;
		const { tag, vectors } = await walkLanes(order, texts);
		return vectors.map((vector) => ({ tag, vector }));
	}
}

/** Convenience: embed one search string; resolves to a single Float64Array. */
export async function embedQuery(tag, text) {
	const [vec] = await embedWith(tag, [text], 'query');
	return vec;
}

async function embedNim(embedder, texts, inputType, { truncated = false } = {}) {
	const upstream = await fetch(NIM_EMBED_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: embedder.model,
			input: texts,
			input_type: inputType,
			...(embedder.matryoshka ? { dimensions: embedder.dim } : {}),
		}),
		signal: AbortSignal.timeout(30_000),
	});
	if (!upstream.ok) {
		const body = await upstream.text().catch(() => '');
		// The nemotron-3.5 models screen inputs and refuse a whole request with a
		// 422 when any input trips the filter. That is a verdict on the input,
		// not an outage: callers isolate it (embedPassagesEach) instead of
		// retrying or cooling the lane down.
		if (upstream.status === 422 && /content safety/i.test(body)) {
			throw Object.assign(new Error(`nim embedding refused by content safety screening (${embedder.tag})`), {
				code: 'content_refused',
				status: 422,
			});
		}
		// Over-length input: retry once with every input clamped to a budget that
		// cannot exceed the 512-token cap. Better to truncate one outlier chunk
		// than to fail a whole ingest batch.
		if (upstream.status === 400 && /maximum allowed token size/i.test(body) && !truncated) {
			return embedNim(embedder, texts.map((t) => t.slice(0, NIM_SAFE_CHARS)), inputType, {
				truncated: true,
			});
		}
		throw upstreamError('nim', upstream.status, body);
	}
	return parseEmbeddings(await upstream.json(), texts.length, 'nim');
}

// Vertex AI text-embedding-005 — service-account/metadata-server auth (same
// helper api/_lib/vertex-claude.js and api/_mcp3d/vertex-imagen.js already
// use), billed to the platform's GCP credit pool. Asymmetric like NIM: a
// document/passage and a query embed differently, so `task_type` carries the
// same distinction NIM's `input_type` does. Verified live 2026-07-16 (batch
// request, both task types, 768-dim output confirmed).
async function embedVertex(embedder, texts, inputType) {
	const project = process.env.GOOGLE_CLOUD_PROJECT;
	if (!project) {
		throw Object.assign(new Error('vertex embedder not configured (GOOGLE_CLOUD_PROJECT missing)'), {
			code: 'no_embedder',
		});
	}
	const { getGcpAccessToken } = await import('./gcp-auth.js');
	const token = await getGcpAccessToken();
	const taskType = inputType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
	const upstream = await fetch(vertexEmbedUrl(), {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify({
			instances: texts.map((content) => ({ content, task_type: taskType })),
			parameters: { outputDimensionality: embedder.dim },
		}),
		signal: AbortSignal.timeout(30_000),
	});
	if (!upstream.ok) {
		const body = await upstream.text().catch(() => '');
		throw upstreamError('vertex', upstream.status, body);
	}
	const data = await upstream.json();
	const rows = data?.predictions || [];
	if (rows.length !== texts.length || rows.some((r) => !Array.isArray(r?.embeddings?.values))) {
		throw Object.assign(new Error('vertex embedding response shape mismatch'), {
			code: 'embedder_error',
		});
	}
	return rows.map((row) => Float64Array.from(row.embeddings.values));
}

async function embedOpenAi(embedder, texts) {
	const upstream = await fetch(OPENAI_EMBED_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: embedder.model,
			input: texts,
			dimensions: embedder.dim,
		}),
		signal: AbortSignal.timeout(30_000),
	});
	if (!upstream.ok) {
		const body = await upstream.text().catch(() => '');
		throw upstreamError('openai', upstream.status, body);
	}
	return parseEmbeddings(await upstream.json(), texts.length, 'openai');
}

function parseEmbeddings(data, expected, provider) {
	const rows = (data?.data || []).sort((a, b) => a.index - b.index);
	if (rows.length !== expected || rows.some((r) => !Array.isArray(r.embedding))) {
		throw Object.assign(new Error(`${provider} embedding response shape mismatch`), {
			code: 'embedder_error',
		});
	}
	return rows.map((row) => Float64Array.from(row.embedding));
}

function upstreamError(provider, status, body) {
	return Object.assign(new Error(`${provider} embedding api ${status}: ${body.slice(0, 200)}`), {
		code: 'embedder_error',
		status,
	});
}

/**
 * Score stored vector rows against a search string without ever crossing
 * vector spaces. Rows are grouped by their `embedder` tag (untagged legacy
 * rows are OpenAI — LEGACY_EMBED_TAG), the query is embedded once per space
 * whose provider is configured, and cosine runs strictly within each space.
 * The tag, not the vector length, decides the space: the current NIM model and
 * the one it replaced are both 2048-dim. Rows in a space no configured
 * provider can serve, and rows whose vector length contradicts their tag, are
 * counted in `needsReembed`, reported and never silently compared.
 *
 * @param {Array<{embedder?: string|null, embedding: number[]|{values:number[]}}>} rows
 * @param {string} query
 * @returns {Promise<{scored: Array<object & {embedder: string, score: number}>,
 *                    needsReembed: Array<{embedder: string, chunks: number, reason?: string}>}>}
 */
export async function scoreRowsBySpace(rows, query) {
	const bySpace = new Map();
	for (const r of rows) {
		const tag = r.embedder || LEGACY_EMBED_TAG;
		if (!bySpace.has(tag)) bySpace.set(tag, []);
		bySpace.get(tag).push(r);
	}

	const scored = [];
	const needsReembed = [];
	for (const [tag, group] of bySpace) {
		if (!embedderConfigured(tag)) {
			needsReembed.push({ embedder: tag, chunks: group.length });
			continue;
		}
		const { dim } = EMBEDDERS[resolveEmbedderTag(tag)];
		const vectorOf = (r) => (Array.isArray(r.embedding) ? r.embedding : r.embedding?.values || []);
		const fit = group.filter((r) => vectorOf(r).length === dim);
		if (fit.length < group.length) {
			needsReembed.push({ embedder: tag, chunks: group.length - fit.length, reason: 'dimension_mismatch' });
		}
		if (!fit.length) continue;
		const queryEmbedding = await embedQuery(tag, query);
		for (const r of fit) {
			scored.push({ ...r, embedder: tag, score: cosine(queryEmbedding, vectorOf(r)) });
		}
	}
	return { scored, needsReembed };
}

/**
 * Cosine between two tagged vectors, refusing outright when the tags name
 * different spaces. Use this wherever both sides carry a tag; it is the
 * only cosine that can catch two same-length vectors from different models.
 *
 * @param {{ tag: string|null, vector: ArrayLike<number> }} a
 * @param {{ tag: string|null, vector: ArrayLike<number> }} b
 */
export function cosineInSpace(a, b) {
	const ta = a.tag || LEGACY_EMBED_TAG;
	const tb = b.tag || LEGACY_EMBED_TAG;
	if (ta !== tb) {
		throw Object.assign(new Error(`refusing to compare vectors from different vector spaces: ${ta} vs ${tb}`), {
			code: 'space_mismatch',
		});
	}
	return cosine(a.vector, b.vector);
}

/**
 * Cosine similarity between two equal-length numeric arrays. Inputs come from
 * embedWith() (Float64Array) or from the DB (plain Array via JSONB) — both
 * work. Mismatched lengths score 0: vectors of different dimensionality are
 * by definition different spaces, and comparing a shared prefix would be
 * exactly the silent cross-space garbage this module is built to prevent.
 */
export function cosine(a, b) {
	if (!a || !b || a.length !== b.length) return 0;
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	if (!na || !nb) return 0;
	return dot / Math.sqrt(na * nb);
}
