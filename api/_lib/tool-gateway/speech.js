// tts and transcribe.
//
// tts runs the platform speech chain (api/_lib/ai-speech.js ttsSynthesize):
// NVIDIA NIM Magpie first, Gemini TTS on Vertex AI as the failover. The clip is
// written to object storage and returned as a hosted URL, so a model never has
// to carry megabytes of base64 through its context.
//
// transcribe takes audio by URL or as base64. WAV, FLAC and Ogg/Opus go to the
// NIM Riva lane first; anything Riva cannot read (MP3, M4A, WebM), or a Riva
// failure, goes to Gemini on Vertex AI. The result names the lane that
// answered. Billing is per minute of audio: exact for WAV, the Riva-reported
// processed duration when Riva answered, and a bitrate estimate otherwise.

import { ttsSynthesize, ttsConfigured, PAID_TTS_MAX_CHARS } from '../ai-speech.js';
import { TTS_VOICE_IDS, DEFAULT_VOICE } from '../tts-voices.js';
import { transcribeNvidiaAsr, nvidiaAsrConfigured, parseWav } from '../asr-nvidia.js';
import { downloadPublic, decodeBase64Input } from './download.js';
import { GatewayError } from './errors.js';
import { geminiFilesAvailable, geminiReadFile } from './gemini.js';
import { persistGatewayOutput } from './storage.js';

export const TTS_MAX_CHARS = PAID_TTS_MAX_CHARS;
export const TRANSCRIBE_MAX_BYTES = 15 * 1024 * 1024;

// Compressed audio without a header we can read is billed at 128 kbit/s, the
// common speech-and-podcast rate, so an estimate never under-counts by much.
const COMPRESSED_BYTES_PER_SECOND = 16_000;

/** Characters of speech, in the priced unit (thousands of characters). */
export function ttsUnits(text) {
	return String(text || '').length / 1000;
}

function readTtsArgs(args) {
	const text = String(args?.text ?? '').trim();
	if (!text) throw new GatewayError(400, 'bad_request', '"text" is required.');
	if (text.length > TTS_MAX_CHARS) {
		throw new GatewayError(413, 'too_large', `"text" is ${text.length} characters; the limit per call is ${TTS_MAX_CHARS}. Split it into several calls.`);
	}
	const voice = args?.voice == null || args.voice === '' ? DEFAULT_VOICE : String(args.voice);
	if (!TTS_VOICE_IDS.includes(voice)) {
		throw new GatewayError(400, 'bad_request', `Unknown voice "${voice}". Voices: ${TTS_VOICE_IDS.join(', ')}.`);
	}
	return { text, voice, language: args?.language ? String(args.language).slice(0, 16) : 'en-US' };
}

/** Estimate for the up-front charge. */
export function estimateTts(args) {
	return ttsUnits(readTtsArgs(args).text);
}

export async function tts(args, principal) {
	const { text, voice, language } = readTtsArgs(args);
	if (!ttsConfigured()) {
		throw new GatewayError(503, 'not_configured', 'No speech lane is configured on this deployment (set NVIDIA_API_KEY or GOOGLE_CLOUD_PROJECT).');
	}
	let out;
	try {
		out = await ttsSynthesize({ text, voice, format: 'wav', language });
	} catch (err) {
		throw new GatewayError(err?.status || 502, err?.code || 'tts_failed', err?.message || 'Speech synthesis failed.');
	}
	const audio = Buffer.from(out.audio, 'base64');
	const stored = await persistGatewayOutput({ userId: principal.userId, kind: 'audio', body: audio, contentType: out.content_type || 'audio/wav', ext: 'wav' });
	const wav = parseWav(audio);
	const durationSeconds = wav ? wav.pcm.length / (wav.sampleRateHz * 2 * (wav.channels || 1)) : null;
	const provider = out.lane ? `gemini-tts:${out.lane}` : 'nvidia-nim-magpie';
	return {
		result: {
			url: stored.url,
			content_type: out.content_type || 'audio/wav',
			format: out.format || 'wav',
			bytes: audio.length,
			sample_rate: out.sample_rate ?? null,
			duration_seconds: durationSeconds == null ? null : Math.round(durationSeconds * 100) / 100,
			characters: text.length,
			voice: out.voice,
			model: out.model,
			provider,
			...(out.fallback_from ? { fallback_from: out.fallback_from } : {}),
			...(stored.inline ? { stored: false } : {}),
		},
		units: ttsUnits(text),
		provider,
	};
}

// ── transcribe ──────────────────────────────────────────────────────────────

