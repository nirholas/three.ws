// LiveKit realtime voice — bidirectional audio via a LiveKit room.
// The agent server joins the same room, handles VAD/STT/TTS, and sends
// data-channel messages with transcript payloads.

import { ACTION_TYPES } from '../agent-protocol.js';
import { loadModule } from '../shared/load-module.js';

// The single-file CDN embed (vite.config.js libConfig) inlines every
// bundler-visible import, so a bundled livekit-client added about 1MB to
// agent-3d.js for a feature most embeds never start. That build defines
// import.meta.env.AGENT3D_LIB, which folds this to the pinned CDN load; the app
// build keeps livekit-client as its own lazily fetched chunk.
const LIVEKIT_CDN_URL = 'https://esm.sh/livekit-client@2.23.0';

function loadLivekitClient() {
	return import.meta.env?.AGENT3D_LIB ? loadModule(LIVEKIT_CDN_URL) : import('livekit-client');
}

export class LiveKitVoice {
	/**
	 * @param {object} opts
	 * @param {string} opts.serverUrl  LiveKit server WebSocket URL (wss://…)
	 * @param {string} opts.token      Room access JWT
	 * @param {import('../agent-protocol.js').AgentProtocol} opts.protocol
	 */
	constructor({ serverUrl, token, protocol }) {
		this._serverUrl = serverUrl;
		this._token = token;
		this._protocol = protocol;
		this._room = null;
		this._audioEls = []; // { track, el }[]
		this._userSpeaking = false;
		this._micEnabled = false;
		this._micError = null;
	}

	async connect() {
		const { Room, RoomEvent, Track } = await loadLivekitClient();
		const room = new Room();
		this._room = room;

		// Agent TTS audio — attach <audio> element when track arrives.
		// In the slim widget shell we still need the element to exist so the
		// browser plays the track, but it must be hidden (no DOM leak) and
		// detached from any user-visible layout. The audio is what the
		// embedder asked for; the <audio> tag itself is invisible chrome.
		room.on(RoomEvent.TrackSubscribed, (track, _pub, _participant) => {
			if (track.kind !== Track.Kind.Audio) return;
			const el = track.attach();
			if (window.__WIDGET_SHELL) {
				el.style.display = 'none';
				el.setAttribute('aria-hidden', 'true');
			}
			document.body.appendChild(el);
			this._audioEls.push({ track, el });
		});

		room.on(RoomEvent.TrackUnsubscribed, (track) => {
			const idx = this._audioEls.findIndex((e) => e.track === track);
			if (idx === -1) return;
			const { el } = this._audioEls.splice(idx, 1)[0];
			try { track.detach(el); } catch {}
			el.remove();
		});

		// Data messages from the agent server
		room.on(RoomEvent.DataReceived, (data, _participant) => {
			let msg;
			try {
				msg = JSON.parse(new TextDecoder().decode(data));
			} catch {
				return;
			}
			// Agent speaking — drive avatar lipsync + chat bubble
			if (msg.type === 'transcript' && msg.text) {
				this._protocol.emit({
					type: 'speak',
					payload: { text: msg.text, sentiment: 0 },
				});
			}
			// Named body gesture (e.g. from the LiveKit avatar plugin)
			if (msg.type === 'gesture' && msg.name) {
				this._protocol.emit({
					type: ACTION_TYPES.GESTURE,
					payload: { name: msg.name },
				});
			}
			// User speech boundaries (VAD from agent server)
			if (msg.type === 'speech_started') {
				this._userSpeaking = true;
				this._protocol.emit({ type: ACTION_TYPES.LISTEN_START, payload: {} });
			}
			if (msg.type === 'speech_ended') {
				this._userSpeaking = false;
				this._protocol.emit({
					type: ACTION_TYPES.LISTEN_END,
					payload: { text: msg.transcript || '' },
				});
			}
		});

		// Fallback: use LiveKit active-speaker VAD when agent doesn't send speech events
		room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
			const localId = room.localParticipant?.identity;
			const active = speakers.some((p) => p.identity === localId);
			if (active && !this._userSpeaking) {
				this._userSpeaking = true;
				this._protocol.emit({ type: ACTION_TYPES.LISTEN_START, payload: {} });
			} else if (!active && this._userSpeaking) {
				this._userSpeaking = false;
				this._protocol.emit({ type: ACTION_TYPES.LISTEN_END, payload: { text: '' } });
			}
		});

		await room.connect(this._serverUrl, this._token);

		// The microphone is optional. A visitor with no input device, or who
		// declines the permission prompt, is still in the room: the agent's
		// audio plays and its data channel keeps driving lipsync and gestures,
		// so the session continues in listen-only mode instead of failing.
		try {
			await room.localParticipant.setMicrophoneEnabled(true);
			this._micEnabled = true;
			this._micError = null;
		} catch (err) {
			this._micEnabled = false;
			this._micError = err;
		}
	}

	async disconnect() {
		for (const { track, el } of this._audioEls) {
			try { track.detach(el); } catch {}
			try { el.remove(); } catch {}
		}
		this._audioEls = [];
		if (this._room) {
			try { await this._room.disconnect(); } catch {}
			this._room = null;
		}
		this._userSpeaking = false;
		this._micEnabled = false;
	}

	/** True once the visitor's microphone is publishing into the room. */
	get micEnabled() {
		return this._micEnabled;
	}

	/** The error that kept the microphone off (listen-only mode), or null. */
	get micError() {
		return this._micError;
	}

	get connected() {
		return this._room?.state === 'connected';
	}
}
