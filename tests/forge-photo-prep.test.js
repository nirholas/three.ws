import { describe, it, expect } from 'vitest';
import {
	MODEL_SIZE,
	THRESHOLDS,
	buildInputTensor,
	normalizeMask,
	analyzeMask,
	maskBoxToImage,
	squareCropPlan,
	laplacianVariance,
	exposureStats,
	assessPhoto,
	decideOnDevice,
} from '../src/forge-photo-prep/core.js';

// A w x h mask with the given rectangles filled at 255.
function maskWith(w, h, rects) {
	const m = new Uint8Array(w * h);
	for (const [x0, y0, x1, y1] of rects) {
		for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 255;
	}
	return m;
}

describe('buildInputTensor', () => {
	it('lays RGBA out as planar NCHW, scaled by the brightest channel value and ImageNet-normalized', () => {
		// 1x1 image is enough to pin the arithmetic: max channel 200.
		const t = buildInputTensor(new Uint8ClampedArray([200, 100, 0, 255]), 1);
		expect(t.length).toBe(3);
		expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
		expect(t[1]).toBeCloseTo((0.5 - 0.456) / 0.224, 5);
		expect(t[2]).toBeCloseTo((0 - 0.406) / 0.225, 5);
	});
	it('rejects a buffer that does not match the size', () => {
		expect(() => buildInputTensor(new Uint8ClampedArray(8), 2)).toThrow(/expected 16/);
	});
});

describe('normalizeMask', () => {
	it('stretches the model output to 0..255', () => {
		expect(Array.from(normalizeMask(new Float32Array([0.25, 0.75, 0.5])))).toEqual([0, 255, 128]);
	});
	it('returns all zeros for a flat output instead of dividing by zero', () => {
		expect(Array.from(normalizeMask(new Float32Array([0.5, 0.5])))).toEqual([0, 0]);
	});
});

describe('analyzeMask', () => {
	it('finds the subject box, coverage and one component', () => {
		const a = analyzeMask(maskWith(10, 10, [[2, 3, 6, 8]]), 10, 10);
		expect(a.box).toEqual({ x: 2, y: 3, w: 4, h: 5 });
		expect(a.coverage).toBeCloseTo(0.2, 5);
		expect(a.components).toEqual([20]);
	});
	it('reports separate blobs largest first', () => {
		const a = analyzeMask(maskWith(20, 10, [[0, 0, 4, 4], [10, 2, 16, 8]]), 20, 10);
		expect(a.components).toEqual([36, 16]);
		expect(a.box).toEqual({ x: 0, y: 0, w: 16, h: 8 });
	});
	it('returns a null box for an empty mask', () => {
		const a = analyzeMask(new Uint8Array(16), 4, 4);
		expect(a.box).toBeNull();
		expect(a.coverage).toBe(0);
		expect(a.components).toEqual([]);
	});
});

describe('maskBoxToImage', () => {
	it('scales a model-space box to image pixels, rounding outward', () => {
		expect(maskBoxToImage({ x: 32, y: 64, w: 160, h: 96 }, 320, 1920, 1280)).toEqual({ x: 192, y: 256, w: 960, h: 384 });
	});
});

describe('squareCropPlan', () => {
	it('pads the longer side and centres a square on the subject', () => {
		const p = squareCropPlan({ x: 400, y: 300, w: 200, h: 400 }, 1000, 1000);
		const side = Math.round(400 * (1 + 2 * THRESHOLDS.cropPadding));
		expect(p.side).toBe(side);
		expect(p.sx + side / 2).toBeCloseTo(500, 0);
		expect(p.sy + side / 2).toBeCloseTo(500, 0);
		expect(p.outSize).toBe(side);
	});
	it('shifts the square back inside the photo when there is room', () => {
		const p = squareCropPlan({ x: 0, y: 0, w: 100, h: 100 }, 1000, 800);
		expect(p.sx).toBe(0);
		expect(p.sy).toBe(0);
	});
	it('extends past the photo (padding area) only when the square is larger than the photo', () => {
		const p = squareCropPlan({ x: 0, y: 100, w: 1000, h: 400 }, 1000, 600);
		expect(p.side).toBeGreaterThan(1000);
		expect(p.sx).toBeLessThan(0);
		expect(p.sx + p.side / 2).toBeCloseTo(500, 0);
	});
	it('caps the output edge at maxSide', () => {
		const p = squareCropPlan({ x: 0, y: 0, w: 3000, h: 3000 }, 4000, 4000, { maxSide: 1024 });
		expect(p.outSize).toBe(1024);
	});
});

