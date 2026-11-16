// Free NVIDIA NIM TTS lane — Magpie multilingual (Riva) over NVCF gRPC.
//
// Magpie has NO REST surface: it is hosted as an NVCF gRPC function on
// grpc.nvcf.nvidia.com:443, selected by a `function-id` metadata entry, with
// the nvapi key as a bearer `authorization` metadata entry (live-verified —
// see tasks/nvidia-nim/probes/tts.md). The wire contract is the standard Riva
// SpeechSynthesis service; the proto definitions are vendored under
// ./riva-protos/ and loaded from a generated JSON descriptor so no .proto
// file needs to exist on the serverless filesystem (api/ routes are
// esbuild-bundled in place — scripts/bundle-api.mjs).
//
// Platform policy (api/_lib/llm.js doctrine): this free lane leads the TTS
// chain; OpenAI is the paid last-resort backstop wired by the callers
// (api/tts/speak.js, packages/avatar-agent-mcp). Mirrored for the published
// MCP package at packages/avatar-agent-mcp/src/lib/tts-nvidia.js — keep both
// in sync.

import { env } from './env.js';
import rivaDescriptor from './riva-protos/descriptor.js';

export const NVIDIA_TTS_MODEL = 'magpie-tts-multilingual';
export const NVIDIA_TTS_HOST = 'grpc.nvcf.nvidia.com:443';
// NVCF function id for `ai-magpie-tts-multilingual` (from the probed function
// list — GET api.nvcf.nvidia.com/v2/nvcf/functions).
export const MAGPIE_FUNCTION_ID = '877104f7-e885-42b9-8de8-f6e4c6303969';

// Magpie's native model rate is 22050 Hz; the server resamples. 44100 was
// live-verified and keeps playback quality high for avatar speech.
const SAMPLE_RATE_HZ = 44100;
const DEFAULT_TIMEOUT_MS = 30_000;

// The 9 languages the live model config reports, plus bare-tag aliases so
// callers can pass "en" / "ja" etc.
export const MAGPIE_LANGUAGES = new Map([
	['en-US', 'en-US'],
	['es-US', 'es-US'],
	['fr-FR', 'fr-FR'],
	['de-DE', 'de-DE'],
	['zh-CN', 'zh-CN'],
	['vi-VN', 'vi-VN'],
	['it-IT', 'it-IT'],
	['hi-IN', 'hi-IN'],
	['ja-JP', 'ja-JP'],
	['en', 'en-US'],
	['es', 'es-US'],
	['fr', 'fr-FR'],
	['de', 'de-DE'],
	['zh', 'zh-CN'],
	['vi', 'vi-VN'],
	['it', 'it-IT'],
	['hi', 'hi-IN'],
	['ja', 'ja-JP'],
]);

// OpenAI-style voice name → nearest Magpie persona (en-US set, live-verified
// by scripts/verify-nvidia-tts.mjs). Full voice ids are built as
// `Magpie-Multilingual.<LANG>.<Persona>`; the persona is held constant across
// languages so a caller switching language keeps a consistent character.
export const VOICE_TO_MAGPIE = {
	alloy: 'Mia',
	ash: 'Jason',
	ballad: 'Leo',
	coral: 'Sofia',
	echo: 'Ray',
	fable: 'Leo',
	nova: 'Aria',
	onyx: 'Ray',
	sage: 'Mia',
	shimmer: 'Sofia',
	verse: 'Jason',
};
const DEFAULT_PERSONA = 'Sofia';

export function nvidiaTtsConfigured() {
	return Boolean(env.NVIDIA_API_KEY);
}

export function resolveMagpieLanguage(language) {
	if (!language) return 'en-US';
	const exact =
		MAGPIE_LANGUAGES.get(language) || MAGPIE_LANGUAGES.get(String(language).toLowerCase());
	if (exact) return exact;
	// Try the primary subtag ("en-GB" → "en" → "en-US").
	const primary = String(language).toLowerCase().split('-')[0];
	return MAGPIE_LANGUAGES.get(primary) || 'en-US';
}

