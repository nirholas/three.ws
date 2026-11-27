// NVIDIA NIM provider — the FREE TRELLIS 3D-generation backend (TEXT-ONLY).
//
// Microsoft TRELLIS hosted on NVIDIA NVCF gives `/forge` a zero-vendor-cost
// text→3D lane (GLB output) behind the platform `NVIDIA_API_KEY`. Per the
// platform free-first policy it is the default draft backend for prompt
// generations, with the paid Replicate/Meshy/Tripo lanes staying selectable.
//
// ── Why text-only ────────────────────────────────────────────────────────────
// The hosted preview API does NOT accept user images for mode:"image": every
// form — inline base64 at any size, NVCF asset references (`;asset_id,` with
// NVCF-INPUT-ASSET-REFERENCES), bare asset ids — is rejected 422; the only
// accepted image input is `data:image/png;example_id,{0..3}` referencing
// NVIDIA's predefined sample images. Verified live 2026-06-11 against the real
// endpoint and confirmed by the official schema docs — full transcripts in
// tasks/nvidia-nim/probes/trellis.md. Self-deployed TRELLIS NIMs accept real
// image input, so this constraint is about NVIDIA's hosted preview, not the
// model; if NVIDIA lifts it, the asset handshake recipe is preserved in the
// probe file and git history.
//
// The forge layer therefore routes user-photo submissions to the standing
// image backend (Replicate TRELLIS) and only sends prompts here — see
// resolveBackendId({ userImages }) in api/_lib/forge-tiers.js.
//
// ── Protocol (verified live, T0.2/T1.1 probes) ──────────────────────────────
//   submit  POST https://ai.api.nvidia.com/v1/genai/microsoft/trellis
//           Authorization: Bearer nvapi-…   Accept: application/json
//           { mode:"text", prompt, seed?, ss_sampling_steps, slat_sampling_steps, output_format:"glb" }
//           → 202 + header NVCF-REQID  (async; poll)   |   200 + body (synchronous completion)
//
//   poll    GET https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/{NVCF-REQID}
//           (sent with redirect:"manual" so a 302 is read, not followed)
//           200 done, body holds the result   | 202 still running
//           302 large result: `Location` is a presigned URL, fetched with no key
//           402 credits exhausted (terminal, code insufficient_credits)
//           400/422 request rejected (terminal)  | 403 missing scope (terminal)
//           429 throttled: stays running and returns `retryAfter` from Retry-After
//           5xx / network: stays running (the forge layer owns the overall deadline)
//
//   result  The result rides in `body.artifacts[0]`, or arrives as raw bytes, as a
//           302 download, or as a zip. The hosted preview has shipped it in
//           SEVERAL shapes over time. extractGlb normalizes all of:
//             • { artifacts: [ { base64 } ] }     inline base64 (original)
//             • { artifacts: [ { data } ] }        inline base64 under `data`
//             • { artifacts: [ "<base64 string>" ] }   bare string, no wrapper
//             • { artifacts: [ { url } ] }         CDN URL, fetched through the SSRF
//                                                  guard with a byte cap
//             • { artifacts: { "0": {...} } }      object with numeric-string keys
//           plus raw bytes (model/gltf-binary | octet-stream) and a zip holding a
//           .glb or an artifacts JSON. Every candidate is then validated as a real
//           model (valid GLB header, declared length, JSON chunk, at least one
//           mesh). An HTML error page, a truncated file or an empty scene is never
//           marked done: it fails with code nvcf_bad_artifact so the forge layer
//           can route around the lane. Validated bytes are persisted to R2 and a
//           durable public URL is returned like the other providers. On an
//           unrecognized shape the warn logs `json keys=[...] artifact[0]=[...]` so
//           the next schema drift is visible in the first failure.
//
// Error codes match the established provider contract (replicate.js / meshy.js):
//   provider_unreachable / invalid_key / insufficient_credits / rate_limited /
//   provider_error / nvcf_bad_artifact, so the forge layer can route around a
//   dead/limited lane. A 429 carries `retryAfter` (seconds) parsed from Retry-After.

