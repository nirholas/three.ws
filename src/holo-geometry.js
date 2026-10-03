// Bendable extrusion for the holo sticker.
//
// THREE.ExtrudeGeometry triangulates each flat face from its outline alone, so a
// face is a fan of long slivers running edge to edge with no vertex inside. The
// peel is a per-vertex cylinder roll, and a triangle can only bend at its
// vertices: a sliver that crosses the fold line stays straight, cuts a chord
// through the curl, and reads as stair steps, then shards, then a crumple.
//
// extrudeBendable keeps ExtrudeGeometry's side walls and bevels (they are made
// of short quads along a dense outline, so they already bend), and rebuilds both
// flat faces as a constrained Delaunay triangulation of the exact same outline
// points plus an even triangular lattice of interior points. Every face edge is
// then shorter than maxEdge, so the roll has a vertex every few degrees of arc,
// and because the face reuses the walls' outline vertices bit for bit, nothing
// can open a crack along the rim when it curls.

import * as THREE from 'three';
import Delaunator from 'delaunator';
import Constrainautor from '@kninnug/constrainautor';

// ExtrudeGeometry drops index-adjacent points closer than this (scaled by the
// coordinate magnitude) before it builds the walls. The face outline has to
// drop exactly the same points or the rim stops sharing vertices with the wall.
const MERGE_EPS = 1e-10;

function dropOverlapping(points) {
	const out = points.slice();
	let prev = out[0];
	for (let i = 1; i <= out.length; i++) {
		const idx = i % out.length;
		const cur = out[idx];
		const scale = Math.max(Math.abs(cur.x), Math.abs(cur.y), Math.abs(prev.x), Math.abs(prev.y));
		const dx = cur.x - prev.x;
		const dy = cur.y - prev.y;
		if (dx * dx + dy * dy <= MERGE_EPS * MERGE_EPS * scale * scale) {
			out.splice(idx, 1);
			i--;
			continue;
		}
		prev = cur;
	}
	return out;
}

// Rings of one shape (outer first, then holes) exactly as ExtrudeGeometry
// sees them, so the face rim and the wall share every vertex.
function shapeRings(shape, curveSegments) {
	const { shape: outer, holes } = shape.extractPoints(curveSegments);
	return [outer, ...holes].map(dropOverlapping).filter((ring) => ring.length >= 3);
}

// Uniform bucket grid over the ring segments, for the "is this lattice point
// too close to the rim" test.
function segmentIndex(rings, cell) {
	const buckets = new Map();
	const key = (ix, iy) => ix * 73856093 ^ iy * 19349663;
	for (const ring of rings) {
		for (let i = 0; i < ring.length; i++) {
			const a = ring[i];
			const b = ring[(i + 1) % ring.length];
			const x0 = Math.floor(Math.min(a.x, b.x) / cell);
			const x1 = Math.floor(Math.max(a.x, b.x) / cell);
			const y0 = Math.floor(Math.min(a.y, b.y) / cell);
			const y1 = Math.floor(Math.max(a.y, b.y) / cell);
			for (let ix = x0; ix <= x1; ix++) {
				for (let iy = y0; iy <= y1; iy++) {
					const k = key(ix, iy);
					const list = buckets.get(k);
					if (list) list.push(a, b);
					else buckets.set(k, [a, b]);
				}
			}
		}
	}
	return (x, y, radius) => {
		const r2 = radius * radius;
		const cx = Math.floor(x / cell);
		const cy = Math.floor(y / cell);
		for (let ix = cx - 1; ix <= cx + 1; ix++) {
			for (let iy = cy - 1; iy <= cy + 1; iy++) {
				const list = buckets.get(key(ix, iy));
				if (!list) continue;
				for (let j = 0; j < list.length; j += 2) {
					if (segmentDist2(x, y, list[j], list[j + 1]) < r2) return true;
				}
			}
		}
		return false;
	};
}

