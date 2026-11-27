// tests/club-audio.test.js
//
// ClubAudio (Web Audio API mixer) — unit tests.
//
// We can't run a real AudioContext in node, so the tests install a tiny fake
// Web Audio implementation on globalThis.window.AudioContext. The fake
// records linearRampToValueAtTime / cancelScheduledValues calls on each gain
// node so we can assert that crossfade scheduling matches the documented
// behaviour:
//
//   fadeToStyle(): ambience gain → 0.1, style gain → 0.75, both over durationMs.
//   fadeOutStyle(): style → 0,  ambience → 0.35.
//   setMuted(true)/false: master gain → 0 / 0.75 over 0.15s.
//
// The fake fetch handler returns a minimal ArrayBuffer; decodeAudioData
// resolves to a placeholder "buffer" object. Real audio decoding isn't
// exercised — only the scheduling graph is.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ClubAudio } from '../src/club-audio.js';

// ── Fake Web Audio impl ──────────────────────────────────────────────────────

class FakeAudioParam {
	constructor(initial = 0) {
		this.value = initial;
		this.events = []; // {type, value, time}
	}
	setValueAtTime(value, time) {
		this.value = value;
		this.events.push({ type: 'set', value, time });
		return this;
	}
	linearRampToValueAtTime(value, time) {
		this.value = value;
		this.events.push({ type: 'linearRamp', value, time });
		return this;
	}
	setTargetAtTime(value, time) {
		this.value = value;
		this.events.push({ type: 'target', value, time });
		return this;
	}
	cancelScheduledValues(time) {
		this.events.push({ type: 'cancel', time });
		return this;
	}
	_lastRamp() {
		return [...this.events].reverse().find((e) => e.type === 'linearRamp');
	}
}

class FakeGainNode {
	constructor() {
		this.gain = new FakeAudioParam(1);
		this._connections = [];
	}
	connect(dest) {
		this._connections.push(dest);
		return dest;
	}
	disconnect() {
		this._connections = [];
	}
}

class FakeAnalyserNode {
	constructor() {
		this.fftSize = 256;
		this.smoothingTimeConstant = 0;
		this.frequencyBinCount = 128;
		this._connections = [];
	}
	connect(dest) {
		this._connections.push(dest);
		return dest;
	}
	disconnect() {
		this._connections = [];
	}
	getByteFrequencyData(buf) {
		// Constant mid-level energy across the spectrum so getPeak() returns
		// a deterministic non-zero value.
		buf.fill(128);
	}
}

class FakeBufferSource {
	constructor() {
		this.buffer = null;
		this.loop = false;
		this.started = false;
		this.stopped = false;
		this._connections = [];
	}
	connect(dest) {
		this._connections.push(dest);
		return dest;
	}
	disconnect() {
		this._connections = [];
	}
	start() {
		this.started = true;
	}
	stop() {
		this.stopped = true;
	}
}

class FakeBiquadFilterNode {
	constructor() {
		this.type = '';
		this.frequency = new FakeAudioParam(0);
		this.Q = new FakeAudioParam(0);
		this.gain = new FakeAudioParam(0);
		this._connections = [];
	}
	connect(dest) {
		this._connections.push(dest);
		return dest;
	}
	disconnect() {
		this._connections = [];
	}
}

class FakeConvolverNode {
	constructor() {
		this.buffer = null;
		this._connections = [];
	}
	connect(dest) {
		this._connections.push(dest);
		return dest;
	}
	disconnect() {
		this._connections = [];
	}
}

class FakeDynamicsCompressorNode {
	constructor() {
		this.threshold = new FakeAudioParam(-24);
		this.knee = new FakeAudioParam(30);
		this.ratio = new FakeAudioParam(12);
		this.attack = new FakeAudioParam(0.003);
		this.release = new FakeAudioParam(0.25);
		this._connections = [];
	}
	connect(dest) {
		this._connections.push(dest);
		return dest;
	}
	disconnect() {
		this._connections = [];
	}
}

