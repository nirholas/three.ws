// @ts-check
// NVIDIA NIM transport and lane classifier for the day-0 release pipeline.
//
// When /api/cron/free-model-audit sees a model id appear in the NIM catalog it
// enqueues an evaluation (api/_lib/nim-release-store.js), and
// /api/cron/nim-release-eval works the queue. The first thing that job needs
// is the model's lane, and the catalog cannot say: GET /v1/models returns only
// `id` and `owned_by` for every entry (measured 2026-11-16 on the live account),
// and names lie (riva-translate-4b-instruct answers chat, nano-omni answers
// images, content-safety models answer chat with a JSON verdict). So the lane
// comes from what the model actually does when called:
//
//   1. /v1/embeddings answers with a numeric vector        -> embeddings
//   2. /v1/chat/completions answers, and the reply is a
//      safety verdict (publish-safety.js parseVerdict)      -> safety
//   3. the same chat call with a rendered image answers
//      and names the colour in it                          -> vision
//   4. chat answers                                         -> chat
//   5. the retrieval host's /reranking answers rankings     -> rerank
//
// Anything else is not evaluable over HTTP. Riva speech (TTS/ASR) runs as NVCF
// gRPC functions selected by function id, which never appear in this catalog,
// so the speech lane is out of reach of this classifier by construction; such a
// model comes back `lane: null` with the probe statuses as the reason.
//
// Availability is read from the same probes: a 410 is a retired model, a 404
// naming a function "not found for account" is listed but not callable on our
// key (nemotron-3.5-content-safety on 2026-11-16), and a timeout or 5xx is a
// transient fault the job retries rather than a verdict.

import { parseVerdict } from './publish-safety.js';
// The production reranker's own URL builder, so a probe addresses a candidate
// exactly the way the lane would once it is pinned.
import { rerankUrl } from './rerank.js';

export const NIM_BASE = 'https://integrate.api.nvidia.com/v1';
export const LANE_IDS = Object.freeze(['chat', 'vision', 'embeddings', 'rerank', 'safety']);

const DEFAULT_TIMEOUT_MS = 45_000;
// Reasoning families (Nemotron 3.x) think out loud unless told not to; the
// production lanes send the same switch (api/_lib/llm.js NVIDIA_NO_THINK).
const NO_THINK = Object.freeze({ chat_template_kwargs: { enable_thinking: false } });

/**
 * @typedef {{ ok: boolean, status: number, ms: number, body: any, error: string|null }} NimCall
 */

/**
 * A NIM client bound to one key. Every call resolves (never throws) to a
 * NimCall so the eval can count failures instead of aborting on the first one.
 * @param {{ key: string, fetchImpl?: typeof fetch, timeoutMs?: number, retries?: number, retryDelayMs?: number }} opts
 */
export function nimClient({ key, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, retryDelayMs = 1500 }) {
	/**
	 * One call, retried `retries` times on a transient fault (timeout, 429,
	 * 5xx) so a single free-tier blip is not scored as a model failure. The
	 * returned `ms` is the latency of the attempt that produced the result.
	 * @param {string} url
	 * @param {object} body
	 * @returns {Promise<NimCall>}
	 */
	async function post(url, body) {
		let call = await attempt(url, body);
		for (let i = 0; i < retries && !call.ok && (call.status === 0 || call.status === 429 || call.status >= 500); i++) {
			await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (i + 1)));
			call = await attempt(url, body);
		}
		return call;
	}

	/**
	 * @param {string} url
	 * @param {object} body
	 * @returns {Promise<NimCall>}
	 */
	async function attempt(url, body) {
		const t0 = Date.now();
		try {
			const r = await fetchImpl(url, {
				method: 'POST',
				headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs),
			});
			const text = await r.text();
			let parsed = null;
			try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
			const ms = Date.now() - t0;
			if (!r.ok) {
				const detail = parsed?.detail || parsed?.message || parsed?.error?.message || parsed?.error || text;
				return { ok: false, status: r.status, ms, body: parsed, error: `HTTP ${r.status}: ${String(detail).slice(0, 240)}` };
			}
			return { ok: true, status: r.status, ms, body: parsed, error: null };
		} catch (err) {
			const e = /** @type {Error} */ (err);
			const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
			return { ok: false, status: 0, ms: Date.now() - t0, body: null, error: timeout ? `timeout after ${timeoutMs}ms` : String(e?.message || e) };
		}
	}

	return {
		/**
		 * @param {string} model
		 * @param {Array<{ role: string, content: any }>} messages
		 * @param {{ maxTokens?: number }} [opts]
		 */
		chat(model, messages, { maxTokens = 256 } = {}) {
			return post(`${NIM_BASE}/chat/completions`, { model, messages, max_tokens: maxTokens, temperature: 0, ...NO_THINK });
		},
		/**
		 * @param {string} model
		 * @param {string[]} input
		 * @param {'query'|'passage'} inputType
		 * @param {{ dimensions?: number }} [opts] Matryoshka truncation, as production sends it
		 */
		embed(model, input, inputType, { dimensions } = {}) {
			return post(`${NIM_BASE}/embeddings`, { model, input, input_type: inputType, encoding_format: 'float', truncate: 'END', ...(dimensions ? { dimensions } : {}) });
		},
		/**
		 * @param {string} model
		 * @param {string} query
		 * @param {string[]} passages
		 */
		rerank(model, query, passages) {
			return post(rerankUrl(model), { model, query: { text: query }, passages: passages.map((text) => ({ text })) });
		},
	};
}

