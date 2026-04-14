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

export function createTTS(config = {}) {
	const provider = config.provider || 'browser';
	if (provider === 'none') return null;
	if (provider === 'browser') return new BrowserTTS(config);
	throw new Error(`TTS provider "${provider}" not implemented yet`);
}

export function createSTT(config = {}) {
	const provider = config.provider || 'browser';
	if (provider === 'none') return null;
	if (provider === 'browser') return new BrowserSTT(config);
	throw new Error(`STT provider "${provider}" not implemented yet`);
}
