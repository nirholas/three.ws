// POST /api/v1/ai/asr — speech-to-text for agents (free daily quota → x402).
// GET  /api/v1/ai/asr — capability probe (free, public).
//
// Productizes the platform's free NVIDIA NIM Riva lane (api/_lib/asr-nvidia.js)
// as a versioned, agent-callable endpoint. Nobody else in the x402 ecosystem
// sells ASR — this is the differentiated listing.
//   • Free tier: 5 calls/day per IP, audio ≤60s — the funnel.
//   • Above the free tier (quota exhausted OR clip >60s OR an X-PAYMENT header
//     is present) the request falls through to the x402 rail: a 402 challenge
//     with bazaar discovery, settled per clip in USDC.
//
// Request transports: a JSON body { audio: <base64>, format?, language?, words? }
// or raw bytes with an audio/* Content-Type (audio/wav | audio/pcm?rate= |
// audio/flac | audio/ogg). WebM/Opus must be decoded to PCM/WAV client-side.

import { cors, method, error, json, wrap, readBody } from '../../_lib/http.js';
import { clientIp, limits } from '../../_lib/rate-limit.js';
import { priceFor } from '../../_lib/x402-prices.js';
import { paidEndpoint } from '../../_lib/x402-paid-endpoint.js';
import { declareHttpDiscovery, withService } from '../../_lib/x402/bazaar-helpers.js';
import { installAccessControl } from '../../_lib/x402/access-control.js';
import {
	nvidiaAsrConfigured,
	parseAsrRequest,
	asrTranscribe,
	ASR_ACCEPTED_ENCODINGS,
	ASR_MAX_BODY_BYTES,
	FREE_ASR_MAX_SECONDS,
} from '../../_lib/ai-speech.js';

export const maxDuration = 30;

const ROUTE = '/api/v1/ai/asr';
const PRICE_ATOMICS = priceFor('ai-asr', '10000'); // $0.01 per clip (env: X402_PRICE_AI_ASR)

// Uniqueness-first: the first sentence answers "what can I only get here".
const DESCRIPTION =
	'Speech-to-text for agents over x402 — the only ASR lane in the x402 ecosystem; ' +
	'pay $0.01 USDC per clip, no API key, no account. POST WAV/PCM/FLAC/Ogg audio ' +
	'(base64 JSON or raw bytes) and get back the transcript with confidence, ' +
	'detected language, and duration. A free daily quota lets you try it first.';

const INPUT_EXAMPLE = {
	audio: 'UklGR... (base64-encoded WAV, ≤60s)',
	format: 'wav',
	language: 'en-US',
	words: false,
};

const INPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['audio'],
	properties: {
		audio: { type: 'string', description: 'Base64-encoded audio bytes (data: URIs are accepted).' },
		format: {
			type: 'string',
			enum: ASR_ACCEPTED_ENCODINGS,
			default: 'wav',
			description: 'Audio encoding of the supplied bytes.',
		},
		language: { type: 'string', default: 'en-US', description: 'BCP-47 language hint.' },
		sampleRate: { type: 'integer', description: 'Sample rate for raw PCM (Hz). Ignored for WAV (read from header).' },
		words: { type: 'boolean', default: false, description: 'Return word-level timestamps.' },
		model: { type: 'string', description: 'Override the Riva model name (optional).' },
	},
};

const OUTPUT_EXAMPLE = {
	text: 'schedule the deploy for friday morning',
	confidence: 0.94,
	duration: 2.1,
	language: 'en-US',
	model: 'riva-asr',
	tier: 'paid',
};

const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['text', 'language', 'model'],
	properties: {
		text: { type: 'string' },
		confidence: { type: 'number' },
		duration: { type: 'number', description: 'Seconds of audio processed.' },
		language: { type: 'string' },
		model: { type: 'string' },
		words: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					word: { type: 'string' },
					startMs: { type: 'number' },
					endMs: { type: 'number' },
					confidence: { type: 'number' },
				},
			},
		},
		tier: { type: 'string', enum: ['free', 'paid'] },
	},
};

const BAZAAR = declareHttpDiscovery({
	method: 'POST',
	bodyType: 'json',
	input: INPUT_EXAMPLE,
	inputSchema: INPUT_SCHEMA,
	output: { example: OUTPUT_EXAMPLE, schema: OUTPUT_SCHEMA },
});

