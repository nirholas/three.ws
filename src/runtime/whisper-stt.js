/**
 * WhisperSTT: the `whisper` speech-to-text provider of the agent manifest.
 *
 * Speech is recognized on the visitor's own device. No audio leaves the browser
 * on the primary path, nothing is billed, and unlike `BrowserSTT` it works in
 * every browser with WebAssembly, Firefox and Safari included, where
 * window.SpeechRecognition is missing or ships the audio to a vendor.
 *
 * Pipeline:
 *
 *   mic ─▶ silero VAD (src/voice/vad.js) ─▶ one utterance, 16 kHz Float32
 *        ─▶ on-device transformers.js ASR ─▶ text
 *        └▶ (on-device failed) POST /api/asr, the NVIDIA Riva lane ─▶ text
 *
 * Models (both MIT, ONNX q8, fetched once from the Hugging Face CDN and kept in
 * the browser Cache API, so the second visit loads from disk):
 *
 *   English      onnx-community/moonshine-base-ONNX  about 63 MB
 *   Other        onnx-community/whisper-base         about 77 MB, 99 languages
 *
 * Measured on the JFK reference clip (11 s, CPU, 4 threads): Moonshine 2.0 s and
 * Whisper 3.0 s per utterance, both transcribing it word-perfect.
 *
 * The model download starts the moment listening starts, so it overlaps the
 * user speaking instead of following it. Progress is reported through
 * `onStatus` so a caller can say what is happening on a first, slow load.
 *
 * Same contract as BrowserSTT: listen({ onInterim, onFinal }) resolves with the
 * final transcript, stop() ends listening and still transcribes whatever was
 * said. `continuous: true` keeps listening across utterances until stop(),
 * firing onFinal per utterance.
 */

import { log } from '../shared/log.js';
import { VoiceActivityDetector, VAD_ASSET_PATH, VAD_SAMPLE_RATE, float32ToWav } from '../voice/vad.js';

export const ON_DEVICE_MODELS = Object.freeze({
	english: 'onnx-community/moonshine-base-ONNX',
	multilingual: 'onnx-community/whisper-base',
});

/** Whisper reads a 30 s window; cut a little short so padding never truncates speech. */
export const MAX_UTTERANCE_SAMPLES = 28 * VAD_SAMPLE_RATE;

/**
 * Trailing silence that ends an utterance. The home voice loop runs at 352 ms
 * because hands-free turn-taking has to feel instant; push-to-talk does not, and
 * at 352 ms an ordinary mid-sentence pause ends the turn. The JFK reference clip
 * pauses 1.0 to 1.2 s after "my fellow Americans": 352 ms and 1200 ms both cut
 * there, 1500 ms keeps the sentence whole. Clicking the mic again ends the turn
 * at once and still transcribes it, so the longer window never traps anyone.
 */
export const END_OF_SPEECH_SILENCE_MS = 1500;

/** Give up on a single-shot listen when nobody speaks for this long. */
export const NO_SPEECH_TIMEOUT_MS = 12_000;

