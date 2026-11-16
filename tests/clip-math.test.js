// Frame timing and audio sync math for talking-avatar clips
// (src/clip/clip-math.js). The renderer draws frame i at i / fps, poses the face
// from the Audio2Face-3D track at i / fps - leadIn, and places the speech audio
// at leadIn, so these identities are what keep lips and audio within a frame.

import { describe, it, expect } from 'vitest';
import {
	CLIP_FPS,
	LEAD_IN_SEC,
	TAIL_SEC,
	ASPECTS,
	clipTimeline,
	frameTime,
	frameDuration,
	speechTimeForFrame,
	audioOffsetSamples,
	audioLengthSamples,
	floatToPcm16,
	rmsEnvelope,
	voicedSpan,
	captionCues,
	cueAt,
	cameraDistanceForHeight,
	framingSpan,
	bestLag,
	clipFileName,
} from '../src/clip/clip-math.js';

describe('clip timeline', () => {
	it('covers lead-in, speech and tail with a whole number of frames', () => {
		const t = clipTimeline(2.5);
		expect(t.fps).toBe(CLIP_FPS);
		expect(t.leadIn).toBe(LEAD_IN_SEC);
		expect(t.tail).toBe(TAIL_SEC);
		expect(t.frameCount).toBe(Math.ceil((LEAD_IN_SEC + 2.5 + TAIL_SEC) * 30));
		expect(t.durationSec).toBeCloseTo(t.frameCount / 30, 12);
		expect(t.durationSec).toBeGreaterThanOrEqual(LEAD_IN_SEC + 2.5 + TAIL_SEC - 1e-9);
	});

	it('does not add a spurious frame when the length is already frame-aligned', () => {
		// 0.3 + 2.1 + 0.6 = 3.0 s exactly: 90 frames, not 91 from float noise.
		expect(clipTimeline(2.1).frameCount).toBe(90);
	});

	it('never drops below one frame and treats bad input as silence', () => {
		expect(clipTimeline(0, { leadIn: 0, tail: 0 }).frameCount).toBe(1);
		expect(clipTimeline(Number.NaN).frameCount).toBe(Math.ceil((LEAD_IN_SEC + TAIL_SEC) * 30));
		expect(clipTimeline(-4).frameCount).toBe(clipTimeline(0).frameCount);
	});

	it('honours a custom frame rate', () => {
		const t = clipTimeline(1, { fps: 60, leadIn: 0, tail: 0 });
		expect(t.frameCount).toBe(60);
		expect(frameDuration(60)).toBeCloseTo(1 / 60, 12);
	});
});

describe('frame and speech times', () => {
	const t = clipTimeline(3);

	it('places frame i at i / fps', () => {
		expect(frameTime(0)).toBe(0);
		expect(frameTime(30)).toBe(1);
		expect(frameTime(45)).toBeCloseTo(1.5, 12);
	});

	it('samples the face at the speech-relative time of each frame', () => {
		expect(speechTimeForFrame(0, t)).toBeCloseTo(-LEAD_IN_SEC, 12);
		expect(speechTimeForFrame(9, t)).toBeCloseTo(0, 12); // 9 / 30 = 0.3 s = lead-in
		expect(speechTimeForFrame(39, t)).toBeCloseTo(1, 12);
	});

	it('lines frame times up with the audio sample where the speech starts', () => {
		for (const rate of [16000, 44100, 48000]) {
			const offset = audioOffsetSamples(t, rate);
			expect(offset).toBe(Math.round(LEAD_IN_SEC * rate));
			// The frame whose speech time is 0 is drawn at exactly offset / rate.
			const firstSpeechFrame = Math.round(LEAD_IN_SEC * t.fps);
			expect(Math.abs(frameTime(firstSpeechFrame, t.fps) - offset / rate)).toBeLessThan(1 / rate);
			// Any speech time maps to an output time inside the same frame.
			for (const s of [0.01, 0.5, 1.234, 2.99]) {
				const outSec = (offset + Math.round(s * rate)) / rate;
				const frame = Math.floor(outSec * t.fps + 1e-9);
				expect(Math.abs(speechTimeForFrame(frame, t) - s)).toBeLessThan(1 / t.fps);
			}
		}
	});

	it('sizes the audio track to the video duration', () => {
		expect(audioLengthSamples(t, 48000)).toBe(Math.round(t.durationSec * 48000));
		expect(audioLengthSamples(t, 48000) / 48000).toBeCloseTo(t.frameCount / t.fps, 4);
	});
});