/** @typedef {ReturnType<typeof nimClient>} NimClient */

/**
 * Assistant text from a chat completion, with any inline reasoning block
 * removed (some NIM models still emit <think>...</think> with thinking off).
 * @param {any} body
 */
export function chatText(body) {
	const raw = body?.choices?.[0]?.message?.content;
	const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((p) => p?.text || '').join('') : '';
	return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * The first embedding vector in an /embeddings response, or null when the
 * response is not a finite numeric vector.
 * @param {any} body
 * @returns {number[]|null}
 */
export function embeddingVector(body) {
	const v = body?.data?.[0]?.embedding;
	if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
	return v;
}

/**
 * Candidate indexes best-first from a /reranking response, or null when it is
 * not a full permutation of the `count` passages sent.
 * @param {any} body
 * @param {number} count
 * @returns {number[]|null}
 */
export function rerankOrder(body, count) {
	const rankings = Array.isArray(body?.rankings) ? body.rankings : null;
	if (!rankings) return null;
	const order = rankings.map((r) => r?.index).filter((i) => Number.isInteger(i) && i >= 0 && i < count);
	return order.length === count && new Set(order).size === count ? order : null;
}

// ---------------------------------------------------------------------------
// Synthetic eval images. Vision items and the vision probe draw an SVG and
// rasterise it with sharp, so no third-party image is ever sent and the ground
// truth is exact by construction. Digits are seven-segment bars, not text, so
// the rendering does not depend on which fonts the host has installed.

// Segment rectangles on a 60x100 cell: a top, b top-right, c bottom-right,
// d bottom, e bottom-left, f top-left, g middle.
const SEGMENTS = {
	a: [8, 0, 44, 10], b: [50, 6, 10, 42], c: [50, 52, 10, 42], d: [8, 90, 44, 10],
	e: [0, 52, 10, 42], f: [0, 6, 10, 42], g: [8, 45, 44, 10],
};
const DIGIT_SEGMENTS = {
	0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

/**
 * Seven-segment SVG body for a digit string, centred in a `size` square.
 * @param {string} value
 * @param {number} size
 */
export function sevenSegmentSvg(value, size) {
	const digits = String(value).split('').filter((c) => c in DIGIT_SEGMENTS);
	const scale = Math.min(1.6, (size * 0.8) / (digits.length * 80));
	const width = digits.length * 80 * scale;
	const x0 = (size - width) / 2;
	const y0 = (size - 100 * scale) / 2;
	return digits.map((d, i) => DIGIT_SEGMENTS[/** @type {keyof typeof DIGIT_SEGMENTS} */ (/** @type {unknown} */ (d))]
		.split('')
		.map((s) => {
			const [x, y, w, h] = SEGMENTS[/** @type {keyof typeof SEGMENTS} */ (s)];
			return `<rect x='${(x0 + (i * 80 + x) * scale).toFixed(1)}' y='${(y0 + y * scale).toFixed(1)}' width='${(w * scale).toFixed(1)}' height='${(h * scale).toFixed(1)}' fill='#111'/>`;
		})
		.join(''))
		.join('');
}

/**
 * Full SVG document for an eval image spec.
 * @param {{ render: { kind: 'svg', body: string } | { kind: 'digits', value: string }, background?: string }} item
 * @param {number} size
 */
export function evalImageSvg(item, size) {
	const body = item.render.kind === 'digits' ? sevenSegmentSvg(item.render.value, size) : item.render.body;
	const bg = item.background || '#ffffff';
	return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'><rect width='${size}' height='${size}' fill='${bg}'/>${body}</svg>`;
}

/**
 * PNG data URL for an eval image spec.
 * @param {Parameters<typeof evalImageSvg>[0]} item
 * @param {number} [size]
 */
export async function evalImageDataUrl(item, size = 384) {
	const { default: sharp } = await import('sharp');
	const png = await sharp(Buffer.from(evalImageSvg(item, size))).png().toBuffer();
	return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * OpenAI-style multimodal user turn: question text plus one image.
 * @param {string} question
 * @param {string} dataUrl
 */
export function imageTurn(question, dataUrl) {
	return [{ role: 'user', content: [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: dataUrl } }] }];
}

// ---------------------------------------------------------------------------
// Classifier

const PROBE_IMAGE = { render: { kind: /** @type {const} */ ('svg'), body: "<rect x='96' y='96' width='192' height='192' fill='#e11d1d'/>" } };

/**
 * What a failed probe says about the model.
 * @param {NimCall} call
 * @returns {'retired'|'not_entitled'|'transient'|'refused'}
 */
export function failureKind(call) {
	if (call.status === 410) return 'retired';
	if (call.status === 404 && /not found for account|specified function in account/i.test(call.error || '')) return 'not_entitled';
	if (call.status === 0 || call.status === 429 || call.status >= 500) return 'transient';
	return 'refused';
}

/**
 * @typedef {{
 *   lane: string|null,
 *   availability: 'live'|'retired'|'not_entitled'|'unreachable'|'unsupported',
 *   reason: string,
 *   ownedBy: string|null,
 *   dim?: number,
 *   probes: Record<string, { status: number, ms: number, ok: boolean, error: string|null, sample?: string }>,
 * }} Classification
 */

/**
 * Determine a model's lane from catalog metadata plus live probes, never from
 * its name. Probes stop at the first lane that answers.
 * @param {{ id: string, ownedBy?: string|null, client: NimClient }} opts
 * @returns {Promise<Classification>}
 */
export async function classifyNimModel({ id, ownedBy = null, client }) {
	/** @type {Classification['probes']} */
	const probes = {};
	const note = (name, call, sample) => {
		probes[name] = { status: call.status, ms: call.ms, ok: call.ok, error: call.error, ...(sample !== undefined ? { sample: String(sample).slice(0, 160) } : {}) };
	};
	/** @param {Omit<Classification, 'probes'|'ownedBy'>} r */
	const done = (r) => ({ ...r, ownedBy, probes });

	const emb = await client.embed(id, ['three.ws release probe'], 'query');
	const vec = emb.ok ? embeddingVector(emb.body) : null;
	note('embeddings', emb, vec ? `${vec.length}-dim vector` : undefined);
	if (vec) return done({ lane: 'embeddings', availability: 'live', dim: vec.length, reason: `/v1/embeddings returned a ${vec.length}-dim vector` });

	const chat = await client.chat(id, [{ role: 'user', content: 'Reply with the single word: ok' }], { maxTokens: 48 });
	const chatOut = chat.ok ? chatText(chat.body) : '';
	note('chat', chat, chat.ok ? chatOut : undefined);
	if (chat.ok) {
		if (parseVerdict(chatOut).parsed) {
			return done({ lane: 'safety', availability: 'live', reason: `chat replied with a safety verdict (${chatOut.slice(0, 60)})` });
		}
		const vision = await client.chat(id, imageTurn('What colour is the square? Answer with one word.', await evalImageDataUrl(PROBE_IMAGE, 256)), { maxTokens: 24 });
		const visionOut = vision.ok ? chatText(vision.body) : '';
		note('vision', vision, vision.ok ? visionOut : undefined);
		if (vision.ok && /\bred\b/i.test(visionOut)) {
			return done({ lane: 'vision', availability: 'live', reason: 'chat answered with an image input and named the colour drawn in it' });
		}
		if (!vision.ok && failureKind(vision) === 'transient') {
			return done({ lane: null, availability: 'unreachable', reason: `vision probe failed transiently (${vision.error})` });
		}
		return done({ lane: 'chat', availability: 'live', reason: vision.ok ? 'chat answered; the image probe answered without seeing the image' : `chat answered; image input refused (${vision.status})` });
	}

	const rr = await client.rerank(id, 'What is the capital of France?', ['Berlin is the capital of Germany.', 'Paris is the capital of France.']);
	const order = rr.ok ? rerankOrder(rr.body, 2) : null;
	note('rerank', rr, order ? `order ${order.join(',')}` : undefined);
	if (order) return done({ lane: 'rerank', availability: 'live', reason: 'the retrieval host returned a full ranking' });

	const calls = [emb, chat, rr];
	const kinds = calls.map(failureKind);
	const summary = `embeddings ${emb.status || 'ERR'}, chat ${chat.status || 'ERR'}, rerank ${rr.status || 'ERR'}`;
	if (kinds.includes('retired')) return done({ lane: null, availability: 'retired', reason: `model answered 410 Gone (${summary})` });
	if (kinds.includes('not_entitled')) return done({ lane: null, availability: 'not_entitled', reason: `listed in the catalog but its function is not callable on this key (${summary})` });
	if (kinds.includes('transient')) return done({ lane: null, availability: 'unreachable', reason: `a probe failed transiently (${summary})` });
	return done({ lane: null, availability: 'unsupported', reason: `no HTTP lane accepted it (${summary}); speech and other NVCF gRPC functions are not reachable through the catalog endpoints` });
}