// The x402 paid twin — built once, lazily. Reused for every over-quota / paying
// request.
let _paid = null;
function paidHandler() {
	if (_paid) return _paid;
	_paid = paidEndpoint({
		route: ROUTE,
		method: 'POST',
		priceAtomics: PRICE_ATOMICS,
		networks: ['base', 'solana'],
		description: DESCRIPTION,
		bazaar: BAZAAR,
		service: withService({
			serviceName: 'three.ws Speech-to-Text',
			tags: ['asr', 'speech', 'transcription', 'audio', 'ai'],
		}),
		requiredScope: 'x402:bypass',
		accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
		async handler({ req }) {
			const buf = req._aiSpeechBody ?? (await readBody(req, ASR_MAX_BODY_BYTES));
			const prepared = parseAsrRequest({ contentType: req.headers['content-type'], url: req.url, buf });
			const payload = await asrTranscribe(prepared);
			return { ...payload, tier: 'paid' };
		},
	});
	return _paid;
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	// ── Capability probe (free, public) ──────────────────────────────────────
	if (req.method === 'GET') {
		return json(
			res,
			200,
			{
				data: {
					endpoint: ROUTE,
					configured: nvidiaAsrConfigured(),
					encodings: ASR_ACCEPTED_ENCODINGS,
					sampleRate: 16000,
					free_tier: { per_day: 5, max_seconds: FREE_ASR_MAX_SECONDS },
					paid: { price_usdc: Number(PRICE_ATOMICS) / 1e6, networks: ['base', 'solana'] },
				},
			},
			{ 'cache-control': 'public, max-age=300' },
		);
	}

	// ── POST: transcribe ──────────────────────────────────────────────────────
	if (!nvidiaAsrConfigured()) {
		return error(
			res,
			503,
			'not_configured',
			'Speech-to-text is not configured (set NVIDIA_API_KEY and NVIDIA_ASR_FUNCTION_ID — ' +
				'discover the id with scripts/verify-nvidia-asr.mjs --list)',
		);
	}

	// Buffer the body once, then decide the lane — the paid rail reads the same
	// bytes (req._aiSpeechBody) so the stream is never consumed twice.
	let buf;
	try {
		buf = await readBody(req, ASR_MAX_BODY_BYTES);
	} catch (e) {
		if (e?.status === 413) return error(res, 413, 'payload_too_large', `request body exceeds the ${ASR_MAX_BODY_BYTES}-byte limit`);
		return error(res, 400, 'bad_request', e?.message || 'could not read request body');
	}
	req._aiSpeechBody = buf;
	// The stream is drained now; leave the bytes where readBody looks first so
	// the paid wrapper hashes the real clip into its idempotency key.
	if (!Buffer.isBuffer(req.rawBody)) req.rawBody = buf;

	// A payment header means the caller is on the paid rail already.
	const paymentPresent = Boolean(req.headers['x-payment'] || req.headers['payment-signature']);
	if (paymentPresent) return paidHandler()(req, res);

	// Parse/validate against the boundary (bad body 400, oversize 413, bad type
	// 415) so genuinely broken input never becomes a payment prompt.
	let prepared;
	try {
		prepared = parseAsrRequest({ contentType: req.headers['content-type'], url: req.url, buf });
	} catch (e) {
		return error(res, e.status || 400, e.code || 'bad_request', e.message);
	}

	// Beyond the free-tier duration cap (measurable for WAV/PCM) → pay per clip.
	if (prepared.durationSec != null && prepared.durationSec > FREE_ASR_MAX_SECONDS) {
		return paidHandler()(req, res);
	}

	// Free daily quota (per IP). Exhausted → the 402 challenge.
	const rl = await limits.aiAsrFreeIp(clientIp(req));
	if (!rl.success) return paidHandler()(req, res);

	try {
		const payload = await asrTranscribe(prepared);
		return json(
			res,
			200,
			{ data: { ...payload, tier: 'free', free_remaining_today: Math.max(0, rl.remaining) } },
			{ 'cache-control': 'no-store' },
		);
	} catch (e) {
		return error(res, e.status || 502, e.code || 'provider_error', e.message);
	}
});
