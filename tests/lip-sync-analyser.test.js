/**
 * LipSyncAnalyser — unit tests
 *
 * Validates the spectral analyser without WebAudio by injecting a fake
 * AnalyserNode whose `getByteFrequencyData()` writes a deterministic
 * frequency spectrum.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// LipSyncAnalyser does an `instanceof AnalyserNode` check on input. Node has
// no WebAudio, so we shim the constructor before importing the module under
// test, then the fake instance below extends it so `instanceof` matches.
class FakeAnalyserNode {
	constructor({ binCount = 128, sampleRate = 48000, spectrum = null } = {}) {
		this.fftSize = binCount * 2;
		this.frequencyBinCount = binCount;
		this.smoothingTimeConstant = 0.7;
		this.context = { sampleRate };
		this._spectrum = new Uint8Array(binCount);
		if (spectrum) this.setSpectrum(spectrum);
	}
	/** spectrum: function(i, binHz) -> 0..255  or  Uint8Array */
	setSpectrum(spectrum) {
		if (spectrum instanceof Uint8Array) {
			this._spectrum.set(spectrum.subarray(0, this._spectrum.length));
			return;
		}
		const binHz = this.context.sampleRate / this.fftSize;
		for (let i = 0; i < this._spectrum.length; i++) {
			const v = spectrum(i, binHz);
			this._spectrum[i] = Math.max(0, Math.min(255, v | 0));
		}
	}
	getByteFrequencyData(buf) {
		buf.set(this._spectrum);
	}
}

let LipSyncAnalyser;

beforeAll(async () => {
	globalThis.AnalyserNode = FakeAnalyserNode;
	const mod = await import('../src/lip-sync-analyser.js');
	LipSyncAnalyser = mod.LipSyncAnalyser;
});

const VISEME_NAMES = [
	'viseme_aa', 'viseme_O', 'viseme_E', 'viseme_I', 'viseme_nn',
	'viseme_SS', 'viseme_FF', 'viseme_CH', 'viseme_PP',
];

function makeBand(level, lowHz, highHz) {
	return (i, binHz) => {
		const f = i * binHz;
		return f >= lowHz && f < highHz ? level : 0;
	};
}

describe('LipSyncAnalyser', () => {
	let analyser;
	beforeEach(() => {
		analyser = new LipSyncAnalyser();
	});

	it('returns null when not connected', () => {
		expect(analyser.sample()).toBeNull();
	});

	it('returns null after disconnect', () => {
		const fake = new FakeAnalyserNode({ spectrum: () => 200 });
		analyser.connect(fake);
		expect(analyser.sample()).not.toBeNull();
		analyser.disconnect();
		expect(analyser.sample()).toBeNull();
	});

	it('emits all 9 viseme keys with numeric weights once connected', () => {
		const fake = new FakeAnalyserNode({ spectrum: () => 200 });
		analyser.connect(fake);
		const out = analyser.sample();
		expect(out).not.toBeNull();
		for (const k of VISEME_NAMES) {
			expect(out).toHaveProperty(k);
			expect(typeof out[k]).toBe('number');
			expect(Number.isFinite(out[k])).toBe(true);
			expect(out[k]).toBeGreaterThanOrEqual(0);
		}
	});

	it('low-frequency energy biases open-vowel visemes (aa, O) over sibilants (SS, FF)', () => {
		const fake = new FakeAnalyserNode({ spectrum: makeBand(220, 0, 500) });
		analyser.connect(fake);
		// Run several samples so the EMA settles toward the target.
		let out;
		for (let i = 0; i < 40; i++) out = analyser.sample();
		expect(out.viseme_aa).toBeGreaterThan(out.viseme_SS);
		expect(out.viseme_aa).toBeGreaterThan(out.viseme_FF);
		expect(out.viseme_O).toBeGreaterThan(out.viseme_SS);
	});

	it('high-frequency energy biases sibilant/fricative visemes (SS, FF, CH) over open vowels', () => {
		const fake = new FakeAnalyserNode({ spectrum: makeBand(220, 2500, 7500) });
		analyser.connect(fake);
		let out;
		for (let i = 0; i < 40; i++) out = analyser.sample();
		expect(out.viseme_SS).toBeGreaterThan(out.viseme_aa);
		expect(out.viseme_FF).toBeGreaterThan(out.viseme_O);
	});

	it('silence decays all viseme weights toward zero (multiplicative ramp)', () => {
		const fake = new FakeAnalyserNode({ spectrum: makeBand(220, 0, 500) });
		analyser.connect(fake);
		// Warm up to non-trivial weights.
		let warm;
		for (let i = 0; i < 40; i++) warm = analyser.sample();
		const peak = warm.viseme_aa;
		expect(peak).toBeGreaterThan(0.01);

		// Switch to silence — weights should monotonically decay.
		fake.setSpectrum(() => 0);
		let prev = peak;
		for (let i = 0; i < 30; i++) {
			const out = analyser.sample();
			expect(out.viseme_aa).toBeLessThanOrEqual(prev + 1e-9);
			prev = out.viseme_aa;
		}
		expect(prev).toBeLessThan(peak * 0.05);
	});

	it('smooths over multiple frames rather than snapping to the target', () => {
		const fake = new FakeAnalyserNode({ spectrum: makeBand(255, 0, 500) });
		analyser.connect(fake);
		// First non-silent frame: weight rises but is bounded by the EMA factor.
		// Two consecutive samples should be strictly increasing while ramping up.
		const a = analyser.sample().viseme_aa;
		const b = analyser.sample().viseme_aa;
		const c = analyser.sample().viseme_aa;
		expect(b).toBeGreaterThan(a);
		expect(c).toBeGreaterThan(b);
		// And never overshoots a fully-saturated band (low * 0.8 → ≤ 0.8).
		for (let i = 0; i < 60; i++) analyser.sample();
		const stable = analyser.sample().viseme_aa;
		expect(stable).toBeLessThanOrEqual(0.8 + 1e-6);
	});

	it('connect() is idempotent: a second connect releases the first analyser', () => {
		const a = new FakeAnalyserNode({ spectrum: () => 200 });
		const b = new FakeAnalyserNode({ spectrum: () => 200 });
		analyser.connect(a);
		expect(analyser.sample()).not.toBeNull();
		analyser.connect(b);
		// Still working with the new analyser.
		expect(analyser.sample()).not.toBeNull();
	});

	it('connect() with an unsupported input is a no-op (sample() stays null)', () => {
		analyser.connect({ totally: 'not an audio node' });
		expect(analyser.sample()).toBeNull();
	});
});