describe('laplacianVariance', () => {
	it('is zero on a flat image and large on a hard edge', () => {
		const flat = new Uint8Array(64).fill(120);
		expect(laplacianVariance(flat, 8, 8)).toBe(0);
		const edge = new Uint8Array(64);
		for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) edge[y * 8 + x] = 255;
		expect(laplacianVariance(edge, 8, 8)).toBeGreaterThan(1000);
	});
	it('only counts pixels the weight mask selects', () => {
		const edge = new Uint8Array(64);
		for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) edge[y * 8 + x] = 255;
		const onlyRight = new Uint8Array(64);
		for (let y = 0; y < 8; y++) for (let x = 6; x < 8; x++) onlyRight[y * 8 + x] = 255;
		expect(laplacianVariance(edge, 8, 8, onlyRight)).toBe(0);
	});
});

describe('exposureStats', () => {
	it('measures mean luminance and clipped fractions over subject pixels only', () => {
		// two pixels: a white subject pixel and a black background pixel
		const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
		const s = exposureStats(rgba, new Uint8Array([255, 0]));
		expect(s.mean).toBeCloseTo(255, 0);
		expect(s.clippedHigh).toBe(1);
		expect(s.clippedLow).toBe(0);
	});
});

describe('assessPhoto', () => {
	const good = {
		coverage: 0.3,
		subjectPx: 900,
		components: [1000],
		touchesEdge: false,
		sharpness: THRESHOLDS.minSharpness * 4,
		exposure: { mean: 130, clippedHigh: 0.01, clippedLow: 0.01 },
	};
	const codes = (m) => assessPhoto(m).map((w) => w.code);

	it('passes a clean photo with no warnings', () => {
		expect(codes(good)).toEqual([]);
	});
	it('flags no subject and stops there', () => {
		expect(codes({ ...good, coverage: 0, components: [] })).toEqual(['no_subject']);
	});
	it('flags a subject that is too small in the frame or in pixels', () => {
		expect(codes({ ...good, coverage: THRESHOLDS.minCoverage / 2 })).toContain('subject_small');
		expect(codes({ ...good, subjectPx: THRESHOLDS.minSubjectPx - 1 })).toContain('subject_small');
	});
	it('flags blur below the sharpness threshold', () => {
		expect(codes({ ...good, sharpness: THRESHOLDS.minSharpness - 1 })).toContain('blurry');
	});
	it('flags dark and overexposed subjects', () => {
		expect(codes({ ...good, exposure: { mean: THRESHOLDS.darkMean - 1, clippedHigh: 0, clippedLow: 0.5 } })).toContain('too_dark');
		expect(codes({ ...good, exposure: { mean: 200, clippedHigh: THRESHOLDS.maxClippedHigh + 0.01, clippedLow: 0 } })).toContain('overexposed');
	});
	it('flags a second blob that is a real share of the first', () => {
		expect(codes({ ...good, components: [1000, 1000 * THRESHOLDS.secondSubjectRatio + 1] })).toContain('multiple_subjects');
		expect(codes({ ...good, components: [1000, 10] })).not.toContain('multiple_subjects');
	});
	it('flags a subject cut off by the frame edge', () => {
		expect(codes({ ...good, touchesEdge: true })).toContain('cut_off');
	});
	it('gives every warning a plain-language message', () => {
		const all = assessPhoto({ ...good, coverage: 0.001, subjectPx: 10, sharpness: 0, touchesEdge: true, components: [10, 10], exposure: { mean: 10, clippedHigh: 0, clippedLow: 0.9 } });
		for (const w of all) expect(w.message).toMatch(/^[A-Z].+\.$/);
	});
});

describe('decideOnDevice', () => {
	const caps = { worker: true, wasm: true, offscreenCanvas: true, createImageBitmap: true, webgpu: false };
	it('runs on WASM when WebGPU is missing', () => {
		expect(decideOnDevice(caps)).toEqual({ run: true, provider: 'wasm', reason: null });
	});
	it('prefers WebGPU when an adapter is available', () => {
		expect(decideOnDevice({ ...caps, webgpu: true }).provider).toBe('webgpu');
	});
	it('falls back to today\'s flow, with a reason, when a requirement is missing', () => {
		for (const key of ['worker', 'wasm', 'offscreenCanvas', 'createImageBitmap']) {
			const d = decideOnDevice({ ...caps, [key]: false });
			expect(d.run).toBe(false);
			expect(d.reason).toMatch(/\S/);
		}
	});
	it('skips on a device that reports very little memory', () => {
		expect(decideOnDevice({ ...caps, deviceMemory: 0.5 }).run).toBe(false);
		expect(decideOnDevice({ ...caps, deviceMemory: 4 }).run).toBe(true);
	});
	it('exposes the model input size the worker feeds', () => {
		expect(MODEL_SIZE).toBe(320);
	});
});
