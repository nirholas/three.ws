// Speech I/O — TTS and STT. Browser-native by default; provider-swappable.

export class BrowserTTS {
	constructor({ voiceId = 'default', rate = 1, pitch = 1, lang = 'en-US' } = {}) {
		this.voiceId = voiceId;
		this.rate = rate;
		this.pitch = pitch;
		this.lang = lang;
		this._queue = [];
		this._speaking = false;
	}

	async speak(text, { onStart, onEnd } = {}) {
		if (!('speechSynthesis' in window)) return;
		return new Promise((resolve) => {
			const utter = new SpeechSynthesisUtterance(text);
			utter.rate = this.rate;
			utter.pitch = this.pitch;
			utter.lang = this.lang;
			const voice = this._pickVoice();
			if (voice) utter.voice = voice;
			utter.onstart = () => { this._speaking = true; onStart?.(); };
			utter.onend = () => { this._speaking = false; onEnd?.(); resolve(); };
			utter.onerror = () => { this._speaking = false; resolve(); };
			window.speechSynthesis.speak(utter);
		});
	}

	cancel() {
		if ('speechSynthesis' in window) window.speechSynthesis.cancel();
		this._speaking = false;
	}

	get speaking() { return this._speaking; }

	_pickVoice() {
		if (!('speechSynthesis' in window)) return null;
		const voices = window.speechSynthesis.getVoices();
		if (this.voiceId && this.voiceId !== 'default') {
			const found = voices.find((v) => v.name === this.voiceId || v.voiceURI === this.voiceId);
			if (found) return found;
		}
		return voices.find((v) => v.lang?.startsWith(this.lang.slice(0, 2))) || null;
	}
}

export class BrowserSTT {
	constructor({ language = 'en-US', continuous = false, interimResults = true } = {}) {
		this.language = language;
		this.continuous = continuous;
		this.interimResults = interimResults;
		this._recognition = null;
		this._listening = false;
	}

	_ensure() {
		if (this._recognition) return this._recognition;
		const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!SR) return null;
		const r = new SR();
		r.lang = this.language;
		r.continuous = this.continuous;
		r.interimResults = this.interimResults;
		this._recognition = r;
		return r;
	}

	async listen({ onInterim, onFinal } = {}) {
		const r = this._ensure();
		if (!r) throw new Error('SpeechRecognition unavailable in this browser');
		return new Promise((resolve, reject) => {
			let finalText = '';
			r.onresult = (ev) => {
				for (let i = ev.resultIndex; i < ev.results.length; i++) {
					const res = ev.results[i];
					const text = res[0].transcript;
					if (res.isFinal) {
						finalText += text;
						onFinal?.(text);
					} else {
						onInterim?.(text);
					}
				}
			};
			r.onerror = (e) => { this._listening = false; reject(e.error); };
			r.onend = () => { this._listening = false; resolve(finalText.trim()); };
			this._listening = true;
			try { r.start(); } catch (e) { this._listening = false; reject(e); }
		});
	}

	stop() {
		if (this._recognition && this._listening) this._recognition.stop();
	}

	get listening() { return this._listening; }
}

/**
 * ElevenLabs TTS — streaming MP3 playback via fetch + MediaSource.
 *
 * Wire format:
 *   POST {proxyURL || `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`}
 *   headers: { 'content-type': 'application/json',
 *              'accept': 'audio/mpeg',
 *              'xi-api-key': apiKey }   ← only when proxyURL is unset
 *   body:    { text, model_id, voice_settings: { stability, similarity_boost, style, use_speaker_boost } }
 *
 * Proxy contract (when proxyURL is set):
 *   The proxy receives the same JSON body and forwards it to ElevenLabs with a
 *   server-side key, then streams the audio response back unchanged. Clients
 *   never see the api key. The proxy may also accept `{ voiceId, modelId }` as
 *   top-level fields if it wants to encode the path itself.
 *
 * voice_settings mapping:
 *   `rate`  is mapped onto `style` (0..1) — ElevenLabs has no true playback-
 *           rate control on the Turbo models, but `style` shifts delivery
 *           pacing, so a higher rate translates to a more emphatic/faster
 *           feel. `rate` 0.5..1.5 → `style` 0..1, clamped.
 *   `pitch` has no analogue in ElevenLabs voice_settings, so it is dropped
 *           with a comment rather than silently misapplied. To get a higher
 *           voice, pick a different voiceId.
 *   `stability`, `similarity_boost`, `use_speaker_boost` use ElevenLabs'
 *   recommended defaults (0.5, 0.75, true) and can be overridden per instance.
 */
