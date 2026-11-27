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
	alphaChannel,
	detectCutout,
	maskVerdict,
	pickUpload,
	removalNotice,
	PREP_WAIT,
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

// An RGBA square where `alphaAt(x, y)` decides every pixel's alpha.
function rgbaSquare(size, alphaAt) {
	const px = new Uint8ClampedArray(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const i = (y * size + x) * 4;
			px[i] = 200;
			px[i + 1] = 120;
			px[i + 2] = 40;
			px[i + 3] = alphaAt(x, y);
		}
	}
	return px;
}

describe('detectCutout (a photo that already has its background removed)', () => {
	const size = 40;
	const inCentre = (x, y) => x >= 10 && x < 30 && y >= 10 && y < 30;

	it('recognises an object floating in transparent space', () => {
		const d = detectCutout(rgbaSquare(size, (x, y) => (inCentre(x, y) ? 255 : 0)), size);
		expect(d.cutout).toBe(true);
		expect(d.transparentShare).toBeCloseTo(0.75, 2);
		expect(d.borderTransparentShare).toBe(1);
	});
	it('does not treat an opaque photo with an alpha channel as a cut-out', () => {
		expect(detectCutout(rgbaSquare(size, () => 255), size).cutout).toBe(false);
	});
	it('does not treat a solid frame with see-through holes inside as a cut-out', () => {
		const holes = (x, y) => (x >= 15 && x < 25 && y >= 15 && y < 25 ? 0 : 255);
		const d = detectCutout(rgbaSquare(size, holes), size);
		expect(d.transparentShare).toBeGreaterThan(THRESHOLDS.cutoutTransparentShare);
		expect(d.cutout).toBe(false);
	});
	it('does not treat a faint soft shadow edge as a cut-out', () => {
		expect(detectCutout(rgbaSquare(size, (x, y) => (x === 0 && y < 3 ? 0 : 255)), size).cutout).toBe(false);
	});
	it('reads the alpha channel as the mask', () => {
		const a = alphaChannel(rgbaSquare(2, (x, y) => x * 100 + y * 50));
		expect(Array.from(a)).toEqual([0, 100, 50, 150]);
	});
	it('rejects a buffer that does not match the size', () => {
		expect(() => detectCutout(new Uint8ClampedArray(8), 2)).toThrow(/expected 16/);
	});
});

describe('maskVerdict (empty and whole-frame masks are failed removals)', () => {
	it('rejects a mask with no subject pixels at all', () => {
		const v = maskVerdict(analyzeMask(new Uint8Array(100), 10, 10));
		expect(v).toEqual({ ok: false, reason: 'empty' });
	});
	it('rejects a mask of a few stray specks, which the old flow still cropped and offered', () => {
		const specks = maskWith(320, 320, [[5, 5, 7, 7], [100, 100, 102, 101], [200, 50, 201, 52]]);
		const a = analyzeMask(specks, 320, 320);
		expect(a.box).not.toBeNull();
		expect(maskVerdict(a)).toEqual({ ok: false, reason: 'empty' });
	});
	it('rejects a mask that kept the whole frame', () => {
		const v = maskVerdict(analyzeMask(maskWith(20, 20, [[0, 0, 20, 20]]), 20, 20));
		expect(v).toEqual({ ok: false, reason: 'whole_frame' });
	});
	it('rejects a mask that kept all but a thin rim of the frame', () => {
		const v = maskVerdict(analyzeMask(maskWith(100, 100, [[1, 1, 99, 99]]), 100, 100));
		expect(v.reason).toBe('whole_frame');
	});
	it('accepts a subject that fills half the frame, the largest in the calibration bench', () => {
		expect(maskVerdict(analyzeMask(maskWith(20, 20, [[0, 0, 20, 10]]), 20, 20))).toEqual({ ok: true, reason: null });
	});
	it('accepts the smallest real subject in the bench (4% of the frame)', () => {
		expect(maskVerdict(analyzeMask(maskWith(100, 100, [[40, 40, 60, 50]]), 100, 100)).ok).toBe(true);
	});
	it('has assessPhoto say plainly that the background was kept', () => {
		const a = analyzeMask(maskWith(20, 20, [[0, 0, 20, 20]]), 20, 20);
		const w = assessPhoto({ ...a, subjectPx: 20, sharpness: 500, exposure: { mean: 120, clippedHigh: 0 } });
		expect(w.map((x) => x.code)).toEqual(['background_kept']);
		expect(w[0].message).toMatch(/background/i);
	});
});