// Returns the full Riva voice_name for an OpenAI-style voice (or passes a raw
// Magpie voice id straight through, emotion suffixes included).
export function resolveMagpieVoice(voice, language) {
	if (typeof voice === 'string' && voice.startsWith('Magpie-')) return voice;
	const lang = resolveMagpieLanguage(language);
	const persona = VOICE_TO_MAGPIE[voice] || DEFAULT_PERSONA;
	// Subvoice ids are upper-cased on the server ("EN-US.Aria", "ZH-CN.Mia") —
	// lowercase language tags come back as INVALID_ARGUMENT "subvoice not found".
	return `Magpie-Multilingual.${lang.toUpperCase()}.${persona}`;
}

// Magpie cannot encode mp3/aac/flac, and its OGGOPUS output over NVCF is
// length-framed raw Opus packets WITHOUT an Ogg container (live-verified
// 2026-06-11 — no OggS magic anywhere in the payload), so it is not directly
// playable either. Every non-pcm request is therefore served as WAV; browser
// decoders sniff the container, and content-type + x-tts-format stay truthful
// about what was actually sent. The OpenAI backstop still produces native
// mp3/opus/aac/flac when it serves.
export function resolveMagpieFormat(format) {
	if (format === 'pcm')
		return { encoding: 'LINEAR_PCM', wrapWav: false, format: 'pcm', contentType: 'audio/pcm' };
	return { encoding: 'LINEAR_PCM', wrapWav: true, format: 'wav', contentType: 'audio/wav' };
}

