// Lane configuration, health, and response shaping for POST /api/v1/ai/image.
//
// The endpoint routes across the same free/subsidized text→image lanes the 3D
// forge uses (api/_mcp3d/text-to-image.js): NVIDIA NIM FLUX (free), Google
// Vertex/Gemini image (GCP credits), and a Replicate paid backstop. This module
// answers three questions the route needs without duplicating that lane logic:
//
//   1. Which lanes are configured right now? (drives the honest 503 before the
//      GCP env lands, and the /api/v1/ai/image?health=1 probe)
//   2. Is a delivered result a provider safety refusal? (→ 422, never retried)
//   3. What provider label + nominal dimensions describe the result?
//
// It never generates an image itself — health probes are auth/reachability
// checks against each lane's cheap surface, so they cost nothing against quota.

import { getGcpAccessToken, gcpAuthConfigured } from './gcp-auth.js';
import { providersInCooldown } from './provider-health.js';
import { describeImageLadder } from './image-rung-breaker.js';
import { vertexBreakerState } from './vertex-image-breaker.js';
import { imageModelChain, isModelNotFound, resolveImageModel } from './image-model.js';
import { HF_IMAGE_PROVIDERS } from '../_mcp3d/text-to-image.js';
import { NIM_FLUX_MODEL, NIM_FLUX_URL } from './nim-flux.js';

function readEnv(name) {
	if (typeof process !== 'undefined' && process.env?.[name]) return process.env[name];
	return null;
}

