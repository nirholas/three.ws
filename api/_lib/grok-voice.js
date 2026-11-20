// Grok Voice realtime: server half of the browser speech-to-speech session.
//
// The browser talks to xAI's realtime WebSocket directly (lowest latency, no
// audio relay through Cloud Run), but it must never hold the server's xAI key.
// So the server mints a short-lived client secret at POST /v1/realtime/
// client_secrets and hands the browser only that secret, its expiry and the
// session config it should send in its first `session.update` (the token
// endpoint does not carry session config: docs.x.ai/developers/model-
// capabilities/audio/ephemeral-tokens, read 2026-11-20).
//
// Model ids, URLs and audio rates live in api/_lib/chat-models.js.

import {
	GROK_VOICE_CLIENT_SECRETS_URL,
	GROK_VOICE_DEFAULT_VOICE,
	GROK_VOICE_INPUT_RATE,
	GROK_VOICE_MODEL,
	GROK_VOICE_OUTPUT_RATE,
	GROK_VOICE_REALTIME_URL,
	GROK_VOICE_TRANSCRIBE_MODEL,
	GROK_VOICE_VOICES_URL,
} from './chat-models.js';

/** Client secret lifetime. Long enough to reconnect a dropped socket, short enough to be worthless if leaked. */
export const GROK_VOICE_SECRET_TTL_S = 300;
const MINT_TIMEOUT_MS = 8_000;
const VOICES_TIMEOUT_MS = 6_000;
const VOICES_CACHE_MS = 60 * 60 * 1000;
const MAX_PERSONA_CHARS = 6_000;
const VOICE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** An upstream failure with a stable code the handler maps to an HTTP answer. */
export class GrokVoiceError extends Error {
	constructor(code, message, { status = 502, upstreamStatus = null } = {}) {
		super(message);
		this.code = code;
		this.status = status;
		this.upstreamStatus = upstreamStatus;
	}
}

/** True when a voice id is safe to forward (xAI ids are lowercase words, custom ids are slugs). */
export function isValidVoiceId(id) {
	return typeof id === 'string' && VOICE_ID_RE.test(id);
}

/**
 * The spoken persona. Voice replies are heard, not read, so the agent's own
 * persona is kept and a short speaking note is appended. A persona_prompt is
 * private to the agent's owner, so a non-owner only gets the public name and
 * description.
 *
 * @param {{ name?: string, description?: string, persona_prompt?: string, meta?: object } | null} agent
 * @param {{ owner: boolean }} o
 */
export function buildVoiceInstructions(agent, { owner }) {
	const name = String(agent?.name || '').trim();
	const desc = String(agent?.description || '').trim();
	const persona = owner
		? String(agent?.persona_prompt || agent?.meta?.brain?.instructions || '').trim()
		: '';
	const opening = persona
		? persona.slice(0, MAX_PERSONA_CHARS)
		: name
			? `You are ${name}, a 3D agent on three.ws.${desc ? ` ${desc}` : ''}`
			: 'You are a friendly 3D avatar on three.ws, the platform for interactive 3D agents.';
	return [
		opening,
		'You are speaking out loud through an animated 3D avatar. Keep replies short and ' +
			'conversational: one to three sentences unless the user asks for more. Never read ' +
			'out markdown, lists, links or code.',
	].join('\n\n');
}

/**
 * The `session` object the browser sends in its first `session.update`.
 * PCM16 both ways; 16 kHz in matches MicCapture's PcmDownsampler.
 */
export function buildSessionConfig({ instructions, voice }) {
	return {
		instructions,
		voice: voice || GROK_VOICE_DEFAULT_VOICE,
		turn_detection: { type: 'server_vad' },
		audio: {
			input: {
				format: { type: 'audio/pcm', rate: GROK_VOICE_INPUT_RATE },
				transcription: { model: GROK_VOICE_TRANSCRIBE_MODEL },
			},
			output: { format: { type: 'audio/pcm', rate: GROK_VOICE_OUTPUT_RATE } },
		},
	};
}

