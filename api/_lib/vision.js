// Canonical server-side image understanding (VLM completion) + the platform's
// vision provider policy. The image-side twin of api/_lib/llm.js — same
// free-first doctrine, same spend-ledger discipline, so vision never becomes a
// per-endpoint reinvention that drifts out of policy.
//
// Policy (identical to llm.js — read that file's header for the rationale):
//
//   • FREE NIM VISION LANES FIRST, ALWAYS. NVIDIA NIM hosts several VLMs on the
//     OpenAI-compatible chat host (integrate.api.nvidia.com) at zero marginal
//     cost to the platform. They lead every chain, tried in order, and every
//     consumer must survive on them alone.
//
//   • Paid vision-capable backstop LAST, automatically. When OPENAI_API_KEY is
//     configured, gpt-5.4-nano (vision-capable) is appended to the tail so a
//     request that exhausted the free lanes still succeeds. It never leads, and
//     no consumer hard-fails when it is absent.
//
//   • NOTHING HARD-FAILS ON A VISION OUTAGE. describeImage throws on total
//     failure, but every consumer is required to treat that as "skip the
//     vision-derived enhancement", never as an error the end user sees. See
//     visionConfigured() for the gate, and each consumer's degraded path.
//
// Image input — pass EITHER an http(s) URL (default; the model server fetches it
// — used for first-party R2 URLs and already-validated claim image URLs) OR a
// base64 blob + mimeType (inlined as a data URI). Both verified live against
// every NIM lane; see tasks/nvidia-nim/probes/vision.md.

import { isIP } from 'node:net';
import { env } from './env.js';
import {
	AUTH_COOLDOWN_SECONDS,
	clearProviderCooldown,
	markProviderCooldown,
	providersInCooldown,
} from './provider-health.js';
import { recordEvent } from './usage.js';
import { costMicroUsd } from './llm-pricing.js';
import { validatePublicUrl, isPrivateAddress, SsrfError } from './ssrf.js';
import { fetchSafePublicUrl } from './ssrf-guard.js';
import {
	vertexGeminiAvailable,
	vertexGeminiModel,
	vertexGeminiChatUrl,
	vertexGeminiHeaders,
} from './vertex-gemini.js';

