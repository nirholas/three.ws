// Grok Imagine image generation on the platform's xAI key. generateXaiImage
// takes a prompt plus options (aspect ratio, resolution, quality, timeout, usage
// tracking) and resolves to the image bytes, their base64 and mime type, the
// revised prompt when xAI returns one, the model, the cost and the latency.
//
// One request to POST https://api.x.ai/v1/images/generations with
// response_format "b64_json", so the bytes come back inline and the caller
// persists them to our own storage (a returned xAI URL is short-lived). Request
// and response shapes: https://docs.x.ai/developers/rest-api-reference/inference/images.md
// and https://docs.x.ai/developers/model-capabilities/images/generation.md,
// read 2026-11-20. A `url` answer (response_format unset, or deferred mode) is
// downloaded inside the same timeout. Model id and endpoint live in chat-models.js.
//
// Every failure throws an XaiImageError whose `kind` the caller switches on:
//   no_key        GROK_API_KEY / XAI_API_KEY unset (no request is made)
//   auth          401 (no or invalid credentials), 403, or the 400
//                 "Incorrect API key provided" xAI answers for a malformed key
//   rate_limited  429 (xAI documents 6 requests per second for Image 2.0)
//   refused       content moderation: a 4xx whose message names moderation or
//                 policy, or a 200 that flags the image as filtered
//   timeout       no answer within timeoutMs
//   unreachable   network failure before any HTTP status
//   bad_response  a 2xx with no image in it, or an image URL that will not download
//   provider_error any other non-2xx
//
// Each call (success or failure) writes one usage_events row with client_id
// 'xai-imagine' through usage.js; a success also feeds the xAI credit ledger
// (xai-usage.js) when that module is deployed. Neither write can fail the call.

import { env } from './env.js';
import { recordEvent } from './usage.js';
import { XAI_IMAGE_GENERATIONS_URL, XAI_IMAGINE_IMAGE_MODEL } from './chat-models.js';

export const XAI_IMAGINE_CLIENT_ID = 'xai-imagine';
export const XAI_IMAGE_DEFAULT_TIMEOUT_MS = 60_000;

// Aspect ratios /v1/images/generations accepts (REST reference, request body).
const XAI_ASPECTS = new Set([
	'1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1', '21:9', '5:2',
]);
// Forge aspects xAI does not list, mapped to the nearest one it does.
const NEAREST_ASPECT = { '4:5': '3:4', '5:4': '4:3' };
const RESOLUTIONS = new Set(['1k', '1.5k', '2k']);
const QUALITIES = new Set(['low', 'medium', 'auto']);

// One USD is 10,000,000,000 ticks (REST reference, usage.cost_in_usd_ticks),
// so one micro-USD is 10,000 ticks.
const TICKS_PER_MICRO_USD = 10_000;

const REFUSAL_TEXT = /moderat|content polic|usage polic|safety|violat|prohibited|not allowed|inappropriate|filtered/i;
const BAD_KEY_TEXT = /incorrect api key|invalid api key|api key not valid/i;

export class XaiImageError extends Error {
	constructor(kind, message, { status = null, code = null } = {}) {
		super(message);
		this.name = 'XaiImageError';
		this.kind = kind;
		this.providerStatus = status;
		this.providerCode = code;
		if (kind === 'rate_limited') this.code = 'rate_limited';
		if (kind === 'refused') this.code = 'content_refused';
	}
}

export function xaiAspect(aspectRatio) {
	const a = String(aspectRatio || '').trim();
	if (XAI_ASPECTS.has(a)) return a;
	return NEAREST_ASPECT[a] || '1:1';
}

export function xaiImageConfigured() {
	return Boolean(env.GROK_API_KEY);
}

