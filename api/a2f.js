// POST /api/a2f — free facial animation (Audio2Face-3D) for the talking avatar.
//
// The third leg of the avatar voice loop: /api/tts/speak gives every avatar a
// voice (Magpie), /api/asr lets users talk back (Riva), and THIS endpoint turns
// the spoken audio into a per-frame ARKit blendshape track so the avatar's mouth
// and face animate in sync with the words. Two named NVIDIA models on one face:
// Magpie voice + Audio2Face-3D animation (api/_lib/a2f-nvidia.js).
//
// Lane: NVIDIA NIM Audio2Face-3D (free, bidirectional gRPC). Purely additive —
// when the lane is unconfigured (no NVIDIA_API_KEY) the client keeps speaking and
// falls back to its in-browser amplitude lipsync, so nothing depends on this and
// nothing breaks when it is absent.
//
// Two ways to call it:
//
//   1. Animate audio you already have (lips match the EXACT bytes you'll play):
//      • raw audio body with Content-Type audio/wav | audio/pcm (+ ?rate=)
//      • or JSON { audio: <base64>, format?, sampleRate? }
//      → { ok, animation: { fps, blendShapeNames, frames, durationSec, … } }
//
//   2. One-shot text→speech→animation (server synthesizes via Magpie, then
//      animates that exact clip, and returns BOTH so you can play + drive):
//      • JSON { text, voice?, language? }
//      → { ok, audio: { base64, contentType, format }, animation: { … } }
//
//   3. Streamed text→speech→animation for the conversational digital human
//      (public/demos/audio2face.html). JSON { text, stream: true, turn? }
//      answers text/event-stream: `meta`, then interleaved `audio` (base64
//      s16le PCM chunks), `header` and `frames` events AS THEY ARE PRODUCED,
//      `degraded` if Audio2Face drops out (audio continues), then `done` with
//      per-stage timings. See api/_lib/digital-human-stream.js.
//
//   Emotion, on all three paths: A2F animates brows, eyes and cheeks too
//   with an emotion, and the response carries the emotion it applied
//   (animation.emotion, or `emotion` events when streamed). Pass
//      • emotion: an intent label ('joy', 'sad', 'concern', ...), an A2F channel
//        map ({ joy: 0.8 }), 'auto' (default: read `text`, or `emotionText`
//        alongside audio), or 'off'
//      • emotionStrength: 0..1 (0 is off; default 0.6)
//   in the JSON body, or ?emotion= / ?emotionStrength= on a raw-audio body. The
//   resolved intent is echoed back as `emotionIntent` (an `intent` event first
//   when streamed).
//
//   GET ?warm=1 opens and authenticates both NVIDIA channels (and runs the
//   function-rotation check) so the next spoken line skips the cold start.
//
// A frame is { t, w }: t = time code in seconds from clip start, w = weights in
// the order of blendShapeNames (ARKit naming). The browser plays the audio and
// samples the track by the audio element's currentTime — see
// src/voice/a2f-blendshapes.js for the morph-target mapping + player.

import { cors, method, readBody, readJson, error, json, wrap, rateLimited } from './_lib/http.js';
import { getSessionUser, authenticateBearer, extractBearer } from './_lib/auth.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import {
	animateNvidiaA2F,
	nvidiaA2fConfigured,
	resolveA2fFunctionId,
	a2fHealer,
	warmA2fChannel,
} from './_lib/a2f-nvidia.js';
import { synthesizeNvidiaTts, nvidiaTtsConfigured, warmTtsChannel } from './_lib/tts-nvidia.js';
import { streamSpeechAnimation } from './_lib/digital-human-stream.js';
import { resolveEmotionRequest } from './_lib/a2f-emotion-wire.js';
import { INTENT_LABELS } from '../src/voice/a2f-emotion-intent.js';
import { isKioskRequest, kioskBucketKey } from './_lib/kiosk-auth.js';
import { cacheSetIfAbsent } from './_lib/cache.js';
import { TTS_VOICE_IDS } from './_lib/tts-voices.js';

export const maxDuration = 60;

