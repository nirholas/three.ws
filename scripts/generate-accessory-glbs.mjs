#!/usr/bin/env node
// Procedural accessory GLB generator.
//
// Builds the seven small GLB files referenced in public/accessories/presets.json:
//   hat-baseball.glb, hat-beanie.glb, hat-cowboy.glb,
//   glasses-round.glb, glasses-shades.glb,
//   earrings-hoops.glb, earrings-studs.glb
//
// Each is a real glTF 2.0 binary with positions, normals, UVs, indices, and a
// PBR material — small enough (< 8 KB) to commit to the repo, large enough to
// be visibly correct when attached to a humanoid avatar's Head bone.
//
// Coordinates are in meters, oriented for a head bone whose +Y is up and +Z
// is forward (the standard glTF convention used by Mixamo, RPM, and Avaturn
// outputs). The Head bone is typically located at the top of the neck; these
// meshes are offset to sit naturally on top of / in front of / beside it.
//
// Run with: node scripts/generate-accessory-glbs.mjs

import { Document, NodeIO } from '@gltf-transform/core';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '..', 'public', 'accessories');

// ── Geometry primitives ────────────────────────────────────────────────────

// Tessellated half-sphere ("dome") of radius r, sliced at y = 0.
function halfSphere({ r = 1, segments = 16, rings = 8, yOffset = 0 } = {}) {
	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];

	for (let i = 0; i <= rings; i++) {
		const v = i / rings;
		const phi = v * (Math.PI / 2); // 0 (top) → π/2 (equator)
		for (let j = 0; j <= segments; j++) {
			const u = j / segments;
			const theta = u * Math.PI * 2;
			const x = r * Math.sin(phi) * Math.cos(theta);
			const y = r * Math.cos(phi) + yOffset;
			const z = r * Math.sin(phi) * Math.sin(theta);
			positions.push(x, y, z);
			const nLen = Math.hypot(x, y - yOffset, z) || 1;
			normals.push(x / nLen, (y - yOffset) / nLen, z / nLen);
			uvs.push(u, 1 - v);
		}
	}

	const stride = segments + 1;
	for (let i = 0; i < rings; i++) {
		for (let j = 0; j < segments; j++) {
			const a = i * stride + j;
			const b = a + stride;
			indices.push(a, b, a + 1, b, b + 1, a + 1);
		}
	}
	return { positions, normals, uvs, indices };
}

// Solid cylinder of radius r between y=y0 and y=y1. side + caps.
function cylinder({ r = 1, y0 = 0, y1 = 1, segments = 24 } = {}) {
	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];

	// Side
	for (let j = 0; j <= segments; j++) {
		const u = j / segments;
		const theta = u * Math.PI * 2;
		const x = Math.cos(theta);
		const z = Math.sin(theta);
		// bottom + top
		positions.push(r * x, y0, r * z);
		normals.push(x, 0, z);
		uvs.push(u, 0);
		positions.push(r * x, y1, r * z);
		normals.push(x, 0, z);
		uvs.push(u, 1);
	}
	for (let j = 0; j < segments; j++) {
		const a = j * 2;
		const b = a + 2;
		indices.push(a, a + 1, b + 1, a, b + 1, b);
	}

	// Caps — fan triangulated from centers.
	const ringStart = positions.length / 3;
	// Top center
	positions.push(0, y1, 0);
	normals.push(0, 1, 0);
	uvs.push(0.5, 0.5);
	const topCenter = ringStart;
	for (let j = 0; j <= segments; j++) {
		const u = j / segments;
		const theta = u * Math.PI * 2;
		positions.push(r * Math.cos(theta), y1, r * Math.sin(theta));
		normals.push(0, 1, 0);
		uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
	}
	for (let j = 0; j < segments; j++) {
		indices.push(topCenter, topCenter + 1 + j, topCenter + 2 + j);
	}

	const botCenter = positions.length / 3;
	positions.push(0, y0, 0);
	normals.push(0, -1, 0);
	uvs.push(0.5, 0.5);
	for (let j = 0; j <= segments; j++) {
		const u = j / segments;
		const theta = u * Math.PI * 2;
		positions.push(r * Math.cos(theta), y0, r * Math.sin(theta));
		normals.push(0, -1, 0);
		uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
	}
	for (let j = 0; j < segments; j++) {
		indices.push(botCenter, botCenter + 2 + j, botCenter + 1 + j);
	}

	return { positions, normals, uvs, indices };
}

