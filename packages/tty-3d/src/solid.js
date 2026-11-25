// A mesh the rasterizer can draw without a GLB.
//
// Procedural scenes (a torus, a lathed solid, a flock) have no glTF document
// and no skeleton. They still have to look like a loaded model, because the
// rasterizer and the skinning path both assume that shape: one identity node,
// triangle primitives, scratch buffers, and a pose stamp.

import { mat4Identity } from './math.js';

/**
 * @param {Array<{ positions: Float32Array, indices: Uint32Array, normals?: Float32Array, color: number[] }>} parts
 */
export function solidModel(parts) {
	const node = {
		parent: -1,
		restT: new Float64Array([0, 0, 0]),
		restR: new Float64Array([0, 0, 0, 1]),
		restS: new Float64Array([1, 1, 1]),
		local: new Float64Array(16),
		world: new Float64Array(16),
	};
	mat4Identity(node.world);

	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	const primitives = parts.map((part) => {
		const positions = part.positions;
		for (let i = 0; i < positions.length; i += 3) {
			for (let k = 0; k < 3; k += 1) {
				const v = positions[i + k];
				if (v < min[k]) min[k] = v;
				if (v > max[k]) max[k] = v;
			}
		}
		const indices = part.indices;
		const normals = part.normals ?? faceNormals(positions, indices);
		return {
			nodeId: 0,
			color: part.color,
			positions,
			normals,
			indices,
			jointNodes: null,
			inverseBind: null,
			joints: null,
			weights: null,
			outPositions: new Float32Array(positions.length),
			outNormals: new Float32Array(normals.length),
			poseStamp: -1,
		};
	});

	let triangles = 0;
	for (const prim of primitives) triangles += prim.indices.length / 3;

	return {
		nodes: [node],
		primitives,
		animations: [],
		poseStamp: 0,
		bounds: {
			min: min.map((v) => (Number.isFinite(v) ? v : -1)),
			max: max.map((v) => (Number.isFinite(v) ? v : 1)),
		},
		triangleCount: triangles,
		skinned: false,
	};
}

function faceNormals(positions, indices) {
	const normals = new Float32Array(positions.length);
	const counts = new Float32Array(positions.length / 3);
	for (let i = 0; i < indices.length; i += 3) {
		const a = indices[i] * 3;
		const b = indices[i + 1] * 3;
		const c = indices[i + 2] * 3;
		const ux = positions[b] - positions[a];
		const uy = positions[b + 1] - positions[a + 1];
		const uz = positions[b + 2] - positions[a + 2];
		const vx = positions[c] - positions[a];
		const vy = positions[c + 1] - positions[a + 1];
		const vz = positions[c + 2] - positions[a + 2];
		let nx = uy * vz - uz * vy;
		let ny = uz * vx - ux * vz;
		let nz = ux * vy - uy * vx;
		const len = Math.hypot(nx, ny, nz) || 1;
		nx /= len; ny /= len; nz /= len;
		for (const idx of [indices[i], indices[i + 1], indices[i + 2]]) {
			normals[idx * 3] += nx;
			normals[idx * 3 + 1] += ny;
			normals[idx * 3 + 2] += nz;
			counts[idx] += 1;
		}
	}
	for (let i = 0; i < counts.length; i += 1) {
		const o = i * 3;
		const len = Math.hypot(normals[o], normals[o + 1], normals[o + 2]) || 1;
		normals[o] /= len; normals[o + 1] /= len; normals[o + 2] /= len;
		if (!counts[i]) normals[o + 1] = 1;
	}
	return normals;
}

/** A torus. `major` is the ring radius, `minor` the tube radius. */
export function torusMesh(major = 0.72, minor = 0.28, rings = 36, sides = 16, color = [0.92, 0.55, 0.28]) {
	const positions = new Float32Array(rings * sides * 3);
	const indices = new Uint32Array(rings * sides * 6);
	for (let i = 0; i < rings; i += 1) {
		const u = (i / rings) * Math.PI * 2;
		const cu = Math.cos(u);
		const su = Math.sin(u);
		for (let j = 0; j < sides; j += 1) {
			const v = (j / sides) * Math.PI * 2;
			const cv = Math.cos(v);
			const sv = Math.sin(v);
			const rad = major + minor * cv;
			const o = (i * sides + j) * 3;
			positions[o] = rad * cu;
			positions[o + 1] = minor * sv;
			positions[o + 2] = rad * su;
		}
	}
	let t = 0;
	for (let i = 0; i < rings; i += 1) {
		const i2 = (i + 1) % rings;
		for (let j = 0; j < sides; j += 1) {
			const j2 = (j + 1) % sides;
			const a = i * sides + j;
			const b = i2 * sides + j;
			const c = i2 * sides + j2;
			const d = i * sides + j2;
			indices[t++] = a; indices[t++] = d; indices[t++] = b;
			indices[t++] = b; indices[t++] = d; indices[t++] = c;
		}
	}
	return solidModel([{ positions, indices, color }]);
}

/**
 * Revolve a 2D profile into a solid. `profile` is [radius, y] pairs, bottom
 * to top. This is the "a drawing becomes a 3D object" scene: the profile is
 * the drawing, the revolution is the preview.
 */
export function latheMesh(profile, steps = 28, color = [0.45, 0.72, 0.95]) {
	const rings = profile.length;
	const positions = new Float32Array(rings * steps * 3);
	const indices = [];
	for (let i = 0; i < rings; i += 1) {
		const [radius, y] = profile[i];
		for (let s = 0; s < steps; s += 1) {
			const a = (s / steps) * Math.PI * 2;
			const o = (i * steps + s) * 3;
			positions[o] = Math.cos(a) * radius;
			positions[o + 1] = y;
			positions[o + 2] = Math.sin(a) * radius;
		}
	}
	for (let i = 0; i < rings - 1; i += 1) {
		for (let s = 0; s < steps; s += 1) {
			const s2 = (s + 1) % steps;
			const a = i * steps + s;
			const b = i * steps + s2;
			const c = (i + 1) * steps + s2;
			const d = (i + 1) * steps + s;
			indices.push(a, d, b, b, d, c);
		}
	}
	return solidModel([{ positions, indices: Uint32Array.from(indices), color }]);
}
