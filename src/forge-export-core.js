// The conversion engine behind the Forge export menu (src/forge-export.js,
// loaded by both Forge and Forge Studio), its page driver
// (src/forge-export-client.js) and the export worker
// (src/forge-export-worker.js), so every surface writes the same bytes.
//
// Pipeline: parseGlb() opens the model (meshopt and Draco included, so the
// compressed delivery variant converts too), collectMeshes() bakes every mesh
// into plain world-space arrays (skinning, morphs, node transforms and mirrored
// nodes resolved once), and writeGeometryFormat() turns those arrays into OBJ,
// STL or PLY. The arrays are transferable, which is what lets a worker do the
// heavy part without freezing the page.
//
// Each format follows the convention of the tool it is opened in:
//   OBJ   Y-up meters, as Blender, Maya and every DCC tool import it.
//   STL   Z-up millimetres on the build plate, exactly like the server's
//         slicer handoff (api/_lib/print/slicer.js placeOnBed), because STL is
//         read by slicers and a glTF-unit file opens on its side at 1 mm.
//   PLY   binary little-endian, Y-up meters, with normals, UVs and colour.
//   USDZ  Y-up meters (the USDZ exporter writes metersPerUnit = 1).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';

// ---- reading ---------------------------------------------------------------

let dracoLoader = null;
async function dracoFor(path) {
	if (!path || typeof Worker === 'undefined') return null;
	if (!dracoLoader) {
		const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
		dracoLoader = new DRACOLoader().setDecoderPath(path);
	}
	return dracoLoader;
}

/** A GLTFLoader that reads every encoding Forge produces. */
export async function makeGltfLoader({ dracoPath = null } = {}) {
	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);
	const draco = await dracoFor(dracoPath);
	if (draco) loader.setDRACOLoader(draco);
	return loader;
}

/**
 * Parse GLB bytes into a three.js scene.
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {{ dracoPath?: string|null }} [opts]
 */
export async function parseGlb(bytes, opts = {}) {
	const loader = await makeGltfLoader(opts);
	const ab =
		bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	return (await loader.parseAsync(ab, '')).scene;
}

// ---- baking ----------------------------------------------------------------

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();

function isTriangleMesh(o) {
	if (!o.isMesh || !o.geometry?.attributes?.position) return false;
	return o.drawMode === undefined || o.drawMode === THREE.TrianglesDrawMode;
}

/**
 * Every triangle mesh in the scene, baked to world space as plain typed arrays:
 * `{ name, position, normal, uv, color, index }`. Interleaved and normalized
 * (quantized) attributes are read through the attribute accessors, so the
 * output is always real Float32 meters.
 *
 * @param {THREE.Object3D} scene
 * @returns {{ meshes: object[], triangles: number, vertices: number }}
 */
export function collectMeshes(scene) {
	const meshes = [];
	let triangles = 0;
	let vertices = 0;
	scene.updateMatrixWorld(true);
	scene.traverse((o) => {
		if (!isTriangleMesh(o)) return;
		const g = o.geometry;
		const pos = g.attributes.position;
		const count = pos.count;
		// A skinned or morphed mesh draws a different shape from its rest
		// positions; getVertexPosition gives the shape as displayed.
		const deformed = !!(o.isSkinnedMesh || (g.morphAttributes?.position?.length && o.morphTargetInfluences?.length));
		const position = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			if (deformed) o.getVertexPosition(i, _v);
			else _v.fromBufferAttribute(pos, i);
			_v.applyMatrix4(o.matrixWorld);
			position[i * 3] = _v.x;
			position[i * 3 + 1] = _v.y;
			position[i * 3 + 2] = _v.z;
		}

		const mirrored = o.matrixWorld.determinant() < 0;
		let index;
		if (g.index) {
			index = new Uint32Array(g.index.count);
			for (let i = 0; i < index.length; i++) index[i] = g.index.getX(i);
		} else {
			index = new Uint32Array(count - (count % 3));
			for (let i = 0; i < index.length; i++) index[i] = i;
		}
		// A negative-determinant transform turns every triangle inside out; swap
		// two corners so the winding (which tools use for "outside") stays right.
		if (mirrored) {
			for (let i = 0; i + 2 < index.length; i += 3) {
				const t = index[i + 1];
				index[i + 1] = index[i + 2];
				index[i + 2] = t;
			}
		}

		let normal = null;
		if (g.attributes.normal && !deformed) {
			const src = g.attributes.normal;
			_normalMatrix.getNormalMatrix(o.matrixWorld);
			normal = new Float32Array(count * 3);
			for (let i = 0; i < count; i++) {
				_n.fromBufferAttribute(src, i).applyMatrix3(_normalMatrix).normalize();
				normal[i * 3] = _n.x;
				normal[i * 3 + 1] = _n.y;
				normal[i * 3 + 2] = _n.z;
			}
		} else {
			// No normals (common on rigged output) or a deformed shape: derive
			// them from the baked triangles so every format carries real ones.
			const tmp = new THREE.BufferGeometry();
			tmp.setAttribute('position', new THREE.BufferAttribute(position, 3));
			tmp.setIndex(new THREE.BufferAttribute(index, 1));
			tmp.computeVertexNormals();
			normal = tmp.attributes.normal.array;
		}

		let uv = null;
		if (g.attributes.uv) {
			const src = g.attributes.uv;
			uv = new Float32Array(count * 2);
			for (let i = 0; i < count; i++) {
				uv[i * 2] = src.getX(i);
				uv[i * 2 + 1] = src.getY(i);
			}
		}

		let color = null;
		if (g.attributes.color) {
			const src = g.attributes.color;
			color = new Float32Array(count * 3);
			for (let i = 0; i < count; i++) {
				color[i * 3] = src.getX(i);
				color[i * 3 + 1] = src.getY(i);
				color[i * 3 + 2] = src.getZ(i);
			}
		}

		meshes.push({ name: o.name || `mesh_${meshes.length}`, position, normal, uv, color, index });
		triangles += index.length / 3;
		vertices += count;
	});
	return { meshes, triangles, vertices };
}