// xAI error bodies are `{ code, error }` (observed live 2026-11-20:
// {"code":"unauthenticated:no-credentials","error":"No credentials presented."}).
// OpenAI-compatible `{ error: { message, code } }` is read too.
function readErrorBody(text) {
	try {
		const j = JSON.parse(text);
		const message = typeof j?.error === 'string' ? j.error : j?.error?.message || j?.message || '';
		const code = typeof j?.code === 'string' ? j.code : j?.error?.code || null;
		return { message: String(message || text).slice(0, 300), code };
	} catch {
		return { message: String(text || '').slice(0, 300), code: null };
	}
}

/** Map a non-2xx answer to the typed error. PURE. */
export function classifyXaiImageFailure(status, bodyText) {
	const { message, code } = readErrorBody(bodyText);
	const detail = `xai image ${status}${code ? ` ${code}` : ''}: ${message}`;
	if (status === 401 || status === 403 || (status === 400 && BAD_KEY_TEXT.test(message))) {
		return new XaiImageError('auth', detail, { status, code });
	}
	if (status === 429) return new XaiImageError('rate_limited', detail, { status, code });
	if (status >= 400 && status < 500 && (REFUSAL_TEXT.test(message) || REFUSAL_TEXT.test(code || ''))) {
		return new XaiImageError('refused', detail, { status, code });
	}
	return new XaiImageError('provider_error', detail, { status, code });
}

/**
 * Read the first image out of a 2xx body, or throw the typed error. PURE.
 * Returns inline bytes when the body carries `b64_json`, otherwise the `url`
 * the caller downloads (the shape xAI answers with when response_format is
 * unset or "url", and the only shape its deferred mode supports).
 */
export function parseXaiImageResponse(data) {
	const item = Array.isArray(data?.data) ? data.data[0] : null;
	if (data?.respect_moderation === false || item?.respect_moderation === false) {
		throw new XaiImageError('refused', 'xai image filtered by content moderation', { status: 200 });
	}
	const b64 = typeof item?.b64_json === 'string' && item.b64_json ? item.b64_json : null;
	const url = typeof item?.url === 'string' && item.url ? item.url : null;
	if (!b64 && !url) throw new XaiImageError('bad_response', 'xai image response carried no image', { status: 200 });
	const bytes = b64 ? Buffer.from(b64, 'base64') : null;
	if (bytes && !bytes.length) throw new XaiImageError('bad_response', 'xai image response decoded to zero bytes', { status: 200 });
	const ticks = Number(data?.usage?.cost_in_usd_ticks);
	return {
		bytes,
		url: bytes ? null : url,
		mime: typeof item?.mime_type === 'string' && item.mime_type ? item.mime_type : null,
		revisedPrompt: typeof item?.revised_prompt === 'string' && item.revised_prompt ? item.revised_prompt : null,
		costMicroUsd: Number.isFinite(ticks) && ticks >= 0 ? Math.round(ticks / TICKS_PER_MICRO_USD) : null,
		usage: data?.usage ?? null,
	};
}

async function downloadImage(url, timeoutMs) {
	let res;
	try {
		res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	} catch (err) {
		const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
		throw new XaiImageError(timedOut ? 'timeout' : 'unreachable', `xai image download failed: ${err?.message || err}`);
	}
	if (!res.ok) throw new XaiImageError('bad_response', `xai image download ${res.status}`, { status: res.status });
	const bytes = Buffer.from(await res.arrayBuffer());
	if (!bytes.length) throw new XaiImageError('bad_response', 'xai image download was empty');
	return { bytes, mime: res.headers.get('content-type')?.split(';')[0].trim() || null };
}

function sniffMime(bytes) {
	if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
	if (bytes.slice(0, 4).toString() === 'RIFF') return 'image/webp';
	return 'image/jpeg';
}

function recordCall({ status, model, latencyMs, costMicroUsd, track, meta }) {
	recordEvent({
		kind: 'image',
		provider: 'xai',
		model,
		tool: track?.tool ?? 'forge_reference_image',
		status,
		latencyMs,
		costMicroUsd,
		clientId: XAI_IMAGINE_CLIENT_ID,
		userId: track?.userId ?? null,
		apiKeyId: track?.apiKeyId ?? null,
		meta: { client: XAI_IMAGINE_CLIENT_ID, ...meta },
	});
}

