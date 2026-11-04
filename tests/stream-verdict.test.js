import { describe, it, expect } from 'vitest';
import { describeVerdict } from '../src/stream-verdict.js';

const kb = (n) => `${n} B`;
const run = (c, s) => describeVerdict({ firstFrameMs: c, bytes: 800 }, { firstFrameMs: s, baseBytes: 80 }, kb);

describe('describeVerdict', () => {
	it('says faster only when the stream was faster', () => {
		expect(run(1400, 1000)).toMatch(/^1\.4x faster/);
	});
	it('says slower, never "0.5x faster", when the stream took longer', () => {
		const text = run(500, 1000);
		expect(text).toMatch(/^2\.0x slower/);
		expect(text).not.toMatch(/faster/);
	});
	it('calls near-equal times the same', () => {
		expect(run(1000, 1010)).toMatch(/^About the same/);
	});
	it('does not print NaN for unusable timings', () => {
		expect(run(0, 0)).not.toMatch(/NaN|Infinity/);
	});
});
