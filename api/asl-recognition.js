/**
 * /api/asl-recognition — webcam ASL fingerspelling → text.
 *
 *   GET  /api/asl-recognition
 *     → { columns: [390 landmark column names], max_frames, min_frames }
 *       The feature schema the browser must assemble per video frame
 *       (MediaPipe Holistic landmark selection, served by the worker).
 *
 *   POST /api/asl-recognition  { frames: [[390 numbers|null]…], clean?: boolean }
 *     → { text, raw, cleaned, confidence, frames, ms }
 *       `text` is the LLM-cleaned decode (send clean:false to skip that pass
 *       and get the worker's raw output); `confidence` is the recognizer's
 *       mean per-character softmax, which the UI uses to warn on a bad read.
 *
 * Word-level signs (PopSign ASL, 250 everyday signs) share the endpoint:
 *
 *   GET  /api/asl-recognition?mode=signs
 *     → { columns, max_frames, min_frames, labels, top_k }
 *   POST /api/asl-recognition  { mode: 'signs', frames }
 *     → { signs: [{ sign, probability } x5], confidence, frames, ms }
 *       503 { error: 'signs_unavailable' } until the worker carries the word
 *       model. `mode` defaults to 'fingerspelling'; any other value is a 400.
 *
 * Thin authenticated proxy to workers/model-asl-recognition (Kaggle-2023
 * ASLFR 1st-place model, Apache-2.0 weights, FSboard CC BY 4.0 corpus).
 * Landmarks are extracted client-side (src/sign-input.js), so raw video
 * never reaches the platform — only pose coordinates.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { fetchUpstream } from './_lib/upstream-fetch.js';

// One breaker for the worker: the schema read is idempotent and retried, a
// transcribe is a GPU inference and gets a single attempt with a long deadline.
const WORKER_BREAKER = 'asl-recognition-worker';
const SCHEMA_TIMEOUT_MS = 10_000;
const TRANSCRIBE_TIMEOUT_MS = 60_000;

// 1500 frames × 390 floats serializes to ~10–20 MB; cap the body above that.
const MAX_BODY_BYTES = 24_000_000;

function config() {
	const base = (process.env.GCP_ASL_RECOGNITION_URL || '').replace(/\/$/, '');
	const key = process.env.GCP_RECONSTRUCTION_KEY || '';
	return base && key ? { base, key } : null;
}

function unconfigured(res) {
	return json(res, 503, {
		error: 'unconfigured',
		message:
			'Sign recognition is not configured. Set GCP_ASL_RECOGNITION_URL and ' +
			'GCP_RECONSTRUCTION_KEY on the API service.',
	});
}

const MODES = ['fingerspelling', 'signs'];
const _schemas = {}; // mode -> { value, at }
const SCHEMA_TTL_MS = 10 * 60 * 1000;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const cfg = config();
	if (!cfg) return unconfigured(res);

	if (req.method === 'GET') {
		const qmode = new URL(req.url || '/', 'http://localhost').searchParams.get('mode') || 'fingerspelling';
		if (!MODES.includes(qmode)) return badMode(res);
		const cached = _schemas[qmode];
		if (cached && Date.now() - cached.at < SCHEMA_TTL_MS) return json(res, 200, cached.value);
		const r = await fetchUpstream(`${cfg.base}${qmode === 'signs' ? '/signs-schema' : '/schema'}`, {
			headers: { authorization: `Bearer ${cfg.key}` },
		}, { name: WORKER_BREAKER, timeoutMs: SCHEMA_TIMEOUT_MS, attempts: 3, okWhen: () => true });
		if (r.status === 503 && qmode === 'signs') return signsUnavailable(res);
		if (!r.ok) return json(res, 502, { error: 'worker_error', status: r.status });
		const value = await r.json();
		_schemas[qmode] = { value, at: Date.now() };
		return json(res, 200, value);
	}

	const rl = await limits.aslTranscribeIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'Sign recognition limit reached. Try again shortly.');
	const body = await readJson(req, MAX_BODY_BYTES).catch(() => null);
	if (!body || !Array.isArray(body.frames)) {
		return json(res, 400, { error: 'bad_request', message: 'Body must be { frames: [[…]] }.' });
	}
	const mode = body.mode ?? 'fingerspelling';
	if (!MODES.includes(mode)) return badMode(res);
	const route = mode === 'signs' ? '/recognize-signs' : '/transcribe';
	const r = await fetchUpstream(`${cfg.base}${route}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${cfg.key}`,
		},
		body: JSON.stringify({ frames: body.frames }),
	}, { name: WORKER_BREAKER, timeoutMs: TRANSCRIBE_TIMEOUT_MS, attempts: 1, okWhen: () => true });
	const out = await r.json().catch(() => ({}));
	if (mode === 'signs' && r.status === 503) return signsUnavailable(res);
	if (!r.ok) {
		return json(res, r.status === 400 ? 400 : 502, {
			error: r.status === 400 ? 'bad_frames' : 'worker_error',
			message: out.detail || out.message || `worker returned ${r.status}`,
		});
	}
	if (mode === 'signs') return json(res, 200, out);
	out.raw = out.text ?? '';
	if (out.raw && body.clean !== false) {
		out.text = await cleanTranscription(out.raw);
		out.cleaned = out.text !== out.raw;
	}
	return json(res, 200, out);
});

function badMode(res) {
	return json(res, 400, { error: 'bad_request', message: `mode must be one of: ${MODES.join(', ')}.` });
}

function signsUnavailable(res) {
	return json(res, 503, {
		error: 'signs_unavailable',
		message: 'Word-level sign recognition is not live yet. Fingerspelling is available.',
	});
}

/**
 * Webcam fingerspelling decodes at a 10–20% character error rate; a
 * constrained LLM pass recovers most of it ("esteredouble" → intended word).
 * Fail-open: any LLM problem returns the raw decode untouched.
 */
async function cleanTranscription(raw) {
	try {
		const { llmComplete, llmConfigured } = await import('./_lib/llm.js');
		if (!llmConfigured()) return raw;
		const cleaned = await llmComplete({
			system:
				'You correct noisy ASL fingerspelling transcriptions. The input is a ' +
				'machine decode of someone spelling letter by letter into a webcam; ' +
				'roughly 1 in 6 characters may be wrong, split, or merged. Return ONLY ' +
				'the most likely intended text, preserving meaning and proper nouns. ' +
				'No explanations, no quotes. If the input already looks right, return it unchanged.',
			user: raw,
			maxTokens: 120,
			timeoutMs: 8_000,
		});
		const text = (cleaned || '').trim();
		// Guard against LLM refusals/essays: a cleanup should stay in the same
		// size class as the input.
		if (!text || text.length > raw.length * 2 + 20) return raw;
		return text;
	} catch {
		return raw;
	}
}