// Free NIM vision lanes, in order.
//
// `nvidia/nemotron-nano-12b-v2-vl` used to lead here for its small image token
// footprint. NVIDIA retired it: the host answers every request for it with a
// hard 410 ("has reached its end of life on 2026-08-26T09:00:00Z"), verified
// against production on 2026-09-08. A 410 never recovers, so leaving it in the
// list only spent the first, largest slice of every vision request's deadline
// on a model that cannot answer. Adding a replacement free NIM VLM needs a live
// NVIDIA_API_KEY to probe the catalog against, which is why this is a removal
// rather than a swap.
const NVIDIA_VISION_MODELS = [
	'meta/llama-3.2-11b-vision-instruct',
];
// Free OpenRouter vision lanes, in order.
//
// The text chain (llm.js providerChain) has carried an OpenRouter rung for a
// long time; vision never did, and that gap took the whole endpoint down on
// 2026-09-09: NVIDIA answered 500, the paid OpenAI backstop answered 429
// `billing_not_active`, and Vertex answered 403 `Lightning dunning decision is
// deny for project` (a project-level billing hold that denies Vertex AND the
// AI-Studio Gemini endpoint on the same key, so both Google rungs die together).
// Three rungs, one dead chain, and every consumer that judges an image with it
// (catalog seeding's quality gate, forge validation, alt text) went dark.
//
// Only the `:free` suffix is used here. llm-pricing.js prices OpenRouter by
// exactly that suffix (isOpenRouterFreeModel), so a `:free` route is metered at
// zero and the spend ledger stays truthful; OpenRouter's `openrouter/free`
// router meta-model answers fine but would be metered as paid, so it is
// deliberately not in this list.
//
// Verified against the live platform key on 2026-09-09: nemotron-omni answered
// 3/3 in a median 1.5 s with clean parseable JSON, which is what the seed judge
// needs (api/_lib/seed-quality.js parses every reply as JSON). The two Gemma
// routes were saturated (429) in the same probe and are kept behind it as spare
// capacity: a 429 falls through in ~150 ms and, unlike the 410 that retired the
// NIM model above, it recovers when the shared free pool drains.
//
// The nemotron route is a REASONING model, and OpenRouter's own model record
// says `default_enabled: true`, so left alone it thinks before it answers. In a
// bulk text run that is merely expensive; inside a vision lane's slice of a
// shared deadline it is fatal, because the thinking consumes the budget and the
// lane returns an EMPTY message.content. Probing /api/vision on production
// (2026-09-10) caught it doing exactly that: provider openrouter, model
// nemotron-omni, text ''. The same record says `mandatory: false`, which is
// OpenRouter's way of saying this model accepts being told not to, so the lane
// carries reasoning.effort:'none'.
//
// Note the parameter is host-specific and copying the wrong one ships a no-op:
// NVIDIA's own host takes chat_template_kwargs.enable_thinking (see
// scripts/i18n-translate.mjs), OpenRouter takes reasoning.effort. Check a
// model's `reasoning` object at https://openrouter.ai/api/v1/models before
// assuming either works; a model with `mandatory: true` rejects 'none' with a
// 400.
const OPENROUTER_VISION_MODELS = [
	{ model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', extraBody: { reasoning: { effort: 'none' } } },
	{ model: 'google/gemma-4-31b-it:free' },
	{ model: 'google/gemma-4-26b-a4b-it:free' },
];
// Paid last-resort tail. gpt-5.4-nano is vision-capable and already priced in
// llm-pricing.js, keeping the backstop cheap and the spend ledger truthful.
const OPENAI_VISION_MODEL = 'gpt-5.4-nano';

// ── Lane health and budget policy ───────────────────────────────────────────
//
// Two failures were costing /api/vision its 502s and 504s in production (79
// and 35 respectively in the week to 2026-08-27), and neither was a provider
// being genuinely unable to answer:
//
//   1. NO COOLDOWN. Unlike the chat chain, vision never recorded a throttling
//      lane, so every incoming request re-picked the same rate-limited NIM as
//      attempt zero, waited out its timeout, and only then failed over. Under
//      any sustained throttle that is the whole latency budget spent on a lane
//      already known to be refusing. The chat chain's remedy applies verbatim:
//      skip a cooling lane, and clear the cooldown the moment one answers.
//
//   2. THE FIRST LANE COULD EAT THE WHOLE DEADLINE. The per-attempt timeout was
//      min(timeoutMs, remaining), so a single hung lane consumed the entire
//      24s budget and the request 504'd having tried exactly one provider, with
//      a healthy Vertex anchor sitting untried behind it. Splitting the
//      remaining budget across the lanes that are still to come guarantees
//      every rung a real attempt, which is the only reason a chain exists.
//
// Free NIM rungs share one host, so a transport failure or a 429 there is a
// statement about the HOST, not the model: cooling only the model that happened
// to be asked would send the very next request to a sibling on the same sick
// host. Model-specific rejections (a 404 for a retired model id, a 400) cool
// just that lane, and a 410 parks it for the long window (see below).
const VISION_LANE_COOLDOWN_SECONDS = 45;
// Below this a lane cannot complete a VLM call, so handing it a smaller slice
// only burns budget the next rung could have used.
const MIN_LANE_ATTEMPT_MS = 3_500;
// Share of the remaining deadline the image inline fetch may take. It runs
// BEFORE any lane, so an uncapped one starves the whole chain: at the measured
// 20s timeout against a 24s deadline it left 4s for every provider combined.
const INLINE_BUDGET_SHARE = 0.25;
const INLINE_MAX_MS = 8_000;

/** Cooldown key for one lane. Model-scoped: two lanes on one host are distinct rungs. */
function laneKey(p) {
	return `vision:${p.name}:${p.model}`;
}

/** The host a lane talks to, used to cool every sibling rung when the host itself is sick. */
function laneHost(p) {
	try {
		return new URL(p.url).host;
	} catch {
		return p.url;
	}
}

/**
 * Cool `lane` for `seconds`, and every sibling lane sharing its host when the
 * failure was about the host (transport error, rate limit, auth) rather than
 * about the model. Fire-and-forget: provider-health never throws.
 */
function coolLane(chain, lane, { seconds, reason, hostWide }) {
	const targets = hostWide
		? chain.filter((p) => laneHost(p) === laneHost(lane))
		: [lane];
	for (const t of targets) void markProviderCooldown(laneKey(t), seconds, reason);
}

/**
 * Per-attempt timeout for the lane about to be tried. Splits what is left of the
 * deadline evenly across the lanes still to come so the first rung can never
 * consume the budget of the rest, and never exceeds the caller's own timeoutMs.
 * With no deadline the caller's timeout stands unchanged.
 *
 * @param {number} remainingMs  ms left on the overall deadline (Infinity when none)
 * @param {number} lanesLeft    lanes still to try, including this one
 * @param {number} timeoutMs    caller's per-attempt ceiling
 */
export function laneAttemptTimeout(remainingMs, lanesLeft, timeoutMs) {
	if (!Number.isFinite(remainingMs)) return timeoutMs;
	// Reserve the floor for the rungs behind this one, then give this lane the
	// rest. It used to divide the budget EQUALLY, which quietly punishes the
	// chain for having depth: every lane added to the list shrinks the slice the
	// FIRST and best lane gets, even though that lane is the one most likely to
	// answer. Adding three OpenRouter rungs on 2026-09-09 took the free NIM
	// lane's slice from about 9.7s to about 4.8s against the forge quality
	// gate's 29s deadline, which is just under what it needs for the scoring
	// rubric, and the gate went from 5 verdicts in 10 to 0 in 10 (measured on
	// production 2026-09-10). Nothing about either lane changed; the arithmetic
	// did.
	//
	// Reserving instead of dividing keeps the property the split existed for (a
	// hung lane cannot eat the whole deadline, and every remaining rung is still
	// guaranteed MIN_LANE_ATTEMPT_MS) while letting the lane in hand use the
	// budget nobody else needs yet. A lane that fails fast hands its unused
	// share straight to the next one, because `remainingMs` is re-read per
	// attempt.
	const reserve = MIN_LANE_ATTEMPT_MS * Math.max(0, lanesLeft - 1);
	const share = Math.max(MIN_LANE_ATTEMPT_MS, remainingMs - reserve);
	// The floor may exceed the share when the budget is nearly spent; capping it
	// by what is actually left keeps the attempt inside the deadline either way.
	//
	// Math.floor is load-bearing, not cosmetic: this value is handed straight to
	// AbortSignal.timeout(), which rejects a non-integer delay with
	// ERR_OUT_OF_RANGE. The division above produces an integer only when the
	// remaining budget happens to divide evenly by the lane count, so in
	// production the fallback rung usually threw before it sent a single byte
	// and was recorded as "unreachable" ("The value of \"delay\" is out of range.
	// It must be an integer. Received 7924.333333333333"). That silently cost the
	// chain the very rung it exists for, on every request that reached it.
	return Math.floor(Math.max(1, Math.min(timeoutMs, remainingMs, Math.max(MIN_LANE_ATTEMPT_MS, share))));
}

/**
 * Budget for the pre-chain image inline fetch: a slice of the remaining
 * deadline, never more than INLINE_MAX_MS and never more than the caller's
 * timeout. Exported for the budget regression test.
 */
export function inlineImageBudget(remainingMs, timeoutMs) {
	const cap = Math.min(timeoutMs, INLINE_MAX_MS);
	if (!Number.isFinite(remainingMs)) return cap;
	return Math.max(1_000, Math.min(cap, Math.floor(remainingMs * INLINE_BUDGET_SHARE)));
}

// Thrown when no vision provider is available at all. Carries an HTTP status so
// a handler that *chose* to surface it can return 503 — but consumers should
// generally catch it and degrade silently instead.
export class VisionUnavailableError extends Error {
	constructor(message = 'No vision provider available. Configure NVIDIA_API_KEY or OPENROUTER_API_KEY (free), GOOGLE_CLOUD_PROJECT (Vertex Gemini credits anchor), or OPENAI_API_KEY (paid backstop).') {
		super(message);
		this.name = 'VisionUnavailableError';
		this.code = 'vision_unavailable';
		this.status = 503;
	}
}

// One OpenAI-compatible vision provider entry. The multimodal user message is
// the only shape difference from llm.js's text providers. `getHeaders` (async)
// replaces the static key header for keyless lanes whose auth is minted per
// request (the Vertex Gemini credits anchor).
function openaiCompatVisionProvider({ name, key, url, model, getHeaders = null, extraBody = null }) {
	return {
		name,
		model,
		url,
		...(getHeaders
			? { getHeaders }
			: { headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` } }),
		buildBody: (system, parts, maxTokens) => {
			const messages = [];
			if (system) messages.push({ role: 'system', content: system });
			messages.push({ role: 'user', content: parts });
			return { model, max_tokens: maxTokens, temperature: 0, messages, ...(extraBody || {}) };
		},
		extractText: (r) => r.choices?.[0]?.message?.content || '',
		extractUsage: (r) => ({ input: r.usage?.prompt_tokens ?? 0, output: r.usage?.completion_tokens ?? 0 }),
	};
}

// Build the ordered vision provider chain: free NIM lanes first, then the
// credits-funded Vertex Gemini anchor, paid OpenAI backstop appended last and
// only when its key is set. Exported for the anchor regression tests
// (tests/api/llm-vertex-anchor-surfaces).
export function visionChain() {
	const chain = [];
	if (env.NVIDIA_API_KEY) {
		for (const model of NVIDIA_VISION_MODELS) {
			chain.push(openaiCompatVisionProvider({
				name: 'nvidia',
				key: env.NVIDIA_API_KEY,
				url: 'https://integrate.api.nvidia.com/v1/chat/completions',
				model,
			}));
		}
	}
	// Free OpenRouter routes, alongside the NIM lanes and ahead of the credits
	// anchor: same free tier, same zero meter, and they are the rungs that keep
	// vision answering when both NVIDIA and Google are down at once. Ordering
	// them here leaves the Vertex anchor exactly where it was in the chain
	// relative to the paid tail; nothing is evicted.
	if (env.OPENROUTER_API_KEY) {
		for (const spec of OPENROUTER_VISION_MODELS) {
			chain.push(openaiCompatVisionProvider({
				name: 'openrouter',
				key: env.OPENROUTER_API_KEY,
				url: 'https://openrouter.ai/api/v1/chat/completions',
				model: spec.model,
				extraBody: spec.extraBody || null,
			}));
		}
	}
	// Vertex Gemini credits anchor: multimodal (Gemini Flash reads image_url
	// parts, data URIs included, through the same OpenAI-compatible endpoint),
	// keyless (OAuth token minted per request), billed to GCP credits. Sits
	// after the free NIM lanes and ahead of the paid tail, exactly like the
	// text anchor in llm.js's providerChain: the prod OPENAI_API_KEY is
	// billing-dead, so this rung is what keeps vision answering when the NIM
	// queue throttles or hangs. Nothing may evict it (see api/_lib/vertex-gemini.js).
	if (vertexGeminiAvailable()) {
		chain.push(openaiCompatVisionProvider({
			name: 'vertex-gemini',
			url: vertexGeminiChatUrl(),
			model: vertexGeminiModel(),
			getHeaders: vertexGeminiHeaders,
		}));
	}
	if (env.OPENAI_API_KEY) {
		chain.push(openaiCompatVisionProvider({
			name: 'openai',
			key: env.OPENAI_API_KEY,
			url: 'https://api.openai.com/v1/chat/completions',
			model: OPENAI_VISION_MODEL,
		}));
	}
	return chain;
}

// True when at least one vision provider can serve a request. Use to gate a
// consumer's vision-derived enhancement WITHOUT making the doomed upstream call —
// this is the fail-open switch (forge validation, alt text, image evidence all
// check it first).
export function visionConfigured() {
	return visionChain().length > 0;
}

// Synchronous SSRF guard for a caller-supplied image URL. Requires https (http
// only in dev) and blocks IP-literal hosts in private/loopback/link-local ranges
// plus localhost — the direct SSRF targets reachable through the provider's
// server-side image fetch. DNS-name hosts pass (we can't pin the provider's DNS
// resolution, so name→private rebinding is out of scope here). Throws a 400
// invalid_image_url so callers treat it as bad input, not a vision outage.
function assertSafeImageUrl(rawUrl) {
	let url;
	try {
		url = validatePublicUrl(rawUrl);
	} catch (e) {
		if (e instanceof SsrfError) {
			throw Object.assign(new Error('image URL is not a public https address'), {
				status: 400,
				code: 'invalid_image_url',
			});
		}
		throw e;
	}
	const host = url.hostname.replace(/^\[|\]$/g, '');
	const fam = isIP(host);
	const blocked = fam
		? isPrivateAddress(host, fam)
		: host === 'localhost' || /\.(local|internal|localdomain)$/i.test(host);
	if (blocked) {
		throw Object.assign(new Error('image URL resolves to a non-public host'), {
			status: 400,
			code: 'invalid_image_url',
		});
	}
	return url;
}

// 12 MiB — matches /api/vision's inbound cap; comfortably covers a viewer
// screenshot or photo while bounding the per-request buffer.
const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024;

// Fetch a caller-supplied image URL ourselves and return it as inline base64.
// The provider model servers otherwise fetch imageUrl server-side, and hosts
// with hotlink / User-Agent protection (Wikipedia thumbnails, some CDNs) reject
// that fetch — which fails EVERY URL-based lane and forces a fall-through to the
// paid backstop. Fetching here (SSRF-guarded, redirects re-validated per hop)
// makes the free NIM lanes independent of whether the provider can reach the
// host. Throws on non-2xx, oversize, or transport error so the caller can decide
// whether to fall back to URL pass-through.
async function inlineImageFromUrl(imageUrl, { timeoutMs = 8_000 } = {}) {
	const res = await fetchSafePublicUrl(imageUrl, {
		signal: AbortSignal.timeout(timeoutMs),
		// A browser-like UA + image Accept gets past CDNs that reject empty/bot
		// user-agents — the same gate that blocks the providers' own fetchers.
		headers: {
			'user-agent': 'Mozilla/5.0 (compatible; three.ws-vision/1.0; +https://three.ws)',
			accept: 'image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5',
		},
	});
	if (!res.ok) throw Object.assign(new Error(`image fetch ${res.status}`), { status: res.status });
	const advertised = Number(res.headers.get('content-length') || 0);
	if (advertised > MAX_INLINE_IMAGE_BYTES) {
		throw Object.assign(new Error('image exceeds inline size cap'), { status: 413 });
	}
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length > MAX_INLINE_IMAGE_BYTES) {
		throw Object.assign(new Error('image exceeds inline size cap'), { status: 413 });
	}
	const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	return { imageBase64: buf.toString('base64'), mimeType: ct.startsWith('image/') ? ct : 'image/jpeg' };
}

// Normalize a caller's image spec into one OpenAI `image_url` content part.
// Accepts { imageUrl } (pass-through) or { imageBase64, mimeType } (data URI).
function imagePart({ imageUrl, imageBase64, mimeType = 'image/jpeg' }) {
	if (imageUrl) return { type: 'image_url', image_url: { url: imageUrl } };
	if (imageBase64) {
		const raw = imageBase64.startsWith('data:') ? imageBase64 : `data:${mimeType};base64,${imageBase64}`;
		return { type: 'image_url', image_url: { url: raw } };
	}
	throw Object.assign(new Error('describeImage requires imageUrl or imageBase64'), {
		status: 400,
		code: 'no_image',
	});
}

// Map a non-2xx vision response to a normalized error code, mirroring the other
// NIM provider contracts (probes/vision.md error table). Folded into lastErr so
// the final throw after the whole chain fails carries a meaningful code.
function normalizeStatus(status) {
	if (status === 401 || status === 403) return 'invalid_key';
	if (status === 402) return 'insufficient_credits';
	if (status === 429) return 'rate_limited';
	if (status >= 500) return 'provider_error';
	return 'provider_error';
}

// Describe / analyze one image against a prompt, against the first available
// provider, falling over to the next on transport or non-2xx errors.
//
//   { prompt, imageUrl? , imageBase64?, mimeType?, system?, maxTokens?,
//     timeoutMs?, track? }
//
// `timeoutMs` bounds EACH provider attempt so a hung free lane can't stall a
// serverless function — the next lane is tried instead. `deadlineMs` bounds the
// WHOLE chain: without it, a handful of lanes each timing out at `timeoutMs`
// sequentially can blow past the function's wall-clock limit, which is exactly
// what produced the "Vercel Runtime Timeout Error: Task timed out after 30s" 504
// on /api/vision (3 free NIM models + a paid backstop × 20s each ≫ 30s). With a
// deadline we stop walking the chain and return a clean 504 before the platform
// hard-kills the invocation. Each attempt is capped at min(timeoutMs, time left).
// `track` is the same optional spend-ledger attribution as llmComplete; a
// successful call records a kind:'vision' usage event with provider/model/tokens/cost
// (free NIM prices to 0 in llm-pricing.js).
//
// Returns { text, provider, model, usage:{input,output}, raw }.
// Throws VisionUnavailableError when nothing is configured, or the last upstream
// error (with .status = 502/504, .code = normalized) when every provider failed
// or the deadline elapsed.
export async function describeImage({
	prompt,
	imageUrl = null,
	imageBase64 = null,
	mimeType = 'image/jpeg',
	system = null,
	maxTokens = 512,
	timeoutMs = 20_000,
	deadlineMs = null,
	track = null,
	accept = null,
}) {
	const chain = visionChain();
	if (!chain.length) throw new VisionUnavailableError();
	const deadlineAt = deadlineMs != null ? Date.now() + deadlineMs : Infinity;

	// SSRF guard: the provider's model server fetches `imageUrl` server-side, so a
	// caller-supplied URL could otherwise reach internal targets (169.254.169.254,
	// localhost, RFC1918) through the provider. We can't DNS-pin the provider's
	// fetch, so apply a synchronous string-level guard — require https and reject
	// private/loopback/link-local IP literals + localhost — before the URL leaves
	// this process. Centralized here so every consumer of describeImage is covered,
	// not just the forge image-validate path that already pre-validates.
	if (imageUrl) assertSafeImageUrl(imageUrl);

	// Prefer inlining the image ourselves over handing the URL to each provider's
	// server-side fetcher. If our own fetch fails (a host the provider CAN reach
	// but we can't, or a transient error), fall back to URL pass-through so we
	// never regress a currently-working path. Bounded by the remaining chain
	// deadline so a slow image host can't blow the whole budget before a lane runs.
	if (imageUrl && !imageBase64) {
		try {
			const budget = inlineImageBudget(deadlineAt - Date.now(), timeoutMs);
			const inlined = await inlineImageFromUrl(imageUrl, { timeoutMs: budget });
			imageBase64 = inlined.imageBase64;
			mimeType = inlined.mimeType;
			imageUrl = null;
		} catch {
			// keep imageUrl set — the providers will try their own server-side fetch
		}
	}

	const parts = [
		{ type: 'text', text: prompt },
		imagePart({ imageUrl, imageBase64, mimeType }),
	];

	// Put the lanes a recent request found throttled or key-dead at the BACK
	// rather than dropping them: a chain that skips every cooling lane and finds
	// nothing left must still answer, so the cooled ones remain as a last resort.
	// One cache round-trip, and it is skipped entirely for a single-lane chain.
	let order = chain;
	if (chain.length > 1) {
		const cooling = await providersInCooldown(chain.map(laneKey));
		if (cooling.size) {
			const hot = chain.filter((p) => !cooling.has(laneKey(p)));
			const cold = chain.filter((p) => cooling.has(laneKey(p)));
			if (hot.length) order = [...hot, ...cold];
		}
	}

	let lastErr;
	// Every rung's verdict, in the order they were tried. Only the LAST failure
	// used to survive, which made a dead chain unreadable: the caller was told
	// "openai vision 429: billing_not_active" while the actual problem was that
	// the free NIM lanes and the Vertex anchor ahead of it had already failed for
	// two entirely different reasons. Whoever has to fix it needs all three, so
	// the whole walk is carried on the thrown error and rendered by the handler.
	/** @type {{ provider: string, model: string|null, status: number|null, detail: string }[]} */
	const attempts = [];
	// Hosts this request has already proven sick (a throttle, a dead key, an
	// unreachable socket). Skipping their remaining rungs inside THIS request is
	// the difference between paying one doomed attempt and paying one per model
	// the host happens to serve, and the deadline it saves is what lets the next
	// healthy lane answer at all.
	const sickHosts = new Set();
	for (let i = 0; i < order.length; i++) {
		const p = order[i];
		if (sickHosts.has(laneHost(p))) continue;
		// Stop walking the chain once the overall budget is spent — returning a clean
		// 504 here beats letting the platform hard-kill the function mid-request.
		const remaining = deadlineAt - Date.now();
		if (remaining <= 0) {
			lastErr = Object.assign(new Error('vision deadline exceeded before a provider answered'), {
				status: 504,
				code: 'deadline_exceeded',
			});
			break;
		}
		const attemptTimeout = laneAttemptTimeout(remaining, order.length - i, timeoutMs);
		const startedAt = Date.now();
		let upstream;
		try {
			// Keyless lanes (the Vertex Gemini credits anchor) mint their auth per
			// attempt via getHeaders; a token-exchange failure lands in the catch
			// below and fails over to the next lane like any transport error.
			upstream = await fetch(p.url, {
				method: 'POST',
				headers: p.getHeaders ? await p.getHeaders() : p.headers,
				body: JSON.stringify(p.buildBody(system, parts, maxTokens)),
				signal: AbortSignal.timeout(attemptTimeout),
			});
		} catch (e) {
			// Unreachable or timed out. Cool this lane only: a hang is as often one
			// heavy model refusing to answer inside its slice as it is a dead host,
			// and benching the sibling rung on that guess would discard the very
			// redundancy the second rung exists to provide.
			coolLane(order, p, { seconds: VISION_LANE_COOLDOWN_SECONDS, reason: 'health', hostWide: false });
			attempts.push({ provider: p.name, model: p.model || null, status: null, detail: `unreachable: ${String(e.message).slice(0, 160)}` });
			lastErr = Object.assign(new Error(`${p.name} vision unreachable: ${e.message}`), { status: 502, code: 'provider_unreachable' });
			continue;
		}
		if (!upstream.ok) {
			const body = await upstream.text().catch(() => '');
			// 401/403/402 is a key or billing fault that will not clear on its own, so
			// it parks the lane for the long window instead of being re-probed every
			// request. 429 and 5xx are the host throttling or failing, which cools
			// every rung sharing it. Anything else (a 404 for a retired model id, a
			// 400) is specific to this model and cools this lane alone.
			const st = upstream.status;
			// 410 Gone is how NIM reports a retired model id. Unlike a 404 or a 500 it
			// is a permanent verdict about this model, so it parks the lane for the
			// long window instead of being re-probed (and re-charged a slice of the
			// deadline) on every request until someone notices.
			const authFault = st === 401 || st === 403 || st === 402 || st === 410;
			// A 429 is the one verdict that is unambiguously about the HOST and the
			// account behind it: every model served there is throttled by the same
			// quota, so both the bench and the in-request skip cover every sibling
			// rung. Everything else stays lane-scoped, because NIM answers a
			// per-model fault with a 403 (model not enabled for this account) or a
			// 500 just as readily as a host-level one, and benching a working twin
			// on that guess would cost the chain its redundancy.
			coolLane(order, p, {
				seconds: authFault ? AUTH_COOLDOWN_SECONDS : VISION_LANE_COOLDOWN_SECONDS,
				reason: authFault ? 'auth' : 'health',
				hostWide: st === 429,
			});
			if (st === 429) sickHosts.add(laneHost(p));
			attempts.push({ provider: p.name, model: p.model || null, status: st, detail: body.slice(0, 160) });
			lastErr = Object.assign(
				new Error(`${p.name} vision ${upstream.status}: ${body.slice(0, 200)}`),
				{ status: 502, code: normalizeStatus(upstream.status) },
			);
			continue;
		}
		const data = await upstream.json();
		const usage = p.extractUsage(data);
		// Meter it either way: the tokens were spent whether or not the reply is
		// usable, and a ledger that hides rejected replies understates the cost of
		// a lane that answers fluently in the wrong shape.
		recordVisionSpend(p, usage, Date.now() - startedAt, track);
		const text = (p.extractText(data) || '').trim();
		// A 200 is not the same as an answer. When the caller requires a shape
		// (describeImageJson requires parseable JSON), validating it HERE makes the
		// shape part of the chain's success test instead of a filter bolted on
		// after a winner is picked. That distinction is the whole bug: with the
		// check outside the loop, the first lane to emit prose ended the request
		// and every healthy rung behind it went untried, which is exactly how a
		// reasoning model that narrates before it answers took the forge quality
		// gate from intermittent to 0 verdicts in 10 (production, 2026-09-10).
		//
		// A rejected lane is NOT cooled. The cooldown key is shared with callers
		// that want free-form prose, and that reply is perfectly good to them;
		// benching it here would degrade alt-text to punish a JSON caller.
		let accepted;
		if (accept) {
			try {
				accepted = accept(text);
			} catch (e) {
				attempts.push({
					provider: p.name,
					model: p.model || null,
					status: upstream.status,
					detail: `reply rejected: ${String(e?.message || e).slice(0, 120)}`,
				});
				lastErr = Object.assign(
					new Error(`${p.name} vision reply rejected: ${e?.message || e}`),
					{ status: 502, code: e?.code || 'vision_bad_reply' },
				);
				continue;
			}
		}
		// A lane that just served a real request is healthy whatever an earlier
		// window recorded; waiting out the rest of a disproved cooldown only keeps
		// a recovered lane off the menu.
		void clearProviderCooldown(laneKey(p));
		return {
			text,
			provider: p.name,
			model: p.model,
			usage,
			raw: data,
			accepted,
		};
	}
	throw Object.assign(lastErr || new VisionUnavailableError(), { lanes: attempts });
}

// Convenience: describeImage with "parseable JSON" as the acceptance test. VLMs
// mostly honor "reply ONLY JSON" (probes/vision.md) but may wrap it in a ```json
// fence or a trailing newline, and a reasoning model may narrate around it;
// parseJsonLoose strips what it can. A reply it cannot parse fails THAT LANE and
// the chain moves to the next rung, so one chatty model no longer costs the
// request every healthy provider behind it. Throws only when no rung produced
// parseable JSON (the caller's degraded path handles that like a vision outage).
export async function describeImageJson(opts) {
	const result = await describeImage({ ...opts, accept: parseJsonLoose });
	return { ...result, json: result.accepted };
}

// Strip a ```json fence / stray prose and parse the first JSON object/array in
// the text. Throws a normalized error on failure so callers treat it as a
// degraded vision result.
export function parseJsonLoose(text) {
	const trimmed = String(text || '').trim();
	const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
	const start = fenced.search(/[[{]/);
	const candidate = start >= 0 ? fenced.slice(start) : fenced;
	try {
		return JSON.parse(candidate);
	} catch {
		// Last resort: grab the outermost {...} or [...] span.
		const m = candidate.match(/[{[][\s\S]*[}\]]/);
		if (m) {
			try {
				return JSON.parse(m[0]);
			} catch {
				/* fall through */
			}
		}
		throw Object.assign(new Error('vision reply was not valid JSON'), { status: 502, code: 'vision_bad_json' });
	}
}

// Fire-and-forget spend ledger write for one vision call. Free NIM prices to 0;
// the paid OpenAI backstop prices via llm-pricing.js. Never throws.
function recordVisionSpend(provider, usage, latencyMs, track) {
	const input = usage?.input ?? 0;
	const output = usage?.output ?? 0;
	recordEvent({
		kind: 'vision',
		provider: provider.name,
		model: provider.model,
		inputTokens: input,
		outputTokens: output,
		costMicroUsd: costMicroUsd({ provider: provider.name, model: provider.model, input, output }),
		latencyMs,
		userId: track?.userId ?? null,
		agentId: track?.agentId ?? null,
		avatarId: track?.avatarId ?? null,
		clientId: track?.clientId ?? null,
		apiKeyId: track?.apiKeyId ?? null,
		tool: track?.tool ?? null,
		meta: track?.meta ?? undefined,
	});
}
