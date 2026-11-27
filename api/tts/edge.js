/**
 * POST /api/tts/edge  (legacy route, kept so deployed clients keep working)
 *
 * The Microsoft Edge Read Aloud lane was retired: it is a consumer browser
 * feature, not a licensed API. This route now renders on the platform's
 * licensed default lane (Google Gemini TTS, via api/_lib/voice-providers.js).
 * A stored Edge-style voice id ("en-US-AriaNeural") is mapped to the closest
 * Gemini voice instead of erroring.
 * Caches synthesized clips in R2 by sha256(voice + text) for 30 days.
 *
 * Body: { voice?: string, text: string }  (rate/pitch are accepted and ignored)
 * Response: audio/wav
 */

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { sha256 } from '../_lib/crypto.js';
import { headObject, getObjectBuffer, putObject } from '../_lib/r2.js';
import { synthesizeVoice, DEFAULT_PROVIDER_ID, isKnownVoice } from '../_lib/voice-providers.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');

	const userId = session?.id ?? bearer?.userId;
	const rl = await limits.ttsEdge(String(userId));
	if (!rl.success) {
		const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
		res.setHeader('retry-after', String(retryAfter));
		return rateLimited(res, rl, 'Too many TTS requests', { retry_after: retryAfter });
	}

	const body = await readJson(req);
	const voice = String(body.voice || '').trim();
	const text = String(body.text || '').trim();

	if (!text) return error(res, 400, 'validation_error', 'text is required');
	if (text.length > 500)
		return error(res, 400, 'validation_error', 'text exceeds 500 chars per request');
	if (!(await isKnownVoice(DEFAULT_PROVIDER_ID, voice)))
		return error(res, 400, 'validation_error', 'invalid voice name');

	const cacheHash = await sha256(`${voice}\x00${text}`);
	const cacheKey = `tts/legacy-voice/${cacheHash}.wav`;

	const cached = await headObject(cacheKey).catch(() => null);
	if (cached) {
		try {
			const buf = await getObjectBuffer(cacheKey);
			res.setHeader('content-type', 'audio/wav');
			res.setHeader('content-length', String(buf.length));
			res.setHeader('x-tts-cache', 'hit');
			res.setHeader('cache-control', 'private, max-age=86400');
			return res.end(buf);
		} catch {
			// Fall through to synthesize fresh on cache read failure.
		}
	}

	let clip;
	try {
		clip = await synthesizeVoice({ provider: DEFAULT_PROVIDER_ID, voiceId: voice, text });
	} catch (err) {
		console.error('[tts/edge] synthesis failed', err?.code, err?.message);
		return error(res, 502, 'upstream_error', 'TTS synthesis failed');
	}
	if (!clip.audio.length) return error(res, 502, 'upstream_error', 'TTS returned empty audio');

	putObject({
		key: cacheKey,
		body: clip.audio,
		contentType: clip.contentType,
		metadata: { 'created-at': new Date().toISOString() },
	}).catch((e) => console.warn('[tts/edge] R2 cache write failed:', e.message));

	res.setHeader('content-type', clip.contentType);
	res.setHeader('content-length', String(clip.audio.length));
	res.setHeader('x-tts-cache', 'miss');
	res.setHeader('cache-control', 'private, max-age=86400');
	res.end(clip.audio);
});
