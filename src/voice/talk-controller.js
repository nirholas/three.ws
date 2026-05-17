/**
 * TalkController — orchestrates the live voice loop on /avatars/:id.
 *
 *   user mic ─▶ Web Speech API STT ─▶ /api/chat (SSE)
 *                                          │
 *                                          ▼
 *                          /api/tts/eleven (cloned voice)
 *                          /api/tts/edge   (fallback)
 *                                          │
 *                                          ▼
 *                                 audio element + analyser
 *                                          │
 *                                          ▼
 *                           LipsyncDriver ▶ AvatarMouthTarget
 *
 * Every piece is real:
 *   - Web Speech API mic capture (browser-native, no key)
 *   - /api/chat streams from Anthropic / OpenRouter / etc (existing)
 *   - /api/tts/eleven is the existing R2-cached ElevenLabs proxy
 *   - /api/tts/edge is the existing Microsoft Edge Neural TTS fallback
 *   - Voice ID is read from /api/agents/:agent_id/voice when the avatar is
 *     bound to an agent with a cloned voice; otherwise we use the Edge path
 *
 * The controller takes ownership of an AvatarMouthTarget — it doesn't own the
 * scene that drives the visuals. Tear down by calling stop().
 */

import { LipsyncDriver, tapAudioElement } from './lipsync-driver.js';

const EDGE_VOICES_BY_GENDER = {
	female: 'en-US-AriaNeural',
	male: 'en-US-GuyNeural',
	neutral: 'en-US-AriaNeural',
};

const ELEVEN_DEFAULT_VOICE = 'EXAVITQu4vr4xnSDxMaL'; // Bella — ElevenLabs default voice

export class TalkController {
	/**
	 * @param {object} opts
	 * @param {object} opts.avatar       Avatar record (must include id; optionally agent_id, source_meta)
	 * @param {() => string} [opts.systemPromptFn]  Optional system prompt builder
	 * @param {(msg: { role: 'user'|'assistant', content: string }) => void} [opts.onMessage]
	 *        Hook so the host UI can append a transcript line.
	 * @param {(state: 'idle'|'listening'|'thinking'|'speaking') => void} [opts.onStateChange]
	 * @param {(err: Error) => void} [opts.onError]
	 * @param {{ attach: Function, setMouthShape: Function }} opts.mouthTarget
	 */
	constructor({ avatar, systemPromptFn, onMessage, onStateChange, onError, mouthTarget }) {
		if (!avatar?.id) throw new Error('TalkController: avatar.id required');
		if (!mouthTarget) throw new Error('TalkController: mouthTarget required');
		this.avatar = avatar;
		this.systemPromptFn = systemPromptFn || (() => '');
		this.onMessage = onMessage || (() => {});
		this.onStateChange = onStateChange || (() => {});
		this.onError = onError || ((e) => console.warn('[talk]', e?.message));
		this.mouthTarget = mouthTarget;

		this._state = 'idle';
		this._history = [];
		this._recognizer = null;
		this._audioCtx = null;
		this._currentAudioEl = null;
		this._currentTap = null;
		this._driver = null;
		this._voicePromise = null; // resolves to { provider, voiceId } | null
	}

	get state() {
		return this._state;
	}

	/**
	 * Begin a single push-to-talk turn. Returns immediately; the recognized
	 * speech triggers the chat call on the recognizer's `end` event. Call
	 * stopListening() to terminate before a final result lands.
	 */
	startListening() {
		if (this._state !== 'idle') return false;

		const RecCls = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!RecCls) {
			this.onError(
				new Error('Your browser does not support speech input. Try Chrome, Edge, or Safari.'),
			);
			return false;
		}

		const rec = new RecCls();
		rec.lang = 'en-US';
		rec.continuous = false;
		rec.interimResults = false;
		rec.maxAlternatives = 1;
		this._recognizer = rec;

		let finalText = '';
		rec.onresult = (e) => {
			const last = e.results[e.results.length - 1];
			if (last.isFinal) finalText = last[0].transcript;
		};
		rec.onerror = (e) => {
			this.onError(new Error(`Speech recognition error: ${e.error || 'unknown'}`));
		};
		rec.onend = () => {
			this._recognizer = null;
			const transcript = finalText.trim();
			if (!transcript) {
				this._setState('idle');
				return;
			}
			this._handleTranscript(transcript).catch((err) => this.onError(err));
		};