/** The realtime socket URL for the configured model. */
export function realtimeUrl() {
	return `${GROK_VOICE_REALTIME_URL}?model=${encodeURIComponent(GROK_VOICE_MODEL)}`;
}

async function readUpstreamError(res) {
	try {
		const body = await res.json();
		return String(body?.error || body?.code || body?.message || '').slice(0, 300);
	} catch {
		return '';
	}
}

/**
 * Mint a client secret. Resolves `{ value, expiresAt }` (expiresAt in unix
 * seconds) or throws GrokVoiceError:
 *   grok_voice_key_rejected  400/401/403: the server key is missing or wrong
 *   grok_voice_rate_limited  429 from xAI
 *   grok_voice_upstream_error  anything else, including a malformed body
 */
export async function mintClientSecret({ apiKey, ttlSeconds = GROK_VOICE_SECRET_TTL_S, fetchImpl = fetch }) {
	let res;
	try {
		res = await fetchImpl(GROK_VOICE_CLIENT_SECRETS_URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
			body: JSON.stringify({ expires_after: { seconds: ttlSeconds } }),
			signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
		});
	} catch (err) {
		throw new GrokVoiceError('grok_voice_upstream_error', `xAI token endpoint unreachable: ${err?.message || err}`);
	}
	if (!res.ok) {
		const detail = await readUpstreamError(res);
		if (res.status === 400 || res.status === 401 || res.status === 403) {
			throw new GrokVoiceError('grok_voice_key_rejected', `xAI rejected the server key (${res.status})${detail ? `: ${detail}` : ''}`, {
				status: 503,
				upstreamStatus: res.status,
			});
		}
		if (res.status === 429) {
			throw new GrokVoiceError('grok_voice_rate_limited', 'xAI is rate limiting voice sessions, try again shortly', {
				status: 503,
				upstreamStatus: 429,
			});
		}
		throw new GrokVoiceError('grok_voice_upstream_error', `xAI token endpoint answered ${res.status}${detail ? `: ${detail}` : ''}`, {
			upstreamStatus: res.status,
		});
	}
	let body;
	try {
		body = await res.json();
	} catch {
		throw new GrokVoiceError('grok_voice_upstream_error', 'xAI token endpoint returned a non-JSON body');
	}
	const value = typeof body?.value === 'string' ? body.value : '';
	const expiresAt = Number(body?.expires_at);
	if (!value || !Number.isFinite(expiresAt) || expiresAt <= 0) {
		throw new GrokVoiceError('grok_voice_upstream_error', 'xAI token response is missing value or expires_at');
	}
	return { value, expiresAt };
}

let voicesCache = null;

/**
 * The live voice roster from GET /v1/tts/voices, cached for an hour. Resolves
 * `[{ id, name, language }]`; on any upstream failure it resolves the
 * documented default alone, so a picker always has something real to show.
 */
export async function listVoices({ apiKey, fetchImpl = fetch, now = Date.now() }) {
	if (voicesCache && now - voicesCache.at < VOICES_CACHE_MS) return voicesCache.voices;
	const fallback = [{ id: GROK_VOICE_DEFAULT_VOICE, name: 'Eve', language: null }];
	try {
		const res = await fetchImpl(GROK_VOICE_VOICES_URL, {
			headers: { authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(VOICES_TIMEOUT_MS),
		});
		if (!res.ok) return fallback;
		const body = await res.json();
		const voices = (Array.isArray(body?.voices) ? body.voices : [])
			.map((v) => ({
				id: String(v?.voice_id || '').toLowerCase(),
				name: String(v?.name || v?.voice_id || ''),
				language: v?.language ? String(v.language) : null,
			}))
			.filter((v) => isValidVoiceId(v.id));
		if (!voices.length) return fallback;
		voicesCache = { at: now, voices };
		return voices;
	} catch {
		return fallback;
	}
}

/** Test seam: drop the cached roster. */
export function resetVoicesCache() {
	voicesCache = null;
}