// Standard 44-byte RIFF/WAVE header around raw little-endian s16 PCM.
export function pcmToWav(
	pcm,
	{ sampleRateHz = SAMPLE_RATE_HZ, channels = 1, bitsPerSample = 16 } = {},
) {
	const blockAlign = channels * (bitsPerSample >> 3);
	const byteRate = sampleRateHz * blockAlign;
	const header = Buffer.alloc(44);
	header.write('RIFF', 0, 'ascii');
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write('WAVE', 8, 'ascii');
	header.write('fmt ', 12, 'ascii');
	header.writeUInt32LE(16, 16); // PCM fmt chunk size
	header.writeUInt16LE(1, 20); // audio format: PCM
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRateHz, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write('data', 36, 'ascii');
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

// gRPC status code → platform error code (numeric codes so the mapping does
// not depend on the grpc-js import being resolved).
function normalizeGrpcError(err) {
	const code = typeof err?.code === 'number' ? err.code : null;
	const map = {
		3: 'invalid_argument', // bad voice/lang/text
		4: 'timeout', // DEADLINE_EXCEEDED
		7: 'invalid_key', // PERMISSION_DENIED
		8: 'rate_limited', // RESOURCE_EXHAUSTED (credit-metered free tier)
		14: 'provider_unreachable', // UNAVAILABLE
		16: 'invalid_key', // UNAUTHENTICATED
	};
	const normalized = new Error(
		`NVIDIA Magpie TTS failed${code !== null ? ` (gRPC ${code})` : ''}: ${err?.details || err?.message || 'unknown error'}`,
	);
	normalized.code = (code !== null && map[code]) || 'provider_error';
	normalized.grpcCode = code;
	return normalized;
}

// The TLS channel is keyless (auth rides in per-call metadata), so one cached
// client serves the whole warm lambda. @grpc/grpc-js is imported lazily to
// keep cold starts of non-TTS importers free of the dependency.
//
// NVCF gotcha (live-observed): authorization is validated when the gRPC
// stream/connection is established — an already-authenticated warm channel
// keeps serving even if the key in env later changes. Irrelevant for prod
// (the key is fixed per deployment), but key-rotation tests must use a fresh
// process (see scripts/verify-nvidia-tts.mjs).
let clientPromise = null;
async function getClient() {
	if (!clientPromise) {
		clientPromise = (async () => {
			const [{ default: grpc }, { default: protoLoader }] = await Promise.all([
				import('@grpc/grpc-js'),
				import('@grpc/proto-loader'),
			]);
			const definition = protoLoader.fromJSON(rivaDescriptor, {
				keepCase: true,
				longs: Number,
				enums: String,
				defaults: true,
				oneofs: true,
			});
			const pkg = grpc.loadPackageDefinition(definition);
			const Synthesis = pkg.nvidia.riva.tts.RivaSpeechSynthesis;
			return {
				grpc,
				client: new Synthesis(NVIDIA_TTS_HOST, grpc.credentials.createSsl(), {
					'grpc.max_receive_message_length': 64 * 1024 * 1024,
					// Keep the HTTP/2 connection to NVCF alive between requests: a cold
					// channel adds ~1.1 s of TLS + auth to the first audio (measured).
					'grpc.keepalive_time_ms': 30_000,
					'grpc.keepalive_permit_without_calls': 1,
				}),
			};
		})().catch((e) => {
			clientPromise = null; // a failed init must not poison the warm lambda
			throw e;
		});
	}
	return clientPromise;
}

// Synthesize speech on the free NIM lane. Resolves with the COMPLETE audio
// buffer (non-streaming Synthesize RPC) so callers can fail over to the paid
// backstop before a single byte reaches the client.
//
//   { text, voice?, language?, format?, timeoutMs?, apiKey? }
//     → { audio: Buffer, contentType, format, voiceName, model, sampleRateHz }
//
// Throws Error with .code ∈ invalid_key | rate_limited | invalid_argument |
// timeout | provider_unreachable | provider_error | not_configured.
export async function synthesizeNvidiaTts({
	text,
	voice = 'nova',
	language = 'en-US',
	format = 'mp3',
	timeoutMs = DEFAULT_TIMEOUT_MS,
	apiKey,
} = {}) {
	const key = apiKey || env.NVIDIA_API_KEY;
	if (!key) {
		const err = new Error('NVIDIA_API_KEY not set');
		err.code = 'not_configured';
		throw err;
	}
	const voiceName = resolveMagpieVoice(voice, language);
	const languageCode = resolveMagpieLanguage(language);
	const out = resolveMagpieFormat(format);

	const { grpc, client } = await getClient();
	const metadata = new grpc.Metadata();
	metadata.set('function-id', MAGPIE_FUNCTION_ID);
	metadata.set('authorization', `Bearer ${key}`);

	const response = await new Promise((resolveCall, rejectCall) => {
		client.synthesize(
			{
				text,
				language_code: languageCode,
				encoding: out.encoding,
				sample_rate_hz: SAMPLE_RATE_HZ,
				voice_name: voiceName,
			},
			metadata,
			{ deadline: new Date(Date.now() + timeoutMs) },
			(err, res) => (err ? rejectCall(normalizeGrpcError(err)) : resolveCall(res)),
		);
	});

	const raw = Buffer.isBuffer(response?.audio)
		? response.audio
		: Buffer.from(response?.audio || []);
	if (!raw.length) {
		const err = new Error('NVIDIA Magpie TTS returned empty audio');
		err.code = 'provider_error';
		throw err;
	}
	return {
		audio: out.wrapWav ? pcmToWav(raw, { sampleRateHz: SAMPLE_RATE_HZ }) : raw,
		contentType: out.contentType,
		format: out.format,
		voiceName,
		model: NVIDIA_TTS_MODEL,
		sampleRateHz: SAMPLE_RATE_HZ,
	};
}

// Magpie's native synthesis rate. The streaming lane asks for it directly so
// no audio is upsampled on NVIDIA's side only to be resampled again for A2F.
export const STREAM_SAMPLE_RATE_HZ = 22050;

/**
 * Synthesize speech as a stream (Riva SynthesizeOnline). Raw little-endian s16
 * mono PCM chunks reach `onChunk` as Magpie produces them, so a caller can
 * start playback and Audio2Face long before the sentence finishes. Measured on
 * a warm channel: first chunk ~240 ms, versus ~750 ms for the blocking RPC.
 *
 *   { text, voice?, language?, sampleRateHz?, onChunk(Buffer), timeoutMs?, apiKey? }
 *     -> { voiceName, model, sampleRateHz, bytes, firstChunkMs, totalMs }
 *
 * Throws the same .code set as synthesizeNvidiaTts. `deps.getClient` lets the
 * stream plumbing be tested without a network.
 */
export async function synthesizeNvidiaTtsStream(
	{
		text,
		voice = 'nova',
		language = 'en-US',
		sampleRateHz = STREAM_SAMPLE_RATE_HZ,
		onChunk,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		apiKey,
	} = {},
	deps = {},
) {
	const key = apiKey || env.NVIDIA_API_KEY;
	if (!key) {
		const err = new Error('NVIDIA_API_KEY not set');
		err.code = 'not_configured';
		throw err;
	}
	const voiceName = resolveMagpieVoice(voice, language);
	const languageCode = resolveMagpieLanguage(language);
	const { grpc, client } = await (deps.getClient || getClient)();
	const metadata = new grpc.Metadata();
	metadata.set('function-id', MAGPIE_FUNCTION_ID);
	metadata.set('authorization', `Bearer ${key}`);

	const t0 = Date.now();
	let bytes = 0;
	let firstChunkMs = null;
	await new Promise((resolveCall, rejectCall) => {
		let settled = false;
		const finish = (fn, v) => {
			if (settled) return;
			settled = true;
			fn(v);
		};
		// SynthesizeOnline is declared bidi in the Riva descriptor: one request
		// written, then the stream is half-closed and audio flows back.
		const call = client.synthesizeOnline(metadata, {
			deadline: new Date(Date.now() + timeoutMs),
		});
		call.on('data', (res) => {
			const raw = Buffer.isBuffer(res?.audio) ? res.audio : Buffer.from(res?.audio || []);
			if (!raw.length) return;
			if (firstChunkMs === null) firstChunkMs = Date.now() - t0;
			bytes += raw.length;
			try {
				onChunk?.(raw);
			} catch (e) {
				try {
					call.cancel();
				} catch {}
				finish(rejectCall, e);
			}
		});
		call.on('error', (e) => finish(rejectCall, normalizeGrpcError(e)));
		call.on('end', () => finish(resolveCall));
		call.write({
			text,
			language_code: languageCode,
			encoding: 'LINEAR_PCM',
			sample_rate_hz: sampleRateHz,
			voice_name: voiceName,
		});
		call.end();
	});
	if (!bytes) {
		const err = new Error('NVIDIA Magpie TTS returned empty audio');
		err.code = 'provider_error';
		throw err;
	}
	return {
		voiceName,
		model: NVIDIA_TTS_MODEL,
		sampleRateHz,
		bytes,
		firstChunkMs,
		totalMs: Date.now() - t0,
	};
}

/**
 * Open and authenticate the Magpie stream path ahead of the first request.
 * waitForReady alone is not enough: NVCF authorizes per stream, so the first
 * real stream on a fresh channel still paid ~900 ms (measured 2026-11-16). A
 * one-word synthesis pays it here instead. Never throws.
 */
export async function warmTtsChannel({ timeoutMs = 5000, apiKey } = {}) {
	const t0 = Date.now();
	try {
		await synthesizeNvidiaTtsStream({
			text: 'Hi.',
			sampleRateHz: STREAM_SAMPLE_RATE_HZ,
			timeoutMs,
			apiKey,
		});
		return { ok: true, ms: Date.now() - t0 };
	} catch (e) {
		return { ok: false, ms: Date.now() - t0, error: e?.code || e?.message || String(e) };
	}
}