class FakePannerNode {
	constructor() {
		this.panningModel = '';
		this.distanceModel = '';
		this.refDistance = 1;
		this.maxDistance = 10000;
		this.rolloffFactor = 1;
		this.coneInnerAngle = 360;
		this.coneOuterAngle = 360;
		this.coneOuterGain = 0;
		this.positionX = new FakeAudioParam(0);
		this.positionY = new FakeAudioParam(0);
		this.positionZ = new FakeAudioParam(0);
		this._connections = [];
	}
	connect(dest) {
		this._connections.push(dest);
		return dest;
	}
	disconnect() {
		this._connections = [];
	}
}

class FakeAudioListener {
	constructor() {
		this.positionX = new FakeAudioParam(0);
		this.positionY = new FakeAudioParam(0);
		this.positionZ = new FakeAudioParam(0);
		this.forwardX = new FakeAudioParam(0);
		this.forwardY = new FakeAudioParam(0);
		this.forwardZ = new FakeAudioParam(-1);
		this.upX = new FakeAudioParam(0);
		this.upY = new FakeAudioParam(1);
		this.upZ = new FakeAudioParam(0);
	}
}

class FakeMediaElementSource {
	constructor(el) {
		this.mediaElement = el;
		this._connections = [];
	}
	connect(dest) {
		this._connections.push(dest);
		return dest;
	}
	disconnect() {
		this._connections = [];
	}
}

// First play() can be told to reject (browser autoplay policy) so we can
// exercise the gesture-retry path. `audioPlayBehavior` is reset per test.
let audioPlayBehavior = 'resolve';

class FakeAudioElement {
	constructor() {
		this.src = '';
		this.preload = '';
		this.loop = false;
		this.paused = true;
		this.playCount = 0;
		this._listeners = new Map();
	}
	addEventListener(type, cb) {
		if (!this._listeners.has(type)) this._listeners.set(type, []);
		this._listeners.get(type).push(cb);
	}
	async play() {
		this.playCount += 1;
		if (audioPlayBehavior === 'reject-first' && this.playCount === 1) {
			throw new Error('NotAllowedError: autoplay blocked');
		}
		this.paused = false;
		this._emit('playing');
	}
	pause() {
		this.paused = true;
	}
	_emit(type) {
		for (const cb of this._listeners.get(type) || []) cb();
	}
}

class FakeAudioContext {
	constructor() {
		this.currentTime = 0;
		this.sampleRate = 44100;
		this.destination = { _label: 'destination' };
		this.state = 'running';
		this.createdGains = [];
		this.createdSources = [];
		this.createdAnalysers = [];
		this.createdMediaSources = [];
		this.createdFilters = [];
		this.createdConvolvers = [];
		this.createdCompressors = [];
		this.createdPanners = [];
		this.decodedBuffers = [];
		this.listener = new FakeAudioListener();
	}
	createPanner() {
		const p = new FakePannerNode();
		this.createdPanners.push(p);
		return p;
	}
	createGain() {
		const g = new FakeGainNode();
		this.createdGains.push(g);
		return g;
	}
	createMediaElementSource(el) {
		const s = new FakeMediaElementSource(el);
		this.createdMediaSources.push(s);
		return s;
	}
	createBiquadFilter() {
		const f = new FakeBiquadFilterNode();
		this.createdFilters.push(f);
		return f;
	}
	createConvolver() {
		const c = new FakeConvolverNode();
		this.createdConvolvers.push(c);
		return c;
	}
	createDynamicsCompressor() {
		const c = new FakeDynamicsCompressorNode();
		this.createdCompressors.push(c);
		return c;
	}
	createBuffer(channels, length, rate) {
		const data = Array.from({ length: channels }, () => new Float32Array(length));
		return {
			numberOfChannels: channels,
			length,
			sampleRate: rate,
			getChannelData: (c) => data[c],
		};
	}
	createAnalyser() {
		const a = new FakeAnalyserNode();
		this.createdAnalysers.push(a);
		return a;
	}
	createBufferSource() {
		const s = new FakeBufferSource();
		this.createdSources.push(s);
		return s;
	}
	async decodeAudioData(arrayBuffer) {
		const buf = { _fake: true, byteLength: arrayBuffer?.byteLength ?? 0 };
		this.decodedBuffers.push(buf);
		return buf;
	}
	async resume() {
		this.state = 'running';
	}
}

