// `speak` — synthesize audio for the avatar. Returns the audio as a base64
// data URL by default so clients can embed it directly. The avatar's voice
// (set when spawn_avatar runs) is used unless explicitly overridden.
//
// Provider chain (free first, paid backstop — same policy as the three.ws
// platform's /api/tts/speak):
//   1. NVIDIA NIM Magpie TTS (free, gRPC) when NVIDIA_API_KEY is set. Magpie
//      emits raw PCM, so every non-pcm request is served as WAV — the
//      returned `mime`/`format`/`voice`/`model` fields describe the actual
//      audio.
//   2. OpenAI /v1/audio/speech when OPENAI_API_KEY is set.
// `not_configured` only when neither key is present.

import { z } from 'zod';

import { OPENAI_API_KEY, NVIDIA_API_KEY } from '../config.js';
import { getSession, updateSession } from '../lib/avatars.js';
import { synthesizeNvidiaTts } from '../lib/tts-nvidia.js';

const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
const MODELS = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'];
const FORMATS = {
	mp3: 'audio/mpeg',
	opus: 'audio/ogg',
	aac: 'audio/aac',
	flac: 'audio/flac',
	wav: 'audio/wav',
	pcm: 'audio/pcm',
};
const NVIDIA_TIMEOUT_MS = 30_000;

export const def = {
	name: 'speak',
	title: 'Avatar speaks (TTS)',
	// MCP ToolAnnotations — safety hints surfaced to MCP clients.
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Synthesize speech for an avatar session and return a base64 audio data URL the client can play. Free NVIDIA NIM Magpie TTS leads when NVIDIA_API_KEY is set (non-pcm requests are served as WAV); OpenAI TTS is the paid backstop when OPENAI_API_KEY is set. Picks the session\'s configured voice unless overridden. Use this when a spawned avatar session should say a line out loud.',
	inputSchema: {
		sessionId: z.string().optional()
			.describe('Avatar session id (optional — when omitted, voice falls back to the override or "nova").'),
		text: z.string().min(1).max(4096).describe('Text the avatar should say.'),
		voice: z.enum(VOICES).optional().describe('Override the session voice for this call.'),
		model: z.enum(MODELS).optional().describe('OpenAI TTS model used on the paid backstop lane (default gpt-4o-mini-tts). The free NVIDIA lane always serves magpie-tts-multilingual.'),
		format: z.enum(Object.keys(FORMATS)).optional().describe('Audio format (default mp3; the free NVIDIA lane serves every non-pcm request as wav).'),
		language: z.string().optional().describe('BCP-47 language for the free NVIDIA lane (en-US default; also es-US, fr-FR, de-DE, zh-CN, vi-VN, it-IT, hi-IN, ja-JP).'),
		speed: z.number().min(0.5).max(2.0).optional().describe('Playback speed multiplier (OpenAI lane only).'),
	},
	async handler(args) {
		if (!NVIDIA_API_KEY && !OPENAI_API_KEY) {
			return {
				ok: false,
				error: 'not_configured',
				message: 'No TTS provider configured. Set NVIDIA_API_KEY (free Magpie lane) or OPENAI_API_KEY (paid backstop) on the MCP server.',
			};
		}
		const { sessionId, text } = args || {};
		const session = sessionId ? getSession(sessionId) : null;
		if (sessionId && !session) {
			return { ok: false, error: 'unknown_session', message: `No session ${sessionId}.` };
		}
		const voice = args.voice || session?.voice || 'nova';
		const model = args.model || 'gpt-4o-mini-tts';
		const format = args.format || 'mp3';
		const language = args.language || 'en-US';
		const speed = typeof args.speed === 'number' ? args.speed : 1.0;

		const t0 = Date.now();
		const laneErrors = [];

		// Lane 1: free NVIDIA NIM Magpie TTS.
		if (NVIDIA_API_KEY) {
			try {
				const out = await synthesizeNvidiaTts({
					text, voice, language, format, timeoutMs: NVIDIA_TIMEOUT_MS, apiKey: NVIDIA_API_KEY,
				});
				if (session) updateSession(session.id, { lastSpoken: text.slice(0, 200) });
				return {
					ok: true,
					sessionId: session?.id || null,
					provider: 'nvidia',
					voice: out.voiceName,
					model: out.model,
					format: out.format,
					mime: out.contentType,
					sizeBytes: out.audio.length,
					durationMs: Date.now() - t0,
					audio: `data:${out.contentType};base64,${out.audio.toString('base64')}`,
					text,
				};
			} catch (e) {
				laneErrors.push(`nvidia: ${e?.code || 'error'} — ${e?.message || 'failed'}`);
			}
		}

		// Lane 2: OpenAI paid backstop.
		if (!OPENAI_API_KEY) {
			return { ok: false, error: 'tts_failed', message: `All TTS lanes failed: ${laneErrors.join('; ')}` };
		}
		const mime = FORMATS[format];
		let r;
		try {
			r = await fetch('https://api.openai.com/v1/audio/speech', {
				method: 'POST',
				headers: {
					authorization: `Bearer ${OPENAI_API_KEY}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ input: text, voice, model, response_format: format, speed }),
				signal: AbortSignal.timeout(NVIDIA_TIMEOUT_MS),
			});
		} catch (e) {
			laneErrors.push(`openai: ${e?.message || 'fetch failed'}`);
			return { ok: false, error: 'tts_failed', message: `All TTS lanes failed: ${laneErrors.join('; ')}` };
		}
		if (!r.ok) {
			const errText = await r.text().catch(() => '');
			laneErrors.push(`openai: ${r.status} ${errText.slice(0, 500)}`);
			return {
				ok: false,
				error: 'tts_failed',
				status: r.status,
				message: `All TTS lanes failed: ${laneErrors.join('; ')}`,
			};
		}
		const buf = Buffer.from(await r.arrayBuffer());
		if (session) updateSession(session.id, { lastSpoken: text.slice(0, 200) });
		return {
			ok: true,
			sessionId: session?.id || null,
			provider: 'openai',
			voice,
			model,
			format,
			mime,
			sizeBytes: buf.length,
			durationMs: Date.now() - t0,
			audio: `data:${mime};base64,${buf.toString('base64')}`,
			text,
		};
	},
};
