/**
 * The maths behind /dissolve (src/dissolve/*.js). The page turns a 3D model
 * into hundreds of thousands of particles, so these rules decide whether the
 * cloud is even and whether a morph moves like a body or like a shuffle:
 *
 *  · points land ON the surface, spread by area and not by triangle count
 *  · the particle budget splits across meshes by area and always sums exactly
 *  · a seed reproduces a cloud, so a shared link reproduces a look
 *  · two shapes pair bottom-to-bottom through the Morton order
 *  · every shape is seated on the shared floor and held inside the frame
 *  · the mic bands, the recorder container and the smoothing behave
 */

import { describe, it, expect } from 'vitest';
import {
	mulberry32,
	triangleAreas,
	buildCdf,
	pickTriangle,
	randomBarycentric,
	allocateCounts,
	sampleMesh,
	interpolate,
	mortonCode,
	mortonOrder,
	boundsOf,
	fitTransform,
	STAGE_HEIGHT,
	STAGE_MAX_WIDTH,
} from '../src/dissolve/sample-core.js';
import { bandLevel, bandLevels, smoothLevel } from '../src/dissolve/audio.js';
import { pickMime, extensionFor } from '../src/dissolve/recorder.js';

/** A unit square in the XY plane as two triangles. */
const SQUARE = {
	positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
	indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
	uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
};

