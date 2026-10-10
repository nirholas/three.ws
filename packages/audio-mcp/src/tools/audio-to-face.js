// `audio_to_face` — turn speech into a per-frame facial-animation (lipsync)
// track for a 3D avatar. Read-only: it transforms audio (or text→audio) into a
// blendshape track and mutates no platform state.
//
// Wraps POST /api/a2f (NVIDIA NIM Audio2Face-3D, free). Two ways to call it:
//   • Animate audio you already have — pass base64 `audio` (wav or pcm). The
//     lips match the exact bytes you will play.
//   • One-shot text→speech→animation — pass `text` and the server synthesizes
//     the line with Magpie TTS, animates that exact clip, and returns BOTH the
//     audio and the animation so you can play and drive in sync.
//
// The animation is { fps, blendShapeNames, frames, durationSec }, where each
// frame is { t, w }: t = seconds from clip start, w = weights in the order of
// blendShapeNames (ARKit-52 naming — map onto the loaded GLB's convention).

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

const VOICES = ['nova', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'sage', 'shimmer', 'verse'];
const FORMATS = ['wav', 'pcm'];

export const def = {
	name: 'audio_to_face',
	title: 'Audio to face (lipsync)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Generate a per-frame ARKit blendshape lipsync track from speech using free NVIDIA NIM Audio2Face-3D. Provide either `text` ' +
		'(the server synthesizes it with Magpie TTS, then animates that clip and returns both the audio and the animation) or `audio` ' +
		'(base64 wav/pcm you already have, so the lips match the exact bytes you will play). Returns { animation: { fps, blendShapeNames, ' +
		'frames, durationSec } } where each frame is { t, w } — t in seconds, w = weights ordered by blendShapeNames (ARKit-52). On the text ' +
		'path it also returns { audio: { base64, contentType, format } }. Read-only: produces an animation track without changing platform state. ' +
		'Use this when an avatar has to mouth a spoken line; for plain audio with no face animation, call text_to_speech instead.',
	inputSchema: {
		text: z
			.string()
			.min(1)
			.max(4096)
			.optional()
			.describe('Text to synthesize and animate (1–4096 chars). Provide this OR `audio`. On this path the synthesized audio is returned alongside the animation.'),
		audio: z
			.string()
			.min(1)
			.optional()
			.describe('Pre-synthesized audio to animate, base64-encoded (raw or a data: URL). Provide this OR `text`. Set `format` to match the bytes.'),
		format: z
			.enum(FORMATS)
			.optional()
			.describe('Encoding of `audio` (default "wav"). Use "pcm" for raw 16-bit little-endian PCM and set `sampleRate`.'),
		sampleRate: z
			.number()
			.int()
			.positive()
			.optional()
			.describe('Sample rate in Hz for raw PCM `audio` (default 16000). Ignored for WAV.'),
		voice: z
			.enum(VOICES)
			.optional()
			.describe('Voice for the text path (default "nova"). Ignored when `audio` is supplied.'),
		language: z
			.string()
			.optional()
			.describe('BCP-47 language for the text path (default "en-US"). Ignored when `audio` is supplied.'),
	},
	async handler(args) {
		const text = typeof args?.text === 'string' ? args.text.trim() : '';
		const audio = typeof args?.audio === 'string' ? args.audio.trim() : '';
		if (!text && !audio) {
			throw Object.assign(new Error('provide `text` to synthesize and animate, or `audio` (base64) to animate'), {
				code: 'bad_request',
			});
		}

		const body = audio
			? { audio, format: args?.format, sampleRate: args?.sampleRate }
			: { text, voice: args?.voice, language: args?.language };

		const data = await apiRequest('/api/a2f', { method: 'POST', body });

		return {
			ok: true,
			...(data?.audio ? { audio: data.audio } : {}),
			animation: data?.animation ?? null,
		};
	},
};