// ── Globals setup ────────────────────────────────────────────────────────────

let originalWindow;
let originalFetch;
let originalLocalStorage;

beforeEach(() => {
	originalWindow = globalThis.window;
	originalFetch = globalThis.fetch;
	originalLocalStorage = globalThis.localStorage;

	audioPlayBehavior = 'resolve';

	const fakeWindow = { AudioContext: FakeAudioContext, Audio: FakeAudioElement };
	globalThis.window = fakeWindow;

	// In-memory localStorage so setMuted persistence doesn't touch disk.
	const store = new Map();
	globalThis.localStorage = {
		getItem: (k) => (store.has(k) ? store.get(k) : null),
		setItem: (k, v) => {
			store.set(k, String(v));
		},
		removeItem: (k) => {
			store.delete(k);
		},
		clear: () => {
			store.clear();
		},
	};

	// fetch returns a stub ArrayBuffer for any URL.
	globalThis.fetch = vi.fn(async () => ({
		ok: true,
		status: 200,
		arrayBuffer: async () => new ArrayBuffer(64),
	}));
});

afterEach(() => {
	globalThis.window = originalWindow;
	globalThis.fetch = originalFetch;
	globalThis.localStorage = originalLocalStorage;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ClubAudio.ensureContext', () => {
	it('lazy-creates the AudioContext, master gain, and analyser', async () => {
		const audio = new ClubAudio();
		expect(audio.ctx).toBeNull();

		await audio.ensureContext();
		expect(audio.ctx).toBeInstanceOf(FakeAudioContext);
		expect(audio.master).toBeInstanceOf(FakeGainNode);
		expect(audio.analyser).toBeInstanceOf(FakeAnalyserNode);
		// Master gain should be set to the documented 0.75 default.
		expect(audio.master.gain.value).toBeCloseTo(0.75, 3);
	});

	it('routes the master through a brick-wall limiter before the destination', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		expect(audio.ctx.createdCompressors).toHaveLength(1);
		expect(audio.limiter).toBeInstanceOf(FakeDynamicsCompressorNode);
		// Master feeds the limiter, limiter feeds the destination — nothing
		// reaches the output un-limited.
		expect(audio.master._connections).toContain(audio.limiter);
		expect(audio.limiter._connections).toContain(audio.ctx.destination);
		expect(audio.master._connections).not.toContain(audio.ctx.destination);
		// Hard-knee, high-ratio limiting with a fast attack.
		expect(audio.limiter.knee.value).toBe(0);
		expect(audio.limiter.ratio.value).toBeGreaterThanOrEqual(20);
		expect(audio.limiter.attack.value).toBeLessThanOrEqual(0.005);
	});

	it('is idempotent — re-calling does not allocate a new context', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		const ctx = audio.ctx;
		await audio.ensureContext();
		expect(audio.ctx).toBe(ctx);
	});
});

describe('ClubAudio.startAmbience', () => {
	it('loads ambience and starts a looping buffer source at the ambience gain', async () => {
		const audio = new ClubAudio();
		await audio.startAmbience();

		expect(audio.ambience).toBeTruthy();
		expect(audio.ambience.source.loop).toBe(true);
		expect(audio.ambience.source.started).toBe(true);
		expect(audio.ambience.gain.gain.value).toBeCloseTo(0.35, 3);
		// One buffer was decoded (ambience.ogg).
		expect(audio.ctx.decodedBuffers).toHaveLength(1);
	});

	it('does not start ambience twice', async () => {
		const audio = new ClubAudio();
		await audio.startAmbience();
		const firstSource = audio.ambience.source;
		await audio.startAmbience();
		expect(audio.ambience.source).toBe(firstSource);
	});
});

