// The holo sticker peel bends geometry per vertex, so the flat faces have to
// carry interior vertices and short edges, and their rim has to be the very
// same vertices as the side walls or the curl opens a crack.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { extrudeBendable } from '../src/holo-geometry.js';

const MAX_EDGE = 0.04;
const OPTIONS = { depth: 0.028, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.016, bevelSegments: 3 };

// Dense outlines like the marching-squares tracer produces (sub-0.01 spacing).
function circle(cx, cy, r, n, clockwise = false) {
	const pts = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2 * (clockwise ? -1 : 1);
		pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
	}
	return pts;
}

// Straight, axis-aligned edges sampled densely: long runs of exactly collinear
// rim points, which is what a die-cut bar or a block letter traces to.
function rect(x0, y0, x1, y1, step, clockwise = false) {
	const pts = [];
	const run = (ax, ay, bx, by) => {
		const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
		for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n));
	};
	run(x0, y0, x1, y0);
	run(x1, y0, x1, y1);
	run(x1, y1, x0, y1);
	run(x0, y1, x0, y0);
	return clockwise ? pts.reverse() : pts;
}

function disc() {
	const shape = new THREE.Shape(circle(0, 0, 1.3, 1000));
	shape.holes.push(new THREE.Path(circle(0.5, 0, 0.3, 220, true)));
	shape.holes.push(new THREE.Path(circle(-0.5, 0.1, 0.22, 160, true)));
	return { shapes: [shape], area: Math.PI * (1.3 ** 2 - 0.3 ** 2 - 0.22 ** 2) };
}

// Two islands, one shaped like a block "O" with a rectangular counter.
function blockLetters() {
	const o = new THREE.Shape(rect(-1.5, -0.6, -0.3, 0.6, 0.007));
	o.holes.push(new THREE.Path(rect(-1.15, -0.3, -0.65, 0.3, 0.007, true)));
	const bar = new THREE.Shape(rect(0, -0.6, 1.5, -0.25, 0.007));
	return { shapes: [o, bar], area: 1.2 * 1.2 - 0.5 * 0.6 + 1.5 * 0.35 };
}

function faceStats(geometry, top) {
	const pos = geometry.attributes.position;
	const index = geometry.index.array;
	const face = geometry.groups.find((g) => g.materialIndex === 0);
	const zTop = OPTIONS.depth + OPTIONS.bevelThickness;
	const onFace = (v) => Math.abs(pos.getZ(v) - (top ? zTop : -OPTIONS.bevelThickness)) < 1e-6;
	const key = (v) => `${pos.getX(v)},${pos.getY(v)}`;
	const edgeUse = new Map();
	let area = 0;
	let maxEdge = 0;
	let wrongWinding = 0;
	const verts = new Set();
	for (let i = face.start; i < face.start + face.count; i += 3) {
		const tri = [index[i], index[i + 1], index[i + 2]];
		if (!tri.every(onFace)) continue;
		const [a, b, c] = tri;
		const cross =
			(pos.getX(b) - pos.getX(a)) * (pos.getY(c) - pos.getY(a)) -
			(pos.getY(b) - pos.getY(a)) * (pos.getX(c) - pos.getX(a));
		area += Math.abs(cross) / 2;
		if (top ? cross <= 0 : cross >= 0) wrongWinding++;
		for (const [u, v] of [[a, b], [b, c], [c, a]]) {
			maxEdge = Math.max(maxEdge, Math.hypot(pos.getX(u) - pos.getX(v), pos.getY(u) - pos.getY(v)));
			const k = [key(u), key(v)].sort().join('|');
			edgeUse.set(k, (edgeUse.get(k) || 0) + 1);
		}
		tri.forEach((v) => verts.add(key(v)));
	}
	const rimEdges = [...edgeUse].filter(([, n]) => n === 1).map(([k]) => k);
	const rimVerts = new Set(rimEdges.flatMap((k) => k.split('|')));
	return { area, maxEdge, wrongWinding, rimEdges, interior: verts.size - rimVerts.size };
}

// Every edge of the wall triangles, keyed by its two (x, y, z) endpoints.
function wallEdges(geometry, z) {
	const pos = geometry.attributes.position;
	const index = geometry.index.array;
	const wall = geometry.groups.find((g) => g.materialIndex === 1);
	const at = (v) => Math.abs(pos.getZ(v) - z) < 1e-6;
	const key = (v) => `${pos.getX(v)},${pos.getY(v)}`;
	const edges = new Set();
	for (let i = wall.start; i < wall.start + wall.count; i += 3) {
		const tri = [index[i], index[i + 1], index[i + 2]];
		for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
			if (at(u) && at(v)) edges.add([key(u), key(v)].sort().join('|'));
		}
	}
	return edges;
}

describe('extrudeBendable', () => {
	for (const [name, build] of [['disc with two holes', disc], ['block letters with collinear rims', blockLetters]]) {
		describe(name, () => {
			const { shapes, area } = build();
			const geometry = extrudeBendable(shapes, OPTIONS, MAX_EDGE);

			for (const top of [true, false]) {
				const side = top ? 'top' : 'bottom';
				const stats = faceStats(geometry, top);

				it(`${side} face has interior vertices for the roll to bend`, () => {
					expect(stats.interior).toBeGreaterThan(area / (MAX_EDGE * MAX_EDGE));
				});

				it(`${side} face has no edge much longer than the bound`, () => {
					expect(stats.maxEdge).toBeLessThan(MAX_EDGE * 1.5);
				});

				it(`${side} face covers exactly the shape, holes left open`, () => {
					expect(stats.area).toBeCloseTo(area, 2);
				});

				it(`${side} face points ${top ? 'up' : 'down'}`, () => {
					expect(stats.wrongWinding).toBe(0);
				});

				it(`${side} face rim is welded to the side walls`, () => {
					const z = top ? OPTIONS.depth + OPTIONS.bevelThickness : -OPTIONS.bevelThickness;
					const walls = wallEdges(geometry, z);
					const loose = stats.rimEdges.filter((e) => !walls.has(e));
					expect(stats.rimEdges.length).toBeGreaterThan(0);
					expect(loose).toEqual([]);
				});
			}

			it('keeps the walls and bevels identical to ExtrudeGeometry', () => {
				const reference = new THREE.ExtrudeGeometry(shapes, OPTIONS);
				const wallCount = reference.groups
					.filter((g) => g.materialIndex === 1)
					.reduce((n, g) => n + g.count, 0);
				expect(geometry.groups.find((g) => g.materialIndex === 1).count).toBe(wallCount);
				reference.dispose();
			});
		});
	}
});
