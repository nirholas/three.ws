// /api/clips/voice: the server half of "Make a clip".
//
// A talking-avatar clip is rendered and encoded entirely in the browser
// (src/clip/clip-renderer.js). The only server work is the voice and the face:
//
//   POST { text, voice?, language? }
//     → NVIDIA Magpie (Riva TTS) speaks the line, then NVIDIA Audio2Face-3D
//       turns that exact audio into a per-frame ARKit blendshape track.
//     ← { ok, audio: { base64, contentType, sampleRateHz, voiceName, durationSec },
//         animation: { fps, blendShapeNames, frames, durationSec, ... }, quota }
//
//   POST { audio: <base64 16 kHz mono s16 PCM>, sampleRate: 16000 }
//     → an uploaded or recorded line (decoded and resampled in the browser);
//       Audio2Face-3D animates it. The browser already holds the audio.
//     ← { ok, animation, quota }
//
//   GET → this principal's limits: { configured, plan, perDay, maxSeconds,
//         maxChars, voices, signedIn }. No quota is consumed.
//
// Limits (api/_lib/clip-policy.js) are enforced here, before any upstream call:
// a per-plan daily clip count (rate-limit buckets clipUser / clipIp) and a
// per-plan duration cap, checked on text length before synthesis and on the
// measured audio duration after it.

import { cors, method, readJson, error, json, wrap, rateLimited } from '../_lib/http.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { animateNvidiaA2F, nvidiaA2fConfigured } from '../_lib/a2f-nvidia.js';
import { synthesizeNvidiaTts, nvidiaTtsConfigured } from '../_lib/tts-nvidia.js';
import { parseWav } from '../_lib/asr-nvidia.js';
import { TTS_VOICES, TTS_VOICE_IDS, DEFAULT_VOICE } from '../_lib/tts-voices.js';
import { clipPolicy, pcmDurationSec } from '../_lib/clip-policy.js';

export const maxDuration = 60;

const UPLOAD_RATE_HZ = 16000;
const TTS_TIMEOUT_MS = 30_000;
const A2F_TIMEOUT_MS = 45_000;
const VOICES = new Set(TTS_VOICE_IDS);

async function resolvePrincipal(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, plan: session.plan || 'free' };
	const bearer = await authenticateBearer(extractBearer(req));
	if (!bearer?.userId) return { userId: null, plan: null };
	const [row] = await sql`select plan from users where id = ${bearer.userId} limit 1`;
	return { userId: bearer.userId, plan: row?.plan || 'free' };
}

function quotaPayload(policy, rl) {
	return {
		plan: policy.plan,
		perDay: policy.perDay,
		remaining: Math.max(0, Number(rl?.remaining ?? 0)),
		resetAt: rl?.reset ? new Date(Number(rl.reset)).toISOString() : null,
	};
}

