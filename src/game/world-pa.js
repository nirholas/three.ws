// Presenter PA for /play: a host speaks once and every player in the coin's world
// hears it, across the General and Holders worlds and every room shard.
//
// Self-attaching like meetup-event.js: it polls window.__CC__ and follows the
// live CommunityNet (a new one per world entry or reconnect) without touching
// coincommunities.js. Two halves:
//   * Listener (everyone): a LIVE bar naming the speaker, WebCodecs Opus decode
//     into a small jitter buffer, volume + mute (remembered), live captions, and
//     a plain notice on browsers without WebCodecs audio.
//   * Presenter (hosts): `/host` in chat opens the panel. The server decides who
//     may speak (multiplayer/src/world-pa.js); the panel only asks, then streams
//     the mic as ~100 ms batches of 20 ms Opus frames, with optional captions
//     from the browser's speech recognizer.

import './world-pa.css';
import { MicCapture } from '../voice/mic-capture.js';
import {
	PA_SAMPLE_RATE, PA_FRAME_SAMPLES, PA_FRAME_US, PA_BITRATE, PA_BATCH_FRAMES, PA_STALE_MS,
	LinearResampler, FrameAccumulator, PlayoutClock, speakerLabel, paSupport, formatElapsed, paErrorText,
} from './world-pa-core.js';

const VOL_KEY = 'cc-pa-volume';
const MUTE_KEY = 'cc-pa-muted';
const HOSTKEY_KEY = 'cc-pa-host-key';
const START_TIMEOUT_MS = 8000;

function store(kind) {
	try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch { return null; }
}
function readPref(key, fallback, kind) {
	try { const v = store(kind)?.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
function writePref(key, value, kind) {
	try { store(kind)?.setItem(key, String(value)); } catch { /* storage blocked: preference lasts this visit */ }
}

function h(tag, attrs = {}, kids = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'text') n.textContent = v;
		else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
		else if (v === true) n.setAttribute(k, '');
		else if (v !== false && v != null) n.setAttribute(k, v);
	}
	for (const kid of kids) if (kid) n.append(kid);
	return n;
}

// ── Listener ──────────────────────────────────────────────────────────────────

class PaListener {
	constructor() {
		this.ctx = null;
		this.gain = null;
		this.analyser = null;
		this.levelBuf = null;
		this.decoder = null;
		this.clock = new PlayoutClock();
		this.ts = 0;
		this.streamId = '';
		this.volume = Math.min(1, Math.max(0, Number(readPref(VOL_KEY, '0.9')) || 0));
		this.muted = readPref(MUTE_KEY, '0') === '1';
	}

	get suspended() {
		return !!this.ctx && this.ctx.state === 'suspended';
	}

	_ensureGraph() {
		if (this.ctx) return;
		const AC = window.AudioContext || window.webkitAudioContext;
		this.ctx = new AC({ latencyHint: 'interactive' });
		this.gain = this.ctx.createGain();
		this.analyser = this.ctx.createAnalyser();
		this.analyser.fftSize = 256;
		this.levelBuf = new Uint8Array(this.analyser.fftSize);
		this.gain.connect(this.analyser).connect(this.ctx.destination);
		this._applyGain();
	}

	_ensureDecoder() {
		if (this.decoder && this.decoder.state === 'configured') return;
		this.decoder = new AudioDecoder({
			output: (data) => this._play(data),
			error: () => { this.decoder = null; }, // rebuilt on the next chunk
		});
		this.decoder.configure({ codec: 'opus', sampleRate: PA_SAMPLE_RATE, numberOfChannels: 1 });
	}

	begin(id) {
		if (this.streamId === id) return;
		this.streamId = id;
		this.clock.reset();
		this._ensureGraph();
		this.resume();
	}

	resume() {
		if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
	}