// 8 MiB of audio — generous for an avatar line (~4 min of 16 kHz mono PCM) while
// bounding the in-memory buffer per request.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const A2F_TIMEOUT_MS = 40_000;
const TTS_TIMEOUT_MS = 30_000;
const VOICES = new Set(TTS_VOICE_IDS);
// One streamed segment is one sentence or two; the cap keeps a single segment
// from carrying a whole essay through the per-segment bucket.
const MAX_SEGMENT_CHARS = 600;
// A warm-up is shared by every request the instance serves for a minute.
const WARM_REUSE_MS = 60_000;
let lastWarm = null; // { at, result }

const statusForCode = (code) =>
	code === 'rate_limited'
		? 429
		: code === 'invalid_argument' || code === 'bad_request'
			? 400
			: code === 'not_configured'
				? 503
				: code === 'timeout'
					? 504
					: 502;

// Spend the right bucket for this request. Kiosk key -> the booth bucket.
// Streamed segment of a turn already paid for -> the per-segment bucket.
// Everything else -> the a2f per-user / per-IP bucket, exactly as before.
async function meter(req, { turn, warmup = false } = {}) {
	if (isKioskRequest(req)) {
		const rl = await limits.digitalHumanKiosk(kioskBucketKey());
		return rl.success
			? null
			: { rl, message: 'Kiosk hourly budget reached, it refills within the hour' };
	}
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	const userId = session?.id ?? bearer?.userId ?? null;
	const principal = userId ? `u:${userId}` : `ip:${clientIp(req)}`;
	if (warmup) {
		const rl = await limits.a2fSegment(principal);
		return rl.success ? null : { rl, message: 'Too many warm-up requests this hour' };
	}
	if (turn) {
		const fresh = await cacheSetIfAbsent(`a2f:turn:${principal}:${turn}`, 1, 300);
		if (!fresh) {
			const rl = await limits.a2fSegment(principal);
			return rl.success
				? null
				: { rl, message: 'Too many sentences this hour, try again later' };
		}
	}
	const rl = userId ? await limits.a2fUser(userId) : await limits.a2fIp(clientIp(req));
	if (rl.success) return null;
	return {
		rl,
		message: userId
			? 'Audio2Face rate limit exceeded, try again later'
			: 'Audio2Face rate limit exceeded, sign in for a higher limit',
	};
}

async function warm() {
	if (lastWarm && Date.now() - lastWarm.at < WARM_REUSE_MS)
		return { ...lastWarm.result, reused: true };
	const [tts, a2f, rotation] = await Promise.all([
		warmTtsChannel(),
		warmA2fChannel(),
		a2fHealer
			.refresh(resolveA2fFunctionId())
			.catch((e) => ({ error: e?.message || String(e) })),
	]);
	const result = { tts, a2f, rotation, healing: a2fHealer.state() };
	lastWarm = { at: Date.now(), result };
	return result;
}

// Streamed text -> speech -> animation as server-sent events. Once the stream
// has started, failures are reported in-band (`error` with a stage) because the
// HTTP status is already committed.
async function streamLine(req, res, { text, voice, language, animate, emotion }) {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-store, no-transform',
		'X-Accel-Buffering': 'no',
	});
	res.flushHeaders?.();
	const abort = new AbortController();
	res.on('close', () => {
		if (!res.writableEnded) abort.abort();
	});
	const send = (type, data) => {
		if (res.writableEnded) return;
		res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
	};
	send('intent', { emotion: emotion.intent });
	try {
		await streamSpeechAnimation({
			text,
			voice,
			language,
			animate,
			emotion: emotion.a2f,
			emit: send,
			signal: abort.signal,
			ttsTimeoutMs: TTS_TIMEOUT_MS,
			a2fTimeoutMs: A2F_TIMEOUT_MS,
		});
	} catch (e) {
		if (!abort.signal.aborted) {
			send('error', {
				stage: e?.stage || 'tts',
				code: e?.code || 'provider_error',
				message: e?.message || 'Speech synthesis failed',
				partial: Boolean(e?.partial),
			});
		}
	}
	if (!res.writableEnded) res.end();
}

