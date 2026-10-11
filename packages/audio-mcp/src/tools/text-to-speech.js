// `text_to_speech` — synthesize speech from text and return it as a base64
// audio data URL the client can play or hand to an avatar. Read-only: it
// transforms text → audio and mutates no platform state.
//
// Wraps POST /api/tts/speak, which streams raw encoded audio (not JSON) with a
// truthful content-type and x-tts-* headers. Provider policy is the platform's:
// free NVIDIA NIM Magpie leads, OpenAI is the paid backstop. Magpie emits PCM,
// so every non-pcm request is served as WAV — the returned mime/format always
// describe the actual bytes.

import { z } from 'zod';

import { apiRequestBinary } from '../lib/api.js';

// Mirrors api/_lib/tts-voices.js (TTS_VOICE_IDS) — a voice that renders on either
// the free Magpie lane or the OpenAI backstop.
const VOICES = ['nova', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'sage', 'shimmer', 'verse'];
const MODELS = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'];
const FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];

export const def = {
	name: 'text_to_speech',
	title: 'Text to speech',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Synthesize spoken audio from text for a 3D avatar and return it as a base64 audio data URL (data:<mime>;base64,…) plus metadata. ' +
		'Free NVIDIA NIM Magpie TTS leads; OpenAI is the paid backstop. Because Magpie emits raw PCM, every non-pcm request is served as WAV — ' +
		'the returned `mime`, `format`, and `voice` describe the bytes you actually get, not the request. Pair the audio with audio_to_face to ' +
		'drive lipsync. Input text is capped at 4096 characters. Read-only: synthesizes audio without changing any platform state. ' +
		'Use this when an avatar needs a voice line you can play; to get the lipsync track for that line in the same call, use audio_to_face with `text` instead.',
	inputSchema: {
		text: z
			.string()
			.min(1)
			.max(4096)
			.describe('The text to speak (1–4096 characters).'),
		voice: z
			.enum(VOICES)
			.optional()
			.describe('Voice persona (default "nova"). The same id renders on either provider lane.'),
		format: z
			.enum(FORMATS)
			.optional()
			.describe('Requested audio container (default "mp3"). The free NVIDIA lane serves every non-pcm request as WAV; the response metadata reports what you actually received.'),
		model: z
			.enum(MODELS)
			.optional()
			.describe('OpenAI TTS model for the paid backstop lane (default "gpt-4o-mini-tts"). Ignored by the free NVIDIA lane, which always uses magpie-tts-multilingual.'),
		language: z
			.string()
			.optional()
			.describe('BCP-47 language for the free NVIDIA lane (default "en-US"; also es-US, fr-FR, de-DE, zh-CN, vi-VN, it-IT, hi-IN, ja-JP).'),
		speed: z
			.number()
			.min(0.5)
			.max(2.0)
			.optional()
			.describe('Playback speed multiplier, 0.5–2.0 (OpenAI backstop lane only; default 1.0).'),
	},
	async handler(args) {
		const text = String(args?.text ?? '').trim();
		const body = {
			text,
			voice: args?.voice,
			format: args?.format,
			model: args?.model,
			language: args?.language,
			speed: args?.speed,
		};

		const { buffer, contentType, headers } = await apiRequestBinary('/api/tts/speak', { method: 'POST', body });

		return {
			ok: true,
			voice: headers.get('x-tts-voice') || args?.voice || 'nova',
			model: headers.get('x-tts-model') || null,
			format: headers.get('x-tts-format') || args?.format || 'mp3',
			mime: contentType,
			sizeBytes: buffer.length,
			audio: `data:${contentType};base64,${buffer.toString('base64')}`,
		};
	},
};
