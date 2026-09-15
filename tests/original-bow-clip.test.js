import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Quaternion } from 'three';
import { createBowClip } from '../scripts/build-original-animations.mjs';

const idle = JSON.parse(readFileSync(new URL('../public/animations/clips/idle.json', import.meta.url), 'utf8'));
const committed = JSON.parse(readFileSync(new URL('../public/animations/clips/bow.json', import.meta.url), 'utf8'));

function frame(track, index) {
	return new Quaternion().fromArray(track.values, index * 4);
}

describe('project-authored bow clip', () => {
	it('is reproduced byte-for-byte from its committed generator', () => {
		expect(createBowClip(idle)).toEqual(committed);
	});

	it('starts and ends neutral, with a sustained torso bow in the middle', () => {
		const torso = ['Spine', 'Spine1', 'Spine2'];
		let peakRadians = 0;
		for (const bone of torso) {
			const track = committed.tracks.find((entry) => entry.name === `${bone}.quaternion`);
			expect(track).toBeTruthy();
			expect(frame(track, 0).angleTo(frame(track, track.times.length - 1))).toBeLessThan(1e-6);
			peakRadians += frame(track, 0).angleTo(frame(track, 2));
		}
		expect(peakRadians * 180 / Math.PI).toBeGreaterThan(40);
	});

	it('is a grounded one-shot rather than a loop or locomotion clip', () => {
		const hips = committed.tracks.find((entry) => entry.name === 'Hips.position');
		expect(committed.duration).toBe(1.8);
		expect(hips.values.at(0)).toBeCloseTo(hips.values.at(-3), 6);
		expect(hips.values.at(2)).toBeCloseTo(hips.values.at(-1), 6);
	});
});
