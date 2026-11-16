// One spoken line for the browser digital human, with every stage overlapped.
//
// Before: /api/a2f synthesized the whole sentence (Magpie, blocking RPC), then
// streamed the finished clip through Audio2Face-3D, then returned one JSON body
// once the last frame existed. The browser could not make a sound until all
// three had finished (~2.3 s for a short line, measured 2026-11-16).
//
// Now: Magpie's streaming synthesis feeds two consumers at once. Each PCM chunk
// is (a) sent to the browser straight away so playback starts on the first
// chunk, and (b) resampled to 16 kHz and written into a live Audio2Face-3D
// session, whose blendshape frames are forwarded as they arrive. A2F failing
// never silences the avatar: the audio keeps flowing and the stream says
// `degraded`, so the browser drives the mouth from the audio amplitude instead.
//
// Events passed to `emit(type, data)`:
//   meta     { voiceName, sampleRateHz, encoding: 'pcm_s16le', a2fSampleRateHz }
//   audio    { seq, pcm: <base64 s16le mono at meta.sampleRateHz> }
//   header   { blendShapeNames, fps }
//   frames   { frames: [{ t, w }] }
//   degraded { stage: 'a2f', code, message }
//   done     { timings, functionId, healedFrom, audioBytes, frameCount, degraded }
// Throws (with .stage = 'tts') only when no audio could be produced at all.

import { synthesizeNvidiaTtsStream, STREAM_SAMPLE_RATE_HZ } from './tts-nvidia.js';
import { openA2fSession, StreamingResampler, A2F_SAMPLE_RATE_HZ } from './a2f-nvidia.js';

const A2F_FPS = 30;

/**
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} [opts.voice]
 * @param {string} [opts.language]
 * @param {boolean} [opts.animate=true]  false skips A2F (caller knows it is down)
 * @param {(type: string, data: object) => void} opts.emit
 * @param {AbortSignal} [opts.signal]     client went away: stop both upstreams
 * @param {number} [opts.ttsTimeoutMs]
 * @param {number} [opts.a2fTimeoutMs]
 * @param {object} [deps] { synthesize, openSession, now } for tests
 */
export async function streamSpeechAnimation(
	{
		text,
		voice,
		language,
		animate = true,
		emit,
		signal,
		ttsTimeoutMs = 20_000,
		a2fTimeoutMs = 30_000,
	},
	deps = {},
) {
	const synthesize = deps.synthesize || synthesizeNvidiaTtsStream;
	const openSession = deps.openSession || openA2fSession;
	const now = deps.now || Date.now;
	const t0 = now();
	const timings = {
		ttsFirstMs: null,
		ttsEndMs: null,
		a2fFirstMs: null,
		a2fEndMs: null,
		totalMs: null,
	};

	let session = null;
	let degraded = null;
	let frameCount = 0;
	const degrade = (code, message) => {
		if (degraded) return;
		degraded = {
			stage: 'a2f',
			code: code || 'provider_error',
			message: message || 'Audio2Face unavailable',
		};
		emit('degraded', degraded);
		try {
			session?.cancel();
		} catch {}
		session = null;
	};

	// Open A2F first: its channel setup overlaps Magpie's time to first audio.
	const sessionReady = animate
		? openSession({
				timeoutMs: a2fTimeoutMs,
				onHeader: (blendShapeNames) => emit('header', { blendShapeNames, fps: A2F_FPS }),
				onFrames: (frames) => {
					if (timings.a2fFirstMs === null) timings.a2fFirstMs = now() - t0;
					frameCount += frames.length;
					emit('frames', { frames });
				},
			}).then(
				(s) => {
					session = s;
					return s;
				},
				(e) => {
					degrade(e?.code, e?.message);
					return null;
				},
			)
		: Promise.resolve(null);
	if (!animate) degrade('skipped', 'Animation skipped for this line');

	const resampler = new StreamingResampler(STREAM_SAMPLE_RATE_HZ, A2F_SAMPLE_RATE_HZ);
	const pending16k = []; // audio produced before the A2F session finished opening
	let seq = 0;
	let audioBytes = 0;
	let voiceName = null;
	let metaSent = false;

	const onAbort = () => {
		try {
			session?.cancel();
		} catch {}
	};
	signal?.addEventListener('abort', onAbort, { once: true });

	try {
		const tts = await synthesize({
			text,
			voice,
			language,
			sampleRateHz: STREAM_SAMPLE_RATE_HZ,
			timeoutMs: ttsTimeoutMs,
			onChunk: (raw) => {
				if (signal?.aborted)
					throw Object.assign(new Error('client disconnected'), { code: 'cancelled' });
				if (timings.ttsFirstMs === null) timings.ttsFirstMs = now() - t0;
				if (!metaSent) {
					metaSent = true;
					emit('meta', {
						sampleRateHz: STREAM_SAMPLE_RATE_HZ,
						encoding: 'pcm_s16le',
						a2fSampleRateHz: A2F_SAMPLE_RATE_HZ,
					});
				}
				audioBytes += raw.length;
				emit('audio', { seq: seq++, pcm: raw.toString('base64') });
				if (degraded) return;
				const even = raw.length - (raw.length % 2);
				const samples = new Int16Array(
					raw.buffer.slice(raw.byteOffset, raw.byteOffset + even),
				);
				const down = resampler.push(samples);
				if (session) session.write(down);
				else pending16k.push(Int16Array.from(down));
			},
		});
		voiceName = tts.voiceName;
		timings.ttsEndMs = now() - t0;
	} catch (e) {
		onAbort();
		// The session may still be opening; cancel it when it lands.
		sessionReady.then((late) => late?.cancel());
		const err = e instanceof Error ? e : new Error(String(e));
		err.stage = 'tts';
		err.partial = audioBytes > 0;
		throw err;
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}

	let functionId = null;
	let healedFrom = null;
	const s = await sessionReady;
	if (s && !degraded) {
		for (const chunk of pending16k) s.write(chunk);
		s.end();
		try {
			const result = await s.done;
			functionId = result.functionId;
			healedFrom = result.healedFrom;
		} catch (e) {
			degrade(e?.code, e?.message);
		}
		timings.a2fEndMs = now() - t0;
	}
	timings.totalMs = now() - t0;

	const summary = {
		timings,
		voiceName,
		functionId,
		healedFrom,
		audioBytes,
		audioSeconds: audioBytes / 2 / STREAM_SAMPLE_RATE_HZ,
		frameCount,
		degraded: degraded ? degraded.code : null,
	};
	emit('done', summary);
	return summary;
}