describe('ClubAudio.startMusic', () => {
	it('streams the first track (hiphop) through a media-element source at the music gain', async () => {
		const audio = new ClubAudio();
		const music = await audio.startMusic();

		expect(music).toBeTruthy();
		expect(audio.music).toBe(music);
		// One <audio> element wired through exactly one MediaElementSource.
		expect(audio.ctx.createdMediaSources).toHaveLength(1);
		expect(audio.ctx.createdMediaSources[0].mediaElement).toBe(music.el);
		// First track is hiphop.mp3, playing, at the full bed gain.
		expect(music.el.src.endsWith('/club/audio/hiphop.mp3')).toBe(true);
		expect(music.el.paused).toBe(false);
		expect(music.gain.gain.value).toBeCloseTo(0.85, 3);
		// Full tracks stream — they must never be decoded into a buffer.
		expect(audio.ctx.decodedBuffers).toHaveLength(0);
	});

	it('loops the sequence hiphop → pole → hiphop on each `ended`', async () => {
		const audio = new ClubAudio();
		await audio.startMusic();
		const el = audio.music.el;

		expect(el.src.endsWith('/club/audio/hiphop.mp3')).toBe(true);

		el._emit('ended');
		expect(el.src.endsWith('/club/audio/pole.mp3')).toBe(true);
		expect(audio.music.index).toBe(1);

		el._emit('ended');
		expect(el.src.endsWith('/club/audio/hiphop.mp3')).toBe(true);
		expect(audio.music.index).toBe(0);
	});

	it('retries on the same element after an autoplay rejection (no second graph)', async () => {
		audioPlayBehavior = 'reject-first';
		const audio = new ClubAudio();

		await expect(audio.startMusic()).rejects.toThrow();
		// The graph is wired even though the first play() was blocked.
		expect(audio.music).toBeTruthy();
		const firstEl = audio.music.el;

		// Second call (a user gesture) resumes the same element, not a new graph.
		await audio.startMusic();
		expect(audio.music.el).toBe(firstEl);
		expect(audio.music.el.paused).toBe(false);
		expect(audio.ctx.createdMediaSources).toHaveLength(1);
	});

	it('a tipped style loop ducks the music bed and fadeOutStyle restores it', async () => {
		const audio = new ClubAudio();
		await audio.startMusic();

		audio.ctx.currentTime = 4;
		await audio.fadeToStyle('rumba', 800);
		const duckRamp = audio.music.gain.gain._lastRamp();
		expect(duckRamp.value).toBeCloseTo(0.18, 3);
		expect(duckRamp.time).toBeCloseTo(4.8, 3);

		audio.ctx.currentTime = 10;
		await audio.fadeOutStyle(800);
		const restoreRamp = audio.music.gain.gain._lastRamp();
		expect(restoreRamp.value).toBeCloseTo(0.85, 3);
		expect(restoreRamp.time).toBeCloseTo(10.8, 3);
	});

	it('mute pauses the streaming element and unmute resumes it', async () => {
		const audio = new ClubAudio();
		await audio.startMusic();
		expect(audio.music.el.paused).toBe(false);

		audio.setMuted(true);
		expect(audio.music.el.paused).toBe(true);

		audio.setMuted(false);
		expect(audio.music.el.paused).toBe(false);
	});
});