	chunk(frames) {
		if (!this.ctx) return;
		this._ensureDecoder();
		for (const f of frames) {
			const data = f instanceof Uint8Array ? f : new Uint8Array(f);
			try {
				this.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: this.ts, data }));
			} catch {
				this.decoder = null;
				return;
			}
			this.ts += PA_FRAME_US;
		}
	}

	_play(data) {
		try {
			if (!this.ctx || this.ctx.state === 'closed') return;
			const n = data.numberOfFrames;
			const buf = this.ctx.createBuffer(1, n, data.sampleRate);
			data.copyTo(buf.getChannelData(0), { planeIndex: 0, format: 'f32-planar' });
			const at = this.clock.schedule(this.ctx.currentTime, buf.duration);
			if (at < 0) return; // too far behind live: drop to catch up
			const src = this.ctx.createBufferSource();
			src.buffer = buf;
			src.connect(this.gain);
			src.start(at);
		} finally {
			data.close();
		}
	}

	end() {
		this.streamId = '';
		this.clock.reset();
		try { this.decoder?.close(); } catch { /* already closed */ }
		this.decoder = null;
	}

	level() {
		if (!this.analyser) return 0;
		this.analyser.getByteTimeDomainData(this.levelBuf);
		let sum = 0;
		for (let i = 0; i < this.levelBuf.length; i++) { const v = (this.levelBuf[i] - 128) / 128; sum += v * v; }
		return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 3);
	}

	setVolume(v) {
		this.volume = Math.min(1, Math.max(0, v));
		if (this.volume > 0 && this.muted) this.muted = false;
		writePref(VOL_KEY, this.volume.toFixed(2));
		writePref(MUTE_KEY, this.muted ? '1' : '0');
		this._applyGain();
	}

	toggleMute() {
		this.muted = !this.muted;
		writePref(MUTE_KEY, this.muted ? '1' : '0');
		this._applyGain();
		this.resume();
	}

	_applyGain() {
		if (!this.gain) return;
		const target = this.muted ? 0 : this.volume;
		this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
	}
}

// ── Presenter ─────────────────────────────────────────────────────────────────

class PaPresenter {
	constructor(onEvent) {
		this.onEvent = onEvent; // ({kind:'level'|'stopped'|'error', ...})
		this.net = null;
		this.live = false;
		this.id = '';
		this.mic = null;
		this.encoder = null;
		this.resampler = null;
		this.framer = null;
		this.batch = [];
		this.seq = 0;
		this.ts = 0;
		this.flushTimer = 0;
		this.recog = null;
		this.captions = false;
		this.lastInterimAt = 0;
		this.startedAt = 0;
		this._pending = null;
	}

	// Ask the server for the mic. Resolves with the pa:state reply.
	request(net, { key = '', force = false } = {}) {
		if (!net || !net.sendPa('pa:start', { key, force })) return Promise.resolve({ ok: false, reason: 'offline' });
		this.net = net;
		return new Promise((resolve) => {
			const timer = setTimeout(() => { this._pending = null; resolve({ ok: false, reason: 'timeout' }); }, START_TIMEOUT_MS);
			this._pending = (msg) => { clearTimeout(timer); this._pending = null; resolve(msg); };
		});
	}

	onState(msg) {
		if (this._pending) { this._pending(msg); return; }
		if (msg.ok === false && msg.reason === 'taken' && this.live) this.halt('taken');
	}

	async goLive(net, opts) {
		const support = paSupport();
		if (!support.speak) return { ok: false, reason: 'unsupported' };
		const reply = await this.request(net, opts);
		if (!reply?.ok) return reply || { ok: false, reason: 'error' };
		try {
			await this._startAudio();
		} catch (err) {
			net.sendPa('pa:stop', {});
			this._teardown();
			return { ok: false, reason: err?.code || 'encoder' };
		}
		this.live = true;
		this.id = reply.id || '';
		this.startedAt = performance.now();
		if (this.captions) this._startCaptions();
		return reply;
	}

