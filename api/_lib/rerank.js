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
export const RERANK_HEDGE_AFTER_MS = 1_000;
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
 * True when the rerank stage should run: KNOWLEDGE_RERANK_ENABLED=1 and the
 * NVIDIA key. Opt-in by the 2026-11-16 eval rule (docs/nvidia/evals/
 * rerank-2026-11-16.md): enable by default only when the served nDCG@5 gain at
 * RERANK_TIMEOUT_MS is at least +0.05 AND the added p95 over all calls is at
 * most 1500ms. The model itself is excellent (nDCG@5 1.000 vs 0.860 cosine
 * when it answers) but hosted queue latency fails both halves: at 2500ms only
 * 21 of 96 calls answered (served gain +0.029, added p95 2504ms), and with no
 * practical timeout the added p95 was 5199ms. Re-run the eval before flipping.
 */
export function rerankConfigured() {
	return process.env.KNOWLEDGE_RERANK_ENABLED === '1' && !!process.env.NVIDIA_API_KEY;
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
 * One POST to the reranker. Resolves with the status and the parsed body (the
 * body is always consumed, so aborting a losing hedge leaks nothing); rejects
 * only on a network error or abort.
 * @returns {Promise<{ status: number, ok: boolean, data: any, text: string }>}
 */
async function postRerank(model, query, texts, signal) {
	const res = await fetch(rerankUrl(model), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ model, query: { text: query }, passages: texts.map((text) => ({ text })) }),
		signal,
	});
	const text = await res.text();
	let data = null;
	try {
		data = JSON.parse(text);
	} catch {
		/* non-JSON body: handled as a malformed answer by the caller */
	}
	return { status: res.status, ok: res.ok, data, text };
}

// A 4xx other than 429 is the same on a retry, so it settles the race; a 5xx,
// a 429 or a network error lets the other request (or a retry) decide.
const decisive = (res) => res.ok || (res.status < 500 && res.status !== 429);

/**
 * Hedged request: start one call, start a second if the first has not
 * answered within `hedgeAfterMs` (or as soon as it fails non-decisively), and
 * resolve with the first decisive answer. At most two calls; the loser is
 * aborted. Hosted reranker latency is queue-dominated (the same 29-token call
 * measured 0.5s, 2.6s and 4.6s back to back), so a second draw cuts the tail.
 */
function hedged(run, { hedgeAfterMs, signal, trace }) {
	return new Promise((resolve, reject) => {
		const controllers = [];
		let done = false;
		let inFlight = 0;
		let fallback = null;
		let timer = null;
		const finish = (settle, value) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			for (const c of controllers) c.abort();
			settle(value);
		};
		const launch = () => {
			if (done || controllers.length >= 2) return;
			if (controllers.length === 1) trace.hedged = true;
			const own = new AbortController();
			controllers.push(own);
			inFlight++;
			run(AbortSignal.any([signal, own.signal])).then(
				(res) => {
					inFlight--;
					if (decisive(res)) return finish(resolve, res);
					fallback = { res };
					if (controllers.length < 2) return launch();
					if (!inFlight) finish(resolve, res);
				},
				(err) => {
					inFlight--;
					if (signal.aborted) return finish(reject, signal.reason ?? err);
					fallback ??= { err };
					if (controllers.length < 2) return launch();
					if (!inFlight) fallback.res ? finish(resolve, fallback.res) : finish(reject, fallback.err);
				},
			);
		};
		launch();
		if (hedgeAfterMs > 0) timer = setTimeout(launch, hedgeAfterMs);
	});
}

/** A full permutation of 0..n-1 from a rankings array, or null. */
function permutationFrom(rankings, n) {
	if (!Array.isArray(rankings)) return null;
	const order = rankings.map((r) => r?.index).filter((i) => Number.isInteger(i) && i >= 0 && i < n);
	// A partial or garbled ranking is worse than no ranking.
	return order.length === n && new Set(order).size === n ? order : null;
}

const isSafetyRejection = (res) => res.status === 422 && /safety/i.test(res.text);

/**
 * Score every passage on its own (in parallel) after the batch was rejected by
 * the content-safety screen. Pair logits do not depend on the batch, so the
 * scored passages are reordered by logit exactly as the batch would have; each
 * passage the screen rejects keeps its cosine slot, so the reranker neither
 * promotes nor buries what it could not read. Null when nothing scored (the
 * query itself was rejected).
 */
async function rerankBySingles(model, query, passages, signal, trace) {
	const logits = await Promise.all(
		passages.map((text) =>
			postRerank(model, query, [text], signal).then(
				(res) => (res.ok && Number.isFinite(res.data?.rankings?.[0]?.logit) ? res.data.rankings[0].logit : null),
				() => null,
			),
		),
	);
	const scored = logits.map((logit, i) => ({ i, logit })).filter((s) => s.logit !== null);
	trace.flagged = passages.length - scored.length;
	if (!scored.length || signal.aborted) return null;
	scored.sort((a, b) => b.logit - a.logit);
	let next = 0;
	return logits.map((logit, slot) => (logit === null ? slot : scored[next++].i));
}

/**
 * Rerank candidate passages against a query. Returns the candidate indexes
 * best-first (e.g. [2, 0, 1]), or null on ANY failure so callers keep their
 * existing cosine order (fail-open by contract). `timeoutMs` bounds the whole
 * operation, hedge and safety fallback included.
 *
 * @param {string} query
 * @param {string[]} passages
 * @param {{ timeoutMs?: number, hedgeAfterMs?: number, trace?: object }} [opts]
 *   trace, when given, is filled with { path, hedged, flagged } for evals.
 * @returns {Promise<number[]|null>}
 */
export async function rerankPassages(
	query,
	passages,
	{ timeoutMs = RERANK_TIMEOUT_MS, hedgeAfterMs = RERANK_HEDGE_AFTER_MS, trace = {} } = {},
) {
	if (!rerankConfigured() || !query || !Array.isArray(passages) || passages.length < 2) return null;
	const model = rerankModel();
	if (await rerankRetired(model)) return null;
	const signal = AbortSignal.timeout(timeoutMs);
	trace.path = 'batch';
	trace.hedged = false;
	try {
		const res = await hedged((s) => postRerank(model, query, passages, s), { hedgeAfterMs, signal, trace });
		if (res.ok) return permutationFrom(res.data?.rankings, passages.length);
		if (RETIREMENT_STATUSES.has(res.status)) {
			await markRetired(model, res.status, res.text);
			return null;
		}
		if (isSafetyRejection(res)) {
			trace.path = 'split';
			return await rerankBySingles(model, query, passages, signal, trace);
		}
		console.warn('[rerank] upstream', res.status, res.text.slice(0, 160));
		return null;
	} catch (err) {
		console.warn('[rerank] failed', err?.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : err?.message);
		return null;
	}
}

/** Test hook: forget every process-local retirement flag. */
export function resetRerankState() {
	retiredUntil.clear();
}