import { unzipSync } from 'fflate';
import { env } from '../_lib/env.js';
import { SEED_MAX } from '../_lib/forge-seed.js';
import { inspectGlb } from '../_lib/glb-inspect.js';
import { fetchSafePublicUrl, MaxBytesExceededError, SsrfBlockedError } from '../_lib/ssrf-guard.js';

const TRELLIS_INVOKE_URL = 'https://ai.api.nvidia.com/v1/genai/microsoft/trellis';
const NVCF_STATUS_URL = 'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status';

// TRELLIS truncates the text prompt at 77 characters server-side; clamp so the
// request is honest about what's actually conditioning the generation.
const TRELLIS_PROMPT_MAX = 77;

// Without explicit lighting/color hints TRELLIS defaults to dark, gritty
// aesthetics. Reserve 17 chars at the end for a studio-lighting suffix and
// append it unless the caller already included their own lighting/color cues.
const TRELLIS_STYLE_SUFFIX = ', studio lighting';
const TRELLIS_STYLE_WORDS = ['studio', 'light', 'bright', 'backlit', 'colorful', 'vibrant', 'cartoon', 'stylized'];

function enhanceTrellisPrompt(raw) {
	const text = String(raw || '').trim();
	const lower = text.toLowerCase();
	const hasStyle = TRELLIS_STYLE_WORDS.some((w) => lower.includes(w));
	if (hasStyle) return text.slice(0, TRELLIS_PROMPT_MAX);
	const maxBase = TRELLIS_PROMPT_MAX - TRELLIS_STYLE_SUFFIX.length;
	return text.slice(0, maxBase) + TRELLIS_STYLE_SUFFIX;
}

// NVCF pexec hands off long jobs to async polling: the gateway holds the invoke
// connection open for at most NVCF-POLL-SECONDS waiting for a synchronous
// completion, then returns 202 + NVCF-REQID so we poll. WITHOUT this header the
// gateway held the connection until our own AbortSignal fired ("operation aborted
// due to timeout") and the request id was lost with the aborted socket — so a
// merely-slow generation surfaced as a hard "nvidia unreachable" and the whole
// free text→3D lane fell over. Capping the synchronous window at 30 s converts
// "slow" into a normal queued+poll job (the path the 202 branch already handles)
// while still completing fast draft jobs (~12–13 s) inline.
const NVCF_POLL_SECONDS = 30;

// Per-request timeouts so a hung upstream never stalls a serverless function.
// A completed poll streams the full GLB (can be several MB), so it gets longer.
// Submit only needs to outlast the NVCF-POLL-SECONDS synchronous window (30 s)
// plus transfer/handshake slack — at 35 s the gateway has already returned its
// 202 long before this backstop fires. (Was 45s; tightened — see
// SUBMIT_PHASE_DEADLINE_MS below for why a hard hang with zero response now
// aborts sooner instead of stacking with the retry budget.)
const SUBMIT_TIMEOUT_MS = 35_000;
const POLL_TIMEOUT_MS = 60_000;

// NVCF can answer a cold model — or a momentary capacity/routing blip at the
// gateway — with a transient 502/503/504, or drop the socket before a worker is
// warm. None of these is terminal: a short retry usually lands once the model
// spins up, which keeps the FREE lane from dead-ending straight to the (often
// equally throttled) paid Replicate lane and surfacing to the user as a hard 502.
// A hosted-preview 504 is the single most common blip (the gateway gives up on a
// slow worker), and it returns FAST — so retrying it a couple of times with
// spaced-out backoff is cheap and lands most of them on a warmed node, which is
// the main lever that stops a transient 504 from tripping the lane cooldown and
// dumping the request on the paid lane. Bounded to MAX_INVOKE_ATTEMPTS so a
// genuinely-down upstream still fails over fast rather than burning the whole
// serverless budget on a dead provider.
const GATEWAY_RETRY_STATUSES = new Set([502, 503, 504]);
const MAX_INVOKE_ATTEMPTS = 3;
const INVOKE_RETRY_BASE_MS = 1_000;
const INVOKE_RETRY_MAX_MS = 6_000;

