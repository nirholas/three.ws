// Plays a streamed digital-human turn: PCM chunks scheduled gaplessly on Web
// Audio, Audio2Face frames laid onto the same clock, and amplitude lipsync for
// any audio the frames do not cover.
//
// One turn is one timeline. Each spoken segment's audio is appended at the
// playhead as chunks arrive; A2F frame times (relative to the start of that
// segment's audio) are mapped onto the turn clock through the exact schedule
// the audio received, including any gap a network stall forced in. The mouth
// therefore follows A2F wherever frames exist and falls back to the analyser
// (the same estimator LipsyncDriver uses) wherever they do not: before the
// first frame lands, after A2F degrades, or for a fallback clip.

import { computeShape } from './lipsync-driver.js';

const LEAD_S = 0.06; // scheduling headroom for the first chunk of a run
const REST_GAP_S = 1 / 30;

/**
 * Maps a segment's audio time (seconds of its own audio) to turn time, given
 * the pieces its chunks were scheduled at. Pure; exported for tests.
 */
export class SegmentClock {
	constructor() {
		this.pieces = []; // { audioStart, turnStart }
		this.audioSec = 0;
	}

	/** Record a chunk of `durSec` scheduled at turn time `turnStart`. */
	schedule(turnStart, durSec) {
		const last = this.pieces[this.pieces.length - 1];
		const contiguous =
			last && Math.abs(last.turnStart + (this.audioSec - last.audioStart) - turnStart) < 1e-4;
		if (!contiguous) this.pieces.push({ audioStart: this.audioSec, turnStart });
		this.audioSec += durSec;
	}

	toTurn(audioT) {
		let p = this.pieces[0];
		if (!p) return null;
		for (const q of this.pieces) {
			if (q.audioStart <= audioT) p = q;
			else break;
		}
		return p.turnStart + (audioT - p.audioStart);
	}

	get turnEnd() {
		const last = this.pieces[this.pieces.length - 1];
		return last ? last.turnStart + (this.audioSec - last.audioStart) : null;
	}
}

function int16ToFloat(bytes) {
	const n = Math.floor(bytes.byteLength / 2);
	const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
	return out;
}

export class StreamSpeechPlayer {
	/**
	 * @param {object} o
	 * @param {AudioContext} o.ctx
	 * @param {import('./a2f-player.js').A2FPlayer} o.a2f       blendshape player bound to the avatar
	 * @param {{ setMouthShape(s:object):void }} o.mouth           amplitude fallback target
	 * @param {(state:object) => void} [o.onState]                 'speaking' / 'idle' + mouth source
	 */
	constructor({ ctx, a2f, mouth, onState }) {
		this.ctx = ctx;
		this.a2f = a2f;
		this.mouth = mouth;
		this.onState = onState || (() => {});
		this.out = ctx.createGain();
		this.analyser = ctx.createAnalyser();
		this.analyser.fftSize = 256;
		this.analyser.smoothingTimeConstant = 0.5;
		this.out.connect(this.analyser);
		this.analyser.connect(ctx.destination);
		this._bins = new Uint8Array(this.analyser.frequencyBinCount);
		this._shape = { open: 0, wide: 0, round: 0 };
		this._raf = 0;
		this._source = 'rest';
		this.reset();
	}

	/** Forget the turn and silence everything now (barge-in, stop, new turn). */
	reset() {
		for (const s of this._sources || []) {
			try {
				s.onended = null;
				s.stop();
			} catch {}
		}
		this._sources = new Set();
		this._origin = null; // ctx time of turn t=0
		this._playhead = 0; // turn time where the next chunk goes
		this._segments = new Map(); // index -> { clock, rate, coverEnd }
		this._frames = null; // the array handed to A2FPlayer (grows in place)
		this._names = null;
		this._external = 0; // browser-voice utterances in flight
		this._idleWaiters = [];
		this._mouthRest();
		this.a2f?.reset();
		this._emitState();
	}

	/** Seconds of scheduled audio not yet heard. */
	get pending() {
		if (this._origin === null) return 0;
		return Math.max(0, this._playhead - this._now());
	}

	get speaking() {
		return this._external > 0 || this.pending > 0.01;
	}

	_now() {
		return this._origin === null ? 0 : this.ctx.currentTime - this._origin;
	}

	_seg(index) {
		let s = this._segments.get(index);
		if (!s) {
			s = { clock: new SegmentClock(), rate: 22050, coverEnd: -1 };
			this._segments.set(index, s);
		}
		return s;
	}

	_scheduleBuffer(index, buffer) {
		const ctx = this.ctx;
		if (this._origin === null) this._origin = ctx.currentTime + LEAD_S;
		const now = this._now();
		// An underrun (network stall) leaves a gap rather than a clipped start.
		const at = Math.max(this._playhead, now + (this._playhead < now ? LEAD_S : 0));
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		src.connect(this.out);
		src.start(this._origin + at);
		this._sources.add(src);
		src.onended = () => {
			this._sources.delete(src);
			this._checkIdle();
		};
		this._seg(index).clock.schedule(at, buffer.duration);
		this._playhead = at + buffer.duration;
		this._ensureLoop();
	}

	/** Stream event from /api/a2f for segment `index`. */
	line(index, type, data) {
		if (type === 'meta') {
			this._seg(index).rate = data.sampleRateHz || 22050;
		} else if (type === 'audio') {
			const seg = this._seg(index);
			const f32 = int16ToFloat(base64Bytes(data.pcm));
			if (!f32.length) return;
			const buf = this.ctx.createBuffer(1, f32.length, seg.rate);
			buf.copyToChannel(f32, 0);
			this._scheduleBuffer(index, buf);
		} else if (type === 'header') {
			this._ensureTrack(data.blendShapeNames, data.fps);
		} else if (type === 'frames') {
			this._appendFrames(index, data.frames);
		}
	}