describe('ClubAudio.fadeToStyle', () => {
	it('crossfades ambience down to 0.1 and style up to 0.75', async () => {
		const audio = new ClubAudio();
		await audio.startAmbience();

		const duration = 800;
		audio.ctx.currentTime = 10;
		await audio.fadeToStyle('rumba', duration);

		expect(audio.style).toBeTruthy();
		expect(audio.style.name).toBe('rumba');
		expect(audio.style.source.loop).toBe(true);
		expect(audio.style.source.started).toBe(true);

		// Style layer ramps from 0 to 0.75 over 0.8s.
		const styleRamp = audio.style.gain.gain._lastRamp();
		expect(styleRamp).toBeTruthy();
		expect(styleRamp.value).toBeCloseTo(0.75, 3);
		expect(styleRamp.time).toBeCloseTo(10 + duration / 1000, 3);

		// Ambience layer ramps down to 0.1 over the same window.
		const ambienceRamp = audio.ambience.gain.gain._lastRamp();
		expect(ambienceRamp).toBeTruthy();
		expect(ambienceRamp.value).toBeCloseTo(0.1, 3);
		expect(ambienceRamp.time).toBeCloseTo(10 + duration / 1000, 3);
	});

	it('replacing an active style track fades the previous one out', async () => {
		const audio = new ClubAudio();
		await audio.startAmbience();
		await audio.fadeToStyle('rumba');
		const oldStyleGain = audio.style.gain;

		await audio.fadeToStyle('thriller');

		expect(audio.style.name).toBe('thriller');
		const oldRamp = oldStyleGain.gain._lastRamp();
		// Old style ramps to 0.
		expect(oldRamp).toBeTruthy();
		expect(oldRamp.value).toBeCloseTo(0, 3);
	});
});

describe('ClubAudio.fadeOutStyle', () => {
	it('ramps the active style to 0 and ambience back to 0.35', async () => {
		const audio = new ClubAudio();
		await audio.startAmbience();
		await audio.fadeToStyle('hiphop');

		const styleGain = audio.style.gain;
		audio.ctx.currentTime = 20;
		await audio.fadeOutStyle(800);

		expect(audio.style).toBeNull();

		const styleRamp = styleGain.gain._lastRamp();
		expect(styleRamp.value).toBeCloseTo(0, 3);
		expect(styleRamp.time).toBeCloseTo(20.8, 3);

		const ambienceRamp = audio.ambience.gain.gain._lastRamp();
		expect(ambienceRamp.value).toBeCloseTo(0.35, 3);
		expect(ambienceRamp.time).toBeCloseTo(20.8, 3);
	});

	it('no-ops cleanly when no context has been created', async () => {
		const audio = new ClubAudio();
		await expect(audio.fadeOutStyle()).resolves.toBeUndefined();
	});
});

describe('ClubAudio.setMuted', () => {
	it('ramps the master gain to 0 and back to 0.75 over 0.15s', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();

		audio.ctx.currentTime = 5;
		audio.setMuted(true);

		const muteRamp = audio.master.gain._lastRamp();
		expect(muteRamp).toBeTruthy();
		expect(muteRamp.value).toBeCloseTo(0, 3);
		expect(muteRamp.time).toBeCloseTo(5.15, 3);
		expect(audio.muted).toBe(true);

		audio.ctx.currentTime = 6;
		audio.setMuted(false);
		const unmuteRamp = audio.master.gain._lastRamp();
		expect(unmuteRamp.value).toBeCloseTo(0.75, 3);
		expect(unmuteRamp.time).toBeCloseTo(6.15, 3);
		expect(audio.muted).toBe(false);
	});

	it('persists mute preference to localStorage', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		audio.setMuted(true);
		expect(globalThis.localStorage.getItem('club.audio.muted')).toBe('1');
		audio.setMuted(false);
		expect(globalThis.localStorage.getItem('club.audio.muted')).toBe('0');
	});

	it('reads persisted mute preference on construction', () => {
		globalThis.localStorage.setItem('club.audio.muted', '1');
		const audio = new ClubAudio();
		expect(audio.muted).toBe(true);
	});
});