// Annulus (flat ring) lying in the XZ plane at height y. innerR..outerR.
function annulus({ y = 0, innerR = 1, outerR = 1.4, segments = 32 } = {}) {
	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];
	for (let j = 0; j <= segments; j++) {
		const u = j / segments;
		const theta = u * Math.PI * 2;
		const c = Math.cos(theta);
		const s = Math.sin(theta);
		positions.push(innerR * c, y, innerR * s);
		normals.push(0, 1, 0);
		uvs.push(u, 0);
		positions.push(outerR * c, y, outerR * s);
		normals.push(0, 1, 0);
		uvs.push(u, 1);
	}
	for (let j = 0; j < segments; j++) {
		const a = j * 2;
		const b = a + 2;
		indices.push(a, a + 1, b + 1, a, b + 1, b);
		indices.push(a, b + 1, a + 1, a, b, b + 1); // double-sided
	}
	return { positions, normals, uvs, indices };
}

// Torus in the XY plane, tube radius r2, ring radius r1.
function torus({ r1 = 1, r2 = 0.1, segments = 32, tubeSegments = 12 } = {}) {
	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];
	for (let i = 0; i <= segments; i++) {
		const u = i / segments;
		const theta = u * Math.PI * 2;
		const cx = r1 * Math.cos(theta);
		const cy = r1 * Math.sin(theta);
		for (let j = 0; j <= tubeSegments; j++) {
			const v = j / tubeSegments;
			const phi = v * Math.PI * 2;
			const nx = Math.cos(theta) * Math.cos(phi);
			const ny = Math.sin(theta) * Math.cos(phi);
			const nz = Math.sin(phi);
			positions.push(cx + r2 * nx, cy + r2 * ny, r2 * nz);
			normals.push(nx, ny, nz);
			uvs.push(u, v);
		}
	}
	const stride = tubeSegments + 1;
	for (let i = 0; i < segments; i++) {
		for (let j = 0; j < tubeSegments; j++) {
			const a = i * stride + j;
			const b = a + stride;
			indices.push(a, b, a + 1, b, b + 1, a + 1);
		}
	}
	return { positions, normals, uvs, indices };
}

// Full sphere of radius r centered at origin.
function sphere({ r = 1, segments = 16, rings = 10 } = {}) {
	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];
	for (let i = 0; i <= rings; i++) {
		const v = i / rings;
		const phi = v * Math.PI;
		for (let j = 0; j <= segments; j++) {
			const u = j / segments;
			const theta = u * Math.PI * 2;
			const x = Math.sin(phi) * Math.cos(theta);
			const y = Math.cos(phi);
			const z = Math.sin(phi) * Math.sin(theta);
			positions.push(r * x, r * y, r * z);
			normals.push(x, y, z);
			uvs.push(u, 1 - v);
		}
	}
	const stride = segments + 1;
	for (let i = 0; i < rings; i++) {
		for (let j = 0; j < segments; j++) {
			const a = i * stride + j;
			const b = a + stride;
			indices.push(a, b, a + 1, b, b + 1, a + 1);
		}
	}
	return { positions, normals, uvs, indices };
}

// ── GLB writer ─────────────────────────────────────────────────────────────