export class ElevenLabsTTS {
	constructor({
		voiceId,
		modelId            = 'eleven_turbo_v2_5',
		apiKey             = null,
		proxyURL           = null,
		rate               = 1,
		pitch              = 1,
		lang               = 'en-US',
		stability          = 0.5,
		similarityBoost    = 0.75,
		useSpeakerBoost    = true,
	} = {}) {
		if (!voiceId) throw new Error('ElevenLabsTTS requires voiceId');
		this.voiceId          = voiceId;
		this.modelId          = modelId;
		this.apiKey           = apiKey;
		this.proxyURL         = proxyURL;
		this.rate             = rate;
		this.pitch            = pitch;            // unused — see class comment
		this.lang             = lang;
		this.stability        = stability;
		this.similarityBoost  = similarityBoost;
		this.useSpeakerBoost  = useSpeakerBoost;

		this._speaking        = false;
		this._abort           = null;             // current AbortController
		this._audio           = null;             // current <audio> element
		this._mediaSourceURL  = null;             // for revocation
		this._onEnd           = null;             // pending resolve
	}

	async speak(text, { onStart, onEnd } = {}) {
		this.cancel();
		if (!text) return;

		this._abort = new AbortController();
		this._speaking = true;

		const url = this.proxyURL ||
			`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}/stream`;

		const headers = { 'content-type': 'application/json', accept: 'audio/mpeg' };
		// apiKey is only sent when there's no proxy. Proxies must keep keys server-side.
		if (!this.proxyURL && this.apiKey) headers['xi-api-key'] = this.apiKey;

		// Map rate (0.5..1.5) → style (0..1). Clamped to keep delivery natural.
		const rateNorm = Math.min(1.5, Math.max(0.5, this.rate));
		const styleVal = Math.min(1, Math.max(0, (rateNorm - 0.5) / 1.0));

		const body = JSON.stringify({
			text,
			model_id: this.modelId,
			voice_settings: {
				stability:         this.stability,
				similarity_boost:  this.similarityBoost,
				style:             styleVal,
				use_speaker_boost: this.useSpeakerBoost,
			},
			// Forwarded for proxies that prefer a single endpoint
			voiceId: this.voiceId,
			modelId: this.modelId,
		});

		let resp;
		try {
			resp = await fetch(url, {
				method: 'POST',
				headers,
				body,
				signal: this._abort.signal,
			});
		} catch (err) {
			this._speaking = false;
			if (err.name === 'AbortError') return;
			throw err;
		}

		if (!resp.ok) {
			this._speaking = false;
			throw new Error(`ElevenLabs TTS HTTP ${resp.status}`);
		}

		// Try MediaSource first (low-latency streaming). Fall back to buffered
		// playback for browsers that don't support MSE for audio/mpeg (Safari).
		const supportsMSE =
			typeof MediaSource !== 'undefined' &&
			MediaSource.isTypeSupported('audio/mpeg');

		const playStarted = (cb) => {
			if (this._startedFired) return;
			this._startedFired = true;
			cb?.();
		};
		this._startedFired = false;

		return new Promise((resolve) => {
			this._onEnd = () => {
				this._speaking = false;
				this._cleanupAudio();
				onEnd?.();
				this._onEnd = null;
				resolve();
			};

			const finishOnError = () => {
				if (this._onEnd) this._onEnd();
			};

			if (supportsMSE && resp.body) {
				this._playStreamingMSE(resp.body, () => playStarted(onStart), finishOnError);
			} else {
				this._playBuffered(resp, () => playStarted(onStart), finishOnError);
			}
		});
	}