// Overall wall-clock budget for the WHOLE submit-with-retries phase, on top of
// the per-attempt/per-status bounds above. Root-caused live 2026-07-08: with
// NVCF's hosted TRELLIS gateway in a degraded state, every invoke attempt
// returned HTTP 504 (`nvcf-status: errored`, empty body) at ~32s — comfortably
// under the (then) 45s per-attempt SUBMIT_TIMEOUT_MS, so it was never the
// per-attempt guard that fired. But MAX_INVOKE_ATTEMPTS retries stack: 3
// attempts x ~32s + 2 backoff sleeps totalled ~96-108s server-side — LONGER
// than every downstream client-side submit timeout guarding this call
// (api/_mcp-studio/forge-client.js `startForge` and
// mcp-server/src/tools/_studio-core.js `submitForge`, both 90s). So the caller
// (curl, the `forge_free` MCP tool, `/api/forge` itself) always saw a bare
// timeout with zero bytes, even though this provider would have correctly
// reported the lane as down and let forge.js's own "never dead-end" fallback
// (backendId='trellis' -> Replicate/HuggingFace) run — just too late, after
// every caller had already given up. This deadline stops the retry loop with
// enough of that 90s client budget left for the fallback lane to actually run
// and answer, instead of guaranteeing a client-side timeout on every request
// while NVCF is in this state. Self-adjusting: if NVCF's real failure latency
// changes, this still bounds the worst case rather than relying on a
// hand-tuned attempt count matching today's ~32s number.
//
// Sized at 30s (under one ~32s degraded-gateway attempt) so THIS failure mode —
// a single attempt already burning ~32s — bails after exactly one attempt,
// leaving ~55-60s of the 90s client budget for the FLUX-synthesis +
// Replicate-submit fallback (api/forge.js: backendId='trellis') to actually
// complete. A gateway that fails FAST (the common transient blip, a few
// hundred ms to a couple seconds) still gets its full MAX_INVOKE_ATTEMPTS
// retries, since each barely moves the elapsed-time needle against this
// budget; only a slow-failing gateway forfeits retries — which is exactly the
// case where they aren't worth the client's patience anyway.
const SUBMIT_PHASE_DEADLINE_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Backoff between invoke retries: exponential (base · 2^(n-1), capped) with full
// jitter so concurrent retries don't resynchronize into a thundering herd against
// a single warming node. When the gateway hands back a Retry-After we honour it
// (capped) instead of guessing.
function invokeRetryDelayMs(attempt, retryAfterSeconds) {
	const hinted = Number(retryAfterSeconds);
	if (Number.isFinite(hinted) && hinted > 0) return Math.min(hinted * 1000, INVOKE_RETRY_MAX_MS);
	const ceiling = Math.min(INVOKE_RETRY_BASE_MS * 2 ** (attempt - 1), INVOKE_RETRY_MAX_MS);
	return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

// Sampling steps per quality tier. TRELLIS accepts 10–50, but the NVIDIA HOSTED
// preview at this endpoint only returns within the gateway's synchronous window
// at the low end: a 15-step draft completes in ~13 s, while 25 steps overruns the
// gateway (it neither finishes inline nor hands back a pollable NVCF-REQID before
// our submit timeout), so the whole free lane aborts and silently degrades to the
// PAID Replicate fallback — exactly the "standard tier doesn't work like draft"
// failure. So the free hosted lane is pinned to the proven 15-step budget for both
// draft and standard; the tiers still differ in polycount/price (the catalog) and
// in the higher-fidelity PAID lanes a user can select. High routes to HuggingFace,
// not here, by default; its 40 stays for a self-hosted NIM (which serves the full
// window) if one is ever pointed at this provider.
function trellisSteps(tier) {
	const id = tier?.id || tier || 'draft';
	switch (id) {
		case 'high':
			return { ss: 40, slat: 40 };
		case 'standard':
		case 'draft':
		default:
			return { ss: 15, slat: 15 };
	}
}

// Map an upstream HTTP status onto the normalized error the forge layer routes
// on. `retryAfter` (seconds) is attached for 429 so callers can back off.
function providerError(status, message, retryAfter) {
	let code = 'provider_error';
	let mapped = 502;
	if (status === 401 || status === 403) {
		code = 'invalid_key';
		mapped = 401;
	} else if (status === 402) {
		code = 'insufficient_credits';
		mapped = 402;
	} else if (status === 429) {
		code = 'rate_limited';
		mapped = 429;
	}
	const err = Object.assign(new Error(message || `NVIDIA returned ${status}`), {
		code,
		status: mapped,
		providerStatus: status,
	});
	const secs = parseRetryAfterSeconds(retryAfter);
	if (secs != null) err.retryAfter = secs;
	return err;
}

// Ceiling on any result body NVIDIA points us at (a large-result download, or
// an artifact url). A TRELLIS GLB is a few MB; nothing real approaches this.
const MAX_RESULT_BYTES = 128 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

// HTTP Retry-After is either whole seconds or an HTTP date. Both become seconds
// from now, so a stated wait is honored whichever way NVIDIA spells it.
export function parseRetryAfterSeconds(value) {
	if (value == null || value === '') return null;
	const secs = Number(value);
	if (Number.isFinite(secs)) return secs >= 0 ? secs : null;
	const at = Date.parse(String(value));
	if (!Number.isFinite(at)) return null;
	return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

const isGlbBytes = (buf) => buf.length >= 12 && buf.toString('latin1', 0, 4) === 'glTF';
const isZipBytes = (buf) => buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5) && (buf[3] === 4 || buf[3] === 6);

// What the bytes must prove before they are stored as a finished model: a
// binary glTF 2.0 whose declared length fits the bytes, whose JSON chunk parses,
// and which holds at least one mesh. An HTML error page, a truncated transfer
// or an empty scene all fail here instead of being sold as a model.
function isRealModel(buf) {
	const info = inspectGlb(buf);
	return Boolean(info && info.meshCount > 0);
}

// Pick the artifact out of a parsed JSON result. NVCF has shipped it in several
// shapes over time; all are normalized to { base64 } or { url }:
//   { artifacts: [ { base64 } ] }  { artifacts: [ { data } ] }
//   { artifacts: [ "<base64>" ] }  { artifacts: [ { url } ] }
//   { artifacts: { "0": {...} } }  { output: "<base64>" }  { output: [ { base64 } ] }
// On an unrecognized shape the diagnostic names the keys so the next schema
// drift is visible in the first failure.
function pickArtifact(data) {
	const arts = data?.artifacts;
	const first = Array.isArray(arts)
		? arts[0]
		: arts && typeof arts === 'object'
			? (arts['0'] ?? Object.values(arts)[0])
			: undefined;
	const candidates = [
		typeof first === 'string' ? first : null,
		first?.base64,
		first?.data,
		first?.url,
		typeof data?.output === 'string' ? data.output : null,
		data?.output?.[0]?.base64,
	];
	const value = candidates.find((c) => typeof c === 'string' && c.length > 0);
	if (value) {
		if (/^https?:\/\//i.test(value)) return { url: value };
		return { base64: value.replace(/^data:[^,]*;base64,/i, '') };
	}
	const topKeys = data && typeof data === 'object' ? JSON.stringify(Object.keys(data)) : 'unparseable';
	let artDesc;
	if (Array.isArray(arts)) {
		if (arts.length === 0) artDesc = ' artifacts=[]';
		else if (first && typeof first === 'object') artDesc = ` artifact[0]=${JSON.stringify(Object.keys(first))}`;
		else artDesc = ` artifact[0]=${typeof first}`;
	} else if (arts !== null && arts !== undefined && typeof arts === 'object') {
		artDesc = ` artifacts(object)=${JSON.stringify(Object.keys(arts)).slice(0, 80)}`;
	} else {
		artDesc = ` artifacts=${arts === null ? 'null' : typeof arts}`;
	}
	return { diag: `json keys=${topKeys}${artDesc}` };
}

// Turn response bytes into a GLB, a url to download, or a diagnostic. Handles a
// raw GLB, a zip (NVCF delivers a large result as a zip) holding the GLB or the
// artifacts JSON, and the artifacts JSON itself.
function decodeResultBytes(buf) {
	if (!buf.length) return { diag: 'empty body' };
	if (isGlbBytes(buf)) return { glb: buf };
	if (isZipBytes(buf)) {
		let files;
		try {
			files = unzipSync(new Uint8Array(buf), { filter: (f) => f.originalSize <= MAX_RESULT_BYTES });
		} catch (err) {
			return { diag: `unreadable zip: ${err?.message}` };
		}
		const names = Object.keys(files);
		const glbName = names.find((n) => /\.glb$/i.test(n)) || names.find((n) => isGlbBytes(Buffer.from(files[n])));
		if (glbName) return { glb: Buffer.from(files[glbName]) };
		const jsonName = names.find((n) => /\.json$/i.test(n));
		if (jsonName) return decodeResultBytes(Buffer.from(files[jsonName]));
		return { diag: `zip holds no model: ${JSON.stringify(names).slice(0, 120)}` };
	}
	const head = buf.toString('utf8', 0, 64).trimStart()[0];
	if (head === '{' || head === '[') {
		let data;
		try {
			data = JSON.parse(buf.toString('utf8'));
		} catch {
			return { diag: 'unparseable json body' };
		}
		const art = pickArtifact(data);
		if (art.url) return { url: art.url };
		if (art.base64) return { glb: Buffer.from(art.base64, 'base64') };
		return { diag: art.diag };
	}
	return { diag: `body[0:160]=${buf.toString('utf8', 0, 160).replace(/[^\x20-\x7e]/g, '?')}` };
}

// Download a result NVIDIA points at (a 302 Location for a large result, or an
// artifact url). The url is untrusted input: it goes through the SSRF guard
// (public https only, every redirect hop re-checked), the byte ceiling is
// enforced while streaming, and the NVIDIA key is never sent to it.
// Resolves to { buf } or { diag, transient }, where transient marks a failure a
// later poll may succeed past (network error, 5xx).
async function downloadResult(url) {
	let res;
	try {
		res = await fetchSafePublicUrl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }, { maxBytes: MAX_RESULT_BYTES });
	} catch (err) {
		if (err instanceof SsrfBlockedError) return { diag: 'result url is not an allowed public https address' };
		if (err instanceof MaxBytesExceededError) return { diag: 'result is larger than the allowed size' };
		return { diag: `result url fetch error: ${err?.message}`, transient: true };
	}
	if (!res.ok) {
		await res.body?.cancel().catch(() => {});
		return { diag: `result url fetch ${res.status}`, transient: res.status >= 500 };
	}
	try {
		return { buf: Buffer.from(await res.arrayBuffer()) };
	} catch (err) {
		if (err instanceof MaxBytesExceededError) return { diag: 'result is larger than the allowed size' };
		return { diag: `result download interrupted: ${err?.message}`, transient: true };
	}
}

