/**
 * Generated motion on /pose: keep a travelling motion in view, refuse a clip
 * that cannot play, and play a clip keyed in frames at the right speed.
 *
 * Fixtures are real text2motion output served by production on 2026-11-27,
 * every 4th frame: "a person walks forward in a circle" (as the page received
 * it: travels 5.7 m and ends off camera, then snaps back on every loop) and "a
 * person waves hello with the right hand" (the raw worker output, which the
 * server's conversion turns into a motion that stays in place).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	rootTravel,
	pinRootInPlace,
	IN_PLACE_TRAVEL_M,
	generatedClipProblem,
	normalizeClipTiming,
} from '../src/generated-motion.js';
import { parseClipJSON } from '../src/animation-retarget.js';
import { libraryReadyClip } from '../api/_lib/motion-seed.js';

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const WALK = load('text2motion-walk-clip.json');
const WAVE = load('text2motion-wave-clip.json');

describe('root travel', () => {
	it('measures how far a walk carries the body from where it started', () => {
		expect(rootTravel(WALK)).toBeGreaterThan(5);
		expect(rootTravel(WALK)).toBeGreaterThan(IN_PLACE_TRAVEL_M);
	});

	it('reads a wave, as the server hands it to the page, as staying put', () => {
		expect(rootTravel(libraryReadyClip(WAVE))).toBeLessThan(IN_PLACE_TRAVEL_M);
	});

	it('pins a walk in place without touching its height or its rotations', () => {
		const clip = parseClipJSON(WALK, 'walk');
		const pinned = pinRootInPlace(clip);
		expect(rootTravel(pinned)).toBeLessThan(1e-6);
		const before = clip.tracks.find((t) => t.name === 'Hips.position').values;
		const after = pinned.tracks.find((t) => t.name === 'Hips.position').values;
		for (let i = 1; i < before.length; i += 3) expect(after[i]).toBe(before[i]);
		const q0 = clip.tracks.find((t) => t.name === 'Hips.quaternion').values;
		const q1 = pinned.tracks.find((t) => t.name === 'Hips.quaternion').values;
		expect(Array.from(q1)).toEqual(Array.from(q0));
		// The input clip is never mutated: the toggle can turn it back off.
		expect(rootTravel(clip)).toBeGreaterThan(5);
	});

	it('leaves a clip with no root track as it is', () => {
		const clip = { duration: 1, tracks: [{ name: 'Spine.quaternion', times: [0, 1], values: [0, 0, 0, 1, 0, 0, 0, 1] }] };
		expect(rootTravel(clip)).toBe(0);
		expect(pinRootInPlace(clip)).toBe(clip);
	});
});

describe('generatedClipProblem', () => {
	it('accepts real generated clips', () => {
		expect(generatedClipProblem(WALK)).toBeNull();
		expect(generatedClipProblem(WAVE)).toBeNull();
	});

	it('refuses a clip with no tracks', () => {
		expect(generatedClipProblem({ duration: 4, tracks: [] })).toMatch(/no motion/i);
		expect(generatedClipProblem(null)).toMatch(/no motion/i);
	});

	it('refuses a zero-length clip', () => {
		const one = { name: 'Hips.quaternion', type: 'quaternion', times: [0], values: [0, 0, 0, 1] };
		expect(generatedClipProblem({ duration: 0, tracks: [one] })).toMatch(/too short/i);
	});

	it('refuses a clip that moves no bones', () => {
		const pos = { name: 'Hips.position', type: 'vector', times: [0, 1], values: [0, 1, 0, 0, 1, 0] };
		expect(generatedClipProblem({ duration: 1, tracks: [pos] })).toMatch(/no bone rotations/i);
	});

	it('refuses a clip carrying NaN', () => {
		const bad = { name: 'Hips.quaternion', type: 'quaternion', times: [0, 1], values: [0, 0, 0, 1, NaN, 0, 0, 1] };
		expect(generatedClipProblem({ duration: 1, tracks: [bad] })).toMatch(/broken values/i);
	});
});

describe('normalizeClipTiming', () => {
	it('leaves a clip already keyed in seconds untouched', () => {
		expect(normalizeClipTiming(WALK, { fps: 30, frames: 30 })).toBe(WALK);
	});

	it('rescales a clip keyed in frame numbers to seconds at the reported rate', () => {
		const frames = 120;
		const times = Array.from({ length: frames }, (_, i) => i);
		const clip = {
			name: 'frames',
			duration: frames - 1,
			tracks: [{ name: 'Hips.quaternion', type: 'quaternion', times, values: times.flatMap(() => [0, 0, 0, 1]) }],
		};
		const fixed = normalizeClipTiming(clip, { fps: 30, frames });
		expect(fixed.duration).toBeCloseTo(119 / 30, 6);
		expect(fixed.tracks[0].times[1]).toBeCloseTo(1 / 30, 6);
		expect(fixed.tracks[0].times.at(-1)).toBeCloseTo(119 / 30, 6);
		expect(clip.tracks[0].times[1]).toBe(1);
	});

	it('repairs a duration that cuts the keys short', () => {
		const clip = { ...WAVE, duration: 0 };
		const fixed = normalizeClipTiming(clip, {});
		expect(fixed.duration).toBeCloseTo(WAVE.tracks[0].times.at(-1), 6);
	});
});