function segmentDist2(px, py, a, b) {
	const vx = b.x - a.x;
	const vy = b.y - a.y;
	const len2 = vx * vx + vy * vy;
	const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len2)) : 0;
	const dx = a.x + vx * t - px;
	const dy = a.y + vy * t - py;
	return dx * dx + dy * dy;
}

// Even-odd scanline fill: the x spans of row y that lie inside the shape.
function rowSpans(rings, y) {
	const xs = [];
	for (const ring of rings) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const a = ring[j];
			const b = ring[i];
			if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
		}
	}
	xs.sort((p, q) => p - q);
	const spans = [];
	for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]]);
	return spans;
}

// Interior points on an equilateral lattice of pitch `spacing`, kept at least
// a third of a pitch clear of the rim so no sliver forms against it.
function latticePoints(rings, spacing) {
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const ring of rings) {
		for (const p of ring) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
	}
	const clearance = spacing * 0.35;
	const nearRim = segmentIndex(rings, clearance);
	const rowH = (spacing * Math.sqrt(3)) / 2;
	const pts = [];
	let row = 0;
	for (let y = minY + rowH * 0.5; y < maxY; y += rowH, row++) {
		const shift = row % 2 ? spacing * 0.5 : 0;
		for (const [xa, xb] of rowSpans(rings, y)) {
			const start = Math.ceil((xa - minX - shift) / spacing) * spacing + minX + shift;
			for (let x = start; x < xb; x += spacing) {
				if (!nearRim(x, y, clearance)) pts.push(x, y);
			}
		}
	}
	return pts;
}

/**
 * Triangulate one flat face of a shape so no edge is longer than about
 * `maxEdge`: a constrained Delaunay triangulation of the rim points plus an
 * interior lattice, keeping only the triangles inside the shape.
 *
 * @param {THREE.Vector2[][]} rings outer ring first, then holes
 * @param {number} maxEdge target edge length
 * @returns {{ coords: Float64Array, triangles: number[] }} 2D points and
 *   counter-clockwise index triples
 */
export function triangulateFace(rings, maxEdge) {
	const rimCount = rings.reduce((n, r) => n + r.length, 0);
	const inner = latticePoints(rings, maxEdge);

	// A frame well outside the shape keeps every rim edge off the convex hull,
	// so the hull triangles are always exterior and seed the inside/outside fill.
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const ring of rings) {
		for (const p of ring) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
	}
	const pad = Math.max(maxX - minX, maxY - minY) * 0.1 + maxEdge;
	const frame = [minX - pad, minY - pad, maxX + pad, minY - pad, maxX + pad, maxY + pad, minX - pad, maxY + pad];

	const coords = new Float64Array(rimCount * 2 + inner.length + frame.length);
	const edges = [];
	let n = 0;
	for (const ring of rings) {
		const first = n;
		for (let i = 0; i < ring.length; i++) {
			coords[n * 2] = ring[i].x;
			coords[n * 2 + 1] = ring[i].y;
			edges.push([n, i + 1 < ring.length ? n + 1 : first]);
			n++;
		}
	}
	coords.set(inner, n * 2);
	coords.set(frame, n * 2 + inner.length);

	const del = new Delaunator(coords);
	const con = new Constrainautor(del);
	con.constrainAll(edges);

	// Flood fill from the hull: crossing a rim edge flips inside/outside.
	const { triangles, halfedges } = del;
	const triCount = triangles.length / 3;
	const parity = new Int8Array(triCount).fill(-1);
	const queue = [];
	for (let e = 0; e < halfedges.length; e++) {
		if (halfedges[e] !== -1) continue;
		const t = Math.floor(e / 3);
		if (parity[t] === -1) {
			parity[t] = 0;
			queue.push(t);
		}
	}
	while (queue.length) {
		const t = queue.pop();
		for (let k = 0; k < 3; k++) {
			const e = t * 3 + k;
			const opp = halfedges[e];
			if (opp === -1) continue;
			const nt = Math.floor(opp / 3);
			if (parity[nt] !== -1) continue;
			parity[nt] = parity[t] ^ (con.isConstrained(e) ? 1 : 0);
			queue.push(nt);
		}
	}

	// Emit every kept triangle counter-clockwise in the y-up shape plane, so its
	// front face looks toward +z.
	const out = [];
	for (let t = 0; t < triCount; t++) {
		if (parity[t] !== 1) continue;
		const a = triangles[t * 3];
		const b = triangles[t * 3 + 1];
		const c = triangles[t * 3 + 2];
		const cross =
			(coords[b * 2] - coords[a * 2]) * (coords[c * 2 + 1] - coords[a * 2 + 1]) -
			(coords[b * 2 + 1] - coords[a * 2 + 1]) * (coords[c * 2] - coords[a * 2]);
		if (cross > 0) out.push(a, b, c);
		else out.push(a, c, b);
	}
	return { coords, triangles: out };
}