	cancel() {
		if (this._abort) {
			try { this._abort.abort(); } catch {}
			this._abort = null;
		}
		this._cleanupAudio();
		this._speaking = false;
		// Resolve any pending speak() promise so callers don't hang
		if (this._onEnd) this._onEnd();
	}

	get speaking() { return this._speaking; }

	// ── Internal: streaming via MediaSource ────────────────────────────────

	_playStreamingMSE(stream, onStart, onError) {
		const ms = new MediaSource();
		this._mediaSourceURL = URL.createObjectURL(ms);
		const audio = new Audio(this._mediaSourceURL);
		this._audio = audio;
		audio.preload = 'auto';

		audio.addEventListener('playing', onStart, { once: true });
		audio.addEventListener('ended',   () => this._onEnd?.(), { once: true });
		audio.addEventListener('error',   () => onError?.(),     { once: true });

		ms.addEventListener('sourceopen', async () => {
			let sb;
			try {
				sb = ms.addSourceBuffer('audio/mpeg');
			} catch (err) {
				onError?.();
				return;
			}

			const reader = stream.getReader();
			const queue  = [];
			let   reading = true;

			const pump = () => {
				if (!reading || sb.updating) return;
				const next = queue.shift();
				if (!next) return;
				try {
					sb.appendBuffer(next);
				} catch {
					reading = false;
					try { ms.endOfStream(); } catch {}
				}
			};

			sb.addEventListener('updateend', pump);

			try {
				while (reading) {
					const { value, done } = await reader.read();
					if (done) {
						reading = false;
						const wait = () => {
							if (sb.updating || queue.length) {
								setTimeout(wait, 30);
							} else {
								try { ms.endOfStream(); } catch {}
							}
						};
						wait();
						break;
					}
					queue.push(value);
					pump();
				}
			} catch (err) {
				if (err.name !== 'AbortError') onError?.();
			}
		});

		audio.play().catch(onError);
	}

	// ── Internal: buffered playback fallback (Safari) ──────────────────────

	async _playBuffered(resp, onStart, onError) {
		try {
			const blob = await resp.blob();
			const url  = URL.createObjectURL(blob);
			this._mediaSourceURL = url;
			const audio = new Audio(url);
			this._audio = audio;
			audio.addEventListener('playing', onStart, { once: true });
			audio.addEventListener('ended',   () => this._onEnd?.(), { once: true });
			audio.addEventListener('error',   () => onError?.(), { once: true });
			await audio.play();
		} catch (err) {
			if (err.name !== 'AbortError') onError?.();
		}
	}

	_cleanupAudio() {
		if (this._audio) {
			try { this._audio.pause(); } catch {}
			this._audio.src = '';
			this._audio = null;
		}
		if (this._mediaSourceURL) {
			try { URL.revokeObjectURL(this._mediaSourceURL); } catch {}
			this._mediaSourceURL = null;
		}
		this._startedFired = false;
	}
}

export function createTTS(config = {}) {
	const provider = config.provider || 'browser';
	if (provider === 'none')       return null;
	if (provider === 'browser')    return new BrowserTTS(config);
	if (provider === 'elevenlabs') return new ElevenLabsTTS(config);
	throw new Error(`TTS provider "${provider}" not implemented yet`);
}

export function createSTT(config = {}) {
	const provider = config.provider || 'browser';
	if (provider === 'none') return null;
	if (provider === 'browser') return new BrowserSTT(config);
	throw new Error(`STT provider "${provider}" not implemented yet`);
}