function encodingFromContentType(ct) {
	const type = String(ct || '')
		.split(';')[0]
		.trim()
		.toLowerCase();
	switch (type) {
		case 'audio/wav':
		case 'audio/x-wav':
		case 'audio/wave':
			return 'wav';
		case 'audio/l16':
		case 'audio/pcm':
		case 'audio/x-pcm':
			return 'pcm';
		default:
			return null;
	}
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	// Capability probe — lets the avatar UI decide whether to request a real A2F
	// track or go straight to the amplitude fallback, without browser-sniffing.
	if (req.method === 'GET' || req.method === 'HEAD') {
		const q = new URL(req.url, 'http://localhost').searchParams;
		if (q.get('warm') === '1') {
			if (!nvidiaA2fConfigured())
				return error(res, 503, 'not_configured', 'Audio2Face is not configured');
			const denied = await meter(req, { warmup: true });
			if (denied) return rateLimited(res, denied.rl, denied.message);
			return json(res, 200, { ok: true, ...(await warm()) }, { 'cache-control': 'no-store' });
		}
		return json(
			res,
			200,
			{
				configured: nvidiaA2fConfigured(),
				canSynthesize: nvidiaTtsConfigured(),
				model: 'audio2face-3d',
				functionId: nvidiaA2fConfigured()
					? a2fHealer.resolve(resolveA2fFunctionId())
					: null,
				// Set when this instance failed over from a retired function id.
				healing: a2fHealer.state(),
				stream: true,
				kiosk: isKioskRequest(req),
				fps: 30,
				// A2F emits ARKit-52 blendshape names; the client maps them onto
				// whatever convention the loaded GLB exposes (ARKit/RPM/VRM/Oculus).
				blendshapeFormat: 'arkit',
				sampleRate: 16000,
				accepts: {
					audio: ['wav', 'pcm'],
					json: ['audio', 'text', 'stream', 'emotion', 'emotionStrength'],
				},
				// Emotion input and output: see the header comment.
				emotion: { input: true, output: true, labels: INTENT_LABELS, defaultStrength: 0.6 },
			},
			// Private: the body reflects the caller's kiosk key.
			{ 'cache-control': 'private, max-age=60' },
		);
	}

	if (!nvidiaA2fConfigured()) {
		return error(
			res,
			503,
			'not_configured',
			'Audio2Face is not configured (set NVIDIA_API_KEY). The avatar still speaks and falls back to amplitude lipsync.',
		);
	}

	const url = new URL(req.url, 'http://localhost');
	const q = url.searchParams;
	const contentType = req.headers['content-type'] || '';
	const isJson = contentType.split(';')[0].trim().toLowerCase() === 'application/json';

	// Metered like the other free NVIDIA lanes: per-user budget for signed-in
	// callers, a tighter per-IP one otherwise. The text path also burns a Magpie
	// synthesis, so the bucket covers both. Raw-audio bodies are metered here;
	// JSON bodies once parsed, because a streamed segment names its turn.
	if (!isJson) {
		const denied = await meter(req);
		if (denied) return rateLimited(res, denied.rl, denied.message);
	}

	// ── Gather the audio (and, on the text path, synthesize it first) ─────────
	let wavBuffer = null; // a RIFF/WAVE buffer handed straight to A2F
	let rawPcm = null;
	let rawRate = 0;
	let audioOut = null; // { base64, contentType, format } when we synthesized
	let emotion = null; // resolveEmotionRequest() result

	try {
		if (isJson) {
			const body = await readJson(req, Math.ceil(MAX_AUDIO_BYTES * 1.4)); // base64 inflates ~33%
			const streamed = body.stream === true;
			const turn =
				streamed && typeof body.turn === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.turn)
					? body.turn
					: null;
			const denied = await meter(req, { turn });
			if (denied) return rateLimited(res, denied.rl, denied.message);

			const text = typeof body.text === 'string' ? body.text.trim() : '';
			emotion = resolveEmotionRequest({
				emotion: body.emotion,
				emotionStrength: body.emotionStrength,
				intensity: body.emotionIntensity,
				// emotionText: the line's words when the caller sends audio, so
				// 'auto' can still read the intent.
				text: text || (typeof body.emotionText === 'string' ? body.emotionText.slice(0, 4096) : ''),
			});
			const b64 =
				typeof body.audio === 'string' ? body.audio.replace(/^data:[^,]*,/, '') : '';

			if (b64) {
				const buf = Buffer.from(b64, 'base64');
				const fmt = String(body.format || 'wav').toLowerCase();
				if (fmt === 'pcm' || fmt === 'l16') {
					rawPcm = buf;
					rawRate = Number(body.sampleRate) || 16000;
				} else {
					wavBuffer = buf;
				}
			} else if (text) {
				if (!nvidiaTtsConfigured()) {
					return error(
						res,
						503,
						'not_configured',
						'Text path needs Magpie TTS (NVIDIA_API_KEY). Pass pre-synthesized audio instead.',
					);
				}
				if (text.length > 4096)
					return error(res, 400, 'bad_request', 'text exceeds 4096 characters');
				const voice = VOICES.has(body.voice) ? body.voice : 'nova';
				const language = typeof body.language === 'string' ? body.language : 'en-US';
				if (streamed) {
					if (text.length > MAX_SEGMENT_CHARS) {
						return error(
							res,
							400,
							'bad_request',
							`a streamed segment is at most ${MAX_SEGMENT_CHARS} characters; split the reply into sentences`,
						);
					}
					return streamLine(req, res, {
						text,
						voice,
						language,
						animate: body.animate !== false,
						emotion,
					});
				}
				// WAV so A2F can parse the rate from the header and we can hand the
				// same bytes back to the browser to play.
				const tts = await synthesizeNvidiaTts({
					text,
					voice,
					language,
					format: 'wav',
					timeoutMs: TTS_TIMEOUT_MS,
				});
				wavBuffer = tts.audio;
				audioOut = {
					base64: tts.audio.toString('base64'),
					contentType: tts.contentType,
					format: tts.format,
					voiceName: tts.voiceName,
					sampleRateHz: tts.sampleRateHz,
				};
			} else {
				return error(
					res,
					400,
					'bad_request',
					'provide { text } to synthesize, or { audio: <base64> } to animate',
				);
			}
		} else {
			const fmt = encodingFromContentType(contentType);
			if (!fmt) {
				return error(
					res,
					415,
					'unsupported_media_type',
					`Unsupported audio Content-Type "${contentType.split(';')[0] || 'none'}". Send audio/wav or audio/pcm (with ?rate=), or a JSON body.`,
				);
			}
			emotion = resolveEmotionRequest({
				emotion: q.get('emotion') ?? undefined,
				emotionStrength: q.get('emotionStrength') ?? undefined,
			});
			const buf = await readBody(req, MAX_AUDIO_BYTES);
			if (fmt === 'pcm') {
				rawPcm = buf;
				rawRate = Number(q.get('rate') || q.get('sampleRate')) || 16000;
			} else {
				wavBuffer = buf;
			}
		}
	} catch (e) {
		if (e?.status === 413)
			return error(res, 413, 'payload_too_large', 'audio exceeds the 8 MB limit');
		// A synthesis failure on the text path surfaces as a provider error.
		if (e?.code && e.code !== 'bad_request') {
			const status = e.code === 'rate_limited' ? 429 : e.code === 'invalid_key' ? 502 : 502;
			return error(
				res,
				status,
				e.code,
				`Speech synthesis failed: ${e.message || 'unknown error'}`,
				{ stage: 'tts' },
			);
		}
		return error(
			res,
			e?.status || 400,
			'bad_request',
			e?.message || 'could not read request body',
		);
	}

	if (!wavBuffer?.length && !rawPcm?.length) {
		return error(res, 400, 'bad_request', 'no audio to animate');
	}

	// ── Drive Audio2Face-3D ───────────────────────────────────────────────────
	const a2fStart = Date.now();
	try {
		const animation = await animateNvidiaA2F(
			wavBuffer
				? { wav: wavBuffer, timeoutMs: A2F_TIMEOUT_MS, emotion: emotion?.a2f }
				: { pcm: rawPcm, sampleRateHz: rawRate, timeoutMs: A2F_TIMEOUT_MS, emotion: emotion?.a2f },
		);
		return json(
			res,
			200,
			{
				ok: true,
				...(audioOut ? { audio: audioOut } : {}),
				animation,
				...(emotion ? { emotionIntent: emotion.intent } : {}),
			},
			{ 'cache-control': 'no-store', 'server-timing': `a2f;dur=${Date.now() - a2fStart}` },
		);
	} catch (e) {
		const code = e?.code || 'provider_error';
		return error(
			res,
			statusForCode(code),
			code,
			`Audio2Face failed: ${e?.message || 'unknown error'}`,
			{
				stage: 'a2f',
			},
		);
	}
});