		try {
			rec.start();
			this._setState('listening');
			return true;
		} catch (err) {
			this.onError(new Error(`Could not start mic: ${err.message}`));
			this._setState('idle');
			return false;
		}
	}

	/** Stop an in-flight recognition. The current state transitions to idle. */
	stopListening() {
		if (this._recognizer) {
			try {
				this._recognizer.stop();
			} catch {}
		}
	}

	/**
	 * Force a turn from text (e.g. typed message). Same downstream path as
	 * speech input — chat → TTS → lipsync.
	 */
	async say(text) {
		const trimmed = String(text || '').trim();
		if (!trimmed) return;
		await this._handleTranscript(trimmed);
	}

	/** Stop everything immediately and detach. Idempotent. */
	stop() {
		this.stopListening();
		this._stopPlayback();
		this._driver?.dispose();
		this._driver = null;
		this._setState('idle');
	}

	// ── pipeline ─────────────────────────────────────────────────────────

	async _handleTranscript(transcript) {
		this.onMessage({ role: 'user', content: transcript });
		this._history.push({ role: 'user', content: transcript });
		this._setState('thinking');

		let replyText = '';
		try {
			replyText = await this._streamChat(transcript);
		} catch (err) {
			this.onError(err);
			this._setState('idle');
			return;
		}

		if (!replyText) {
			this._setState('idle');
			return;
		}

		this._history.push({ role: 'assistant', content: replyText });
		this.onMessage({ role: 'assistant', content: replyText });

		try {
			await this._speak(replyText);
		} catch (err) {
			this.onError(err);
		}
	}

	async _streamChat(message) {
		const isUuid =
			typeof this.avatar.id === 'string' &&
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.avatar.id);

		const r = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				message,
				system_prompt: this.systemPromptFn(),
				history: this._history.slice(-10, -1),
				...(isUuid ? { agentId: this.avatar.id } : {}),
				...(this.avatar.agent_id ? { agentId: this.avatar.agent_id } : {}),
			}),
		});
		if (!r.ok) {
			const j = await r.json().catch(() => ({}));
			throw new Error(j.error_description || j.error || `Chat failed (${r.status})`);
		}
		const reader = r.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		let acc = '';
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			const blocks = buf.split('\n\n');
			buf = blocks.pop() || '';
			for (const block of blocks) {
				const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
				if (!dataLine) continue;
				const payload = dataLine.slice(5).trim();
				if (!payload) continue;
				let evt;
				try {
					evt = JSON.parse(payload);
				} catch {
					continue;
				}
				if (evt.type === 'chunk' && evt.text) acc += evt.text;
				else if (evt.type === 'error') throw new Error(evt.message || evt.error || 'Stream error');
			}
		}
		return acc.trim();
	}

	async _resolveVoice() {
		if (this._voicePromise) return this._voicePromise;
		const agentId = this.avatar.agent_id;
		if (!agentId) {
			this._voicePromise = Promise.resolve(null);
			return this._voicePromise;
		}
		this._voicePromise = (async () => {
			try {
				const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}/voice`, {
					credentials: 'include',
				});
				if (!r.ok) return null;
				const j = await r.json();
				if (j.voice_provider === 'elevenlabs' && j.voice_id) {
					return { provider: 'elevenlabs', voiceId: j.voice_id };
				}
				return null;
			} catch {
				return null;
			}
		})();
		return this._voicePromise;
	}

	async _speak(text) {
		// Stop any in-flight playback first so consecutive turns don't overlap.
		this._stopPlayback();

		const voice = await this._resolveVoice();
		const blob = voice
			? await this._fetchTtsEleven(text, voice.voiceId)
			: await this._fetchTtsEdge(text);

		const url = URL.createObjectURL(blob);
		const audio = new Audio();
		audio.crossOrigin = 'anonymous';
		audio.src = url;
		this._currentAudioEl = audio;

		// Build the audio graph so the analyser can read what's about to play.
		// MediaElementSource can only be created once per element — we tear it
		// down on `ended` to free the slot for the next turn.
		if (!this._audioCtx) {
			this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		}
		if (this._audioCtx.state === 'suspended') {
			await this._audioCtx.resume().catch(() => {});
		}
		this._currentTap = tapAudioElement(audio, this._audioCtx);

		// Drive the lipsync.
		this._driver?.dispose();
		this._driver = new LipsyncDriver({
			analyser: this._currentTap.analyser,
			target: this.mouthTarget,
		});

		this._setState('speaking');

		const cleanup = () => {
			URL.revokeObjectURL(url);
			this._driver?.stop();
			this._currentTap?.disconnect();
			this._currentTap = null;
			this._currentAudioEl = null;
			this._setState('idle');
		};
		audio.onended = cleanup;
		audio.onerror = () => {
			cleanup();
			this.onError(new Error('Audio playback failed'));
		};

		this._driver.start();
		try {
			await audio.play();
		} catch (err) {
			cleanup();
			throw err;
		}
	}

	_stopPlayback() {
		if (this._currentAudioEl) {
			try {
				this._currentAudioEl.pause();
			} catch {}
			this._currentAudioEl = null;
		}
		if (this._currentTap) {
			this._currentTap.disconnect();
			this._currentTap = null;
		}
		this._driver?.stop();
	}

	async _fetchTtsEleven(text, voiceId) {
		const r = await fetch('/api/tts/eleven', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				voiceId: voiceId || ELEVEN_DEFAULT_VOICE,
				text: text.slice(0, 500),
			}),
		});
		if (!r.ok) {
			// Fall back to Edge so the talk loop still completes if ElevenLabs
			// is rate-limited or down.
			console.warn('[talk] eleven TTS failed, falling back to edge');
			return this._fetchTtsEdge(text);
		}
		return r.blob();
	}

	async _fetchTtsEdge(text) {
		const gender =
			this.avatar?.source_meta?.gender ||
			this.avatar?.source_meta?.bodyType ||
			'neutral';
		const voice = EDGE_VOICES_BY_GENDER[gender] || EDGE_VOICES_BY_GENDER.neutral;
		const r = await fetch('/api/tts/edge', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ voice, text: text.slice(0, 1500) }),
		});
		if (!r.ok) throw new Error(`TTS failed (${r.status})`);
		return r.blob();
	}

	_setState(state) {
		if (this._state === state) return;
		this._state = state;
		this.onStateChange(state);
	}
}
