/**
 * POST /api/tts/eleven
 *
 * Server proxy for ElevenLabs TTS. Keeps the API key server-side.
 * Caches synthesized clips in R2 by sha256(voiceId + text) for 30 days.
 * Rate-limits per user: 1000 chars / hour tracked via Redis INCRBY.
 *
 * Body: { voiceId: string, text: string, modelId?: string }
 * Response: audio/mpeg
 */

import { Redis } from '@upstash/redis';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, method, wrap, error, readJson } from '../_lib/http.js';
import { sha256 } from '../_lib/crypto.js';
import { env } from '../_lib/env.js';
import { headObject, getObjectBuffer, putObject } from '../_lib/r2.js';

const CHARS_PER_HOUR = 1000;
const ELEVEN_BASE    = 'https://api.elevenlabs.io/v1';

// Only instantiate if Upstash is configured (mirrors the pattern in rate-limit.js).
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
	redis = new Redis({
		url:   process.env.UPSTASH_REDIS_REST_URL,
		token: process.env.UPSTASH_REDIS_REST_TOKEN,
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const apiKey = env.ELEVENLABS_API_KEY;
	if (!apiKey) return error(res, 503, 'not_configured', 'ElevenLabs is not configured on this server');

	const session = await getSessionUser(req);
	const bearer  = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? bearer.userId;

	const body    = await readJson(req);
	const voiceId = String(body.voiceId || '').trim();
	const text    = String(body.text    || '').trim();
	const modelId = String(body.modelId || 'eleven_turbo_v2_5').trim();

	if (!voiceId) return error(res, 400, 'validation_error', 'voiceId is required');
	if (!text)    return error(res, 400, 'validation_error', 'text is required');
	if (text.length > 500) return error(res, 400, 'validation_error', 'text exceeds 500 chars per request');

	// ── Char-based rate limit ─────────────────────────────────────────────────
	if (redis) {
		const hourBucket = Math.floor(Date.now() / 3_600_000);
		const rKey = `tts:chars:${userId}:${hourBucket}`;
		const used = Number(await redis.get(rKey) || 0);
		if (used + text.length > CHARS_PER_HOUR) {
			return error(res, 429, 'rate_limited',
				`TTS character limit (${CHARS_PER_HOUR}/hr) reached. Try again next hour.`);
		}
		// Increment before synthesis to prevent parallel races from blowing past limit.
		const newTotal = await redis.incrby(rKey, text.length);
		await redis.expire(rKey, 7200);
		if (newTotal > CHARS_PER_HOUR) {
			await redis.decrby(rKey, text.length).catch(() => {});
			return error(res, 429, 'rate_limited',
				`TTS character limit (${CHARS_PER_HOUR}/hr) reached. Try again next hour.`);
		}
	}

	// ── R2 cache lookup ───────────────────────────────────────────────────────
	const cacheHash = await sha256(`${voiceId}\x00${text}\x00${modelId}`);
	const cacheKey  = `tts/cache/${cacheHash}.mp3`;

	const cached = await headObject(cacheKey).catch(() => null);
	if (cached) {
		try {
			const buf = await getObjectBuffer(cacheKey);
			res.setHeader('content-type', 'audio/mpeg');
			res.setHeader('content-length', String(buf.length));
			res.setHeader('x-tts-cache', 'hit');
			res.setHeader('cache-control', 'private, max-age=86400');
			return res.end(buf);
		} catch {
			// Cache read failed — fall through to synthesize fresh.
		}
	}

	// ── Synthesize via ElevenLabs ─────────────────────────────────────────────
	// Map rate (0.5..1.5) → ElevenLabs style (0..1). Default rate=1 → style=0.5.
	const styleVal = 0.5;

	let elResp;
	try {
		elResp = await fetch(
			`${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'accept':       'audio/mpeg',
					'xi-api-key':   apiKey,
				},
				body: JSON.stringify({
					text,
					model_id: modelId,
					voice_settings: {
						stability:         0.5,
						similarity_boost:  0.75,
						style:             styleVal,
						use_speaker_boost: true,
					},
				}),
			},
		);
	} catch (fetchErr) {
		console.error('[tts/eleven] ElevenLabs fetch failed', fetchErr);
		return error(res, 502, 'upstream_error', 'Could not reach ElevenLabs');
	}

	if (!elResp.ok) {
		const msg = await elResp.text().catch(() => '');
		console.error('[tts/eleven] ElevenLabs error', elResp.status, msg);
		return error(res, 502, 'upstream_error', `ElevenLabs returned ${elResp.status}`);
	}

	// Buffer the audio so we can cache and serve in one pass.
	const audioBuffer = Buffer.from(await elResp.arrayBuffer());

	// Store in R2 (fire-and-forget — cache miss on failure is acceptable).
	putObject({
		key:         cacheKey,
		body:        audioBuffer,
		contentType: 'audio/mpeg',
		metadata:    { 'created-at': new Date().toISOString() },
	}).catch((e) => console.warn('[tts/eleven] R2 cache write failed:', e.message));

	res.setHeader('content-type', 'audio/mpeg');
	res.setHeader('content-length', String(audioBuffer.length));
	res.setHeader('x-tts-cache', 'miss');
	res.setHeader('cache-control', 'private, max-age=86400');
	return res.end(audioBuffer);
});
