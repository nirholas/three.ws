// Voice session client for agent-voice-chat server.
// Lazy-loaded — only imported when the voice-server attribute is present.
// The server handles all STT/TTS; this module only streams mic audio and plays responses.

export class VoiceClient {
	constructor({ serverUrl, element }) {
		this._url = serverUrl.replace(/\/$/, '');
		this._el = element;
		this._socket = null;
		this._recorder = null;
		this._stream = null;
		this._audio = null;
		this._agentId = null;
		this._active = false;
	}

	async start(agentId, config = {}) {
		if (this._active) return;
		this._active = true;
		this._agentId = agentId;

		// Load socket.io client from the server — version parity guaranteed, zero bundle cost
		// when voice-server attr is absent (dynamic import runs only on demand).
		let io;
		try {
			({ io } = await import(/* @vite-ignore */ `${this._url}/socket.io/socket.io.esm.min.js`));
		} catch (err) {
			console.warn('[voice-client] socket.io load failed', err);
			this._active = false;
			this._emitState('idle');
			return;
		}

		const socket = io(`${this._url}/space`, { transports: ['websocket'] });
		this._socket = socket;

		socket.once('connect', () => {
			socket.emit('joinRoom', { roomId: config.roomId || 'default' });
			if (agentId) socket.emit('agentConnect', { agentId });
			this._startMic();
		});

		socket.on('textDelta', () => this._emitState('thinking'));
		socket.on('ttsAudio', ({ audio, format }) => this._playAudio(audio, format));
		socket.on('ttsBrowser', ({ text }) => {
			this._emitState('speaking');
			const utt = new SpeechSynthesisUtterance(text);
			utt.onend = () => { if (this._active) this._emitState('listening'); };
			window.speechSynthesis?.speak(utt);
		});
		socket.on('agentStatus', ({ status }) => {
			if (status === 'idle' && this._active) this._emitState('listening');
		});
		socket.on('connect_error', (err) => {
			console.warn('[voice-client] connect error', err.message);
			this.stop();
		});
		socket.on('disconnect', () => this._emitState('idle'));
	}

	stop() {
		this._active = false;
		this._stopMic();
		if (this._socket) {
			try { this._socket.emit('agentDisconnect', { agentId: this._agentId }); } catch {}
			this._socket.disconnect();
			this._socket = null;
		}
		if (this._audio) { this._audio.pause(); this._audio.src = ''; this._audio = null; }
		this._emitState('idle');
	}

	async _startMic() {
		this._emitState('listening');
		try {
			this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (err) {
			console.warn('[voice-client] mic access denied', err);
			this.stop();
			return;
		}

		const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
			? 'audio/webm;codecs=opus' : 'audio/webm';
		const recorder = new MediaRecorder(this._stream, { mimeType });
		this._recorder = recorder;

		recorder.ondataavailable = (e) => {
			if (!e.data.size || !this._socket?.connected || !this._active) return;
			this._emitState('thinking');
			const reader = new FileReader();
			reader.onload = () => {
				const base64 = reader.result.split(',')[1];
				this._socket.emit('audioData', { agentId: this._agentId, audio: base64, mimeType });
			};
			reader.readAsDataURL(e.data);
		};

		recorder.start(3000);
	}

	_stopMic() {
		if (this._recorder?.state !== 'inactive') try { this._recorder.stop(); } catch {}
		this._recorder = null;
		this._stream?.getTracks().forEach((t) => t.stop());
		this._stream = null;
	}

	_playAudio(base64, format = 'mp3') {
		this._emitState('speaking');
		const mime = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
		if (this._audio) { this._audio.pause(); this._audio.src = ''; }
		const audio = new Audio(url);
		this._audio = audio;
		const done = () => {
			URL.revokeObjectURL(url);
			if (this._audio === audio) this._audio = null;
			if (this._active) this._emitState('listening');
		};
		audio.onended = done;
		audio.onerror = done;
		audio.play().catch(done);
	}

	_emitState(state) {
		this._el?.dispatchEvent(
			new CustomEvent('voiceStateChange', { detail: { state }, bubbles: true, composed: true }),
		);
	}
}