describe('mulberry32', () => {
	it('repeats for a seed and differs between seeds', () => {
		const a = Array.from({ length: 5 }, mulberry32(7));
		const b = Array.from({ length: 5 }, mulberry32(7));
		const c = Array.from({ length: 5 }, mulberry32(8));
		expect(a).toEqual(b);
		expect(a).not.toEqual(c);
	});

	it('stays inside [0, 1)', () => {
		const next = mulberry32(1);
		for (let i = 0; i < 10000; i++) {
			const v = next();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
});

describe('triangleAreas and the CDF', () => {
	it('measures a unit square as two half-unit triangles', () => {
		const areas = triangleAreas(SQUARE.positions, SQUARE.indices);
		expect(Array.from(areas)).toEqual([0.5, 0.5]);
	});

	it('reads a non-indexed mesh three vertices at a time', () => {
		const soup = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
		expect(Array.from(triangleAreas(soup, null))).toEqual([2]);
	});

	it('gives a degenerate triangle zero weight so nothing is ever drawn on it', () => {
		const flat = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]);
		const { total } = buildCdf(triangleAreas(flat, null));
		expect(total).toBe(0);
	});

	it('maps draws to triangles in proportion to area', () => {
		const { cdf, total } = buildCdf(new Float64Array([1, 3]));
		expect(pickTriangle(cdf, total, 0)).toBe(0);
		expect(pickTriangle(cdf, total, 0.24)).toBe(0);
		expect(pickTriangle(cdf, total, 0.26)).toBe(1);
		expect(pickTriangle(cdf, total, 0.999999)).toBe(1);
	});
});

describe('randomBarycentric', () => {
	it('always sums to one with no negative weight', () => {
		const next = mulberry32(3);
		for (let i = 0; i < 5000; i++) {
			const w = randomBarycentric(next(), next());
			expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 12);
			expect(Math.min(...w)).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('allocateCounts', () => {
	it('sums to exactly the budget', () => {
		for (const count of [1, 7, 1000, 262144]) {
			const parts = allocateCounts([0.31, 12.5, 4, 0.0004, 9], count);
			expect(parts.reduce((s, v) => s + v, 0)).toBe(count);
		}
	});

	it('follows the weights and never funds a zero-weight mesh', () => {
		const parts = allocateCounts([1, 0, 3], 100);
		expect(parts).toEqual([25, 0, 75]);
	});

	it('returns all zeros when there is nothing to weigh', () => {
		expect(allocateCounts([0, 0], 50)).toEqual([0, 0]);
		expect(allocateCounts([], 50)).toEqual([]);
		expect(allocateCounts([1, 2], 0)).toEqual([0, 0]);
	});
});

describe('sampleMesh', () => {
	it('puts every point on the surface of the square', () => {
		const out = sampleMesh(SQUARE, 4000, mulberry32(11));
		expect(out.count).toBe(4000);
		for (let i = 0; i < out.count; i++) {
			const x = out.positions[i * 3];
			const y = out.positions[i * 3 + 1];
			expect(out.positions[i * 3 + 2]).toBe(0);
			expect(x).toBeGreaterThanOrEqual(-1e-6);
			expect(x).toBeLessThanOrEqual(1 + 1e-6);
			expect(y).toBeGreaterThanOrEqual(-1e-6);
			expect(y).toBeLessThanOrEqual(1 + 1e-6);
		}
	});

	it('covers the surface evenly: each quadrant gets about a quarter', () => {
		const out = sampleMesh(SQUARE, 40000, mulberry32(5));
		const quad = [0, 0, 0, 0];
		for (let i = 0; i < out.count; i++) {
			quad[(out.positions[i * 3] > 0.5 ? 1 : 0) + (out.positions[i * 3 + 1] > 0.5 ? 2 : 0)]++;
		}
		for (const q of quad) expect(q / out.count).toBeGreaterThan(0.23);
		for (const q of quad) expect(q / out.count).toBeLessThan(0.27);
	});

	it('weights a big triangle over a small one', () => {
		const mesh = {
			positions: new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, 0, 10, 10, 0, 10.5, 10, 0, 10, 10.5, 0]),
			indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
		};
		const out = sampleMesh(mesh, 10000, mulberry32(2));
		let small = 0;
		for (let i = 0; i < out.count; i++) if (out.tri[i] === 1) small++;
		// areas are 8 and 0.125, so the small triangle owns 1.5% of the surface
		expect(small / out.count).toBeGreaterThan(0.008);
		expect(small / out.count).toBeLessThan(0.025);
	});

	it('reproduces the same cloud from the same seed', () => {
		const a = sampleMesh(SQUARE, 100, mulberry32(9));
		const b = sampleMesh(SQUARE, 100, mulberry32(9));
		expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
	});

	it('interpolates uvs with the same weights as positions', () => {
		const out = sampleMesh(SQUARE, 500, mulberry32(4));
		for (let i = 0; i < out.count; i++) {
			expect(out.uvs[i * 2]).toBeCloseTo(out.positions[i * 3], 5);
			expect(out.uvs[i * 2 + 1]).toBeCloseTo(out.positions[i * 3 + 1], 5);
		}
	});

	it('returns an empty cloud for a mesh with no area instead of NaN points', () => {
		const flat = { positions: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]), indices: null };
		const out = sampleMesh(flat, 10, mulberry32(1));
		expect(out.count).toBe(0);
	});
});

describe('interpolate', () => {
	it('blends a per-vertex attribute with the sample weights', () => {
		const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
		const out = [0, 0, 0];
		interpolate(colors, 3, new Uint32Array([0, 1, 2]), new Uint32Array([0]), new Float32Array([0.5, 0.25, 0.25]), 0, out);
		expect(out).toEqual([0.5, 0.25, 0.25]);
	});
});

describe('mortonOrder', () => {
	const min = [0, 0, 0];
	const max = [1, 1, 1];

	it('is a true permutation', () => {
		const next = mulberry32(21);
		const pts = new Float32Array(3000);
		for (let i = 0; i < pts.length; i++) pts[i] = next();
		const order = mortonOrder(pts, 1000, min, max);
		expect(new Set(order).size).toBe(1000);
		expect(Math.max(...order)).toBe(999);
	});

	it('keeps neighbours close: consecutive points are nearer than random pairs', () => {
		const next = mulberry32(22);
		const n = 4000;
		const pts = new Float32Array(n * 3);
		for (let i = 0; i < pts.length; i++) pts[i] = next();
		const order = mortonOrder(pts, n, min, max);
		const dist = (a, b) =>
			Math.hypot(pts[a * 3] - pts[b * 3], pts[a * 3 + 1] - pts[b * 3 + 1], pts[a * 3 + 2] - pts[b * 3 + 2]);
		let sorted = 0;
		let random = 0;
		for (let i = 1; i < n; i++) {
			sorted += dist(order[i - 1], order[i]);
			random += dist(i - 1, i);
		}
		expect(sorted).toBeLessThan(random * 0.4);
	});

	it('pairs the low end of one shape with the low end of another', () => {
		const a = new Float32Array([0, 0, 0, 0, 1, 0, 0, 0.5, 0]);
		const b = new Float32Array([5, 0.9, 5, 5, 0, 5, 5, 0.4, 5]);
		const box = { min: [0, 0, 0], max: [5, 1, 5] };
		const oa = mortonOrder(a, 3, box.min, box.max);
		const ob = mortonOrder(b, 3, box.min, box.max);
		// the lowest point of each shape sits first in its own order
		expect(a[oa[0] * 3 + 1]).toBe(0);
		expect(b[ob[0] * 3 + 1]).toBe(0);
	});

	it('refuses a cloud it cannot key without collisions', () => {
		expect(() => mortonOrder(new Float32Array(3), 1048577, min, max)).toThrow(RangeError);
	});

	it('clamps points outside the box instead of wrapping', () => {
		expect(mortonCode(-5, -5, -5, min, max)).toBe(0);
		expect(mortonCode(9, 9, 9, min, max)).toBe(mortonCode(1, 1, 1, min, max));
	});
});

describe('boundsOf', () => {
	it('finds the box and tolerates an empty cloud', () => {
		expect(boundsOf(new Float32Array([1, 2, 3, -1, 5, 0]))).toEqual({ min: [-1, 2, 0], max: [1, 5, 3] });
		expect(boundsOf(new Float32Array(0))).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] });
	});
});