	/** Fallback clip (WAV bytes from /api/tts/speak) for segment `index`. */
	async playClip(index, wavBytes) {
		const copy = wavBytes.buffer.slice(
			wavBytes.byteOffset,
			wavBytes.byteOffset + wavBytes.byteLength,
		);
		const buffer = await this.ctx.decodeAudioData(copy);
		this._scheduleBuffer(index, buffer);
	}

	/** Run `speak()` (a browser-voice utterance) after the queued audio, then resume. */
	async external(speak) {
		this._external++;
		this._emitState();
		try {
			await this.whenIdle({ ignoreExternal: true });
			return await speak();
		} finally {
			this._external--;
			// Audio after this utterance must not be scheduled in its past.
			this._playhead = Math.max(this._playhead, this._now());
			this._checkIdle();
		}
	}

	/** Resolves when every scheduled sound has been heard. */
	whenIdle({ ignoreExternal = false } = {}) {
		const idle = () => this.pending <= 0.01 && (ignoreExternal || this._external === 0);
		if (idle()) return Promise.resolve();
		return new Promise((resolve) => this._idleWaiters.push({ idle, resolve }));
	}

	_checkIdle() {
		this._idleWaiters = this._idleWaiters.filter((w) => {
			if (!w.idle()) return true;
			w.resolve();
			return false;
		});
		this._emitState();
	}

	_ensureTrack(names, fps = 30) {
		if (!Array.isArray(names) || !names.length) return;
		if (this._frames && this._names?.join() === names.join()) return;
		this._names = names;
		this._frames = [{ t: 0, w: new Array(names.length).fill(0) }];
		this.a2f?.setTrack({ fps, blendShapeNames: names, frames: this._frames });
	}

	_appendFrames(index, frames) {
		if (!this._frames || !Array.isArray(frames) || !frames.length) return;
		const seg = this._seg(index);
		const rest = new Array(this._names.length).fill(0);
		for (const f of frames) {
			const t = seg.clock.toTurn(f.t);
			if (t === null) continue;
			const last = this._frames[this._frames.length - 1];
			if (t <= last.t) continue;
			// Close the mouth across the silence between two segments.
			if (t - last.t > 0.25) {
				this._frames.push({ t: last.t + REST_GAP_S, w: rest });
				this._frames.push({ t: t - REST_GAP_S, w: rest });
			}
			this._frames.push({ t, w: f.w });
			seg.coverEnd = t;
		}
	}

	/** True when A2F frames exist for turn time `t`. */
	_covered(t) {
		if (!this._frames || this._frames.length < 2) return false;
		for (const seg of this._segments.values()) {
			const start = seg.clock.pieces[0]?.turnStart;
			if (start === undefined || t < start - REST_GAP_S) continue;
			const end = seg.clock.turnEnd;
			if (t <= end + REST_GAP_S) return seg.coverEnd >= t;
		}
		// Between segments: the rest frames hold the mouth shut.
		return true;
	}

	_ensureLoop() {
		if (this._raf) return;
		const tick = () => {
			this._raf = 0;
			this._frame();
			if (this.speaking || this._shape.open > 0.01) this._raf = requestAnimationFrame(tick);
			else this._mouthRest();
		};
		this._raf = requestAnimationFrame(tick);
	}

	_frame() {
		if (this._external > 0) return; // the browser voice drives its own visemes
		// Heard time lags scheduled time by the output latency.
		const latency = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
		const t = this._now() - latency;
		if (this.pending <= 0 && t > this._playhead) {
			this._mouthRest();
			return;
		}
		if (this._covered(t)) {
			this._setSource('a2f');
			this.a2f.update(t);
			return;
		}
		this._setSource('amplitude');
		this.analyser.getByteFrequencyData(this._bins);
		const s = computeShape(this._bins, 1.5);
		const k = (prev, next) => (next > prev ? 0.45 : 0.18);
		this._shape.open += (s.open - this._shape.open) * k(this._shape.open, s.open);
		this._shape.wide += (s.wide - this._shape.wide) * k(this._shape.wide, s.wide);
		this._shape.round += (s.round - this._shape.round) * k(this._shape.round, s.round);
		try {
			this.mouth.setMouthShape(this._shape);
		} catch {}
	}

	_mouthRest() {
		this._shape = { open: 0, wide: 0, round: 0 };
		try {
			this.mouth?.setMouthShape(this._shape);
		} catch {}
		this.a2f?.reset();
		this._setSource('rest');
	}

	_setSource(source) {
		if (this._source === source) return;
		// Hand the mouth over cleanly: neither driver may leave morphs set
		// that the other does not write.
		if (source === 'amplitude') this.a2f?.reset();
		if (source === 'a2f') {
			this._shape = { open: 0, wide: 0, round: 0 };
			try {
				this.mouth?.setMouthShape(this._shape);
			} catch {}
		}
		this._source = source;
		this._emitState();
	}

	_emitState() {
		this.onState({
			speaking: this.speaking,
			mouth: this._external > 0 ? 'visemes' : this._source,
		});
	}

	dispose() {
		this.reset();
		cancelAnimationFrame(this._raf);
		try {
			this.analyser.disconnect();
			this.out.disconnect();
		} catch {}
	}
}

function base64Bytes(b64) {
	const bin = atob(b64 || '');
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
