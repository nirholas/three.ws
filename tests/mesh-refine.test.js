// Local mesh refinement library — deterministic geometry passes that run in the
// browser (and headless here). These tests build synthetic geometry and assert
// each pass does what it claims: weld dedupes, normals smooth, Laplacian moves
// interior verts but pins boundaries, decimate reduces, subdivide increases.

import { describe, it, expect } from 'vitest';
import { BufferGeometry, BufferAttribute, PlaneGeometry, Mesh, Group } from 'three';
import {
	geometryStats,
	sceneStats,
	weldGeometry,
	recomputeSmoothNormals,
	laplacianSmooth,
	subdivideGeometry,
	decimateGeometry,
	refineGeometry,
	refineScene,
	specForPreset,
	REFINE_PRESETS,
} from '../src/shared/mesh-refine.js';

// Two triangles sharing an edge, but authored as 6 independent vertices (the
// duplicated-seam shape generated meshes ship with). Welding should collapse
// the 2 shared corners → 4 unique vertices.
function duplicatedQuad() {
	const g = new BufferGeometry();
	// prettier-ignore
	const positions = new Float32Array([
		0, 0, 0,  1, 0, 0,  0, 1, 0, // tri A
		1, 0, 0,  1, 1, 0,  0, 1, 0, // tri B (reuses (1,0,0) and (0,1,0))
	]);
	g.setAttribute('position', new BufferAttribute(positions, 3));
	return g;
}

describe('geometryStats / sceneStats', () => {
	it('counts triangles for non-indexed geometry', () => {
		expect(geometryStats(duplicatedQuad())).toEqual({ vertices: 6, triangles: 2 });
	});

	it('sums across every mesh in a scene', () => {
		const root = new Group();
		root.add(new Mesh(duplicatedQuad()));
		root.add(new Mesh(duplicatedQuad()));
		const s = sceneStats(root);
		expect(s.triangles).toBe(4);
		expect(s.vertices).toBe(12);
	});
});

describe('weldGeometry', () => {
	it('merges coincident vertices and indexes the result', () => {
		const welded = weldGeometry(duplicatedQuad());
		expect(welded.getIndex()).not.toBeNull();
		expect(welded.getAttribute('position').count).toBe(4);
		expect(welded.getIndex().count).toBe(6); // still 2 triangles
	});
});

describe('recomputeSmoothNormals', () => {
	it('produces one averaged normal per welded vertex', () => {
		const welded = weldGeometry(duplicatedQuad());
		recomputeSmoothNormals(welded);
		const n = welded.getAttribute('normal');
		expect(n.count).toBe(4);
		// Flat quad in z=0 plane → all normals point along +z.
		expect(Math.abs(n.getZ(0))).toBeCloseTo(1, 5);
	});
});

describe('laplacianSmooth', () => {
	it('moves an interior vertex toward its neighbours but pins the boundary', () => {
		// A plane with interior vertices; displace the centre vertex and confirm
		// smoothing pulls it back toward the neighbour average.
		const plane = new PlaneGeometry(4, 4, 4, 4); // 5x5 grid, indexed
		const pos = plane.getAttribute('position');
		// Centre vertex of a 5x5 grid is index 12; spike it out of plane.
		pos.setZ(12, 5);
		pos.needsUpdate = true;
		const cornerBefore = pos.getZ(0); // a boundary/corner vertex

		laplacianSmooth(plane, { iterations: 4, lambda: 0.5 });

		const after = plane.getAttribute('position');
		expect(Math.abs(after.getZ(12))).toBeLessThan(5); // centre relaxed inward
		expect(after.getZ(0)).toBeCloseTo(cornerBefore, 5); // boundary pinned
	});

	it('is a no-op-but-shades when iterations < 1', () => {
		const g = weldGeometry(duplicatedQuad());
		const out = laplacianSmooth(g, { iterations: 0 });
		expect(out.getAttribute('normal')).not.toBeNull();
	});
});

describe('decimateGeometry', () => {
	it('reduces vertex count toward the kept fraction', async () => {
		const dense = new PlaneGeometry(2, 2, 16, 16);
		const before = geometryStats(dense).vertices;
		const out = await decimateGeometry(dense, { keep: 0.4 });
		expect(geometryStats(out).vertices).toBeLessThan(before);
	});

	it('clamps keep below 1 so it retains nearly all vertices at the top of the range', async () => {
		const g = new PlaneGeometry(2, 2, 4, 4);
		const before = geometryStats(g).vertices;
		const out = geometryStats(await decimateGeometry(g, { keep: 0.99 })).vertices;
		expect(out).toBeLessThanOrEqual(before);
		expect(out).toBeGreaterThanOrEqual(Math.floor(before * 0.9));
	});
});

describe('subdivideGeometry', () => {
	it('increases triangle count', () => {
		const plane = new PlaneGeometry(2, 2, 1, 1); // 2 big triangles
		const before = geometryStats(plane).triangles;
		const out = subdivideGeometry(plane, { iterations: 1 });
		expect(geometryStats(out).triangles).toBeGreaterThan(before);
	});
});

describe('refineGeometry pipeline', () => {
	it('Clean preset welds and adds smooth normals without changing density', async () => {
		const spec = specForPreset('clean');
		const out = await refineGeometry(duplicatedQuad(), spec);
		expect(out.getAttribute('position').count).toBe(4); // welded
		expect(out.getAttribute('normal')).not.toBeNull();
		expect(geometryStats(out).triangles).toBe(2); // unchanged
	});

	it('Game-ready preset reduces triangles', async () => {
		const dense = new PlaneGeometry(2, 2, 16, 16);
		const before = geometryStats(dense).triangles;
		const spec = specForPreset('gameready', 30); // keep 30%
		const out = await refineGeometry(dense, spec);
		expect(geometryStats(out).triangles).toBeLessThan(before);
	});

	it('skips density transforms on multi-material (grouped) geometry', async () => {
		const g = new PlaneGeometry(2, 2, 8, 8);
		g.addGroup(0, 96, 0);
		g.addGroup(96, g.getIndex().count - 96, 1);
		const before = geometryStats(g).triangles;
		const out = await refineGeometry(g, specForPreset('gameready', 30));
		// Grouped → decimate skipped, triangle count preserved.
		expect(geometryStats(out).triangles).toBe(before);
	});
});

describe('refineScene', () => {
	it('refines every mesh and reports before/after totals', async () => {
		const root = new Group();
		root.add(new Mesh(duplicatedQuad()));
		const { before, after } = await refineScene(root, specForPreset('clean'));
		expect(before.vertices).toBe(6);
		expect(after.vertices).toBe(4); // welded
	});
});

describe('specForPreset', () => {
	it('maps slider values into spec overrides', () => {
		expect(specForPreset('smooth', 6).smooth).toBe(6);
		expect(specForPreset('gameready', 40).decimate).toBeCloseTo(0.4, 5);
		expect(specForPreset('hero', 2).subdivide).toBe(2);
	});

	it('returns base spec for sliderless presets and null for unknown keys', () => {
		expect(specForPreset('clean')).toEqual({ weld: true, normals: true });
		expect(specForPreset('nope')).toBeNull();
	});

	it('every preset has a unique key and a spec', () => {
		const keys = new Set(REFINE_PRESETS.map((p) => p.key));
		expect(keys.size).toBe(REFINE_PRESETS.length);
		for (const p of REFINE_PRESETS) expect(p.spec).toBeTruthy();
	});
});