	async _startAudio() {
		const config = { codec: 'opus', sampleRate: PA_SAMPLE_RATE, numberOfChannels: 1, bitrate: PA_BITRATE };
		const sup = await AudioEncoder.isConfigSupported(config).catch(() => null);
		if (!sup?.supported) throw Object.assign(new Error('opus unsupported'), { code: 'unsupported' });
		this.encoder = new AudioEncoder({
			output: (chunk) => {
				const bytes = new Uint8Array(chunk.byteLength);
				chunk.copyTo(bytes);
				this.batch.push(bytes);
				// Flush from the encoder callback, not only the timer: a background
				// tab throttles timers to 1 Hz, and a second of frames would blow the
				// server's per-message cap.
				if (this.batch.length >= PA_BATCH_FRAMES) this._flush();
			},
			error: () => this.halt('encoder'),
		});
		this.encoder.configure(config);
		this.framer = new FrameAccumulator(PA_FRAME_SAMPLES);
		this.mic = new MicCapture({ retain: false, onFrame: (f) => this._onPcm(f) });
		await this.mic.start(); // throws coded 'permission-denied' | 'no-mic' | 'unsupported'
		this.resampler = new LinearResampler(this.mic.sampleRate, PA_SAMPLE_RATE);
		this.flushTimer = setInterval(() => this._flush(), 100);
	}

	_onPcm(frame) {
		if (!this.encoder || this.encoder.state !== 'configured' || !this.resampler) return;
		for (const f of this.framer.push(this.resampler.push(frame))) {
			const data = new AudioData({
				format: 'f32-planar', sampleRate: PA_SAMPLE_RATE, numberOfFrames: f.length,
				numberOfChannels: 1, timestamp: this.ts, data: f,
			});
			this.ts += PA_FRAME_US;
			this.encoder.encode(data);
			data.close();
		}
	}

	_flush() {
		if (!this.batch.length || !this.net) return;
		const f = this.batch;
		this.batch = [];
		this.net.sendPa('pa:chunk', { s: this.seq++, f });
	}

	level() {
		return this.mic?.getLevel() || 0;
	}

	elapsed() {
		return this.live ? performance.now() - this.startedAt : 0;
	}

	setCaptions(on) {
		this.captions = !!on;
		if (!this.live) return;
		if (this.captions) this._startCaptions(); else this._stopCaptions();
	}

	// The browser's speech recognizer turns the host's speech into live captions:
	// accessibility for anyone muted or hard of hearing, and the only way a
	// listener on a browser without WebCodecs audio follows the talk.
	_startCaptions() {
		const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!SR || this.recog) return;
		const r = new SR();
		r.continuous = true;
		r.interimResults = true;
		r.lang = document.documentElement.lang || navigator.language || 'en-US';
		let failures = 0;
		r.onresult = (e) => {
			failures = 0;
			let text = '';
			let final = false;
			for (let i = e.resultIndex; i < e.results.length; i++) {
				text += e.results[i][0].transcript;
				if (e.results[i].isFinal) final = true;
			}
			text = text.trim();
			if (!text || !this.net) return;
			const now = performance.now();
			if (!final && now - this.lastInterimAt < 300) return;
			this.lastInterimAt = now;
			this.net.sendPa('pa:caption', { text, final });
		};
		// A blocked or unreachable recognizer (no speech service in this build,
		// offline, permission refused) turns captions off with a reason instead of
		// restarting in a tight loop; the audio broadcast carries on regardless.
		const giveUp = (why) => {
			if (this.recog !== r) return;
			this.recog = null;
			this.captions = false;
			this.onEvent({ kind: 'captions-off', why });
		};
		r.onerror = (e) => {
			if (e.error === 'no-speech' || e.error === 'aborted') return;
			if (e.error === 'not-allowed' || e.error === 'service-not-allowed') giveUp('blocked');
			else failures += 1;
		};
		// Chrome ends a recognition session after a pause; keep it running while live.
		r.onend = () => {
			if (this.recog !== r || !this.live || !this.captions) return;
			if (failures >= 3) { giveUp('unavailable'); return; }
			try { r.start(); } catch { giveUp('unavailable'); }
		};
		this.recog = r;
		try { r.start(); } catch { this.recog = null; }
	}

	_stopCaptions() {
		const r = this.recog;
		this.recog = null;
		try { r?.stop(); } catch { /* already stopped */ }
	}

	stop() {
		if (!this.live) return;
		this._flush();
		this.net?.sendPa('pa:stop', {});
		this._teardown();
		this.onEvent({ kind: 'stopped' });
	}

	// The server or the wire ended the broadcast; nothing to send.
	halt(reason) {
		if (!this.live && !this.encoder) return;
		this._teardown();
		this.onEvent({ kind: 'error', reason });
	}

	_teardown() {
		this.live = false;
		this.id = '';
		clearInterval(this.flushTimer);
		this.flushTimer = 0;
		this._stopCaptions();
		try { this.mic?.dispose(); } catch { /* released */ }
		this.mic = null;
		try { if (this.encoder && this.encoder.state !== 'closed') this.encoder.close(); } catch { /* closed */ }
		this.encoder = null;
		this.batch = [];
		this.resampler = null;
		this.framer = null;
	}
}

