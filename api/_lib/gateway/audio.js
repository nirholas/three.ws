// Audio for the chat gateways: turning whatever a platform delivers into
// something the speech lane can hear, and turning an agent's reply into a voice
// note every platform can play.
//
// Inbound: Telegram, Discord and WhatsApp send Ogg/Opus, which the NVIDIA Riva
// lane (the same one behind POST /api/asr) accepts as is. Slack clips arrive as
// WebM or MP4, Signal as AAC and MMS as AMR, so those are transcoded to Ogg/Opus
// with ffmpeg first. When Riva is unreachable or unconfigured, the clip goes to
// Gemini on Vertex AI (platform GCP credits) instead, so a voice note still
// lands as text.
//
// Outbound: a reply is synthesized on the platform's server-side TTS lanes
// (api/_lib/voice-providers.js synthesizeVoice), starting with the agent's own
// configured voice when it lives on one of those lanes, then NVIDIA Magpie,
// Gemini on Vertex, the free Edge lane and OpenAI. The clip is always delivered
// as a 48 kHz mono Ogg/Opus voice note: the one container Telegram shows as a
// voice bubble, WhatsApp as a voice message, and Signal, Slack and Discord play.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { sql } from '../db.js';
import { env } from '../env.js';
import { transcribeNvidiaAsr, nvidiaAsrConfigured } from '../asr-nvidia.js';
import { synthesizeVoice } from '../voice-providers.js';
import { geminiTtsConfigured } from '../tts-gemini.js';
import { nvidiaTtsConfigured } from '../tts-nvidia.js';
import { getGcpAccessToken } from '../gcp-auth.js';

export const SPOKEN_MAX_CHARS = 700;
const FFMPEG_TIMEOUT_MS = 30_000;
const SERVER_LANES = ['nvidia', 'gemini', 'edge', 'openai'];
const OPUS_ARGS = ['-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg'];

/**
 * The ffmpeg binary: FFMPEG_PATH when set (the gateway image installs the
 * distro ffmpeg), the ffmpeg-static binary when its install script ran, else
 * `ffmpeg` on PATH.
 */
export function ffmpegPath() {
	if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
	try {
		const p = createRequire(import.meta.url)('ffmpeg-static');
		if (typeof p === 'string' && p) return p;
	} catch {
		// ffmpeg-static is optional here: the PATH binary below serves instead.
	}
	return 'ffmpeg';
}

/** Run ffmpeg over a buffer: stdin in, stdout out. */
export function runFfmpeg(input, args, { timeoutMs = FFMPEG_TIMEOUT_MS } = {}) {
	return new Promise((resolve, reject) => {
		const proc = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...args, 'pipe:1']);
		const out = [];
		let err = '';
		const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(Object.assign(new Error('ffmpeg timed out'), { code: 'transcode_timeout' })); }, timeoutMs);
		proc.stdout.on('data', (d) => out.push(d));
		proc.stderr.on('data', (d) => { err += d; });
		proc.on('error', (e) => { clearTimeout(timer); reject(Object.assign(e, { code: 'transcode_unavailable' })); });
		proc.on('close', (code) => {
			clearTimeout(timer);
			if (code === 0 && out.length) resolve(Buffer.concat(out));
			else reject(Object.assign(new Error(`ffmpeg exited ${code}: ${err.trim().slice(0, 300)}`), { code: 'transcode_failed' }));
		});
		proc.stdin.on('error', () => {});
		proc.stdin.end(input);
	});
}

/** True when a clip is already Ogg/Opus and Riva can take it untouched. */
export function isOggOpus(mimeType) {
	return /^audio\/(ogg|opus)/i.test(String(mimeType || ''));
}

/** Any recorded audio as mono 48 kHz Ogg/Opus. Ogg input passes through untouched. */
export async function toOggOpus(buffer, mimeType = null) {
	if (isOggOpus(mimeType)) return buffer;
	return runFfmpeg(buffer, OPUS_ARGS);
}