// Build a GLB from an array of { geom, color, name, translate? } parts.
// All parts live under a single root node so the AccessoryManager / bake step
// can re-parent the whole accessory under a bone with one operation.
async function writeGLB(filePath, parts, { rootName }) {
	const doc = new Document();
	doc.createBuffer();
	doc.getRoot().getAsset().generator = 'three.ws procedural accessory generator';

	const root = doc.createNode(rootName);

	for (const part of parts) {
		const positions = doc
			.createAccessor(part.name + '_pos')
			.setType('VEC3')
			.setArray(new Float32Array(part.geom.positions));
		const normals = doc
			.createAccessor(part.name + '_nor')
			.setType('VEC3')
			.setArray(new Float32Array(part.geom.normals));
		const uvs = doc
			.createAccessor(part.name + '_uv')
			.setType('VEC2')
			.setArray(new Float32Array(part.geom.uvs));
		const indices = doc
			.createAccessor(part.name + '_idx')
			.setType('SCALAR')
			.setArray(new Uint16Array(part.geom.indices));

		const material = doc
			.createMaterial(part.name + '_mat')
			.setBaseColorFactor([part.color[0], part.color[1], part.color[2], 1])
			.setMetallicFactor(part.metallic ?? 0.05)
			.setRoughnessFactor(part.roughness ?? 0.7)
			.setDoubleSided(true);

		const prim = doc
			.createPrimitive()
			.setAttribute('POSITION', positions)
			.setAttribute('NORMAL', normals)
			.setAttribute('TEXCOORD_0', uvs)
			.setIndices(indices)
			.setMaterial(material);

		const mesh = doc.createMesh(part.name).addPrimitive(prim);
		const node = doc.createNode(part.name).setMesh(mesh);
		if (part.translate) node.setTranslation(part.translate);
		if (part.rotation) node.setRotation(part.rotation);
		if (part.scale) node.setScale(part.scale);
		root.addChild(node);
	}

	const scene = doc.createScene(rootName).addChild(root);
	doc.getRoot().setDefaultScene(scene);

	const io = new NodeIO();
	const bytes = await io.writeBinary(doc);
	await writeFile(filePath, Buffer.from(bytes));
	return bytes.byteLength;
}

// ── Accessory definitions ──────────────────────────────────────────────────
//
// All meshes are authored relative to the Head bone origin, which on a Mixamo
// rig sits at the top of the neck. +Y is up, +Z is forward, scale is meters.
// Head radius is roughly 0.10–0.12 m, so a hat needs r ≈ 0.11 to fit snugly.