// ── UI + wiring ───────────────────────────────────────────────────────────────

export class WorldPa {
	constructor(getCC = () => window.__CC__) {
		this.getCC = getCC;
		this.support = paSupport();
		this.listener = new PaListener();
		this.presenter = new PaPresenter((e) => this._onPresenterEvent(e));
		this.net = null;
		this.room = null;
		this.off = null;
		this.live = null;     // { id, name, role } of the stream on air
		this.lastPacketAt = 0;
		this.captionTimer = 0;
		this._buildBar();
		this._buildPanel();
		this._raf = 0;
		this._poll = setInterval(() => this._follow(), 500);
		window.addEventListener('cc:pa-host', () => this.openPanel());
		// Browsers start audio only after a gesture; the first one anywhere unlocks it.
		const unlock = () => { this.listener.resume(); this._renderBar(); };
		window.addEventListener('pointerdown', unlock, { passive: true });
		window.addEventListener('keydown', unlock);
	}

	// Follow the app's current CommunityNet; re-subscribe when it is replaced and
	// treat a replaced room as a dropped connection for both halves.
	_follow() {
		const net = this.getCC()?.net || null;
		const room = net?.room || null;
		if (net !== this.net) {
			this.off?.();
			this.off = null;
			this.net = net;
			if (net) this.off = net.on('pa', (msg) => this._onMessage(msg));
		}
		if (room !== this.room) {
			this.room = room;
			if (this.presenter.live) this.presenter.halt('dropped');
			this._endStream();
		}
		// The presenter's own room never echoes their audio back, so only a stream
		// someone else is sending can go stale.
		const own = this.presenter.live && this.live?.id === this.presenter.id;
		if (this.live && !own && performance.now() - this.lastPacketAt > PA_STALE_MS) this._endStream();
	}

	_onMessage(msg) {
		switch (msg.type) {
			case 'state':
				this.presenter.onState(msg);
				break;
			case 'start':
				this.live = { id: msg.id, name: msg.name || 'Host', role: msg.role || 'host' };
				this.lastPacketAt = performance.now();
				if (this.support.listen && msg.id !== this.presenter.id) this.listener.begin(msg.id);
				this._showCaption('', false);
				this._renderBar();
				break;
			case 'chunk':
				if (!this.live || msg.id !== this.live.id) return;
				this.lastPacketAt = performance.now();
				if (this.support.listen && Array.isArray(msg.f)) {
					this.listener.begin(msg.id);
					this.listener.chunk(msg.f);
				}
				break;
			case 'caption':
				if (!this.live || msg.id !== this.live.id) return;
				this.lastPacketAt = performance.now();
				this._showCaption(String(msg.text || ''), !!msg.final);
				break;
			case 'stop':
				if (this.live?.id === msg.id) this._endStream();
				break;
			default:
				break;
		}
	}

	_endStream() {
		this.live = null;
		this.listener.end();
		this._showCaption('', false);
		this._renderBar();
	}