/** The typed arrays a worker can take ownership of without copying. */
export function transferablesOf(meshes) {
	const out = [];
	for (const m of meshes) {
		for (const k of ['position', 'normal', 'uv', 'color', 'index']) if (m[k]) out.push(m[k].buffer);
	}
	return out;
}

/** Rebuild a scene from baked meshes (identity transforms, world-space data). */
export function sceneFromMeshes(meshes) {
	const scene = new THREE.Scene();
	for (const m of meshes) {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
		if (m.normal) g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
		if (m.uv) g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
		if (m.color) g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
		g.setIndex(new THREE.BufferAttribute(m.index, 1));
		const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
		mesh.name = m.name;
		scene.add(mesh);
	}
	scene.updateMatrixWorld(true);
	return scene;
}

// ---- writing ---------------------------------------------------------------

// The sizing policy of the server slicer handoff (api/_lib/print/slicer.js),
// kept identical so a browser STL and a server STL of one model match. The
// parity is pinned by tests/forge-export-formats.test.js against placeOnBed.
const MM_PER_METER = 1000;
const AUTO_SIZE_MM = 100;
const REAL_SIZE_RANGE_MM = [10, 250];

function bedPlacement(meshes) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const m of meshes) {
		const p = m.position;
		for (let i = 0; i < p.length; i += 3) {
			for (let a = 0; a < 3; a++) {
				const v = p[i + a];
				if (v < min[a]) min[a] = v;
				if (v > max[a]) max[a] = v;
			}
		}
	}
	const longest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
	if (!(longest > 0)) throw new RangeError('model has no extent to place on a print bed');
	const real = longest * MM_PER_METER;
	const longestMm = real >= REAL_SIZE_RANGE_MM[0] && real <= REAL_SIZE_RANGE_MM[1] ? real : AUTO_SIZE_MM;
	return { k: longestMm / longest, cx: (min[0] + max[0]) / 2, cz: (min[2] + max[2]) / 2, minY: min[1] };
}

function writeStl(meshes) {
	const { k, cx, cz, minY } = bedPlacement(meshes);
	let triangles = 0;
	for (const m of meshes) triangles += m.index.length / 3;
	const out = new ArrayBuffer(84 + triangles * 50);
	const dv = new DataView(out);
	const header = new TextEncoder().encode('three.ws Forge STL, Z-up millimetres');
	new Uint8Array(out, 0, 80).set(header.subarray(0, 80));
	dv.setUint32(80, triangles, true);
	let at = 84;
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	const e1 = new THREE.Vector3();
	const e2 = new THREE.Vector3();
	// Y-up (x, y, z) becomes Z-up (x, -z, y): a +90 degree turn about X, which
	// keeps triangle winding, so the facet normal is recomputed from the corners.
	const place = (p, i, v) =>
		v.set((p[i * 3] - cx) * k, -(p[i * 3 + 2] - cz) * k, (p[i * 3 + 1] - minY) * k);
	for (const m of meshes) {
		const p = m.position;
		const idx = m.index;
		for (let t = 0; t < idx.length; t += 3) {
			place(p, idx[t], a);
			place(p, idx[t + 1], b);
			place(p, idx[t + 2], c);
			e1.subVectors(b, a).cross(e2.subVectors(c, a));
			const len = e1.length();
			if (len > 0) e1.divideScalar(len);
			for (const [o, v] of [[0, e1], [12, a], [24, b], [36, c]]) {
				dv.setFloat32(at + o, v.x, true);
				dv.setFloat32(at + o + 4, v.y, true);
				dv.setFloat32(at + o + 8, v.z, true);
			}
			dv.setUint16(at + 48, 0, true);
			at += 50;
		}
	}
	return new Uint8Array(out);
}