// Mirror of the private gate in text-to-image.js: the Vertex lane is active when
// GOOGLE_CLOUD_PROJECT is set unless VERTEX_IMAGEN_ENABLED explicitly disables it.
function vertexImagenEnabled() {
	const raw = readEnv('VERTEX_IMAGEN_ENABLED');
	if (raw == null) return true;
	return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

// The circuit-breaker key text-to-image.js records a NIM FLUX failure under, so
// the health probe can report a cooling lane as degraded without its own probe.
const NIM_FLUX_COOLDOWN_KEY = 'forge-nim-flux';

// Env vars that gate at least one image lane. Named verbatim in the 503 body so
// the operator knows exactly what to set. NVIDIA / Vertex are the primary
// subsidized lanes; Replicate is the paid backstop.
export const IMAGE_LANE_ENV = Object.freeze({
	nim: ['NVIDIA_API_KEY'],
	vertex: ['GOOGLE_CLOUD_PROJECT', 'GCP_SERVICE_ACCOUNT_JSON', 'GOOGLE_CLOUD_LOCATION'],
	replicate: ['REPLICATE_API_TOKEN'],
});

/**
 * Static (no-I/O) view of which lanes are wired from the current env. Matches
 * text-to-image.js's own config gate so "the endpoint works the moment a lane is
 * set" and "503 not_configured when none are" stay in lockstep with the router.
 */
export function imageLaneConfig() {
	const nim = Boolean(readEnv('NVIDIA_API_KEY'));
	const vertex = Boolean(readEnv('GOOGLE_CLOUD_PROJECT')) && vertexImagenEnabled();
	const replicate = Boolean(readEnv('REPLICATE_API_TOKEN'));
	const hf = Boolean(readEnv('HF_TOKEN'));
	// Pollinations needs no key, so an image lane is always configured.
	const pollinations = true;
	return {
		nim,
		vertex,
		replicate,
		hf,
		pollinations,
		anyConfigured: true,
	};
}

// Flat list of the env vars an operator must set to bring up an image lane —
// surfaced in the 503 body when nothing is configured.
export function missingLaneEnv() {
	return [...IMAGE_LANE_ENV.nim, ...IMAGE_LANE_ENV.vertex.slice(0, 2), ...IMAGE_LANE_ENV.replicate];
}

// ── Provider labelling + dimensions ──────────────────────────────────────────

// Canonical ~1MP pixel dimensions per aspect ratio, mirroring the NIM FLUX map.
// The lanes don't return the rendered size (Gemini takes an aspect ratio, not a
// width/height), so these are the nominal target dimensions for the request.
export const ASPECT_DIMENSIONS = Object.freeze({
	'1:1': [1024, 1024],
	'16:9': [1344, 768],
	'9:16': [768, 1344],
	'4:3': [1024, 768],
	'3:4': [768, 1024],
	'3:2': [1216, 832],
	'2:3': [832, 1216],
});

export const SUPPORTED_ASPECT_RATIOS = Object.freeze(Object.keys(ASPECT_DIMENSIONS));

export function dimensionsFor(aspectRatio) {
	const [width, height] = ASPECT_DIMENSIONS[aspectRatio] || ASPECT_DIMENSIONS['1:1'];
	return { width, height };
}

/**
 * Friendly provider label for a textToImage() result. Distinguishes NIM FLUX
 * from the Replicate flux backstop (both carry a black-forest-labs/flux* model
 * id) via the Replicate-only predictionId, Vertex by its vertex-ai/ prefix and
 * the keyless Pollinations lane by its pollinations/ prefix.
 */
export function providerLabel(result) {
	const model = String(result?.model || '');
	if (model.startsWith('vertex-ai/')) return 'vertex';
	if (model.startsWith('pollinations/')) return 'pollinations';
	if (model.startsWith('hf/')) return 'huggingface';
	if (result?.lane === 'livepeer') return 'livepeer';
	if (result?.predictionId) return 'replicate';
	if (model) return 'nvidia-nim';
	return 'unknown';
}

// ── Safety-refusal detection ─────────────────────────────────────────────────

// Gemini/Imagen block a prohibited prompt by returning candidates with a
// finishReason and no image part; text-to-image.js surfaces that as an error
// whose message carries the finishReason. These are the block enums Vertex emits.
const REFUSAL_FINISH_REASONS = /finishReason:\s*(SAFETY|IMAGE_SAFETY|PROHIBITED_CONTENT|RECITATION|BLOCKLIST|SPII|CONTENT_FILTERED|IMAGE_PROHIBITED_CONTENT)/i;
const REFUSAL_PHRASES = /\b(safety|content policy|prohibited content|blocked by|policy violation)\b/i;

/**
 * True when a thrown lane error is a provider safety refusal (content policy),
 * as opposed to a transient outage. A refusal is a terminal verdict about the
 * prompt — the caller must fix the prompt, so it is surfaced as 422 and never
 * retried. A rate-limit / unreachable / billing error is explicitly NOT a
 * refusal (those carry their own codes and are retryable).
 */
export function isProviderRefusal(err) {
	if (!err) return false;
	if (['rate_limited', 'provider_unreachable', 'billing', 'unconfigured'].includes(err.code)) return false;
	const msg = String(err.message || '');
	return REFUSAL_FINISH_REASONS.test(msg) || REFUSAL_PHRASES.test(msg);
}

/** Human-readable refusal reason pulled from the provider error, for the 422 body. */
export function refusalReason(err) {
	const msg = String(err?.message || '');
	const m = REFUSAL_FINISH_REASONS.exec(msg);
	if (m) return `Provider blocked this prompt (${m[1]}).`;
	return 'Provider declined this prompt for content-policy reasons.';
}

// ── Health probe ─────────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 3_000;

// NIM: a GET on the pinned FLUX route, folded with the rung's breaker so a
// cooling lane reads as degraded without a call. The genai gateway answers a
// GET on a served model route with 405 and on a retired or unknown id with 404,
// and never invokes the model for it, so the check is free and says whether the
// model the rung calls is still served. (It used to GET /v1/models, which does
// not exist on that host and always 404s, and read any status under 500 as ok.)
function nimVerdict(status) {
	if (status === 405 || status === 422 || (status >= 200 && status < 300)) return { status: 'ok' };
	if (status === 404 || status === 410) return { status: 'down', detail: `NVIDIA no longer serves ${NIM_FLUX_MODEL}` };
	if (status === 401 || status === 403) return { status: 'down', detail: 'NVIDIA rejected the API key' };
	if (status === 429) return { status: 'degraded', detail: 'NVIDIA is throttling the key' };
	if (status >= 500) return { status: 'down', detail: `NVIDIA gateway answered ${status}` };
	return { status: 'down', detail: `unexpected answer ${status}` };
}

async function probeNim() {
	if (!readEnv('NVIDIA_API_KEY')) return { configured: false, status: 'unconfigured' };
	let cooled = false;
	try {
		cooled = (await providersInCooldown([NIM_FLUX_COOLDOWN_KEY])).has(NIM_FLUX_COOLDOWN_KEY);
	} catch { /* cache miss → not cooling */ }
	if (cooled) return { configured: true, status: 'degraded', model: NIM_FLUX_MODEL, detail: 'recent failure cooldown' };
	try {
		const res = await fetch(NIM_FLUX_URL, {
			method: 'GET',
			headers: { authorization: `Bearer ${readEnv('NVIDIA_API_KEY')}` },
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		return { configured: true, model: NIM_FLUX_MODEL, httpStatus: res.status, ...nimVerdict(res.status) };
	} catch (err) {
		return { configured: true, status: 'down', model: NIM_FLUX_MODEL, detail: err?.message?.slice(0, 120) };
	}
}

// Vertex: mint a GCP access token. Success proves the service-account creds and
// the token endpoint work — the actual credit-burning generateContent call is
// never made, so this costs nothing against the image budget.
async function probeVertex() {
	const project = readEnv('GOOGLE_CLOUD_PROJECT');
	if (!project || !vertexImagenEnabled()) return { configured: false, status: 'unconfigured' };
	if (!gcpAuthConfigured()) {
		return {
			configured: true,
			status: 'down',
			detail: 'GCP_SERVICE_ACCOUNT_JSON not set',
			model: resolveImageModel(),
		};
	}
	// Probe the model the lane will actually call: the primary, and the retired
	// fallback only when Vertex says the primary is not served, exactly like a
	// real generation walks the chain.
	const chain = imageModelChain();
	let model = chain[0];
	const location = readEnv('GOOGLE_CLOUD_LOCATION') || 'us-central1';
	try {
		const token = await getGcpAccessToken();
		// Minting a token proves the service account, NOT that Vertex will serve.
		// A project in billing dunning hands out tokens happily and then 403s
		// every generative call ("Lightning dunning decision is deny"), which
		// this probe reported as `ok` for a lane that could not paint a single
		// image (observed 2026-08-27). Ask the API itself.
		//
		// countTokens, specifically: it is free, consumes no image quota, and
		// runs the same project + publisher-model path a real generate does, so
		// it fails with the identical project-level denial. The read-only
		// endpoints (publishers/models) were tried first and are wrong for this:
		// they 404 with an HTML body on the regional host whether or not the
		// project is healthy, which would report a working lane as down.
		const host = location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`;
		const countTokens = (id) =>
			fetch(`${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${id}:countTokens`, {
				method: 'POST',
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] }),
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			});
		let res = await countTokens(model);
		let body = '';
		for (let i = 1; !res.ok && i < chain.length; i++) {
			body = await res.text().catch(() => '');
			if (!isModelNotFound(res.status, body)) break;
			model = chain[i];
			body = '';
			res = await countTokens(model);
		}
		if (res.ok) return { configured: true, status: 'ok', model, location };
		if (!body) body = await res.text().catch(() => '');
		let message = body.slice(0, 120);
		try {
			message = JSON.parse(body)?.error?.message || message;
		} catch {
			/* a non-JSON body (an HTML gateway error) keeps the raw prefix */
		}
		// Name the billing hold explicitly: it reads like an IAM problem and
		// sends operators chasing service-account roles instead of the console.
		return {
			configured: true,
			status: 'down',
			httpStatus: res.status,
			detail: /dunning/i.test(message)
				? 'project billing is in dunning: generative APIs denied until the billing account is settled'
				: message.slice(0, 120) || `HTTP ${res.status}`,
			model,
			location,
		};
	} catch (err) {
		return { configured: true, status: 'down', detail: err?.message?.slice(0, 120), model, location };
	}
}

// Replicate: authenticated GET /v1/account — 200 proves a valid key + reachable
// host without creating a (billed) prediction.
async function probeReplicate() {
	const token = readEnv('REPLICATE_API_TOKEN');
	if (!token) return { configured: false, status: 'unconfigured' };
	try {
		const res = await fetch('https://api.replicate.com/v1/account', {
			headers: { authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		if (res.status === 200) return { configured: true, status: 'ok' };
		if (res.status === 401) return { configured: true, status: 'down', detail: 'invalid token' };
		return { configured: true, status: res.status < 500 ? 'ok' : 'down', httpStatus: res.status };
	} catch (err) {
		return { configured: true, status: 'down', detail: err?.message?.slice(0, 120) };
	}
}

/**
 * Per-lane configured/reachable health for the /api/v1/ai/image?health=1 probe.
 * Probes only configured lanes; unconfigured lanes report `unconfigured` with no
 * network call. `healthy` is true when at least one lane is reachable, so the
 * probe distinguishes "not wired yet" from "wired but every lane is down".
 */
// HF: ask each router rung the forge actually calls (HF_IMAGE_PROVIDERS), not
// whoami. A valid token says nothing about serving: on 2026-11-25 whoami was
// 200 while every Inference Providers call answered 402 "Purchase pre-paid
// credits" and /nscale/... answered 400 "no longer supported", and this probe
// read `ok` over a lane that could not paint one image. The router checks
// credit and route before it validates the body, so an empty POST costs
// nothing: 402 means no credit, 400 "no longer supported" or 404 means the
// route is gone, and a validation refusal (400/422) means the request reached
// a provider that would have served it. HF's provider mapping for
// FLUX.1-schnell names a provider HF dropped even before a request fails.
const HF_MAPPING_URL = 'https://huggingface.co/api/models/black-forest-labs/FLUX.1-schnell?expand[]=inferenceProviderMapping';

function hfErrorMessage(text) {
	try {
		const body = JSON.parse(text);
		if (typeof body?.error === 'string') return body.error;
		if (typeof body?.error?.message === 'string') return body.error.message;
		if (typeof body?.message === 'string') return body.message;
	} catch {
		/* a non-JSON body keeps its raw prefix */
	}
	return String(text || '').replace(/\s+/g, ' ').trim();
}

async function probeHfProvider(provider, token, mapping) {
	const mapped = mapping ? mapping[provider.id]?.status === 'live' : null;
	try {
		const res = await fetch(provider.url, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
			body: '{}',
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		const message = hfErrorMessage(await res.text().catch(() => '')).slice(0, 160);
		const retired = res.status === 404 || /no longer supported/i.test(message);
		const reachedProvider = res.ok || ((res.status === 400 || res.status === 422) && !retired);
		return {
			id: provider.id,
			mapped,
			status: reachedProvider ? 'ok' : 'down',
			httpStatus: res.status,
			...(reachedProvider ? {} : { detail: message || `HTTP ${res.status}` }),
		};
	} catch (err) {
		return { id: provider.id, mapped, status: 'down', detail: err?.message?.slice(0, 120) };
	}
}

async function probeHf() {
	const token = readEnv('HF_TOKEN');
	if (!token) return { configured: false, status: 'unconfigured' };
	const mapping = await fetch(HF_MAPPING_URL, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
		.then((res) => (res.ok ? res.json() : null))
		.then((body) => body?.inferenceProviderMapping || null)
		.catch(() => null);
	const providers = await Promise.all(HF_IMAGE_PROVIDERS.map((p) => probeHfProvider(p, token, mapping)));
	const serving = providers.filter((p) => p.status === 'ok');
	if (serving.length) return { configured: true, status: 'ok', providers };
	const reasons = [...new Set(providers.map((p) => p.detail).filter(Boolean))];
	return { configured: true, status: 'down', detail: reasons.join('; ').slice(0, 200) || 'no provider reachable', providers };
}

async function probePollinations() {
	try {
		const res = await fetch('https://image.pollinations.ai/', { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
		return { configured: true, status: res.status < 500 ? 'ok' : 'down', httpStatus: res.status };
	} catch (err) {
		return { configured: true, status: 'down', detail: err?.message?.slice(0, 120) };
	}
}

export async function imageLaneHealth() {
	const [nim, vertex, replicate, hf, pollinations, ladder] = await Promise.all([
		probeNim(),
		// The Vertex lane's own classified breaker rides along: parked or not,
		// the failure class that parked it and when the next probe goes out.
		// Cache read only; it never calls Vertex.
		probeVertex().then(async (v) =>
			v.configured ? { ...v, breaker: await vertexBreakerState().catch(() => null) } : v,
		),
		probeReplicate(),
		probeHf(),
		probePollinations(),
		// What the text-to-image ladder will actually do next: each rung in walk
		// order, its breaker state, the last failure class and when it is tried
		// again. Read from the shared cache only, never a provider call.
		describeImageLadder().catch(() => null),
	]);
	const lanes = { nim, vertex, replicate, hf, pollinations };
	const anyConfigured = Object.values(lanes).some((l) => l.configured);
	const anyReachable = Object.values(lanes).some((l) => l.status === 'ok');
	return {
		endpoint: '/api/v1/ai/image',
		configured: anyConfigured,
		healthy: anyReachable,
		lanes,
		ladder,
		// The keyless rung means `configured` is always true, so this names the
		// KEYED lanes an operator has not brought up, not "nothing at all".
		missing_env: [
			...(nim.configured ? [] : IMAGE_LANE_ENV.nim),
			...(vertex.configured ? [] : IMAGE_LANE_ENV.vertex.slice(0, 2)),
			...(hf.configured ? [] : ['HF_TOKEN']),
			...(replicate.configured ? [] : IMAGE_LANE_ENV.replicate),
		],
	};
}