/**
 * ExtrudeGeometry whose flat faces are finely and evenly triangulated, so a
 * vertex-shader bend (the sticker peel) curls them smoothly.
 *
 * @param {THREE.Shape[]} shapes
 * @param {object} options ExtrudeGeometry options (bevel required, no path)
 * @param {number} maxEdge longest edge allowed across a flat face
 * @returns {THREE.BufferGeometry} indexed geometry with position, normal, uv;
 *   group 0 is the faces, group 1 the walls and bevels
 */
export function extrudeBendable(shapes, options, maxEdge) {
	const curveSegments = options.curveSegments ?? 12;
	const depth = options.depth ?? 1;
	const bevelThickness = options.bevelEnabled ? (options.bevelThickness ?? 0.2) : 0;
	const zBottom = -bevelThickness;
	const zTop = depth + bevelThickness;

	const pos = [];
	const nor = [];
	const uv = [];
	const capIndex = [];
	const wallIndex = [];

	for (const shape of shapes) {
		const rings = shapeRings(shape, curveSegments);
		if (!rings.length) continue;

		const { coords, triangles } = triangulateFace(rings, maxEdge);
		const used = new Map();
		const vertexAt = (i, z, nz) => {
			const k = nz > 0 ? i * 2 + 1 : i * 2;
			let v = used.get(k);
			if (v === undefined) {
				v = pos.length / 3;
				const x = coords[i * 2];
				const y = coords[i * 2 + 1];
				pos.push(x, y, z);
				nor.push(0, 0, nz);
				uv.push(x, y);
				used.set(k, v);
			}
			return v;
		};
		for (let t = 0; t < triangles.length; t += 3) {
			const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
			capIndex.push(vertexAt(a, zTop, 1), vertexAt(b, zTop, 1), vertexAt(c, zTop, 1));
			capIndex.push(vertexAt(a, zBottom, -1), vertexAt(c, zBottom, -1), vertexAt(b, zBottom, -1));
		}

		const walls = new THREE.ExtrudeGeometry(shape, { ...options, curveSegments });
		const wp = walls.attributes.position.array;
		const wn = walls.attributes.normal.array;
		const wu = walls.attributes.uv.array;
		for (const g of walls.groups) {
			if (g.materialIndex !== 1) continue;
			for (let i = g.start; i < g.start + g.count; i++) {
				wallIndex.push(pos.length / 3);
				pos.push(wp[i * 3], wp[i * 3 + 1], wp[i * 3 + 2]);
				nor.push(wn[i * 3], wn[i * 3 + 1], wn[i * 3 + 2]);
				uv.push(wu[i * 2], wu[i * 2 + 1]);
			}
		}
		walls.dispose();
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geometry.setIndex([...capIndex, ...wallIndex]);
	geometry.addGroup(0, capIndex.length, 0);
	geometry.addGroup(capIndex.length, wallIndex.length, 1);
	return geometry;
}
