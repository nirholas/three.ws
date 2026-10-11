// `speech_to_text` — transcribe spoken audio to text. Read-only: it transforms
// audio → transcript and mutates no platform state.
//
// Wraps POST /api/asr (NVIDIA NIM Riva ASR, free). The audio is passed as a
// base64 string (a raw base64 payload or a data: URL — the data prefix is
// stripped server-side). Riva does NOT accept the WebM/Opus container that
// Chrome's MediaRecorder emits by default: decode to WAV or PCM first. Returns
// the transcript with a confidence score and the recognized duration.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

// Encodings the Riva lane accepts (see api/asr.js ACCEPTED_ENCODINGS).
const FORMATS = ['wav', 'pcm', 'flac', 'ogg'];

export const def = {
	name: 'speech_to_text',
	title: 'Speech to text',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Transcribe spoken audio to text using the free NVIDIA NIM Riva recognizer. Pass the audio as base64 (raw or a data: URL). ' +
		'Accepted encodings: wav, pcm (set sampleRate), flac, ogg/opus — the WebM container from a browser MediaRecorder must be decoded ' +
		'to WAV or PCM first. Returns { text, confidence, language, model, durationSec } and, when `words` is set, per-word timestamps. ' +
		'Audio is capped at ~8 MB. Read-only: recognizes speech without changing any platform state. ' +
		'Use this to turn a user\'s recorded voice into text an agent can act on; to go the other way, call text_to_speech.',
	inputSchema: {
		audio: z
			.string()
			.min(1)
			.describe('The audio to transcribe, base64-encoded (a raw base64 string or a data:<mime>;base64,… URL). Max ~8 MB decoded.'),
		format: z
			.enum(FORMATS)
			.optional()
			.describe('Audio encoding of the supplied bytes (default "wav"). Use "pcm" for raw 16-bit little-endian PCM (set sampleRate).'),
		language: z
			.string()
			.optional()
			.describe('BCP-47 language hint for recognition (default "en-US").'),
		sampleRate: z
			.number()
			.int()
			.positive()
			.optional()
			.describe('Sample rate in Hz for raw PCM input (default 16000). Ignored for WAV, which carries its own rate in the header.'),
		words: z
			.boolean()
			.optional()
			.describe('When true, also return per-word timestamps in a `words` array.'),
		model: z
			.string()
			.optional()
			.describe('Override the Riva model name (advanced; defaults to the configured model).'),
	},
	async handler(args) {
		const audio = String(args?.audio ?? '').trim();
		const body = {
			audio,
			format: args?.format,
			language: args?.language,
			sampleRate: args?.sampleRate,
			words: args?.words === true,
			model: args?.model,
		};

		const data = await apiRequest('/api/asr', { method: 'POST', body });

		return {
			ok: true,
			text: data?.text ?? '',
			confidence: data?.confidence ?? null,
			language: data?.language ?? (args?.language || 'en-US'),
			model: data?.model ?? null,
			durationSec: data?.durationSec ?? null,
			...(Array.isArray(data?.words) ? { words: data.words } : {}),
		};
	},
};
