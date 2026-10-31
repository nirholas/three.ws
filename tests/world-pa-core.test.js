// Presenter PA client core (src/game/world-pa-core.js): resampling to Opus's
// 48 kHz, exact 20 ms framing, and the listener's playout clock.
import { describe, it, expect } from 'vitest';
import {
	LinearResampler, FrameAccumulator, PlayoutClock, paSupport, speakerLabel, formatElapsed, paErrorText,
	PA_FRAME_SAMPLES, PA_JITTER_S,
} from '../src/game/world-pa-core.js';

describe('LinearResampler', () => {
	it('passes a 48 kHz mic straight through', () => {
		const r = new LinearResampler(48000);
		const block = new Float32Array([0.1, 0.2]);
		expect(r.push(block)).toBe(block);
	});

	it('produces the right sample count from 44.1 kHz across many blocks', () => {
		const r = new LinearResampler(44100);
		let out = 0;
		for (let i = 0; i < 441; i++) out += r.push(new Float32Array(128)).length; // 56448 input samples
		expect(Math.abs(out - Math.round((441 * 128 * 48000) / 44100))).toBeLessThanOrEqual(1);
	});

	it('joins blocks without a discontinuity on a ramp', () => {
		const r = new LinearResampler(44100);
		const all = [];
		let v = 0;
		for (let b = 0; b < 8; b++) {
			const block = new Float32Array(128);
			for (let i = 0; i < 128; i++) block[i] = (v++) / 1000;
			all.push(...r.push(block));
		}
		const steps = all.slice(1).map((x, i) => x - all[i]);
		const expected = 44100 / 48000 / 1000;
		// The first two outputs read the zero-initialised history sample; every
		// step after that, including each block boundary, is the exact ramp slope.
		for (const s of steps.slice(2)) expect(s).toBeCloseTo(expected, 6);
	});
});

describe('FrameAccumulator', () => {
	it('emits exact 960-sample frames and carries the remainder', () => {
		const acc = new FrameAccumulator();
		expect(acc.push(new Float32Array(500))).toHaveLength(0);
		const frames = acc.push(new Float32Array(1500)); // 2000 total
		expect(frames).toHaveLength(2);
		expect(frames.every((f) => f.length === PA_FRAME_SAMPLES)).toBe(true);
		expect(acc.fill).toBe(2000 - 2 * PA_FRAME_SAMPLES);
	});

	it('keeps sample order across frame boundaries', () => {
		const acc = new FrameAccumulator(4);
		const frames = acc.push(Float32Array.from([1, 2, 3, 4, 5, 6]));
		const more = acc.push(Float32Array.from([7, 8]));
		expect([...frames[0], ...more[0]]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});
});

describe('PlayoutClock', () => {
	it('starts one jitter buffer ahead and then plays back to back', () => {
		const c = new PlayoutClock();
		expect(c.schedule(10, 0.02)).toBeCloseTo(10 + PA_JITTER_S);
		expect(c.schedule(10.01, 0.02)).toBeCloseTo(10 + PA_JITTER_S + 0.02);
	});

	it('re-buffers after a stall instead of scheduling in the past', () => {
		const c = new PlayoutClock();
		c.schedule(0, 0.02);
		expect(c.schedule(5, 0.02)).toBeCloseTo(5 + PA_JITTER_S);
	});

	it('drops audio once it falls too far behind live', () => {
		const c = new PlayoutClock({ jitter: 0.25, maxLag: 0.5 });
		const starts = [];
		for (let i = 0; i < 30; i++) starts.push(c.schedule(0, 0.02));
		expect(starts.filter((s) => s < 0).length).toBeGreaterThan(0);
		expect(Math.max(...starts)).toBeLessThanOrEqual(0.5);
	});
});

describe('support, labels and copy', () => {
	it('detects WebCodecs audio support', () => {
		const none = paSupport({});
		expect(none).toEqual({ listen: false, speak: false, captions: false });
		function F() {}
		const full = paSupport({
			AudioContext: F, AudioDecoder: F, EncodedAudioChunk: F, AudioEncoder: F, AudioData: F,
			webkitSpeechRecognition: F, navigator: { mediaDevices: { getUserMedia: F } },
		});
		expect(full).toEqual({ listen: true, speak: true, captions: true });
	});

	it('labels roles and formats elapsed time', () => {
		expect(speakerLabel('creator')).toBe('Coin creator');
		expect(speakerLabel('guest-host')).toBe('Guest host');
		expect(speakerLabel('host')).toBe('Host');
		expect(formatElapsed(125000)).toBe('2:05');
	});

	it('names the current speaker when the mic is busy', () => {
		expect(paErrorText('busy', 'Jessica')).toMatch(/^Jessica is on the mic/);
		expect(paErrorText('something-new')).toMatch(/Try again/);
	});
});