async function transcribeWithGemini(ogg) {
	const project = process.env.GOOGLE_CLOUD_PROJECT;
	if (!project) throw Object.assign(new Error('Vertex AI is not configured'), { code: 'not_configured' });
	const location = process.env.GOOGLE_CLOUD_LOCATION_GEMINI || 'global';
	const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
	const model = (process.env.VERTEX_GEMINI_MODEL || 'google/gemini-2.5-flash').replace(/^google\//, '');
	const token = await getGcpAccessToken();
	const r = await fetch(`https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			contents: [{
				role: 'user',
				parts: [
					{ inlineData: { mimeType: 'audio/ogg', data: ogg.toString('base64') } },
					{ text: 'Transcribe this voice note verbatim. Reply with the transcript only, no commentary. If there is no speech, reply with nothing.' },
				],
			}],
			generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
		}),
		signal: AbortSignal.timeout(30_000),
	});
	const j = await r.json().catch(() => null);
	if (!r.ok) throw Object.assign(new Error(j?.error?.message || `vertex ${r.status}`), { code: 'provider_error' });
	return (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

/** Whether any speech-to-text lane can serve. */
export function speechConfigured() {
	return nvidiaAsrConfigured() || Boolean(process.env.GOOGLE_CLOUD_PROJECT);
}

/**
 * Transcribe a voice note in any container. Riva first; Gemini on Vertex when
 * Riva is down or unconfigured.
 * @returns {Promise<string>} the transcript (empty when nothing was said)
 */
export async function transcribeAudio({ buffer, mimeType, language = 'en-US' }) {
	const ogg = await toOggOpus(buffer, mimeType);
	if (nvidiaAsrConfigured()) {
		try {
			const out = await transcribeNvidiaAsr({ audio: ogg, encoding: 'OGGOPUS', sampleRateHz: 48000, language });
			return String(out?.text || '').trim();
		} catch (e) {
			if (!process.env.GOOGLE_CLOUD_PROJECT) throw e;
			console.warn('[gateway] riva failed, trying gemini', e?.code || e?.message);
		}
	}
	return transcribeWithGemini(ogg);
}

/**
 * The part of a reply worth saying out loud: markdown, links and long base58
 * strings (addresses, signatures) removed, cut at a sentence boundary so the
 * clip never stops mid-word.
 */
export function spokenText(reply, max = SPOKEN_MAX_CHARS) {
	let s = String(reply || '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/\[([^\]]+)\]\((?:https?:[^)]+)\)/g, '$1')
		.replace(/https?:\/\/\S+/g, '')
		.replace(/\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/g, '')
		.replace(/[*_`#>]/g, '')
		.replace(/\n{2,}/g, '. ')
		.replace(/\s+/g, ' ')
		.replace(/\s+([.,!?])/g, '$1')
		.trim();
	if (s.length <= max) return s;
	s = s.slice(0, max);
	const cut = Math.max(s.lastIndexOf('. '), s.lastIndexOf('! '), s.lastIndexOf('? '));
	return (cut > max * 0.4 ? s.slice(0, cut + 1) : `${s.slice(0, s.lastIndexOf(' '))}.`).trim();
}

function laneConfigured(lane) {
	if (lane === 'nvidia') return nvidiaTtsConfigured();
	if (lane === 'gemini') return geminiTtsConfigured();
	if (lane === 'openai') return Boolean(env.OPENAI_API_KEY);
	return lane === 'edge';
}

/** The server-side TTS lanes that can serve right now, in failover order. */
export function ttsLanes() {
	return SERVER_LANES.filter(laneConfigured);
}

async function agentVoice(agentId) {
	if (!agentId) return null;
	const [row] = await sql`SELECT voice_provider, voice_id FROM agent_identities WHERE id = ${agentId}`.catch(() => []);
	if (!row || !SERVER_LANES.includes(row.voice_provider)) return null;
	return { provider: row.voice_provider, voiceId: row.voice_id || undefined };
}

/**
 * Speak a reply. Returns null when there is nothing to say; throws only when
 * every lane failed, carrying the last lane's error.
 * @returns {Promise<{ buffer:Buffer, mimeType:'audio/ogg', filename:string, provider:string } | null>}
 */
export async function synthesizeReply(reply, { agentId = null } = {}) {
	const text = spokenText(reply);
	if (!text) return null;
	const preferred = await agentVoice(agentId);
	const attempts = [];
	if (preferred && laneConfigured(preferred.provider)) attempts.push(preferred);
	for (const lane of ttsLanes()) if (lane !== preferred?.provider) attempts.push({ provider: lane });
	let last = null;
	for (const a of attempts) {
		try {
			const out = await synthesizeVoice({ provider: a.provider, voiceId: a.voiceId, text, format: a.provider === 'openai' ? 'opus' : undefined });
			const buffer = await toOggOpus(out.audio, out.contentType);
			return { buffer, mimeType: 'audio/ogg', filename: 'reply.ogg', provider: a.provider };
		} catch (e) {
			last = e;
			console.warn(`[gateway] tts lane ${a.provider} failed`, e?.code || e?.message);
		}
	}
	throw last || Object.assign(new Error('no speech lane is configured'), { code: 'not_configured' });
}
