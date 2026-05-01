/**
 * POST /api/tts/edge
 *
 * Microsoft Edge TTS proxy using the same unofficial WebSocket protocol as
 * the edge-tts Python package (pypi.org/project/edge-tts).
 * No API key required — uses the public TrustedClientToken.
 * Caches synthesized clips in R2 by sha256(voice + text + rate + pitch) for 30 days.
 *
 * Body: { voice: string, text: string, rate?: string, pitch?: string }
 *   voice — e.g. "en-US-AriaNeural". Defaults to "en-US-AriaNeural".
 *   rate  — prosody rate, e.g. "+0%", "-10%", "+20%". Defaults to "+0%".
 *   pitch — prosody pitch, e.g. "+0Hz", "-5Hz". Defaults to "+0Hz".
 * Response: audio/mpeg
 */

import WebSocket from 'ws';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, method, wrap, error, readJson } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { sha256 } from '../_lib/crypto.js';
import { headObject, getObjectBuffer, putObject } from '../_lib/r2.js';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_BASE = `wss://speech.microsoft.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

const WS_HEADERS = {
	Pragma: 'no-cache',
	'Cache-Control': 'no-cache',
	Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
	'Accept-Encoding': 'gzip, deflate, br',
	'Accept-Language': 'en-US,en;q=0.9',
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
};

// e.g. "en-US-AriaNeural", "zh-CN-XiaoxiaoNeural"
const VOICE_RE = /^[a-zA-Z]{2,8}-[a-zA-Z]{2,8}-[a-zA-Z]{5,50}$/;
const RATE_RE = /^[+-]\d+%$/;
const PITCH_RE = /^[+-]\d+Hz$/;

function isoTimestamp() {
	return new Date().toISOString().replace(/\.\d+/, '.000');
}

function mkId() {
	return crypto.randomUUID().replace(/-/g, '');
}

function buildSsml(voice, text, rate, pitch) {
	const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return (
		`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
		`<voice name='${voice}'>` +
		`<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${esc}</prosody>` +
		`</voice></speak>`
	);
}

function synthesize(voice, text, rate, pitch) {
	return new Promise((resolve, reject) => {
		const connId = mkId();
		const ws = new WebSocket(`${WSS_BASE}&ConnectionId=${connId}`, { headers: WS_HEADERS });

		const chunks = [];
		let finished = false;

		const timeout = setTimeout(() => {
			if (!finished) {
				ws.terminate();
				reject(new Error('edge-tts synthesis timed out'));
			}
		}, 30_000);

		ws.on('open', () => {
			const configMsg =
				`X-Timestamp:${isoTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
				JSON.stringify({
					context: {
						synthesis: {
							audio: {
								metadataoptions: {
									sentenceBoundaryEnabled: 'false',
									wordBoundaryEnabled: 'false',
								},
								outputFormat: AUDIO_FORMAT,
							},
						},
					},
				});
			ws.send(configMsg);

			const requestId = mkId();
			const ssmlMsg =
				`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${isoTimestamp()}\r\nPath:ssml\r\n\r\n` +
				buildSsml(voice, text, rate, pitch);
			ws.send(ssmlMsg);
		});

		ws.on('message', (data, isBinary) => {
			if (!isBinary) {
				const msg = data.toString();
				if (msg.includes('Path:turn.end')) {
					finished = true;
					clearTimeout(timeout);
					ws.close();
					resolve(Buffer.concat(chunks));
				}
				return;
			}
			// Binary frame: first 2 bytes = big-endian header length, then header, then audio.
			const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
			const headerLen = buf.readUInt16BE(0);
			const header = buf.subarray(2, 2 + headerLen).toString();
			if (header.includes('Path:audio')) {
				chunks.push(buf.subarray(2 + headerLen));
			}
		});

		ws.on('error', (err) => {
			clearTimeout(timeout);
			reject(err);
		});

		ws.on('close', (code) => {
			clearTimeout(timeout);
			if (!finished) reject(new Error(`edge-tts WebSocket closed unexpectedly (${code})`));
		});
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');

	const userId = session?.id ?? bearer?.userId;
	const rl = await limits.ttsEdge(String(userId));
	if (!rl.success) {
		const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
		res.setHeader('retry-after', String(retryAfter));
		return error(res, 429, 'rate_limited', 'Too many TTS requests', { retry_after: retryAfter });
	}

	const body = await readJson(req);
	const voice = String(body.voice || 'en-US-AriaNeural').trim();
	const text = String(body.text || '').trim();
	const rate = String(body.rate || '+0%').trim();
	const pitch = String(body.pitch || '+0Hz').trim();

	if (!VOICE_RE.test(voice))
		return error(res, 400, 'validation_error', 'invalid voice name');
	if (!text) return error(res, 400, 'validation_error', 'text is required');
	if (text.length > 500)
		return error(res, 400, 'validation_error', 'text exceeds 500 chars per request');
	if (!RATE_RE.test(rate))
		return error(res, 400, 'validation_error', 'rate must be like +0% or -10%');
	if (!PITCH_RE.test(pitch))
		return error(res, 400, 'validation_error', 'pitch must be like +0Hz or -5Hz');

	// ── R2 cache lookup ───────────────────────────────────────────────────────
	const cacheHash = await sha256(`${voice}\x00${text}\x00${rate}\x00${pitch}`);
	const cacheKey = `tts/edge/${cacheHash}.mp3`;

	const cached = await headObject(cacheKey).catch(() => null);
	if (cached) {
		try {
			const buf = await getObjectBuffer(cacheKey);
			res.setHeader('content-type', 'audio/mpeg');
			res.setHeader('content-length', String(buf.length));
			res.setHeader('x-tts-cache', 'hit');
			res.setHeader('cache-control', 'private, max-age=86400');
			return res.end(buf);
		} catch {
			// Fall through to synthesize fresh on cache read failure.
		}
	}

	// ── Synthesize via Microsoft Edge TTS ────────────────────────────────────
	let audioBuffer;
	try {
		audioBuffer = await synthesize(voice, text, rate, pitch);
	} catch (synthErr) {
		console.error('[tts/edge] synthesis failed', synthErr);
		return error(res, 502, 'upstream_error', 'Edge TTS synthesis failed');
	}

	if (!audioBuffer.length) return error(res, 502, 'upstream_error', 'Edge TTS returned empty audio');

	putObject({
		key: cacheKey,
		body: audioBuffer,
		contentType: 'audio/mpeg',
		metadata: { 'created-at': new Date().toISOString() },
	}).catch((e) => console.warn('[tts/edge] R2 cache write failed:', e.message));

	res.setHeader('content-type', 'audio/mpeg');
	res.setHeader('content-length', String(audioBuffer.length));
	res.setHeader('x-tts-cache', 'miss');
	res.setHeader('cache-control', 'private, max-age=86400');
	return res.end(audioBuffer);
});