// Resolve a finished response (or a downloaded body) to validated GLB bytes.
// Resolves to { glb } or { glb: null, diag, invalid?, transient? }.
async function resolveGlb(buf) {
	let decoded = decodeResultBytes(buf);
	if (decoded.url) {
		const got = await downloadResult(decoded.url);
		if (!got.buf) return { glb: null, diag: got.diag, transient: got.transient };
		decoded = decodeResultBytes(got.buf);
		if (decoded.url) return { glb: null, diag: 'result url pointed at another url' };
	}
	if (!decoded.glb) return { glb: null, diag: decoded.diag };
	if (!isRealModel(decoded.glb)) {
		return { glb: null, invalid: true, diag: `bytes are not a glTF model (${decoded.glb.length} bytes, starts ${JSON.stringify(decoded.glb.toString('latin1', 0, 8))})` };
	}
	return { glb: decoded.glb };
}

async function extractGlb(res) {
	return resolveGlb(Buffer.from(await res.arrayBuffer()));
}

function buildTextBody({ prompt, tier, seed }) {
	const steps = trellisSteps(tier);
	const body = {
		mode: 'text',
		prompt: enhanceTrellisPrompt(prompt),
		ss_sampling_steps: steps.ss,
		slat_sampling_steps: steps.slat,
		output_format: 'glb',
	};
	// The TRELLIS NIM takes 0..4294967295 (minimum 0, exclusiveMaximum
	// 4294967296) but reads 0 as "pick a random seed", so a caller's seed 0 would
	// never reproduce. It is sent as 4294967295, a fixed mapping, so the same
	// caller seed always lands on the same mesh. See api/_lib/forge-seed.js.
	if (Number.isInteger(seed) && seed >= 0 && seed <= SEED_MAX) body.seed = seed === 0 ? SEED_MAX : seed;
	return body;
}

