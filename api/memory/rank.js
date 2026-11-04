/**
 * Memory semantic rank
 * --------------------
 * POST /api/memory/rank { query, items: [{ id, text }] }  ->  { results: [{ id, score }], embedder }
 *
 * Ranks caller-supplied memory text against a query by embedding cosine. This is
 * what gives the browser file-layer `Memory.recall()` real semantic recall: the
 * client sends each memory file's description plus a truncated body, and keeps its
 * own substring matcher as the fallback when this endpoint is unavailable.
 *
 * Nothing is stored. Memory text is user data, so a signed-in session or a bearer
 * token is required. Embeddings are cached per instance (bounded LRU) keyed by the
 * sha256 of the text plus the embedder tag, so an unchanged memory file is embedded
 * once, not on every chat turn.
 */

import { createHash } from 'node:crypto';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import {
	embeddingsConfigured,
	defaultIngestEmbedderTag,
	embedPassagesAny,
	embedQuery,
	cosine,
} from '../_lib/embeddings.js';

export const MAX_ITEMS = 64;
export const MAX_TEXT_CHARS = 4000;
const MAX_QUERY_CHARS = 1000;
const CACHE_LIMIT = 512;

/** Insertion-ordered Map used as an LRU: a hit is re-inserted to mark it fresh. */
const vectorCache = new Map();

function cacheKey(tag, text) {
	return `${tag}:${createHash('sha256').update(text).digest('hex')}`;
}

function cacheGet(key) {
	const v = vectorCache.get(key);
	if (v === undefined) return undefined;
	vectorCache.delete(key);
	vectorCache.set(key, v);
	return v;
}

function cacheSet(key, vec) {
	vectorCache.set(key, vec);
	while (vectorCache.size > CACHE_LIMIT) vectorCache.delete(vectorCache.keys().next().value);
}

/** Test hook: drop every cached vector. */
export function clearRankCache() {
	vectorCache.clear();
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

/** Vectors for `texts` under one embedder; returns { tag, vectors } aligned to `texts`. */
async function passageVectors(texts) {
	const preferred = defaultIngestEmbedderTag();
	const vectors = new Array(texts.length);
	const missIdx = [];
	texts.forEach((t, i) => {
		const hit = preferred ? cacheGet(cacheKey(preferred, t)) : undefined;
		if (hit) vectors[i] = hit;
		else missIdx.push(i);
	});
	if (!missIdx.length) return { tag: preferred, vectors };

	const out = await embedPassagesAny(preferred, missIdx.map((i) => texts[i]));
	if (out.tag !== preferred) {
		// A fallback lane answered, so cached vectors live in a different space.
		const all = await embedPassagesAny(out.tag, texts);
		all.vectors.forEach((v, i) => cacheSet(cacheKey(all.tag, texts[i]), v));
		return { tag: all.tag, vectors: all.vectors };
	}
	missIdx.forEach((idx, k) => {
		vectors[idx] = out.vectors[k];
		cacheSet(cacheKey(out.tag, texts[idx]), out.vectors[k]);
	});
	return { tag: out.tag, vectors };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	if (!(await requireCsrf(req, res, auth.userId))) return;

	const rl = await limits.memoryRankUser(auth.userId || clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many rank requests, slow down');

	const body = await readJson(req);
	const query = typeof body.query === 'string' ? body.query.trim() : '';
	if (!query) return error(res, 400, 'validation_error', 'query required');
	if (query.length > MAX_QUERY_CHARS) {
		return error(res, 400, 'validation_error', `query must be at most ${MAX_QUERY_CHARS} characters`);
	}
	const items = body.items;
	if (!Array.isArray(items) || !items.length) {
		return error(res, 400, 'validation_error', 'items must be a non-empty array');
	}
	if (items.length > MAX_ITEMS) {
		return error(res, 400, 'validation_error', `items is capped at ${MAX_ITEMS}`);
	}
	const ids = new Set();
	for (const it of items) {
		if (!it || typeof it.id !== 'string' || !it.id || typeof it.text !== 'string' || !it.text.trim()) {
			return error(res, 400, 'validation_error', 'each item needs a string id and non-empty text');
		}
		if (it.text.length > MAX_TEXT_CHARS) {
			return error(res, 400, 'validation_error', `item text must be at most ${MAX_TEXT_CHARS} characters`);
		}
		if (ids.has(it.id)) return error(res, 400, 'validation_error', `duplicate item id: ${it.id}`);
		ids.add(it.id);
	}

	if (!embeddingsConfigured()) {
		return error(res, 503, 'embeddings_unconfigured', 'no embedding provider is configured');
	}

	let tag;
	let vectors;
	let qvec;
	try {
		({ tag, vectors } = await passageVectors(items.map((i) => i.text)));
		qvec = await embedQuery(tag, query);
	} catch (err) {
		return error(res, 503, 'embedder_unavailable', err?.message || 'embedding provider failed');
	}

	const results = items
		.map((it, i) => ({ id: it.id, score: Number(cosine(qvec, vectors[i]).toFixed(6)) }))
		.sort((a, b) => b.score - a.score);
	return json(res, 200, { results, embedder: tag });
});
