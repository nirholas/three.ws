// Browser-side helpers of the digital human: the clock that lays Audio2Face
// frames onto streamed audio, the push-to-talk noise gate, and the viseme
// timeline behind the browser-voice fallback.

import { describe, it, expect } from 'vitest';
import { SegmentClock } from '../src/voice/stream-speech-player.js';
import { gateUtterance, encodeWav, decodeWav } from '../src/voice/utterance-gate.js';
import { textToVisemes, sampleVisemes, timeAtChar } from '../src/voice/viseme-fallback.js';

describe('SegmentClock', () => {
	it('maps contiguous chunks linearly', () => {
		const c = new SegmentClock();
		c.schedule(2, 0.5);
		c.schedule(2.5, 0.5);
		expect(c.pieces).toHaveLength(1);
		expect(c.toTurn(0.75)).toBeCloseTo(2.75);
		expect(c.turnEnd).toBeCloseTo(3);
	});

	it('shifts frames after a stall gap by exactly the gap', () => {
		const c = new SegmentClock();
		c.schedule(1, 0.4); // audio 0..0.4 at turn 1..1.4
		c.schedule(2, 0.4); // stall: audio 0.4..0.8 at turn 2..2.4
		expect(c.toTurn(0.2)).toBeCloseTo(1.2);
		expect(c.toTurn(0.5)).toBeCloseTo(2.1);
		expect(c.turnEnd).toBeCloseTo(2.4);
	});

	it('returns null before any audio was scheduled', () => {
		expect(new SegmentClock().toTurn(0)).toBe(null);
	});
});

function noise(n, amp, seed = 7) {
	let s = seed;
	const out = new Int16Array(n);
	for (let i = 0; i < n; i++) {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		out[i] = Math.round(((s / 0x7fffffff) * 2 - 1) * amp);
	}
	return out;
}

describe('gateUtterance', () => {
	const rate = 16000;

	it('trims crowd noise around the words and keeps the speech', () => {
		const lead = noise(rate * 0.6, 300);
		const speech = new Int16Array(rate * 0.8);
		for (let i = 0; i < speech.length; i++)
			speech[i] = Math.round(Math.sin(i / 6) * 9000) + lead[i % lead.length];
		const tail = noise(rate * 0.5, 300, 11);
		const all = new Int16Array(lead.length + speech.length + tail.length);
		all.set(lead, 0);
		all.set(speech, lead.length);
		all.set(tail, lead.length + speech.length);
		const g = gateUtterance(all, rate);
		expect(g.ok).toBe(true);
		expect(g.speechMs).toBeGreaterThanOrEqual(760);
		// Kept the speech plus padding, dropped most of the 1.1 s of noise.
		expect(g.samples.length / rate).toBeGreaterThan(0.8);
		expect(g.samples.length / rate).toBeLessThan(1.25);
		expect(g.trimmedMs).toBeGreaterThan(600);
	});

	it('rejects a press that holds only room noise', () => {
		const g = gateUtterance(noise(rate, 250), rate);
		expect(g.ok).toBe(false);
		expect(g.reason).toBe('no_speech');
	});

	it('rejects a click shorter than a syllable', () => {
		const all = noise(rate, 100);
		for (let i = 4000; i < 4000 + 1600; i++) all[i] = 12000 * Math.sign(Math.sin(i));
		const g = gateUtterance(all, rate);
		expect(g.ok).toBe(false);
		expect(g.reason).toBe('too_short');
	});
});

describe('WAV encode/decode', () => {
	it('round-trips mono 16-bit PCM', () => {
		const s = Int16Array.from([0, 1000, -1000, 32767, -32768]);
		const back = decodeWav(encodeWav(s, 22050));
		expect(back.sampleRate).toBe(22050);
		expect(Array.from(back.samples)).toEqual(Array.from(s));
	});
});

describe('viseme timeline', () => {
	it('opens for vowels, closes for m/b/p and rests at the end', () => {
		const tl = textToVisemes('mama');
		expect(tl.keys[0].open).toBe(0);
		expect(tl.keys[1].open).toBeGreaterThan(0.5);
		expect(tl.keys.at(-1).open).toBe(0);
		expect(tl.duration).toBeGreaterThan(0.2);
	});

	it('pauses longer on sentence ends and scales with rate', () => {
		expect(textToVisemes('Hi. There').duration).toBeGreaterThan(
			textToVisemes('Hi, There').duration,
		);
		expect(textToVisemes('hello', { rate: 2 }).duration).toBeCloseTo(
			textToVisemes('hello').duration / 2,
		);
	});

	it('resyncs by character index for boundary events', () => {
		const tl = textToVisemes('hello world');
		const t = timeAtChar(tl, 6);
		expect(t).toBeGreaterThan(0);
		expect(sampleVisemes(tl, t + 0.001).round).toBeGreaterThan(0); // the "wo" of world
	});
});