export function createNvidiaProvider() {
	const apiKey = env.NVIDIA_API_KEY;
	if (!apiKey) {
		throw Object.assign(
			new Error('NVIDIA_API_KEY env var is required for the nvidia (TRELLIS) provider'),
			{ code: 'missing_key', status: 503 },
		);
	}

	const authHeader = { authorization: `Bearer ${apiKey}` };
	const invokeHeaders = {
		...authHeader,
		accept: 'application/json',
		'content-type': 'application/json',
		// Bound the gateway's synchronous hold so a slow job becomes a pollable 202
		// instead of timing out our socket and losing the request id (see above).
		'nvcf-poll-seconds': String(NVCF_POLL_SECONDS),
	};
	// NVCF pexec results are CONSUME-ONCE: the first status GET that receives the
	// 200 body takes the artifact with it — a later poll 404s. Without an explicit
	// poll window the gateway may long-hold the status connection until the job
	// finishes; if our own POLL_TIMEOUT_MS abort fires while that 200 is being
	// delivered, the result is consumed by a socket nobody read and the job is
	// unrecoverable ("NVCF request not found or expired"). A short explicit window
	// makes every status call answer fast (202 or the ready 200) long before the
	// abort backstop, closing that loss window.
	const pollHeaders = { ...authHeader, accept: 'application/json', 'nvcf-poll-seconds': '10' };

	// Store validated GLB bytes in R2, returning a durable public URL, the same
	// persist the Vertex inline-PNG path uses, but for model bytes.
	async function persistGlb(glb) {
		const { putObject, cdnUrl } = await import('../_lib/r2.js');
		const key = `forge/nvidia/${globalThis.crypto.randomUUID()}.glb`;
		await putObject({
			key,
			body: glb,
			contentType: 'model/gltf-binary',
		});
		return cdnUrl(key);
	}

	// POST the invoke request. Returns either { done:true, glb } when the
	// generation completed synchronously (200) or { done:false, reqId } when NVCF
	// accepted it for async processing (202). Throws normalized provider errors.
	async function postInvoke(body, extraHeaders) {
		let lastErr = null;
		const phaseStart = Date.now();
		// True once the overall submit-phase budget (SUBMIT_PHASE_DEADLINE_MS) is
		// spent — checked before every retry so a degraded gateway (each attempt
		// individually within its per-attempt timeout, but repeatedly failing)
		// still bails with time left for forge.js's own lane fallback to run,
		// instead of stacking MAX_INVOKE_ATTEMPTS full attempts unconditionally.
		const deadlineExceeded = () => Date.now() - phaseStart >= SUBMIT_PHASE_DEADLINE_MS;
		for (let attempt = 1; attempt <= MAX_INVOKE_ATTEMPTS; attempt++) {
			let res;
			try {
				res = await fetch(TRELLIS_INVOKE_URL, {
					method: 'POST',
					headers: { ...invokeHeaders, ...extraHeaders },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
				});
			} catch (err) {
				lastErr = Object.assign(new Error(`nvidia unreachable: ${err?.message}`), {
					code: 'provider_unreachable',
					status: 502,
				});
				// A SUBMIT_TIMEOUT abort means the gateway held our connection open without
				// finishing or handing back a pollable id — retrying just hangs for another
				// full window (the bug that turned a slow lane into a ~90 s double-timeout
				// before failover). Make it terminal so the forge layer fails over to the
				// next lane fast. A genuine socket/DNS blip (not a timeout) still gets one
				// retry, so a single dropped connection doesn't fail the whole free lane.
				const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
				if (!timedOut && attempt < MAX_INVOKE_ATTEMPTS && !deadlineExceeded()) {
					await sleep(invokeRetryDelayMs(attempt));
					continue;
				}
				throw lastErr;
			}

			if (res.status === 202) {
				const reqId = res.headers.get('nvcf-reqid');
				if (!reqId) {
					throw Object.assign(new Error('NVCF accepted the job but returned no NVCF-REQID'), {
						code: 'provider_error',
						status: 502,
					});
				}
				return { done: false, reqId };
			}

			if (res.ok) {
				// NVCF sometimes returns 200 (instead of 202) with { artifacts: [] } and
				// an NVCF-REQID header when routing to async processing. Read the header
				// before consuming the body so we can fall through to the poll path.
				const reqId = res.headers.get('nvcf-reqid');
				const { glb, diag } = await extractGlb(res);
				if (!glb) {
					if (reqId) {
						// Async job on 200 — same path as 202.
						return { done: false, reqId };
					}
					console.warn('[nvidia] sync 200 but no usable GLB artifact: %s', diag);
					throw Object.assign(new Error('TRELLIS completed but returned no usable GLB artifact'), {
						code: 'provider_error',
						status: 502,
					});
				}
				return { done: true, glb };
			}

			// Transient gateway status — the model is likely cold-starting or a node
			// is momentarily unavailable. Drain the body so the socket frees, then
			// retry once; everything else (auth, quota, 4xx, 429) is terminal here and
			// surfaced as a normalized provider error the forge layer routes around.
			if (GATEWAY_RETRY_STATUSES.has(res.status) && attempt < MAX_INVOKE_ATTEMPTS) {
				await res.text().catch(() => {});
				const retryAfter = res.headers.get('retry-after');
				lastErr = providerError(res.status, undefined, retryAfter);
				// Live-verified 2026-07-08: a degraded NVCF gateway answers EVERY attempt
				// with a fast-but-not-instant 504 (~32s, `nvcf-status: errored`) — each
				// attempt alone looks like "a normal retryable blip", but three of them
				// plus backoff blew past every downstream client timeout (see
				// SUBMIT_PHASE_DEADLINE_MS above). Stop retrying once the overall phase
				// budget is spent, even if attempts remain.
				if (deadlineExceeded()) throw lastErr;
				await sleep(invokeRetryDelayMs(attempt, retryAfter));
				continue;
			}

			let detail = '';
			try {
				const d = await res.json();
				detail = d?.detail || d?.message || d?.title || '';
				// TRELLIS 422s carry `detail` as an array of validation objects — keep
				// it human-readable rather than collapsing to "[object Object]".
				if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
			} catch {
				detail = await res.text().catch(() => '');
			}
			throw providerError(res.status, detail || undefined, res.headers.get('retry-after'));
		}
		// Exhausted retries on a transient status/throw without a terminal verdict.
		throw (
			lastErr ||
			Object.assign(new Error('nvidia invoke failed after retries'), {
				code: 'provider_error',
				status: 502,
			})
		);
	}

	// Finish a submission: persist immediately on synchronous completion,
	// otherwise return the poll handle. Shared by the text and image paths.
	async function finishSubmit(kind, parsed) {
		if (parsed.done) {
			const resultGlbUrl = await persistGlb(parsed.glb);
			return { kind, taskId: null, resultGlbUrl };
		}
		return { kind, taskId: parsed.reqId };
	}

	return {
		// Native text→3D. Returns a poll handle, or a ready R2 GLB URL when NVCF
		// completed the job within the submit request.
		async textTo3d({ prompt, tier, seed } = {}) {
			const parsed = await postInvoke(buildTextBody({ prompt, tier, seed }), {});
			return finishSubmit('text-to-3d', parsed);
		},

		// Poll an async job. Never throws — transient failures resolve to
		// 'running' so the forge poll loop keeps the job alive; only terminal
		// upstream states map to 'failed'. On 'done' the GLB is decoded, persisted
		// to R2, and returned as a durable public URL.
		async status({ taskId } = {}) {
			if (!taskId) return { status: 'failed', error: 'missing NVCF request id' };

			let res;
			try {
				res = await fetch(`${NVCF_STATUS_URL}/${encodeURIComponent(taskId)}`, {
					headers: pollHeaders,
					// A large result answers 302 with a Location to fetch. It is followed by
					// hand below, through the SSRF guard and without the NVIDIA key.
					redirect: 'manual',
					signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
				});
			} catch (err) {
				return { status: 'running', error: `nvidia poll failed: ${err?.message}` };
			}

			if (res.status === 202) return { status: 'running' };

			// Finish a poll that produced a result: validate it as a real model, store
			// it, and report. A result that is not a model is a failure, never a done.
			const finish = async (outcome) => {
				if (!outcome.glb) {
					console.warn('[nvidia] poll result unusable: %s', outcome.diag);
					// A download that failed in a way a later poll may get past stays alive.
					if (outcome.transient) return { status: 'running', error: `NVIDIA result download failed: ${outcome.diag}` };
					return {
						status: 'failed',
						error: outcome.invalid
							? 'NVIDIA returned a file that is not a valid 3D model'
							: 'TRELLIS finished but returned no GLB artifact',
						code: 'nvcf_bad_artifact',
					};
				}
				try {
					return { status: 'done', resultGlbUrl: await persistGlb(outcome.glb) };
				} catch (err) {
					return { status: 'failed', error: `failed to persist GLB: ${err?.message}` };
				}
			};

			if (res.ok) return finish(await extractGlb(res));

			// 302: the result is too large to inline. Location is where it is served.
			if (res.status >= 300 && res.status < 400) {
				const location = res.headers.get('location');
				if (!location) return finish({ glb: null, diag: `${res.status} without a Location` });
				let target;
				try {
					target = new URL(location, `${NVCF_STATUS_URL}/${encodeURIComponent(taskId)}`).toString();
				} catch {
					return finish({ glb: null, diag: 'unparseable Location' });
				}
				const got = await downloadResult(target);
				if (!got.buf) return finish({ glb: null, diag: got.diag, transient: got.transient });
				return finish(await resolveGlb(got.buf));
			}

			if (res.status === 401 || res.status === 403) {
				return { status: 'failed', error: 'NVIDIA rejected the API key' };
			}
			// 402 is documented on this route: the cloud credits behind the hosted
			// function expired. It does not clear on a later poll, so polling it as
			// running only held every job to the 45-minute reaper.
			if (res.status === 402) {
				return {
					status: 'failed',
					error: 'NVIDIA cloud credits for the hosted TRELLIS function have expired',
					code: 'insufficient_credits',
					providerStatus: 402,
				};
			}
			// The request itself was rejected; asking again returns the same answer.
			if (res.status === 400 || res.status === 422) {
				return { status: 'failed', error: `NVIDIA rejected the request (${res.status})`, code: 'provider_error', providerStatus: res.status };
			}
			if (res.status === 404 || res.status === 410) {
				// The request id is gone: either the consume-once result was taken by a
				// racing/aborted poll, or NVCF's retention window lapsed. NVCF answers
				// 410 Gone for a request that ended in an upstream error (observed
				// 2026-11-18 on every errored TRELLIS job); polling that as "running"
				// held each user for the full 45-minute reap. Tagged with a
				// machine-readable code so the forge poll layer can attempt recovery
				// (re-check the store for a racing completion, then resubmit) instead of
				// dead-ending the user's generation.
				return { status: 'failed', error: 'NVCF request not found or expired', code: 'nvcf_expired' };
			}
			// 429 / 5xx mid-flight: the job may still be alive — keep polling.
			if (res.status === 429) {
				// The stated wait travels back so the poll layer stops asking until then.
				const retryAfter = parseRetryAfterSeconds(res.headers.get('retry-after'));
				return {
					status: 'running',
					error: 'NVIDIA is rate limiting; will retry',
					...(retryAfter != null ? { retryAfter } : {}),
				};
			}
			return { status: 'running', error: `NVIDIA poll returned ${res.status}` };
		},
	};
}