describe('ClubAudio.setClarity', () => {
	it('snaps to the outdoor endpoints at clarity 0', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		audio.setClarity(0);
		expect(audio._fx.lowpass.frequency.value).toBeCloseTo(420, 0);
		expect(audio._fx.bass.gain.value).toBeCloseTo(10, 3);
		expect(audio._fx.dry.gain.value).toBeCloseTo(0.22, 3);
		expect(audio._fx.outdoorWet.gain.value).toBeCloseTo(0.85, 3);
		expect(audio._fx.indoorWet.gain.value).toBeCloseTo(0.0, 3);
	});

	it('snaps to the indoor endpoints at clarity 1', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		audio.setClarity(1);
		expect(audio._fx.lowpass.frequency.value).toBeCloseTo(17000, 0);
		expect(audio._fx.bass.gain.value).toBeCloseTo(5, 3);
		expect(audio._fx.dry.gain.value).toBeCloseTo(0.65, 3);
		expect(audio._fx.outdoorWet.gain.value).toBeCloseTo(0.0, 3);
		expect(audio._fx.indoorWet.gain.value).toBeCloseTo(0.28, 3);
	});

	it('produces a real in-between mix at partial clarity', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		audio.setClarity(0.5);
		// Linearly-interpolated params sit between the two endpoints.
		expect(audio._fx.bass.gain.value).toBeCloseTo(7.5, 3);
		expect(audio._fx.dry.gain.value).toBeCloseTo(0.435, 3);
		expect(audio._fx.outdoorWet.gain.value).toBeCloseTo(0.425, 3);
		expect(audio._fx.indoorWet.gain.value).toBeCloseTo(0.14, 3);
		// Cutoff is geometric, so the midpoint is the geometric mean (~2672 Hz),
		// far below the linear midpoint of ~8710 Hz.
		expect(audio._fx.lowpass.frequency.value).toBeGreaterThan(2000);
		expect(audio._fx.lowpass.frequency.value).toBeLessThan(3500);
	});

	it('clamps out-of-range and non-finite input', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		audio.setClarity(5);
		expect(audio._clarity).toBe(1);
		audio.setClarity(-2);
		expect(audio._clarity).toBe(0);
		audio.setClarity(NaN);
		expect(audio._clarity).toBe(0);
	});

	it('setLocation delegates to the clarity extremes', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		audio.setLocation(true);
		expect(audio._clarity).toBe(1);
		audio.setLocation(false);
		expect(audio._clarity).toBe(0);
	});

	it('no-ops cleanly before the context exists', () => {
		const audio = new ClubAudio();
		expect(() => audio.setClarity(0.5)).not.toThrow();
		expect(() => audio.setLocation(true)).not.toThrow();
	});
});