// The xAI credit ledger (order 878) is optional: when its module is deployed a
// generated image is metered against the startups grant; when it is not, the
// usage_events row above is the record.
function recordLedger(model, usage) {
	import('./xai-usage.js')
		.then((m) => m.recordXaiUsage?.({ lane: 'image', model, usage, units: 1, meta: { client: XAI_IMAGINE_CLIENT_ID } }))
		.catch(() => {});
}

/**
 * Generate one image with Grok Imagine.
 * @param {string} prompt
 * @param {{ aspectRatio?: string, resolution?: string, quality?: string, timeoutMs?: number, model?: string,
 *   track?: { userId?: string, apiKeyId?: string, tool?: string } }} [opts]
 */
export async function generateXaiImage(prompt, opts = {}) {
	const model = opts.model || XAI_IMAGINE_IMAGE_MODEL;
	const apiKey = env.GROK_API_KEY;
	if (!apiKey) throw new XaiImageError('no_key', 'xai image lane needs GROK_API_KEY (or XAI_API_KEY)');
	const text = String(prompt || '').trim();
	if (!text) throw new XaiImageError('provider_error', 'xai image prompt is empty');

	const body = {
		model,
		prompt: text,
		n: 1,
		response_format: 'b64_json',
		aspect_ratio: xaiAspect(opts.aspectRatio),
	};
	const resolution = String(opts.resolution || process.env.XAI_IMAGE_RESOLUTION || '').toLowerCase();
	if (RESOLUTIONS.has(resolution)) body.resolution = resolution;
	const quality = String(opts.quality || process.env.XAI_IMAGE_QUALITY || '').toLowerCase();
	if (QUALITIES.has(quality)) body.quality = quality;

	const timeoutMs = Math.max(1_000, Number(opts.timeoutMs) || XAI_IMAGE_DEFAULT_TIMEOUT_MS);
	const meta = { aspect: body.aspect_ratio, resolution: body.resolution ?? '1k', quality: body.quality ?? 'auto' };
	const startedAt = Date.now();
	const fail = (err) => {
		recordCall({ status: err.kind, model, latencyMs: Date.now() - startedAt, costMicroUsd: null, track: opts.track, meta });
		return err;
	};

	let res;
	try {
		res = await fetch(XAI_IMAGE_GENERATIONS_URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (err) {
		const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
		throw fail(
			timedOut
				? new XaiImageError('timeout', `xai image timed out after ${timeoutMs}ms`)
				: new XaiImageError('unreachable', `xai image unreachable: ${err?.message || err}`),
		);
	}

	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw fail(classifyXaiImageFailure(res.status, detail));
	}

	let parsed;
	try {
		parsed = parseXaiImageResponse(await res.json());
		if (!parsed.bytes) {
			const remaining = Math.max(1_000, timeoutMs - (Date.now() - startedAt));
			const dl = await downloadImage(parsed.url, remaining);
			parsed = { ...parsed, bytes: dl.bytes, mime: parsed.mime || dl.mime };
		}
	} catch (err) {
		throw fail(err instanceof XaiImageError ? err : new XaiImageError('bad_response', `xai image body unreadable: ${err?.message}`));
	}
	const mime = parsed.mime || sniffMime(parsed.bytes);

	const latencyMs = Date.now() - startedAt;
	recordCall({
		status: 'ok',
		model,
		latencyMs,
		costMicroUsd: parsed.costMicroUsd,
		track: opts.track,
		meta: { ...meta, revised_prompt: Boolean(parsed.revisedPrompt), bytes: parsed.bytes.length },
	});
	recordLedger(model, parsed.usage);
	return {
		bytes: parsed.bytes,
		b64: parsed.bytes.toString('base64'),
		mime,
		revisedPrompt: parsed.revisedPrompt,
		model,
		costMicroUsd: parsed.costMicroUsd,
		latencyMs,
	};
}
