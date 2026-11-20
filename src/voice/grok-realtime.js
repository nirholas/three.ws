// Grok Voice realtime speech-to-speech client.
//
// The browser asks our broker (/api/voice/grok/session) for a short-lived xAI
// client secret, opens the realtime WebSocket with it as the
// `xai-client-secret.<secret>` subprotocol, streams the microphone up as 16 kHz
// PCM16 and plays the 24 kHz PCM16 reply through StreamSpeechPlayer, whose
// output-latency-delayed analyser drives the avatar's mouth. The server key
// never reaches this file: only the ephemeral secret does.
//
// Construct it with { agentId, mouth } (plus mode 'ptt' for push-to-talk) and
// call connect(). It dispatches four events: `state` (detail.state is one of
// connecting, listening, thinking, speaking, reconnecting, closed, error),
// `transcript` ({ role, text, final, itemId }), `latency` ({ kind: 'response'
// or 'mouth', ms }) and `error` ({ code, message, status }). In push-to-talk
// mode pressTalk() and releaseTalk() bracket each utterance; close() ends it.
//
// Turn detection: open mic uses server VAD (the server decides when the user
// stopped and interrupts its own reply on barge-in); push-to-talk disables VAD
// and commits the buffer on release. Either way, when the user talks over a
// reply the local playback is cut, the late audio of that reply is dropped,
// and the server is told exactly how much was heard (conversation.item.truncate)
// so the model's memory of the turn matches what the listener got.
//
// Reconnect: an unexpected close reopens the socket, reusing the secret while
// it is still valid and minting a new one after, and resumes the conversation
// with ?conversation_id= (session resumption is opted into on every connect).

import { MicCapture, PcmDownsampler } from './mic-capture.js';
import { StreamSpeechPlayer } from './stream-speech-player.js';

const INPUT_CHUNK_SAMPLES = 1600; // 100 ms at 16 kHz, the documented flush size
const SECRET_SAFETY_MS = 5_000;
const MAX_RECONNECTS = 3;
const STABLE_CONNECTION_MS = 15_000;
const MOUTH_OPEN_THRESHOLD = 0.05;
const STATES = new Set(['idle', 'connecting', 'listening', 'thinking', 'speaking', 'reconnecting', 'closed', 'error']);