function writePly(meshes) {
	const withUv = meshes.every((m) => m.uv);
	const withColor = meshes.some((m) => m.color);
	let vertices = 0;
	let faces = 0;
	for (const m of meshes) {
		vertices += m.position.length / 3;
		faces += m.index.length / 3;
	}
	const props = ['float x', 'float y', 'float z', 'float nx', 'float ny', 'float nz'];
	if (withUv) props.push('float s', 'float t');
	if (withColor) props.push('uchar red', 'uchar green', 'uchar blue');
	const header = new TextEncoder().encode(
		[
			'ply',
			'format binary_little_endian 1.0',
			'comment three.ws Forge export, Y-up meters',
			`element vertex ${vertices}`,
			...props.map((p) => `property ${p}`),
			`element face ${faces}`,
			'property list uchar uint vertex_indices',
			'end_header',
			'',
		].join('\n'),
	);
	const stride = 24 + (withUv ? 8 : 0) + (withColor ? 3 : 0);
	const out = new Uint8Array(header.byteLength + vertices * stride + faces * 13);
	out.set(header, 0);
	const dv = new DataView(out.buffer);
	let at = header.byteLength;
	for (const m of meshes) {
		const n = m.position.length / 3;
		for (let i = 0; i < n; i++) {
			for (let a = 0; a < 3; a++) dv.setFloat32(at + a * 4, m.position[i * 3 + a], true);
			for (let a = 0; a < 3; a++) dv.setFloat32(at + 12 + a * 4, m.normal ? m.normal[i * 3 + a] : 0, true);
			let o = at + 24;
			if (withUv) {
				// PLY texture coordinates put t = 0 at the bottom, glTF at the top.
				dv.setFloat32(o, m.uv[i * 2], true);
				dv.setFloat32(o + 4, 1 - m.uv[i * 2 + 1], true);
				o += 8;
			}
			if (withColor) {
				for (let a = 0; a < 3; a++) {
					const v = m.color ? m.color[i * 3 + a] : 1;
					dv.setUint8(o + a, Math.max(0, Math.min(255, Math.round(v * 255))));
				}
			}
			at += stride;
		}
	}
	let base = 0;
	for (const m of meshes) {
		const idx = m.index;
		for (let t = 0; t < idx.length; t += 3) {
			dv.setUint8(at, 3);
			dv.setUint32(at + 1, base + idx[t], true);
			dv.setUint32(at + 5, base + idx[t + 1], true);
			dv.setUint32(at + 9, base + idx[t + 2], true);
			at += 13;
		}
		base += m.position.length / 3;
	}
	return out;
}

/** Formats writeGeometryFormat() handles (worker-safe: no DOM needed). */
export const GEOMETRY_FORMATS = Object.freeze(['obj', 'stl', 'ply']);

/**
 * Write baked meshes as OBJ, STL or PLY.
 * @param {'obj'|'stl'|'ply'} id
 * @param {object[]} meshes  from collectMeshes()
 * @returns {Promise<Uint8Array>}
 */
export async function writeGeometryFormat(id, meshes) {
	if (id === 'obj') return new TextEncoder().encode(new OBJExporter().parse(sceneFromMeshes(meshes)));
	if (id === 'stl') return writeStl(meshes);
	if (id === 'ply') return writePly(meshes);
	throw new Error(`unknown geometry export format: ${id}`);
}

/**
 * USDZ for AR Quick Look. Needs a canvas for textures, so it runs on the page,
 * not in the worker.
 * @param {THREE.Object3D} scene
 * @returns {Promise<Uint8Array>}
 */
export async function writeUsdz(scene) {
	return new USDZExporter().parseAsync(scene);
}

// ---- failing honestly ------------------------------------------------------

/** True when an error is the JS engine running out of memory. */
export function isOutOfMemory(err) {
	const msg = String(err?.message || err || '');
	return /invalid string length|array buffer allocation failed|out of memory|allocation failed|invalid typed array length|invalid array buffer length/i.test(
		msg,
	);
}

/** What to tell a person whose model is too big to convert in the browser. */
export function tooLargeMessage(format, triangles) {
	const size = Number.isFinite(triangles) && triangles > 0 ? `${Math.round(triangles).toLocaleString('en-US')} triangles` : 'this model';
	const label = String(format || '').toUpperCase();
	return `${size} is too large to convert to ${label} in this browser tab. Download the GLB, or pick FBX or 3MF, which convert on the server.`;
}
