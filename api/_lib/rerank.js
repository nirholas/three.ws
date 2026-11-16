// Post-retrieval reranking via an NVIDIA hosted cross-encoder reranker.
//
// Cosine-over-embeddings recall is cheap but coarse; a cross-encoder reranker
// reads the query and each candidate passage together and produces a sharper
// relevance ordering for the handful of chunks that actually get injected into
// the prompt. Strictly fail-open: any rerank error, timeout or malformed
// answer keeps the cosine ordering, so reranking may never break retrieval.
//
// Endpoint shape (not OpenAI-shaped): query/passages in,
// `rankings: [{index, logit}]` out, sorted best-first, `index` pointing back
// into the input passage array. Every hosted reranker has its OWN URL,
// /v1/retrieval/<publisher>/<model>/reranking, and the `model` field must name
// that same model. There is no model-agnostic reranking URL.
//
// Pinned model, probed live 2026-11-16 with our NVIDIA_API_KEY (full probe
// table: docs/nvidia/evals/rerank-2026-11-16.md):
//   nvidia/nemotron-3.5-rerank-8b                 200 {rankings, usage}, 4.7s cold
//   nvidia/llama-nemotron-rerank-vl-1b-v2         410 Gone, end of life 2026-11-16
//   nvidia/llama-nemotron-rerank-1b-v2            410 Gone, end of life 2026-08-25
//   nvidia/llama-3.2-nv-rerankqa-1b-v2            410 Gone, end of life 2026-05-18
//   nvidia/llama-3.2-nemoretriever-500m-rerank-v2 410 Gone, end of life 2026-05-18
//   nvidia/rerank-qa-mistral-4b (old pin)         404 function not found for account
//   nvidia/nv-rerankqa-mistral-4b-v3              404 function not found for account
// The URL path keeps the dot in "3.5" (the underscored slug 404s).
//
// Retirement guard. NVIDIA retires hosted rerankers on a schedule (four end of
// life dates above in six months) and GET /v1/models never lists rerankers, so
// a retirement arrives silently as 404/410 on every call. On either status the
// stage disables itself for RETIRED_COOLDOWN_S in this process AND in the
// shared cache, records the event once (cacheSetIfAbsent claims it across
// instances) and pages ops through sendOpsAlert. Until the cool-down lapses
// every request skips the network call entirely, so a retired model costs zero
// latency. Re-pin by setting KNOWLEDGE_RERANK_MODEL (config-only update) to a
// model a fresh probe shows alive, or by editing DEFAULT_RERANK_MODEL.

import { cacheGet, cacheSetIfAbsent } from './cache.js';
import { sendOpsAlert } from './alerts.js';

export const DEFAULT_RERANK_MODEL = 'nvidia/nemotron-3.5-rerank-8b';
export const RERANK_TIMEOUT_MS = 2_500;
export const RETIRED_COOLDOWN_S = 6 * 60 * 60;
const RETIREMENT_STATUSES = new Set([404, 410]);

// Process-local mirror of the shared retirement flag, so the hot path never
// waits on the cache once this instance has seen (or been told about) a
// retirement. Keyed by model so a re-pin takes effect immediately.
const retiredUntil = new Map();

/** The reranker model in force: KNOWLEDGE_RERANK_MODEL override, else the pin. */
export function rerankModel() {
	return (process.env.KNOWLEDGE_RERANK_MODEL || '').trim() || DEFAULT_RERANK_MODEL;
}

/** The per-model hosted reranking URL. */
export function rerankUrl(model = rerankModel()) {
	return `https://ai.api.nvidia.com/v1/retrieval/${model}/reranking`;
}

const retiredKey = (model) => `rerank:retired:${model}`;

/**
 * True when the rerank stage should run: the NVIDIA key is present and the
 * stage is not switched off. On by default since the 2026-11-16 eval cleared
 * its gain threshold inside the latency budget (docs/nvidia/evals/
 * rerank-2026-11-16.md); KNOWLEDGE_RERANK_ENABLED=0 turns it off.
 */
export function rerankConfigured() {
	return process.env.KNOWLEDGE_RERANK_ENABLED !== '0' && !!process.env.NVIDIA_API_KEY;
}

/** Whether `model` is inside a retirement cool-down (local or shared). */
export async function rerankRetired(model = rerankModel(), now = Date.now()) {
	const local = retiredUntil.get(model);
	if (local && local > now) return true;
	if (local) retiredUntil.delete(model);
	try {
		const shared = await cacheGet(retiredKey(model));
		if (shared && Number(shared.until) > now) {
			retiredUntil.set(model, Number(shared.until));
			return true;
		}
	} catch {
		/* cache trouble never blocks retrieval */
	}
	return false;
}

async function markRetired(model, status, detail, now = Date.now()) {
	const until = now + RETIRED_COOLDOWN_S * 1000;
	retiredUntil.set(model, until);
	let first = true;
	try {
		first = await cacheSetIfAbsent(
			retiredKey(model),
			{ until, status, at: new Date(now).toISOString() },
			RETIRED_COOLDOWN_S,
		);
	} catch {
		/* the local flag already protects this instance */
	}
	if (!first) return;
	console.warn(`[rerank] ${model} answered ${status}; rerank stage disabled for ${RETIRED_COOLDOWN_S}s`);
	void sendOpsAlert(
		`⚠️ NVIDIA reranker ${model} answered ${status}: knowledge rerank paused`,
		`${detail ? `${detail.slice(0, 300)}\n` : ''}Retrieval keeps its cosine order (fail-open). The stage retries after ${RETIRED_COOLDOWN_S / 3600}h. ` +
			'Probe a replacement (docs/nvidia-models.md#reranking) and re-pin with KNOWLEDGE_RERANK_MODEL.',
		{ signature: `rerank:model-retired:${model}` },
	);
}

/**
 * Rerank candidate passages against a query. Returns the candidate indexes
 * best-first (e.g. [2, 0, 1]), or null on ANY failure so callers keep their
 * existing cosine order (fail-open by contract).
 *
 * @param {string} query
 * @param {string[]} passages
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<number[]|null>}
 */
export async function rerankPassages(query, passages, { timeoutMs = RERANK_TIMEOUT_MS } = {}) {
	if (!rerankConfigured() || !query || !Array.isArray(passages) || passages.length < 2) return null;
	const model = rerankModel();
	if (await rerankRetired(model)) return null;
	try {
		const upstream = await fetch(rerankUrl(model), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model,
				query: { text: query },
				passages: passages.map((text) => ({ text })),
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!upstream.ok) {
			if (RETIREMENT_STATUSES.has(upstream.status)) {
				const body = await upstream.text().catch(() => '');
				await markRetired(model, upstream.status, body);
			} else {
				console.warn('[rerank] upstream', upstream.status);
			}
			return null;
		}
		const data = await upstream.json();
		const rankings = Array.isArray(data?.rankings) ? data.rankings : null;
		if (!rankings) return null;
		const order = rankings
			.map((r) => r.index)
			.filter((i) => Number.isInteger(i) && i >= 0 && i < passages.length);
		// A partial or garbled ranking is worse than no ranking: require a full
		// permutation of the candidates before trusting it.
		return new Set(order).size === passages.length && order.length === passages.length ? order : null;
	} catch (err) {
		console.warn('[rerank] failed', err?.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : err?.message);
		return null;
	}
}

/** Test hook: forget every process-local retirement flag. */
export function resetRerankState() {
	retiredUntil.clear();
}