function upstreamStatus(code) {
	if (code === 'rate_limited') return 429;
	if (code === 'invalid_argument') return 400;
	if (code === 'not_configured') return 503;
	if (code === 'timeout') return 504;
	return 502;
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const who = await resolvePrincipal(req);
	const policy = clipPolicy({ signedIn: Boolean(who.userId), plan: who.plan });

	if (req.method === 'GET') {
		return json(
			res,
			200,
			{
				configured: nvidiaA2fConfigured() && nvidiaTtsConfigured(),
				signedIn: Boolean(who.userId),
				plan: policy.plan,
				perDay: policy.perDay,
				maxSeconds: policy.maxSeconds,
				maxChars: policy.maxChars,
				defaultVoice: DEFAULT_VOICE,
				voices: TTS_VOICES,
				models: { voice: 'magpie-tts-multilingual', face: 'audio2face-3d' },
			},
			{ 'cache-control': 'private, no-store' },
		);
	}

	if (!nvidiaA2fConfigured() || !nvidiaTtsConfigured()) {
		return error(res, 503, 'not_configured', 'Clip voice and face are not configured on this server (NVIDIA_API_KEY).');
	}

	let body;
	try {
		// 60 s of 16 kHz s16 PCM is 1.92 MB; base64 inflates it by a third.
		body = await readJson(req, 3_000_000);
	} catch (e) {
		if (e?.status === 413) return error(res, 413, 'payload_too_large', 'Recording is too large. Keep it under one minute.');
		return error(res, 400, 'bad_request', 'Request body must be JSON.');
	}

	const text = typeof body?.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
	const b64 = typeof body?.audio === 'string' ? body.audio.replace(/^data:[^,]*,/, '') : '';
	let uploadPcm = null;

	// Validate everything that costs nothing before touching the quota.
	if (b64) {
		if (Number(body.sampleRate || UPLOAD_RATE_HZ) !== UPLOAD_RATE_HZ) {
			return error(res, 400, 'bad_request', 'Recordings must be sent as 16 kHz mono PCM.');
		}
		uploadPcm = Buffer.from(b64, 'base64');
		const seconds = pcmDurationSec(uploadPcm.length, UPLOAD_RATE_HZ);
		if (seconds < 0.3) return error(res, 400, 'too_short', 'That recording is too short to animate.');
		if (seconds > policy.maxSeconds) {
			return error(res, 400, 'too_long', `Recording is ${seconds.toFixed(1)}s. Your plan allows clips up to ${policy.maxSeconds}s.`, {
				maxSeconds: policy.maxSeconds,
			});
		}
	} else if (text) {
		if (text.length > policy.maxChars) {
			return error(res, 400, 'too_long', `That line is ${text.length} characters. Your plan allows up to ${policy.maxChars} (about ${policy.maxSeconds}s of speech).`, {
				maxChars: policy.maxChars,
				maxSeconds: policy.maxSeconds,
			});
		}
	} else {
		return error(res, 400, 'bad_request', 'Provide { text } for the avatar to say, or { audio } with a recording.');
	}

	const rl = who.userId
		? await limits.clipUser(who.userId, policy.plan, policy.perDay)
		: await limits.clipIp(clientIp(req), policy.perDay);
	if (!rl.success) {
		const message = who.userId
			? `You have made all ${policy.perDay} clips your ${policy.plan} plan allows today.`
			: `Visitors can make ${policy.perDay} clips a day. Sign in for more.`;
		return rateLimited(res, rl, message, { code: 'clip_quota', quota: quotaPayload(policy, rl) });
	}
	const quota = quotaPayload(policy, rl);

	let audioOut = null;
	let a2fInput;
	if (uploadPcm) {
		a2fInput = { pcm: uploadPcm, sampleRateHz: UPLOAD_RATE_HZ };
	} else {
		const voice = VOICES.has(body.voice) ? body.voice : DEFAULT_VOICE;
		const language = typeof body.language === 'string' ? body.language : 'en-US';
		let tts;
		try {
			tts = await synthesizeNvidiaTts({ text, voice, language, format: 'wav', timeoutMs: TTS_TIMEOUT_MS });
		} catch (e) {
			const code = e?.code || 'provider_error';
			return error(res, upstreamStatus(code), code, `NVIDIA Magpie could not voice the line: ${e?.message || 'unknown error'}`, { stage: 'voice', quota });
		}
		const parsed = parseWav(tts.audio);
		const seconds = parsed ? pcmDurationSec(parsed.pcm.length, parsed.sampleRateHz, parsed.channels) : 0;
		if (!parsed || seconds <= 0) {
			return error(res, 502, 'provider_error', 'NVIDIA Magpie returned audio that could not be read.', { stage: 'voice', quota });
		}
		if (seconds > policy.maxSeconds) {
			return error(res, 400, 'too_long', `That line runs ${seconds.toFixed(1)}s when spoken. Your plan allows clips up to ${policy.maxSeconds}s. Shorten it and try again.`, {
				maxSeconds: policy.maxSeconds,
				quota,
			});
		}
		audioOut = {
			base64: tts.audio.toString('base64'),
			contentType: tts.contentType,
			sampleRateHz: tts.sampleRateHz,
			voiceName: tts.voiceName,
			durationSec: seconds,
		};
		a2fInput = { wav: tts.audio };
	}

	let animation;
	try {
		animation = await animateNvidiaA2F({ ...a2fInput, timeoutMs: A2F_TIMEOUT_MS });
	} catch (e) {
		const code = e?.code || 'provider_error';
		return error(res, upstreamStatus(code), code, `NVIDIA Audio2Face-3D could not animate the line: ${e?.message || 'unknown error'}`, { stage: 'face', quota });
	}

	return json(
		res,
		200,
		{ ok: true, ...(audioOut ? { audio: audioOut } : {}), animation, quota },
		{ 'cache-control': 'no-store' },
	);
});