export class GrokVoiceClientError extends Error {
	constructor(code, message, status) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

/** Int16 PCM to base64 without building one giant string (stack-safe on long chunks). */
export function pcm16ToBase64(int16) {
	const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

function base64ByteLength(b64) {
	if (!b64) return 0;
	const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
	return (b64.length * 3) / 4 - pad;
}

export class GrokRealtime extends EventTarget {
	/**
	 * @param {object} [o]
	 * @param {string} [o.sessionUrl]       broker endpoint (absolute for embeds on other origins)
	 * @param {string} [o.agentId]          agent whose persona and Grok voice to use
	 * @param {string} [o.voice]            explicit Grok voice id
	 * @param {'open'|'ptt'} [o.mode]       open mic (server VAD) or push-to-talk
	 * @param {{ setMouthShape(s:object):void }} [o.mouth]  amplitude mouth target; omit when the
	 *        caller drives its own lipsync from `analyser`
	 * @param {AudioContext} [o.ctx]        playback context; created (and owned) when omitted
	 * @param {RequestCredentials} [o.credentials]
	 */
	constructor({
		sessionUrl = '/api/voice/grok/session',
		agentId = null,
		voice = null,
		mode = 'open',
		mouth = null,
		ctx = null,
		credentials = 'include',
		fetchImpl = null,
		WebSocketImpl = null,
		MicImpl = MicCapture,
		now = () => performance.now(),
	} = {}) {
		super();
		this.sessionUrl = sessionUrl;
		this.agentId = agentId;
		this.voice = voice;
		this.mode = mode === 'ptt' ? 'ptt' : 'open';
		this.mouth = mouth;
		this.credentials = credentials;
		this._fetch = fetchImpl || ((...a) => fetch(...a));
		this._WS = WebSocketImpl || globalThis.WebSocket;
		this._Mic = MicImpl;
		this._clock = now;
		this._ctx = ctx;
		this._ownsCtx = !ctx;
		this.state = 'idle';
		this.session = null; // broker reply: { client_secret, expires_at, ws_url, model, session }
		this.conversationId = null;
		this.player = null;
		this._ws = null;
		this._mic = null;
		this._down = null;
		this._pending = [];
		this._pendingLen = 0;
		this._talking = false;
		this._closed = false;
		this._reconnects = 0;
		this._openedAt = 0;
		this._userPartial = new Map();
		this._resetTurnMarks();
		this._item = null; // assistant item being played: { id, samples, firstStart }
		this._dropItems = new Set();
		this._mouthRaf = 0;
	}

	/** The analyser the reply audio flows through, delayed to what the listener hears. */
	get analyser() {
		return this.player?.analyser || null;
	}

	/** Mint a session, open the socket, start the microphone. Rejects with GrokVoiceClientError. */
	async connect() {
		if (this._closed) throw new GrokVoiceClientError('closed', 'This voice session was closed. Start a new one.');
		this._setState('connecting');
		try {
			this.session = await this._mint();
			this._ensurePlayer();
			await this._openSocket();
			await this._startMic();
		} catch (err) {
			const e = err instanceof GrokVoiceClientError ? err : new GrokVoiceClientError(err?.code || 'connect_failed', err?.message || String(err));
			this._fail(e);
			throw e;
		}
		this._setState(this.mode === 'ptt' ? 'idle' : 'listening');
	}

	/** Push-to-talk: start sending the microphone. Talking over a reply interrupts it. */
	pressTalk() {
		if (this.mode !== 'ptt' || this._closed || this._talking) return;
		if (this._item && this.player?.speaking) {
			this._send({ type: 'response.cancel' });
			this._bargeIn();
		}
		this._send({ type: 'input_audio_buffer.clear' });
		this._down?.reset();
		this._pending = [];
		this._pendingLen = 0;
		this._talking = true;
		this._setState('listening');
	}

	/** Push-to-talk: stop sending, commit what was said and ask for the reply. */
	releaseTalk() {
		if (this.mode !== 'ptt' || !this._talking) return;
		this._talking = false;
		this._flushInput(true);
		this._resetTurnMarks();
		this._turnMarks.speechEnd = this._clock();
		this._send({ type: 'input_audio_buffer.commit' });
		this._send({ type: 'response.create' });
		this._setState('thinking');
	}

	/** Switch between open mic and push-to-talk on a live session. */
	setMode(mode) {
		const next = mode === 'ptt' ? 'ptt' : 'open';
		if (next === this.mode) return;
		this.mode = next;
		this._talking = false;
		this._send({ type: 'session.update', session: this._sessionPayload() });
		if (this._ws) this._setState(next === 'ptt' ? 'idle' : 'listening');
	}

	/** Stop everything: socket (code 1000), microphone, playback, owned audio context. */
	close() {
		if (this._closed) return;
		this._closed = true;
		cancelAnimationFrame(this._mouthRaf);
		clearTimeout(this._reconnectTimer);
		const ws = this._ws;
		this._ws = null;
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try {
				ws.close(1000, 'client closed');
			} catch {}
		}
		this._mic?.dispose();
		this._mic = null;
		this.player?.dispose();
		this.player = null;
		if (this._ownsCtx && this._ctx && this._ctx.state !== 'closed') this._ctx.close().catch(() => {});
		this._ctx = null;
		this._setState('closed');
	}

	// ── session ───────────────────────────────────────────────────────────

	async _mint() {
		const body = {};
		if (this.agentId) body.agent_id = this.agentId;
		if (this.voice) body.voice = this.voice;
		let res;
		try {
			res = await this._fetch(this.sessionUrl, {
				method: 'POST',
				credentials: this.credentials,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
		} catch (err) {
			throw new GrokVoiceClientError('network', `Could not reach the voice session service: ${err?.message || err}`);
		}
		let data = null;
		try {
			data = await res.json();
		} catch {
			data = null;
		}
		if (!res.ok) {
			throw new GrokVoiceClientError(
				data?.error || `http_${res.status}`,
				data?.error_description || data?.message || `Voice session request failed (${res.status}).`,
				res.status,
			);
		}
		if (!data?.client_secret || !data?.ws_url) {
			throw new GrokVoiceClientError('bad_session', 'The voice session service answered without a session.');
		}
		return data;
	}

	_secretValid() {
		return Boolean(this.session) && this.session.expires_at * 1000 - SECRET_SAFETY_MS > Date.now();
	}

	_sessionPayload() {
		const base = this.session?.session || {};
		return {
			...base,
			turn_detection: this.mode === 'ptt' ? { type: null } : base.turn_detection || { type: 'server_vad' },
			resumption: { enabled: true },
		};
	}

	_socketUrl() {
		const url = this.session.ws_url;
		if (!this.conversationId) return url;
		return `${url}${url.includes('?') ? '&' : '?'}conversation_id=${encodeURIComponent(this.conversationId)}`;
	}

	_openSocket() {
		return new Promise((resolve, reject) => {
			let settled = false;
			const ws = new this._WS(this._socketUrl(), [`xai-client-secret.${this.session.client_secret}`]);
			this._ws = ws;
			ws.onopen = () => {
				this._send({ type: 'session.update', session: this._sessionPayload() });
				settled = true;
				this._openedAt = Date.now();
				resolve();
			};
			ws.onmessage = (ev) => this._onMessage(ev.data);
			ws.onerror = () => {
				if (!settled) {
					settled = true;
					reject(new GrokVoiceClientError('socket_failed', 'The Grok voice connection could not be opened.'));
				}
			};
			ws.onclose = (ev) => {
				if (this._ws === ws) this._ws = null;
				if (!settled) {
					settled = true;
					reject(new GrokVoiceClientError('socket_closed', `The Grok voice connection closed during setup (${ev?.code ?? 'no code'}).`));
					return;
				}
				this._onUnexpectedClose(ev);
			};
		});
	}

	_onUnexpectedClose(ev) {
		if (this._closed) return;
		// Only a connection that stayed up counts as recovered; one that opens
		// and drops straight away keeps spending the retry budget.
		if (this._openedAt && Date.now() - this._openedAt > STABLE_CONNECTION_MS) this._reconnects = 0;
		this._openedAt = 0;
		if (this._reconnects >= MAX_RECONNECTS) {
			this._fail(new GrokVoiceClientError('connection_lost', `The Grok voice connection dropped (${ev?.code ?? 'no code'}) and could not be restored.`));
			return;
		}
		this._reconnects++;
		this._setState('reconnecting');
		this.player?.reset();
		this._item = null;
		const delay = 400 * 2 ** (this._reconnects - 1);
		this._reconnectTimer = setTimeout(() => this._reconnect(), delay);
	}

	async _reconnect() {
		if (this._closed) return;
		try {
			if (!this._secretValid()) this.session = await this._mint();
			await this._openSocket();
			this._setState(this.mode === 'ptt' && !this._talking ? 'idle' : 'listening');
		} catch (err) {
			this._onUnexpectedClose({ code: err?.code || 'reconnect_failed' });
		}
	}

	_send(msg) {
		const ws = this._ws;
		if (!ws || ws.readyState !== 1) return false;
		ws.send(JSON.stringify(msg));
		return true;
	}

	// ── microphone ────────────────────────────────────────────────────────

	async _startMic() {
		this._mic = new this._Mic({ retain: false, onFrame: (f) => this._onMicFrame(f) });
		try {
			await this._mic.start();
		} catch (err) {
			throw new GrokVoiceClientError(err?.code || 'capture-failed', err?.message || 'Could not start the microphone.');
		}
		this._down = new PcmDownsampler(this._mic.sampleRate);
	}

	_onMicFrame(frame) {
		if (!this._down || !this._ws) return;
		if (this.mode === 'ptt' && !this._talking) return;
		const pcm = this._down.push(frame);
		if (!pcm.length) return;
		this._pending.push(pcm);
		this._pendingLen += pcm.length;
		if (this._pendingLen >= INPUT_CHUNK_SAMPLES) this._flushInput(false);
	}

	_flushInput(force) {
		if (!this._pendingLen || (!force && this._pendingLen < INPUT_CHUNK_SAMPLES)) return;
		const out = new Int16Array(this._pendingLen);
		let o = 0;
		for (const p of this._pending) {
			out.set(p, o);
			o += p.length;
		}
		this._pending = [];
		this._pendingLen = 0;
		this._send({ type: 'input_audio_buffer.append', audio: pcm16ToBase64(out) });
	}

	/** Microphone input level 0..1 for a meter. */
	getInputLevel() {
		return this._mic?.getLevel?.() || 0;
	}

	// ── playback ──────────────────────────────────────────────────────────

	_ensurePlayer() {
		if (this.player) return;
		if (!this._ctx) {
			const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
			this._ctx = new AC();
		}
		if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
		this.player = new StreamSpeechPlayer({
			ctx: this._ctx,
			a2f: null,
			mouth: this.mouth,
			onState: ({ speaking }) => {
				if (!speaking && this.state === 'speaking') this._setState(this.mode === 'ptt' && !this._talking ? 'idle' : 'listening');
			},
		});
		this.player.line(0, 'meta', { sampleRateHz: this.session?.session?.audio?.output?.format?.rate || 24_000 });
	}

	_onAudioDelta(msg) {
		const itemId = msg.item_id || null;
		if (itemId && this._dropItems.has(itemId)) return;
		if (!this.player || !msg.delta) return;
		if (!this._item || (itemId && this._item.id !== itemId)) {
			this._item = { id: itemId, samples: 0, firstStart: null };
		}
		const first = this._turnMarks.firstAudio === null;
		if (first) this._turnMarks.firstAudio = this._clock();
		this.player.line(0, 'audio', { pcm: msg.delta });
		if (this._item.firstStart === null) this._item.firstStart = this.player.lastChunkStart;
		this._item.samples += base64ByteLength(msg.delta) / 2;
		if (first) {
			this._turnMarks.firstAudioCtx = this.player.lastChunkStart;
			if (this._turnMarks.speechEnd !== null) {
				this._emit('latency', {
					kind: 'response',
					ms: Math.round(this._turnMarks.firstAudio - this._turnMarks.speechEnd),
				});
			}
			this._watchMouth();
		}
		if (this.state !== 'speaking') this._setState('speaking');
	}

	// First audio frame to first viseme: poll the delayed analyser's shape every
	// animation frame until the mouth actually opens. `av_offset_ms` is how far
	// the mouth trails the moment the listener hears the first sample (scheduled
	// start plus output latency); near zero means the tap delay did its job.
	_watchMouth() {
		cancelAnimationFrame(this._mouthRaf);
		const marks = this._turnMarks;
		const tick = () => {
			this._mouthRaf = 0;
			if (this._closed || !this.player || marks !== this._turnMarks) return;
			if (this.player.shape.open > MOUTH_OPEN_THRESHOLD) {
				const audibleAt = marks.firstAudioCtx + this.player.lipsyncDelaySec;
				this._emit('latency', {
					kind: 'mouth',
					ms: Math.round(this._clock() - marks.firstAudio),
					av_offset_ms: Math.round((this._ctx.currentTime - audibleAt) * 1000),
					output_latency_ms: Math.round(this.player.lipsyncDelaySec * 1000),
				});
				return;
			}
			if (!this.player.speaking && this.player.pending <= 0 && marks.firstAudio !== null && this._clock() - marks.firstAudio > 5_000) return;
			this._mouthRaf = requestAnimationFrame(tick);
		};
		this._mouthRaf = requestAnimationFrame(tick);
	}

	// The user talked over the reply: silence it, drop its late audio and tell
	// the server how much of it was actually heard.
	_bargeIn() {
		const item = this._item;
		this._item = null;
		if (!item || !this.player) return;
		const rate = this.session?.session?.audio?.output?.format?.rate || 24_000;
		const receivedMs = (item.samples / rate) * 1000;
		let heardMs = receivedMs;
		if (item.firstStart !== null && this._ctx) {
			heardMs = Math.max(0, Math.min(receivedMs, (this._ctx.currentTime - this.player.lipsyncDelaySec - item.firstStart) * 1000));
		}
		this.player.reset();
		cancelAnimationFrame(this._mouthRaf);
		if (item.id) {
			this._dropItems.add(item.id);
			this._send({ type: 'conversation.item.truncate', item_id: item.id, content_index: 0, audio_end_ms: Math.round(heardMs) });
		}
		this._emit('interrupted', { itemId: item.id, heardMs: Math.round(heardMs) });
	}

	_resetTurnMarks() {
		this._turnMarks = { speechEnd: null, firstAudio: null, firstAudioCtx: null };
	}

	// ── server events ─────────────────────────────────────────────────────

	_onMessage(raw) {
		let msg;
		try {
			msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
		} catch {
			return;
		}
		switch (msg.type) {
			case 'conversation.created':
				if (msg.conversation?.id) this.conversationId = msg.conversation.id;
				break;
			case 'input_audio_buffer.speech_started':
				if (this._item && this.player?.speaking) this._bargeIn();
				this._resetTurnMarks();
				if (this.mode === 'open') this._setState('listening');
				break;
			case 'input_audio_buffer.speech_stopped':
				this._turnMarks.speechEnd = this._clock();
				this._setState('thinking');
				break;
			case 'conversation.item.input_audio_transcription.updated':
			case 'conversation.item.input_audio_transcription.delta': {
				const id = msg.item_id || 'user';
				const text = msg.transcript ?? `${this._userPartial.get(id) || ''}${msg.delta || ''}`;
				this._userPartial.set(id, text);
				this._emit('transcript', { role: 'user', text, final: false, itemId: id });
				break;
			}
			case 'conversation.item.input_audio_transcription.completed': {
				const id = msg.item_id || 'user';
				this._userPartial.delete(id);
				this._emit('transcript', { role: 'user', text: msg.transcript || '', final: true, itemId: id });
				break;
			}
			case 'response.output_audio.delta':
			case 'response.audio.delta':
				this._onAudioDelta(msg);
				break;
			case 'response.output_audio_transcript.delta':
			case 'response.audio_transcript.delta':
				if (msg.item_id && this._dropItems.has(msg.item_id)) break;
				this._emit('transcript', { role: 'assistant', text: msg.delta || '', final: false, itemId: msg.item_id || null, delta: true });
				break;
			case 'response.output_audio_transcript.done':
			case 'response.audio_transcript.done':
				this._emit('transcript', { role: 'assistant', text: msg.transcript || '', final: true, itemId: msg.item_id || null });
				break;
			case 'response.done':
				if (this.player && !this.player.speaking && this.state !== 'listening') {
					this._setState(this.mode === 'ptt' && !this._talking ? 'idle' : 'listening');
				}
				break;
			case 'error': {
				const err = msg.error || {};
				this._emit('error', { code: err.code || err.type || 'server_error', message: err.message || 'Grok voice reported an error.', fatal: false });
				break;
			}
			default:
				break;
		}
	}

	// ── plumbing ──────────────────────────────────────────────────────────

	_fail(err) {
		this._emit('error', { code: err.code, message: err.message, status: err.status, fatal: true });
		this._mic?.dispose();
		this._mic = null;
		const ws = this._ws;
		this._ws = null;
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try {
				ws.close(1000, 'client error');
			} catch {}
		}
		this.player?.reset();
		this._setState('error');
	}

	_setState(state) {
		if (!STATES.has(state) || state === this.state) return;
		this.state = state;
		this._emit('state', { state });
	}

	_emit(type, detail) {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}
}