	// ── Listener bar ──
	_buildBar() {
		this.barName = h('span', { class: 'cc-pa-name' });
		this.barRole = h('span', { class: 'cc-pa-role' });
		this.bars = h('span', { class: 'cc-pa-bars', 'aria-hidden': 'true' }, [h('i'), h('i'), h('i'), h('i')]);
		this.muteBtn = h('button', { class: 'cc-pa-btn cc-pa-mute', type: 'button', onclick: () => { this.listener.toggleMute(); this._renderBar(); } });
		this.vol = h('input', {
			class: 'cc-pa-vol', type: 'range', min: '0', max: '100', step: '1',
			'aria-label': 'PA volume',
			oninput: (e) => { this.listener.setVolume(Number(e.target.value) / 100); this._renderBar(); },
		});
		this.tapBtn = h('button', { class: 'cc-pa-btn cc-pa-tap', type: 'button', text: 'Tap to listen', onclick: () => { this.listener.resume(); setTimeout(() => this._renderBar(), 50); } });
		this.notice = h('span', { class: 'cc-pa-notice', text: 'Live audio needs Chrome, Edge, Firefox or Safari 26+. Captions show here.' });
		this.caption = h('div', { class: 'cc-pa-caption', 'aria-live': 'polite' });
		this.bar = h('div', { id: 'cc-pa-bar', role: 'region', 'aria-label': 'Live PA broadcast', hidden: true }, [
			h('div', { class: 'cc-pa-row' }, [
				h('span', { class: 'cc-pa-live', text: 'LIVE' }),
				this.bars,
				h('span', { class: 'cc-pa-who' }, [h('span', { class: 'cc-pa-onmic', text: 'On the mic' }), this.barName, this.barRole]),
				h('span', { class: 'cc-pa-controls' }, [this.tapBtn, this.notice, this.muteBtn, this.vol]),
			]),
			this.caption,
		]);
		document.body.append(this.bar);
	}

	_renderBar() {
		const live = this.live;
		this.bar.hidden = !live;
		document.body.classList.toggle('cc-pa-on', !!live);
		if (!live) { cancelAnimationFrame(this._raf); this._raf = 0; return; }
		const self = live.id === this.presenter.id;
		this.barName.textContent = self ? 'You' : live.name;
		this.barRole.textContent = speakerLabel(live.role);
		const canHear = this.support.listen && !self;
		this.notice.hidden = this.support.listen || self;
		this.tapBtn.hidden = !canHear || !this.listener.suspended;
		this.muteBtn.hidden = !canHear;
		this.vol.hidden = !canHear;
		const muted = this.listener.muted || this.listener.volume === 0;
		this.muteBtn.textContent = muted ? 'Unmute' : 'Mute';
		this.muteBtn.setAttribute('aria-pressed', String(muted));
		this.vol.value = String(Math.round((this.listener.muted ? 0 : this.listener.volume) * 100));
		if (!this._raf) this._raf = requestAnimationFrame(() => this._animate());
	}

	_animate() {
		this._raf = 0;
		if (!this.live) return;
		const self = this.live.id === this.presenter.id;
		const lvl = self ? this.presenter.level() : this.listener.level();
		const kids = this.bars.children;
		for (let i = 0; i < kids.length; i++) {
			const wobble = 0.55 + 0.45 * Math.sin(performance.now() / (120 + i * 37) + i);
			kids[i].style.transform = `scaleY(${(0.18 + lvl * wobble * 0.82).toFixed(3)})`;
		}
		if (this.presenter.live) this.panelTime.textContent = formatElapsed(this.presenter.elapsed());
		this._raf = requestAnimationFrame(() => this._animate());
	}

	_showCaption(text, final) {
		clearTimeout(this.captionTimer);
		this.caption.textContent = text;
		this.caption.classList.toggle('cc-pa-caption--interim', !!text && !final);
		this.caption.hidden = !text;
		if (text && final) this.captionTimer = setTimeout(() => { this.caption.hidden = true; }, 7000);
	}