/** Sniff an audio container from its first bytes. */
export function sniffAudio(buf) {
	if (!buf || buf.length < 12) return null;
	const head4 = buf.toString('ascii', 0, 4);
	if (head4 === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return { format: 'wav', mime: 'audio/wav' };
	if (head4 === 'fLaC') return { format: 'flac', mime: 'audio/flac' };
	if (head4 === 'OggS') return { format: 'ogg', mime: 'audio/ogg' };
	if (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { format: 'mp3', mime: 'audio/mpeg' };
	if (buf.toString('ascii', 4, 8) === 'ftyp') return { format: 'm4a', mime: 'audio/mp4' };
	if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { format: 'webm', mime: 'audio/webm' };
	return null;
}

/** Seconds of audio, exact for WAV and estimated for compressed containers. */
export function audioSeconds(buf, kind) {
	if (kind?.format === 'wav') {
		const wav = parseWav(buf);
		if (wav) return wav.pcm.length / (wav.sampleRateHz * 2 * (wav.channels || 1));
	}
	return buf.length / COMPRESSED_BYTES_PER_SECOND;
}

async function loadAudio(args) {
	if (args?.url) {
		const { body } = await downloadPublic(String(args.url), { maxBytes: TRANSCRIBE_MAX_BYTES, accept: 'audio/*,*/*;q=0.5', timeoutMs: 30_000 });
		return body;
	}
	if (args?.audio) return decodeBase64Input(args.audio, { maxBytes: TRANSCRIBE_MAX_BYTES, field: 'audio' });
	throw new GatewayError(400, 'bad_request', 'Pass "url" (a public audio file) or "audio" (base64).');
}

/** Estimate for the up-front charge, from the declared or inline size. */
export function estimateTranscribe(args) {
	if (args?.audio) {
		const b64 = String(args.audio).replace(/^data:[^,]*,/, '');
		return Math.max(0.05, (b64.length * 0.75) / COMPRESSED_BYTES_PER_SECOND / 60);
	}
	// A URL's length is unknown until it downloads; one minute is charged up
	// front and settled to the measured duration after.
	return 1;
}

async function viaRiva(buf, kind, language, wantWords) {
	let audio = buf;
	let encoding = kind.format === 'flac' ? 'FLAC' : kind.format === 'ogg' ? 'OGGOPUS' : 'LINEAR_PCM';
	let sampleRateHz = 16000;
	if (kind.format === 'wav') {
		const wav = parseWav(buf);
		if (!wav) throw Object.assign(new Error('unreadable WAV header'), { code: 'invalid_argument' });
		if ((wav.channels || 1) !== 1) throw Object.assign(new Error('Riva reads mono WAV only'), { code: 'invalid_argument' });
		audio = wav.pcm;
		sampleRateHz = wav.sampleRateHz;
		encoding = 'LINEAR_PCM';
	} else if (kind.format === 'ogg') {
		sampleRateHz = 48000;
	}
	const out = await transcribeNvidiaAsr({ audio, encoding, sampleRateHz, language, wordTimeOffsets: wantWords, timeoutMs: 30_000 });
	return { text: out.text, confidence: out.confidence ?? null, language: out.language || language, model: out.model, seconds: out.audioProcessed || null, words: out.words };
}

async function viaGemini(buf, kind, language) {
	const out = await geminiReadFile({
		data: buf,
		mimeType: kind?.mime || 'audio/mpeg',
		instruction:
			`Transcribe this audio verbatim. The expected language is ${language}, but transcribe whatever language is spoken. ` +
			'Return only the transcript text: no timestamps, no speaker labels, no commentary. If nothing is spoken, return an empty string.',
		maxOutputTokens: 8192,
		timeoutMs: 120_000,
	});
	return { text: out.text.trim(), confidence: null, language, model: out.model, seconds: null };
}

export async function transcribe(args) {
	const language = args?.language ? String(args.language).slice(0, 16) : 'en-US';
	const wantWords = args?.words === true;
	const buf = await loadAudio(args);
	const kind = sniffAudio(buf);
	if (!kind) throw new GatewayError(415, 'unsupported_media', 'That does not look like an audio file (WAV, FLAC, Ogg/Opus, MP3, M4A or WebM).');

	const errors = [];
	let out = null;
	let provider = null;
	if (['wav', 'flac', 'ogg'].includes(kind.format) && nvidiaAsrConfigured()) {
		try {
			out = await viaRiva(buf, kind, language, wantWords);
			provider = 'nvidia-nim-riva';
		} catch (err) {
			errors.push(`riva: ${err?.message || err}`);
		}
	}
	if (!out && geminiFilesAvailable()) {
		try {
			out = await viaGemini(buf, kind, language);
			provider = 'vertex-gemini';
		} catch (err) {
			errors.push(`gemini: ${err?.message || err}`);
		}
	}
	if (!out) {
		if (!errors.length) {
			throw new GatewayError(503, 'not_configured', 'No transcription lane is configured on this deployment (set NVIDIA_API_KEY or GOOGLE_CLOUD_PROJECT).');
		}
		throw new GatewayError(502, 'transcribe_failed', `Every transcription lane failed. ${errors.join('; ').slice(0, 400)}`);
	}
	const seconds = kind.format === 'wav' ? audioSeconds(buf, kind) : out.seconds || audioSeconds(buf, kind);
	return {
		result: {
			text: out.text,
			language: out.language,
			confidence: out.confidence,
			duration_seconds: Math.round(seconds * 100) / 100,
			format: kind.format,
			model: out.model,
			provider,
			...(wantWords && out.words ? { words: out.words } : {}),
			...(errors.length ? { fallback_from: errors.map((e) => e.split(':')[0]) } : {}),
		},
		units: seconds / 60,
		provider,
	};
}