describe('aspect presets', () => {
	it('exports portrait 1080x1920 and landscape 1920x1080', () => {
		expect(ASPECTS.portrait).toMatchObject({ width: 1080, height: 1920 });
		expect(ASPECTS.landscape).toMatchObject({ width: 1920, height: 1080 });
	});
});

describe('pcm and envelopes', () => {
	it('converts floats to clamped little-endian s16', () => {
		const bytes = floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
		const v = new Int16Array(bytes.buffer);
		expect(Array.from(v)).toEqual([0, 32767, -32767, 32767, -32768, 16384]);
	});

	it('computes one RMS value per video frame window', () => {
		const rate = 3000;
		const s = new Float32Array(rate); // 1 s
		for (let i = 1500; i < 2000; i++) s[i] = 0.5;
		const env = rmsEnvelope(s, rate, 30);
		expect(env.length).toBe(30);
		expect(env[0]).toBe(0);
		expect(env[16]).toBeCloseTo(0.5, 6); // window [1600, 1700)
	});

	it('finds the voiced span of a line padded with silence', () => {
		const rate = 3000;
		const s = new Float32Array(rate * 2);
		for (let i = 1500; i < 4500; i++) s[i] = Math.sin(i) * 0.6;
		const span = voicedSpan(s, rate, { fps: 30 });
		expect(span.start).toBeCloseTo(0.5, 1);
		expect(span.end).toBeCloseTo(1.5, 1);
	});

	it('treats an all-silent buffer as the whole span', () => {
		expect(voicedSpan(new Float32Array(3000), 3000)).toEqual({ start: 0, end: 1 });
	});
});

describe('captions', () => {
	it('breaks at the character limit and after sentences, timing cues across the span', () => {
		const cues = captionCues('Hello there. This line is long enough that it has to wrap across cues.', { start: 0.2, end: 4.2 });
		expect(cues[0].text).toBe('Hello there.');
		for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(34);
		expect(cues[0].start).toBeCloseTo(0.2, 9);
		expect(cues.at(-1).end).toBeCloseTo(4.2, 9);
		for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeCloseTo(cues[i - 1].end, 9);
	});

	it('returns no cues for empty text and finds the active cue', () => {
		expect(captionCues('  ', { start: 0, end: 1 })).toEqual([]);
		const cues = captionCues('One. Two.', { start: 0, end: 1 });
		expect(cueAt(cues, 0.1).text).toBe('One.');
		expect(cueAt(cues, 0.9).text).toBe('Two.');
		expect(cueAt(cues, 1.5)).toBeNull();
		expect(cueAt(cues, -0.1)).toBeNull();
	});
});

describe('framing', () => {
	it('backs the camera off so the span fills the requested fraction', () => {
		// fov 90deg: half-height = distance, so a 1 m span at fill 0.5 needs 1 m.
		expect(cameraDistanceForHeight(1, 90, 0.5)).toBeCloseTo(1, 9);
		expect(cameraDistanceForHeight(2, 24, 0.8)).toBeGreaterThan(cameraDistanceForHeight(1, 24, 0.8));
	});

	it('frames tighter spans for closer presets', () => {
		const m = { floorY: 0, topY: 1.8, headY: 1.68 };
		const h = (f) => framingSpan(f, m).high - framingSpan(f, m).low;
		expect(h('face')).toBeLessThan(h('bust'));
		expect(h('bust')).toBeLessThan(h('full'));
		expect(framingSpan('full', m).low).toBe(0);
		expect(framingSpan('face', m).high).toBeGreaterThan(m.topY);
	});
});

describe('lag measurement', () => {
	it('recovers a known delay between two signals', () => {
		const a = Array.from({ length: 200 }, (_, i) => Math.sin(i * 0.37) + Math.sin(i * 0.11));
		const b = a.map((_, i) => (i >= 3 ? a[i - 3] : 0)); // b trails a by 3
		expect(bestLag(a, b, 10)).toMatchObject({ lag: 3 });
		expect(bestLag(b, a, 10)).toMatchObject({ lag: -3 });
		expect(bestLag(a, a, 10).lag).toBe(0);
		expect(bestLag(a, a, 10).score).toBeCloseTo(1, 9);
	});
});

describe('file names', () => {
	it('slugs the agent name and appends the aspect', () => {
		expect(clipFileName('Nova Prime!', 'portrait')).toBe('nova-prime-clip-portrait.mp4');
		expect(clipFileName('Zoë', 'landscape')).toBe('zoe-clip-landscape.mp4');
		expect(clipFileName('', 'portrait')).toBe('avatar-clip-portrait.mp4');
		expect(clipFileName('***', 'portrait')).toBe('avatar-clip-portrait.mp4');
	});
});