/** BCP-47 tag to its primary language subtag: 'pt-BR' to 'pt'. */
export function primaryLanguage(tag) {
	return String(tag || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
}

/**
 * Which on-device model serves a language, and the generate options it needs.
 * English gets Moonshine (smaller, faster, English-only); everything else gets
 * multilingual Whisper pinned to the requested language so it never guesses.
 */
export function onDeviceModelFor(language) {
	const lang = primaryLanguage(language);
	if (lang === 'en') return { model: ON_DEVICE_MODELS.english, options: {} };
	return { model: ON_DEVICE_MODELS.multilingual, options: { language: lang, task: 'transcribe' } };
}

/** Can this browser capture audio and run the on-device recognizer at all? */
export function onDeviceSupported() {
	if (typeof window === 'undefined' || typeof WebAssembly !== 'object') return false;
	if (!navigator?.mediaDevices?.getUserMedia) return false;
	return Boolean(window.AudioContext || window.webkitAudioContext);
}

/**
 * Run each engine in order and return the first transcript. An engine that
 * throws hands over to the next; the last error surfaces only when all fail.
 *
 * @param {Float32Array} audio 16 kHz mono
 * @param {{id: string, transcribe: (audio: Float32Array) => Promise<string>}[]} engines
 * @returns {Promise<{text: string, engine: string}>}
 */
export async function transcribeWithFallback(audio, engines) {
	let lastError = null;
	for (const engine of engines) {
		try {
			const text = await engine.transcribe(audio);
			return { text: String(text || '').trim(), engine: engine.id };
		} catch (err) {
			lastError = err;
			log.warn(`[whisper-stt] ${engine.id} recognizer failed, trying the next`, err?.message || err);
		}
	}
	throw lastError || new Error('No speech recognizer is available');
}

/** Join utterance frames into one buffer. */
export function concatFrames(frames) {
	let length = 0;
	for (const f of frames) length += f.length;
	const out = new Float32Array(length);
	let offset = 0;
	for (const f of frames) {
		out.set(f, offset);
		offset += f.length;
	}
	return out;
}

// One transformers.js import and one pipeline per model for the whole page, so
// two agents on the same page share a single download and a single session.
// Every caller still hears the download progress, not only the first.
let transformersModule = null;
const transcribers = new Map();

function loadTranscriber(model, onProgress) {
	let entry = transcribers.get(model);
	if (entry) {
		if (onProgress && !entry.settled) entry.listeners.add(onProgress);
		return entry.promise;
	}
	entry = { promise: null, listeners: new Set(onProgress ? [onProgress] : []), settled: false };
	const fanOut = (event) => {
		for (const listener of entry.listeners) listener(event);
	};
	entry.promise = (async () => {
		transformersModule ||= import('@huggingface/transformers');
		const { pipeline, env } = await transformersModule;
		// Models come from the Hugging Face CDN only. Without this the library first
		// probes /models/<id>/ on the current origin, which on a host page that
		// embeds an agent is someone else's server.
		env.allowLocalModels = false;
		return pipeline('automatic-speech-recognition', model, {
			dtype: 'q8',
			device: 'wasm',
			progress_callback: fanOut,
		});
	})();
	const settle = () => {
		entry.settled = true;
		entry.listeners.clear();
	};
	entry.promise.then(settle, () => {
		settle();
		transcribers.delete(model);
	});
	transcribers.set(model, entry);
	return entry.promise;
}

/** Download progress events summed across a model's files into one 0..1 figure. */
function progressTracker(report) {
	const files = new Map();
	return (event) => {
		if (event?.status !== 'progress' || !event.file) return;
		files.set(event.file, { loaded: event.loaded || 0, total: event.total || 0 });
		let loaded = 0;
		let total = 0;
		for (const f of files.values()) {
			loaded += f.loaded;
			total += f.total;
		}
		if (total > 0) report(Math.min(1, loaded / total));
	};
}

export class WhisperSTT {
	/**
	 * @param {object} [opts]
	 * @param {string} [opts.language]   BCP-47 tag, default en-US.
	 * @param {boolean} [opts.continuous] Keep listening across utterances until stop().
	 * @param {string} [opts.apiOrigin]  three.ws origin for the server fallback and
	 *        the VAD assets. Empty means same-origin; an embed passes its API origin.
	 * @param {number} [opts.endSilenceMs] Trailing silence that ends an utterance.
	 * @param {(status: SttStatus) => void} [opts.onStatus]
	 *
	 * @typedef {object} SttStatus
	 * @property {'idle'|'listening'|'transcribing'|'loading-model'} phase
	 *           'loading-model' means an utterance is waiting on the model download.
	 * @property {number} [progress]      0..1, with 'loading-model'.
	 * @property {number} [modelProgress] 0..1, while the model downloads in the
	 *           background of another phase.
	 */
	constructor({
		language = 'en-US',
		continuous = false,
		apiOrigin = '',
		endSilenceMs = END_OF_SPEECH_SILENCE_MS,
		onStatus = null,
	} = {}) {
		this.language = language;
		this.continuous = continuous;
		this.apiOrigin = String(apiOrigin || '').replace(/\/+$/, '');
		this.endSilenceMs = endSilenceMs;
		this.onStatus = onStatus;
		this._session = null;
		this._phase = 'idle';
		/** null until a download is seen, then 0..1; 1 once the model is ready. */
		this._modelProgress = null;
	}

	get listening() {
		return Boolean(this._session);
	}

	/** The recognizers tried for each utterance, best first. */
	engines() {
		const { model, options } = onDeviceModelFor(this.language);
		return [
			{
				id: 'on-device',
				transcribe: async (audio) => {
					const asr = await loadTranscriber(model, () => {});
					try {
						return (await asr(audio, options)).text;
					} catch (err) {
						// A language Whisper does not know throws before decoding; let it
						// detect the language itself rather than failing the utterance.
						if (!options.language) throw err;
						return (await asr(audio, { task: 'transcribe' })).text;
					}
				},
			},
			{
				id: 'server',
				transcribe: async (audio) => {
					const lang = encodeURIComponent(this.language);
					const res = await fetch(`${this.apiOrigin}/api/asr?language=${lang}`, {
						method: 'POST',
						headers: { 'content-type': 'audio/wav' },
						body: float32ToWav(audio, VAD_SAMPLE_RATE),
					});
					if (!res.ok) throw new Error(`/api/asr answered ${res.status}`);
					return (await res.json()).text;
				},
			},
		];
	}

	/** Start the model download without listening, e.g. ahead of a first turn. */
	warm(onStatus) {
		const { model } = onDeviceModelFor(this.language);
		const pending = loadTranscriber(
			model,
			progressTracker((progress) => {
				this._modelProgress = progress;
				this._report(onStatus);
			}),
		);
		pending.then(
			() => {
				const changed = this._modelProgress !== 1;
				this._modelProgress = 1;
				if (changed && this._phase !== 'idle') this._report(onStatus);
			},
			() => {
				this._modelProgress = null;
			},
		);
		return pending;
	}

	/**
	 * Report what the session is doing, folded together with the model download.
	 * An utterance waiting on the download reads as 'loading-model' (that is what
	 * the user is actually waiting for); otherwise the download rides along as
	 * `modelProgress` so "listening" is never hidden behind a progress figure.
	 */
	_report(onStatus, phase = this._phase) {
		this._phase = phase;
		const downloading = this._modelProgress != null && this._modelProgress < 1;
		let status;
		if (phase === 'transcribing' && downloading) status = { phase: 'loading-model', progress: this._modelProgress };
		else status = downloading ? { phase, modelProgress: this._modelProgress } : { phase };
		onStatus?.(status);
		this.onStatus?.(status);
	}

	// The on-device models decode whole utterances, so there is no partial text
	// and `onInterim` from the shared contract is never called.
	async listen({ onFinal, onStatus } = {}) {
		if (this._session) throw new Error('Already listening');
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
		});
		const Ctx = window.AudioContext || window.webkitAudioContext;
		const audioContext = new Ctx();

		// Overlap the model download with the user speaking. A failure here is not
		// fatal: the server rung still answers, so it is only logged.
		this.warm(onStatus).catch((err) => log.warn('[whisper-stt] on-device model unavailable', err?.message || err));

		return new Promise((resolve, reject) => {
			const session = {
				stream,
				audioContext,
				vad: null,
				frames: [],
				samples: 0,
				speaking: false,
				// Set once a long utterance has been cut at the model window: the VAD's
				// own end-of-speech audio would then repeat what was already sent.
				cut: false,
				texts: [],
				errors: [],
				work: Promise.resolve(),
				finished: false,
				noSpeechTimer: null,
			};
			this._session = session;

			const transcribe = (audio) => {
				if (!audio?.length) return;
				session.work = session.work.then(async () => {
					this._report(onStatus, 'transcribing');
					try {
						const { text } = await transcribeWithFallback(audio, this.engines());
						if (text) {
							session.texts.push(text);
							onFinal?.(text);
						}
					} catch (err) {
						session.errors.push(err);
					}
					if (this.continuous && !session.finished) this._report(onStatus, 'listening');
				});
			};

			const finish = async () => {
				if (session.finished) return;
				session.finished = true;
				clearTimeout(session.noSpeechTimer);
				if (session.speaking && session.frames.length) transcribe(concatFrames(session.frames));
				session.frames = [];
				await teardown(session);
				await session.work;
				if (this._session === session) this._session = null;
				this._report(onStatus, 'idle');
				const text = session.texts.join(' ').trim();
				if (!text && session.errors.length) reject(session.errors[session.errors.length - 1]);
				else resolve(text);
			};
			session.finish = finish;

			const resetUtterance = () => {
				session.speaking = false;
				session.cut = false;
				session.frames = [];
				session.samples = 0;
			};

			const endUtterance = (audio) => {
				resetUtterance();
				transcribe(audio);
				if (!this.continuous) finish();
				else this._report(onStatus, 'listening');
			};

			// Longer than the model's window: send what is buffered and keep listening
			// to the rest of the same utterance.
			const cutUtterance = () => {
				transcribe(concatFrames(session.frames));
				session.frames = [];
				session.samples = 0;
				session.cut = true;
				if (!this.continuous) finish();
			};

			session.vad = new VoiceActivityDetector({
				stream,
				audioContext,
				assetPath: `${this.apiOrigin}${VAD_ASSET_PATH}`,
				redemptionMs: this.endSilenceMs,
				onSpeechStart: () => {
					clearTimeout(session.noSpeechTimer);
					resetUtterance();
					session.speaking = true;
				},
				onFrame: (frame) => {
					if (!session.speaking || session.finished) return;
					session.frames.push(frame);
					session.samples += frame.length;
					if (session.samples >= MAX_UTTERANCE_SAMPLES) cutUtterance();
				},
				onSpeechEnd: (audio) => {
					if (session.finished || !session.speaking) return;
					endUtterance(session.cut ? concatFrames(session.frames) : audio);
				},
				onMisfire: () => resetUtterance(),
			});

			session.vad
				.start()
				.then(() => {
					this._report(onStatus, 'listening');
					if (!this.continuous) session.noSpeechTimer = setTimeout(finish, NO_SPEECH_TIMEOUT_MS);
				})
				.catch(async (err) => {
					session.finished = true;
					await teardown(session);
					if (this._session === session) this._session = null;
					this._report(onStatus, 'idle');
					reject(err);
				});
		});
	}

	stop() {
		this._session?.finish?.();
	}
}

async function teardown(session) {
	try {
		await session.vad?.destroy();
	} catch (err) {
		log.warn('[whisper-stt] VAD teardown failed', err?.message || err);
	}
	for (const track of session.stream.getTracks()) track.stop();
	if (session.audioContext.state !== 'closed') await session.audioContext.close().catch(() => {});
}