describe('fitTransform', () => {
	const apply = (v, t) => v * t.scale;

	it('seats a tall figure on the floor at stage height', () => {
		const t = fitTransform([-0.3, 0, -0.2], [0.3, 1.8, 0.2]);
		expect(apply(1.8, t) + t.offset[1]).toBeCloseTo(-1 + STAGE_HEIGHT, 6);
		expect(apply(0, t) + t.offset[1]).toBeCloseTo(-1, 6);
	});

	it('centres a shape on x and z wherever it was authored', () => {
		const t = fitTransform([10, 3, 20], [12, 5, 24]);
		expect(apply(10, t) + t.offset[0]).toBeCloseTo(-(apply(12, t) + t.offset[0]), 6);
		expect(apply(20, t) + t.offset[2]).toBeCloseTo(-(apply(24, t) + t.offset[2]), 6);
	});

	it('holds a long prop inside the frame width', () => {
		const t = fitTransform([0, 0, 0], [30, 1, 2]);
		expect(30 * t.scale).toBeLessThanOrEqual(STAGE_MAX_WIDTH + 1e-9);
	});

	it('does not divide by zero for a flat or empty box', () => {
		const t = fitTransform([0, 0, 0], [0, 0, 0]);
		expect(Number.isFinite(t.scale)).toBe(true);
		expect(t.offset.every(Number.isFinite)).toBe(true);
	});
});

describe('audio bands', () => {
	const sampleRate = 48000;
	const bins = new Uint8Array(512); // 46.875 Hz per bin

	it('reads only the energy inside the band', () => {
		bins.fill(0);
		bins[2] = 255; // ~94 Hz, inside bass
		const { bass, mid, treble } = bandLevels(bins, sampleRate);
		expect(bass).toBeGreaterThan(0);
		expect(mid).toBe(0);
		expect(treble).toBe(0);
	});

	it('returns 1 for a saturated spectrum and 0 for silence or no data', () => {
		bins.fill(255);
		expect(bandLevel(bins, sampleRate, 160, 2000)).toBe(1);
		expect(bandLevel(new Uint8Array(0), sampleRate, 20, 160)).toBe(0);
		expect(bandLevel(null, sampleRate, 20, 160)).toBe(0);
	});

	it('attacks faster than it releases so a kick lands and then breathes out', () => {
		const up = smoothLevel(0, 1);
		const down = 1 - smoothLevel(1, 0);
		expect(up).toBeGreaterThan(down);
	});
});

describe('recorder mime negotiation', () => {
	it('takes the best container the browser accepts', () => {
		expect(pickMime((m) => m === 'video/webm' || m === 'video/mp4')).toBe('video/webm');
		expect(pickMime((m) => m.startsWith('video/mp4'))).toBe('video/mp4;codecs=avc1');
	});

	it('reports no support instead of guessing', () => {
		expect(pickMime(() => false)).toBeNull();
	});

	it('names the file after the container it got', () => {
		expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4');
		expect(extensionFor('video/webm;codecs=vp9')).toBe('webm');
		expect(extensionFor(null)).toBe('webm');
	});
});
