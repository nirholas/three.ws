import { describe, it, expect } from 'vitest';
import { maxQuatNormError, analyseClip, median, renderTable, PROMPTS } from '../workers/model-text2motion/scripts/benchmark-momask.mjs';

const s = Math.SQRT1_2;
describe('momask benchmark helpers', () => {
	it('measures deviation from unit length', () => {
		expect(maxQuatNormError([0, 0, 0, 1, s, 0, 0, s])).toBeLessThan(1e-12);
		expect(maxQuatNormError([0, 0, 0, 2])).toBeCloseTo(1, 12);
	});
	it('analyses an AnimationClip document', () => {
		const clip = { tracks: [
			{ name: 'Hips.quaternion', type: 'quaternion', times: [0, 1, 2], values: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
			{ name: 'Hips.position', type: 'vector', times: [0, 1, 2], values: [0, 0, 0, 0, 1, 0, 0, 2, 0] },
		] };
		expect(analyseClip(clip)).toMatchObject({ tracks: 2, quatTracks: 1, frames: 3, unitNorm: true });
	});
	it('flags a non-unit quaternion track and an empty clip', () => {
		expect(analyseClip({ tracks: [{ type: 'quaternion', times: [0], values: [0, 0, 0, 1.5] }] }).unitNorm).toBe(false);
		expect(analyseClip({}).unitNorm).toBe(false);
	});
	it('takes the median', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([1, 2, 3, 4])).toBe(2.5);
		expect(median([])).toBeNull();
	});
	it('renders one row per result', () => {
		const t = renderTable([{ model: 'momask', prompt: PROMPTS[0], frames: 90, quatTracks: 22, unitNorm: true, worstNormError: 0, coldMs: 9000, warmMs: 2700 }]);
		expect(t.split('\n')).toHaveLength(3);
		expect(t).toContain('momask');
	});
});