	// ── Presenter panel ──
	_buildPanel() {
		this.keyInput = h('input', {
			class: 'cc-pa-key', type: 'password', autocomplete: 'off', spellcheck: 'false',
			placeholder: 'Host key (guest hosts only)', 'aria-label': 'Host key',
		});
		this.keyInput.value = readPref(HOSTKEY_KEY, '', 'session');
		this.capToggle = h('input', { type: 'checkbox', id: 'cc-pa-captions' });
		this.capToggle.checked = this.support.captions;
		this.capToggle.disabled = !this.support.captions;
		this.capToggle.addEventListener('change', () => this.presenter.setCaptions(this.capToggle.checked));
		this.goBtn = h('button', { class: 'cc-pa-btn cc-pa-go', type: 'button', text: 'Go live', onclick: () => this._goLive(false) });
		this.takeBtn = h('button', { class: 'cc-pa-btn cc-pa-take', type: 'button', text: 'Take over the mic', hidden: true, onclick: () => this._goLive(true) });
		this.endBtn = h('button', { class: 'cc-pa-btn cc-pa-end', type: 'button', text: 'End broadcast', hidden: true, onclick: () => this.presenter.stop() });
		this.panelMsg = h('p', { class: 'cc-pa-msg', role: 'status' });
		this.panelTime = h('span', { class: 'cc-pa-time', text: '0:00' });
		this.panelLive = h('div', { class: 'cc-pa-onair', hidden: true }, [h('span', { class: 'cc-pa-live', text: 'ON AIR' }), this.panelTime]);
		this.panel = h('div', { id: 'cc-pa-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'cc-pa-title', hidden: true }, [
			h('div', { class: 'cc-pa-head' }, [
				h('h2', { id: 'cc-pa-title', text: 'Presenter PA' }),
				h('button', { class: 'cc-pa-x', type: 'button', 'aria-label': 'Close', text: '×', onclick: () => this.closePanel() }),
			]),
			h('p', { class: 'cc-pa-lede', text: 'Speak to everyone in this world at once, in the General and Holders worlds alike. Keep this tab open while you talk.' }),
			this.panelLive,
			this.keyInput,
			h('label', { class: 'cc-pa-check', for: 'cc-pa-captions' }, [
				this.capToggle,
				h('span', { text: this.support.captions ? 'Live captions from your speech' : 'Live captions need Chrome or Edge' }),
			]),
			this.panelMsg,
			h('div', { class: 'cc-pa-actions' }, [this.goBtn, this.takeBtn, this.endBtn]),
		]);
		this.panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closePanel(); e.stopPropagation(); });
		document.body.append(this.panel);
	}

	openPanel() {
		this.panel.hidden = false;
		if (!this.support.speak) this._panelMessage(paErrorText('unsupported'), true);
		this._renderPanel();
		(this.presenter.live ? this.endBtn : this.goBtn).focus();
	}

	closePanel() {
		this.panel.hidden = true;
	}

	_panelMessage(text, isError = false) {
		this.panelMsg.textContent = text;
		this.panelMsg.classList.toggle('cc-pa-msg--err', isError);
	}

	_renderPanel(busy = false) {
		const live = this.presenter.live;
		this.goBtn.hidden = live;
		this.goBtn.disabled = busy || !this.support.speak;
		this.goBtn.textContent = busy ? 'Connecting…' : 'Go live';
		this.takeBtn.disabled = busy;
		this.endBtn.hidden = !live;
		this.panelLive.hidden = !live;
		this.keyInput.hidden = live;
		if (live) this.takeBtn.hidden = true;
	}

	async _goLive(force) {
		const key = this.keyInput.value.trim();
		writePref(HOSTKEY_KEY, key, 'session');
		this._panelMessage('');
		this._renderPanel(true);
		this.presenter.captions = this.capToggle.checked;
		const reply = await this.presenter.goLive(this.net, { key, force });
		this._renderPanel(false);
		if (reply?.ok) {
			this._panelMessage(`You are live as ${speakerLabel(reply.role).toLowerCase()}. Everyone in this world hears you now.`);
			this.endBtn.focus();
			this._renderBar();
			return;
		}
		this.takeBtn.hidden = reply?.reason !== 'busy';
		this._panelMessage(paErrorText(reply?.reason, reply?.speaker), true);
	}

	_onPresenterEvent(e) {
		if (e.kind === 'stopped') {
			this._panelMessage('Broadcast ended. Thanks for hosting!');
		} else if (e.kind === 'error') {
			this.panel.hidden = false;
			this._panelMessage(paErrorText(e.reason), true);
		} else if (e.kind === 'captions-off') {
			this.capToggle.checked = false;
			this._panelMessage(e.why === 'blocked'
				? 'Captions were blocked by the browser. Your audio is still live.'
				: 'Live captions are unavailable in this browser right now. Your audio is still live.', true);
		}
		this._renderPanel(false);
		this._renderBar();
	}
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__CC_PA__) {
	window.__CC_PA__ = new WorldPa();
}
