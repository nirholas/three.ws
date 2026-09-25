// Audio plumbing for the chat gateways: every platform delivers voice notes in
// its own container (Telegram, WhatsApp and Discord send Ogg/Opus, Signal and
// iOS clients send AAC in MP4, Slack clips arrive as WebM or MP4), and every
// platform that plays a voice note wants Ogg/Opus back. The speech lanes speak
// WAV and listen to Ogg/Opus, FLAC or 16-bit PCM, so this module converts at
// the edges with ffmpeg and nothing else in the gateway touches a codec.
//
// The ffmpeg binary comes from FFMPEG_PATH (the gateway image installs the
// distro build there), then the ffmpeg-static package, then the PATH.

import { spawn } from 'node:child_process';

let resolvedPath = null;

export async function ffmpegPath() {
	if (resolvedPath) return resolvedPath;
	if (process.env.FFMPEG_PATH) return (resolvedPath = process.env.FFMPEG_PATH);
	try {
		const mod = await import('ffmpeg-static');
		if (mod?.default) return (resolvedPath = mod.default);
	} catch {
		// Not installed in this image: fall through to the PATH.
	}
	return (resolvedPath = 'ffmpeg');
}

export class AudioError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

/**
 * Pipe `input` through ffmpeg with `args` (input is always stdin, output is
 * always stdout) and resolve with the output bytes.
 * @param {Buffer} input
 * @param {string[]} args  arguments between `-i pipe:0` and `pipe:1`
 * @param {{ timeoutMs?:number, maxBytes?:number }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function runFfmpeg(input, args, { timeoutMs = 30_000, maxBytes = 32 * 1024 * 1024 } = {}) {
	const bin = await ffmpegPath();
	return new Promise((resolve, reject) => {
		const proc = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...args, 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
		const out = [];
		let size = 0;
		let stderr = '';
		const timer = setTimeout(() => {
			proc.kill('SIGKILL');
			reject(new AudioError('transcode_timeout', 'audio conversion took too long'));
		}, timeoutMs);
		proc.on('error', (e) => {
			clearTimeout(timer);
			reject(new AudioError('transcoder_unavailable', `ffmpeg could not start: ${e.message}`));
		});
		proc.stdout.on('data', (chunk) => {
			size += chunk.length;
			if (size > maxBytes) {
				proc.kill('SIGKILL');
				return;
			}
			out.push(chunk);
		});
		proc.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-600); });
		proc.on('close', (code) => {
			clearTimeout(timer);
			if (size > maxBytes) return reject(new AudioError('audio_too_large', 'converted audio exceeded the size limit'));
			if (code !== 0) return reject(new AudioError('transcode_failed', `ffmpeg exited ${code}: ${stderr.trim()}`));
			resolve(Buffer.concat(out));
		});
		// A client that closes stdin early (bad container) must not crash the worker.
		proc.stdin.on('error', () => {});
		proc.stdin.end(input);
	});
}

/** The speech-lane encoding a container can be sent as without conversion, or null. */
export function nativeAsrEncoding(mimeType) {
	const m = String(mimeType || '').toLowerCase();
	if (/ogg|opus/.test(m)) return 'OGGOPUS';
	if (/flac/.test(m)) return 'FLAC';
	return null;
}

/**
 * Turn any voice note into something the speech lane accepts: Ogg/Opus and
 * FLAC pass through, everything else becomes 16 kHz mono 16-bit PCM.
 * @returns {Promise<{ audio:Buffer, encoding:string, sampleRateHz:number }>}
 */
export async function toSpeechInput({ buffer, mimeType }) {
	const native = nativeAsrEncoding(mimeType);
	if (native === 'OGGOPUS') return { audio: buffer, encoding: 'OGGOPUS', sampleRateHz: 48000 };
	if (native === 'FLAC') return { audio: buffer, encoding: 'FLAC', sampleRateHz: 16000 };
	const pcm = await runFfmpeg(buffer, ['-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-acodec', 'pcm_s16le']);
	if (!pcm.length) throw new AudioError('no_audio', 'that voice note carried no audio');
	return { audio: pcm, encoding: 'LINEAR_PCM', sampleRateHz: 16000 };
}

/** Duration in seconds of a canonical RIFF/WAVE buffer, or null when it is not one. */
export function wavDurationSeconds(wav) {
	if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return null;
	let offset = 12;
	let byteRate = null;
	while (offset + 8 <= wav.length) {
		const id = wav.toString('ascii', offset, offset + 4);
		const size = wav.readUInt32LE(offset + 4);
		if (id === 'fmt ') byteRate = wav.readUInt32LE(offset + 16);
		if (id === 'data') {
			if (!byteRate) return null;
			const dataBytes = Math.min(size, wav.length - offset - 8);
			return dataBytes / byteRate;
		}
		offset += 8 + size + (size % 2);
	}
	return null;
}

/**
 * Encode speech for a chat voice note: Ogg/Opus, mono, 48 kHz, voice-tuned.
 * @param {Buffer} wav
 * @returns {Promise<{ buffer:Buffer, mimeType:string, durationSec:number|null }>}
 */
export async function wavToVoiceNote(wav) {
	const buffer = await runFfmpeg(wav, ['-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg']);
	if (!buffer.length) throw new AudioError('transcode_failed', 'speech conversion produced no audio');
	return { buffer, mimeType: 'audio/ogg', durationSec: wavDurationSeconds(wav) };
}