const ACCESSORIES = {
	'hat-baseball.glb': {
		rootName: 'HatBaseball',
		parts: [
			// Crown: dome above the head, sitting just above the head bone.
			{
				name: 'crown',
				geom: halfSphere({ r: 0.115, segments: 24, rings: 10, yOffset: 0.10 }),
				color: [0.07, 0.18, 0.45], // navy
			},
			// Visor: thin disc, offset forward.
			{
				name: 'visor',
				geom: annulus({ y: 0.105, innerR: 0.06, outerR: 0.17, segments: 24 }),
				color: [0.07, 0.18, 0.45],
				translate: [0, 0, 0.06], // push forward
				scale: [1, 1, 0.6], // squash front-back so it looks like a visor not a disc
			},
		],
	},

	'hat-beanie.glb': {
		rootName: 'HatBeanie',
		parts: [
			{
				name: 'beanie',
				geom: halfSphere({ r: 0.125, segments: 20, rings: 10, yOffset: 0.08 }),
				color: [0.55, 0.12, 0.22], // wine red
				roughness: 0.95, // wool
			},
			// Cuff (folded brim) — short cylinder around the base.
			{
				name: 'cuff',
				geom: cylinder({ r: 0.125, y0: 0.07, y1: 0.10, segments: 24 }),
				color: [0.45, 0.08, 0.16],
				roughness: 0.95,
			},
		],
	},

	'hat-cowboy.glb': {
		rootName: 'HatCowboy',
		parts: [
			// Crown — tall halfsphere
			{
				name: 'crown',
				geom: halfSphere({ r: 0.11, segments: 20, rings: 10, yOffset: 0.11 }),
				color: [0.32, 0.18, 0.07], // saddle brown
				scale: [1, 1.4, 1],
			},
			// Brim — wide flat ring with subtle upcurl approximated via scale.
			{
				name: 'brim',
				geom: annulus({ y: 0.11, innerR: 0.10, outerR: 0.24, segments: 32 }),
				color: [0.32, 0.18, 0.07],
			},
		],
	},

	'glasses-round.glb': {
		rootName: 'GlassesRound',
		parts: [
			// Left lens rim
			{
				name: 'rim_l',
				geom: torus({ r1: 0.034, r2: 0.005, segments: 24, tubeSegments: 8 }),
				color: [0.08, 0.08, 0.08],
				metallic: 0.7,
				roughness: 0.3,
				translate: [-0.038, 0.005, 0.085],
			},
			// Right lens rim
			{
				name: 'rim_r',
				geom: torus({ r1: 0.034, r2: 0.005, segments: 24, tubeSegments: 8 }),
				color: [0.08, 0.08, 0.08],
				metallic: 0.7,
				roughness: 0.3,
				translate: [0.038, 0.005, 0.085],
			},
			// Bridge
			{
				name: 'bridge',
				geom: cylinder({ r: 0.005, y0: 0, y1: 0.018, segments: 8 }),
				color: [0.08, 0.08, 0.08],
				metallic: 0.7,
				roughness: 0.3,
				translate: [-0.009, 0.012, 0.085],
				rotation: [0, 0, -0.707, 0.707], // rotate to lie horizontally along X
			},
		],
	},

	'glasses-shades.glb': {
		rootName: 'GlassesShades',
		parts: [
			// Single wraparound lens approximated by a flat squashed annulus.
			{
				name: 'lens',
				geom: annulus({ y: 0, innerR: 0.0, outerR: 0.085, segments: 32 }),
				color: [0.05, 0.05, 0.08],
				metallic: 0.1,
				roughness: 0.15,
				translate: [0, 0.005, 0.09],
				scale: [1, 0.45, 0.4],
			},
		],
	},

	'earrings-hoops.glb': {
		rootName: 'EarringsHoops',
		parts: [
			{
				name: 'hoop_l',
				geom: torus({ r1: 0.018, r2: 0.0025, segments: 20, tubeSegments: 8 }),
				color: [0.95, 0.78, 0.20], // gold
				metallic: 1.0,
				roughness: 0.2,
				translate: [-0.085, -0.02, 0.0],
			},
			{
				name: 'hoop_r',
				geom: torus({ r1: 0.018, r2: 0.0025, segments: 20, tubeSegments: 8 }),
				color: [0.95, 0.78, 0.20],
				metallic: 1.0,
				roughness: 0.2,
				translate: [0.085, -0.02, 0.0],
			},
		],
	},

	'earrings-studs.glb': {
		rootName: 'EarringsStuds',
		parts: [
			{
				name: 'stud_l',
				geom: sphere({ r: 0.005, segments: 12, rings: 8 }),
				color: [0.95, 0.95, 0.98],
				metallic: 1.0,
				roughness: 0.1,
				translate: [-0.082, -0.005, 0.0],
			},
			{
				name: 'stud_r',
				geom: sphere({ r: 0.005, segments: 12, rings: 8 }),
				color: [0.95, 0.95, 0.98],
				metallic: 1.0,
				roughness: 0.1,
				translate: [0.082, -0.005, 0.0],
			},
		],
	},
};

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
	const results = [];
	for (const [filename, spec] of Object.entries(ACCESSORIES)) {
		const out = path.join(OUT_DIR, filename);
		const bytes = await writeGLB(out, spec.parts, { rootName: spec.rootName });
		results.push({ filename, bytes });
	}
	console.log('Wrote', results.length, 'accessory GLBs to', OUT_DIR);
	for (const r of results) {
		console.log(`  ${r.filename.padEnd(28)} ${r.bytes.toString().padStart(6)} bytes`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