describe('ClubAudio 8D spatial orbit', () => {
	it('builds an HRTF panner the whole mix funnels through, parked dead ahead', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		expect(audio.ctx.createdPanners).toHaveLength(1);
		expect(audio._panner.panningModel).toBe('HRTF');
		// rolloff 0 keeps loudness constant as the image orbits.
		expect(audio._panner.rolloffFactor).toBe(0);
		// Parked straight ahead (-Z) until the orbit drives it.
		expect(audio._panner.positionX.value).toBeCloseTo(0, 6);
		expect(audio._panner.positionZ.value).toBeCloseTo(-1, 6);
		// Listener sits at the origin facing into the screen.
		expect(audio.ctx.listener.forwardZ.value).toBeCloseTo(-1, 6);
		// The dry + both reverb tails route into the panner, not straight to master.
		expect(audio._fx.dry._connections).toContain(audio.spatialIn);
		expect(audio._fx.outdoorWet._connections).toContain(audio.spatialIn);
		expect(audio._fx.indoorWet._connections).toContain(audio.spatialIn);
		expect(audio.spatialIn._connections).toContain(audio._panner);
		expect(audio._panner._connections).toContain(audio.master);
	});

	it('is off by default and spin8D is a no-op until enabled', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		expect(audio.is8D()).toBe(false);
		audio.spin8D(3.2);
		// Still parked dead ahead — nothing moved.
		expect(audio._panner.positionX.value).toBeCloseTo(0, 6);
		expect(audio._panner.positionZ.value).toBeCloseTo(-1, 6);
	});

	it('orbits the source around the head once enabled', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		audio.set8D(true);
		expect(audio.is8D()).toBe(true);

		// t=0 → straight ahead (sin0=0, -cos0=-1).
		audio.spin8D(0);
		expect(audio._panner.positionX.value).toBeCloseTo(0, 6);
		expect(audio._panner.positionZ.value).toBeCloseTo(-1, 6);

		// A quarter lap (speed 0.125 rps → 2s) swings the source hard right (+X).
		audio.spin8D(2);
		expect(audio._panner.positionX.value).toBeCloseTo(1, 5);
		expect(audio._panner.positionZ.value).toBeCloseTo(0, 5);

		// Half a lap (4s) puts it directly behind (+Z).
		audio.spin8D(4);
		expect(audio._panner.positionZ.value).toBeCloseTo(1, 5);
	});

	it('recentres the image to dead ahead when turned off', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		audio.set8D(true);
		audio.spin8D(2); // swing it off to one side
		expect(audio._panner.positionX.value).toBeCloseTo(1, 5);
		audio.set8D(false);
		expect(audio._panner.positionX.value).toBeCloseTo(0, 6);
		expect(audio._panner.positionZ.value).toBeCloseTo(-1, 6);
	});

	it('persists the 8D preference and reads it on construction', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		audio.set8D(true);
		expect(globalThis.localStorage.getItem('club.audio.spatial')).toBe('1');

		const reloaded = new ClubAudio();
		expect(reloaded.is8D()).toBe(true);
	});

	it('no-ops cleanly before the context exists', () => {
		const audio = new ClubAudio();
		expect(() => audio.spin8D(1)).not.toThrow();
		// set8D persists the flag even with no graph yet.
		expect(audio.set8D(true)).toBe(true);
		expect(audio.is8D()).toBe(true);
	});
});

describe('ClubAudio.getPeak', () => {
	it('returns 0 before the context is created', () => {
		const audio = new ClubAudio();
		expect(audio.getPeak()).toBe(0);
	});

	it('returns a normalised 0..1 reading once the analyser exists', async () => {
		const audio = new ClubAudio();
		await audio.ensureContext();
		const peak = audio.getPeak();
		// FakeAnalyserNode fills the buffer with 128 → expected peak ~ 128/255.
		expect(peak).toBeGreaterThan(0.4);
		expect(peak).toBeLessThanOrEqual(1);
	});
});

describe('styleAudioFor', () => {
	it('maps known dance keys to tracks', async () => {
		const { styleAudioFor } = await import('../src/club-audio.js');
		expect(styleAudioFor('rumba')).toBe('rumba');
		expect(styleAudioFor('silly')).toBe('silly');
		expect(styleAudioFor('thriller')).toBe('thriller');
		expect(styleAudioFor('capoeira')).toBe('capoeira');
		expect(styleAudioFor('hiphop')).toBe('hiphop');
		expect(styleAudioFor('spin')).toBe('pole');
		expect(styleAudioFor('climb')).toBe('pole');
		expect(styleAudioFor('combo')).toBe('pole');
	});

	it('returns null for unknown dances', async () => {
		const { styleAudioFor } = await import('../src/club-audio.js');
		expect(styleAudioFor('breakdance')).toBeNull();
		expect(styleAudioFor('')).toBeNull();
		expect(styleAudioFor(null)).toBeNull();
	});
});

describe('Audio fetch fallback', () => {
	it('falls back from .ogg to .mp3 when the ogg fetch fails', async () => {
		const calls = [];
		globalThis.fetch = vi.fn(async (url) => {
			calls.push(url);
			if (url.endsWith('.ogg'))
				return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
			return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
		});
		const audio = new ClubAudio();
		await audio.startAmbience();
		expect(calls.some((u) => u.endsWith('ambience.ogg'))).toBe(true);
		expect(calls.some((u) => u.endsWith('ambience.mp3'))).toBe(true);
		expect(audio.ambience).toBeTruthy();
	});
});
