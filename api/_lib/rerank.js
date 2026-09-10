// Post-retrieval reranking via NVIDIA NIM's free rerank-qa-mistral-4b.
//
// Cosine-over-embeddings recall is cheap but coarse; a cross-encoder reranker
// reads the query and each candidate passage together and produces a much
// sharper relevance ordering for the handful of chunks that actually get
// injected into the prompt. Wired as an OPTIONAL stage behind
// KNOWLEDGE_RERANK_ENABLED=1 (plus the NVIDIA key) so retrieval behavior only
// changes when explicitly opted in, and strictly fail-open: any rerank error
// keeps the cosine ordering — reranking may never break retrieval.
//
// Endpoint (probed live, tasks/nvidia-nim/probes/embeddings.md): NOT
// OpenAI-shaped — query/passages in, `rankings: [{index, logit}]` out,
// sorted best-first, `index` pointing back into the input passage array.

// KNOWN DEAD as of 2026-09-10, and deliberately left pinned. This model is no
// longer served on our NIM account (404 Not Found for the account, and no
// reranking model on GET /v1/models answered on this endpoint), so the stage
// cannot currently run. That is harmless rather than an outage for two reasons
// and both are load-bearing: the stage is opt-in behind KNOWLEDGE_RERANK_ENABLED,
// which is NOT set on the production service, and rerank() fails open by
// contract, returning null so callers keep their existing cosine order. Pinning
// a model that has been verified dead beats swapping in a guess that has not
// been verified alive. Before enabling the stage, probe a replacement against
// this endpoint and re-pin here.
const RERANK_URL = 'https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking';
const RERANK_MODEL = 'nvidia/rerank-qa-mistral-4b';

/** True when the rerank stage is opted in AND the free NIM key can serve it. */
export function rerankConfigured() {
	return process.env.KNOWLEDGE_RERANK_ENABLED === '1' && !!process.env.NVIDIA_API_KEY;
}

/**
 * Rerank candidate passages against a query. Returns the candidate indexes
 * best-first (e.g. [2, 0, 1]), or null on ANY failure so callers keep their
 * existing cosine order (fail-open by contract).
 *
 * @param {string} query
 * @param {string[]} passages
 */
export async function rerankPassages(query, passages, { timeoutMs = 8_000 } = {}) {
	if (!rerankConfigured() || !query || passages.length < 2) return null;
	try {
		const upstream = await fetch(RERANK_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: RERANK_MODEL,
				query: { text: query },
				passages: passages.map((text) => ({ text })),
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!upstream.ok) {
			console.warn('[rerank] upstream', upstream.status);
			return null;
		}
		const data = await upstream.json();
		const rankings = Array.isArray(data?.rankings) ? data.rankings : null;
		if (!rankings) return null;
		const order = rankings
			.map((r) => r.index)
			.filter((i) => Number.isInteger(i) && i >= 0 && i < passages.length);
		// A partial/garbled ranking is worse than no ranking — require a full
		// permutation of the candidates before trusting it.
		return new Set(order).size === passages.length ? order : null;
	} catch (err) {
		console.warn('[rerank] failed', err?.message);
		return null;
	}
}
