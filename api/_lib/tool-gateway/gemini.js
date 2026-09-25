// Gemini on Vertex AI for gateway tools that hand the model a file: the
// transcribe fallback (audio) and parse_document (PDF). Native generateContent
// with inline data, authenticated with the platform's GCP service account and
// billed to GCP credits, the same rung api/_lib/web-search.js rides.
//
// Gated only by GOOGLE_CLOUD_PROJECT. A token or upstream failure throws a
// GatewayError the calling tool maps into its own failover or its refund.

import { getGcpAccessToken } from '../gcp-auth.js';
import { vertexGeminiAvailable, vertexGeminiModel } from '../vertex-gemini.js';
import { GatewayError } from './errors.js';

/** Inline request bodies Vertex accepts are capped near 20 MB; stay under it. */
export const GEMINI_INLINE_MAX_BYTES = 15 * 1024 * 1024;

export function geminiFilesAvailable() {
	return vertexGeminiAvailable();
}

function generateUrl() {
	const project = process.env.GOOGLE_CLOUD_PROJECT;
	const location = process.env.GOOGLE_CLOUD_LOCATION_GEMINI || 'global';
	const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
	const model = vertexGeminiModel().replace(/^google\//, '');
	return { url: `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`, model };
}

/**
 * Ask Gemini about one inline file.
 *
 * @param {object} o
 * @param {Buffer} o.data
 * @param {string} o.mimeType
 * @param {string} o.instruction   what to do with the file
 * @param {number} [o.maxOutputTokens]
 * @param {number} [o.timeoutMs]
 * @param {object} [o.responseSchema]  when set, Gemini answers JSON matching this schema
 * @returns {Promise<{ text: string, model: string, usage: { input: number, output: number, byModality: Record<string, number> } }>}
 */
export async function geminiReadFile({ data, mimeType, instruction, maxOutputTokens = 8192, timeoutMs = 90_000, responseSchema = null }) {
	if (!geminiFilesAvailable()) {
		throw new GatewayError(503, 'not_configured', 'Gemini on Vertex AI is not configured on this deployment (GOOGLE_CLOUD_PROJECT is unset).');
	}
	if (data.length > GEMINI_INLINE_MAX_BYTES) {
		throw new GatewayError(413, 'too_large', `That file is larger than the ${Math.round(GEMINI_INLINE_MAX_BYTES / 1_048_576)} MB limit for this tool.`);
	}
	let token;
	try {
		token = await getGcpAccessToken();
	} catch (err) {
		throw new GatewayError(503, 'not_configured', `No GCP credential is available for Vertex AI: ${err?.message || err}`);
	}
	const { url, model } = generateUrl();
	let res;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({
				contents: [
					{
						role: 'user',
						parts: [{ inlineData: { mimeType, data: data.toString('base64') } }, { text: instruction }],
					},
				],
				generationConfig: {
					temperature: 0,
					maxOutputTokens,
					thinkingConfig: { thinkingBudget: 0 },
					...(responseSchema ? { responseMimeType: 'application/json', responseSchema } : {}),
				},
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (err) {
		if (err?.name === 'TimeoutError') throw new GatewayError(504, 'upstream_timeout', `Gemini did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
		throw new GatewayError(502, 'upstream_unreachable', `Could not reach Vertex AI: ${err?.message || err}`);
	}
	const body = await res.text();
	if (!res.ok) {
		const status = res.status === 429 ? 429 : res.status === 400 ? 422 : 502;
		throw new GatewayError(status, res.status === 429 ? 'rate_limited' : 'upstream_error', `Vertex AI answered HTTP ${res.status}: ${body.slice(0, 300)}`);
	}
	let json;
	try {
		json = JSON.parse(body);
	} catch {
		throw new GatewayError(502, 'upstream_error', 'Vertex AI returned a body that is not JSON.');
	}
	const cand = json?.candidates?.[0];
	const text = (cand?.content?.parts || []).map((p) => p?.text || '').join('');
	if (!text && cand?.finishReason && cand.finishReason !== 'STOP') {
		throw new GatewayError(422, 'content_blocked', `Gemini declined this file (finishReason: ${cand.finishReason}).`);
	}
	return {
		text,
		model: `vertex-ai/${model}`,
		finishReason: cand?.finishReason || null,
		usage: {
			input: Number(json?.usageMetadata?.promptTokenCount || 0),
			output: Number(json?.usageMetadata?.candidatesTokenCount || 0),
			byModality: modalityTokens(json?.usageMetadata?.promptTokensDetails),
		},
	};
}

// Prompt tokens per input modality (AUDIO, DOCUMENT, TEXT, IMAGE). Gemini bills
// audio at a fixed 32 tokens a second and a PDF at 258 tokens a page, so these
// counts double as a duration and page measure for formats the gateway cannot
// parse itself.
function modalityTokens(details) {
	const out = {};
	for (const d of Array.isArray(details) ? details : []) {
		if (d?.modality) out[String(d.modality).toUpperCase()] = Number(d.tokenCount || 0);
	}
	return out;
}

/** Gemini audio input rate: tokens per second of audio. */
export const GEMINI_AUDIO_TOKENS_PER_SECOND = 32;
/** Gemini document input rate: tokens per PDF page. */
export const GEMINI_TOKENS_PER_PDF_PAGE = 258;