describe('pickUpload and removalNotice (what the review dialog sends and says)', () => {
	const prepared = new Blob(['p'], { type: 'image/jpeg' });
	const cutout = new Blob(['c'], { type: 'image/webp' });
	it('sends the prepared crop after a normal removal', () => {
		expect(pickUpload({ removal: { status: 'model' }, prepared, cutout }, 'prepared')).toBe(prepared);
		expect(pickUpload({ removal: { status: 'model' }, prepared, cutout }, 'cutout')).toBe(cutout);
	});
	it('sends nothing prepared after a failed removal, so only the original remains', () => {
		expect(pickUpload({ removal: { status: 'failed', reason: 'empty' }, prepared, cutout }, 'prepared')).toBeNull();
		expect(pickUpload({ removal: { status: 'failed', reason: 'whole_frame' }, prepared: null, cutout: null }, 'cutout')).toBeNull();
	});
	it('sends the alpha crop of a photo that was already cut out, whatever the default', () => {
		expect(pickUpload({ removal: { status: 'alpha' }, prepared: cutout, cutout }, 'prepared')).toBe(cutout);
	});
	it('says why in one sentence for each non-normal outcome and nothing for a normal one', () => {
		expect(removalNotice({ removal: { status: 'model' } })).toBe('');
		expect(removalNotice({ removal: { status: 'alpha' } })).toMatch(/already has a transparent background/);
		expect(removalNotice({ removal: { status: 'failed', reason: 'whole_frame' } })).toMatch(/kept the whole picture/);
		expect(removalNotice({ removal: { status: 'failed', reason: 'empty' } })).toMatch(/found no subject/);
	});
});

describe('squareCropPlan for a cut-out', () => {
	it('centres the subject exactly even beside the photo edge, padding with transparent space', () => {
		const box = { x: 0, y: 0, w: 200, h: 100 };
		const near = squareCropPlan(box, 1000, 800, { center: true });
		expect(near.sx + near.side / 2).toBeCloseTo(100, 0);
		expect(near.sy + near.side / 2).toBeCloseTo(50, 0);
		expect(near.sx).toBeLessThan(0);
		const shifted = squareCropPlan(box, 1000, 800);
		expect(shifted.sx).toBe(0);
	});
	it('keeps sensible padding around the longer edge', () => {
		const p = squareCropPlan({ x: 300, y: 300, w: 400, h: 200 }, 1000, 1000, { center: true });
		expect(p.side).toBe(Math.round(400 * (1 + 2 * THRESHOLDS.cropPadding)));
	});
	it('never makes the output larger than the square it cuts, so nothing is upscaled past its source', () => {
		for (const [w, h, bw, bh] of [[300, 300, 300, 300], [64, 64, 10, 10], [4000, 3000, 3900, 2900], [1000, 200, 990, 190], [5000, 5000, 100, 100]]) {
			const box = { x: Math.floor((w - bw) / 2), y: Math.floor((h - bh) / 2), w: bw, h: bh };
			for (const center of [false, true]) {
				const p = squareCropPlan(box, w, h, { center });
				expect(p.outSize).toBeLessThanOrEqual(p.side);
				expect(p.outSize).toBeLessThanOrEqual(THRESHOLDS.maxSide);
			}
		}
	});
});

describe('PREP_WAIT', () => {
	it('is bounded, with the loading stage given less silence than the run stage and a cap above both', () => {
		expect(PREP_WAIT.loadIdleMs).toBeGreaterThan(0);
		expect(PREP_WAIT.loadIdleMs).toBeLessThanOrEqual(PREP_WAIT.runIdleMs);
		expect(PREP_WAIT.totalMs).toBeGreaterThan(PREP_WAIT.runIdleMs);
		expect(PREP_WAIT.totalMs).toBeLessThanOrEqual(5 * 60_000);
	});
});
