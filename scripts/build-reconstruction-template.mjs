// Build the selfie-reconstruction template:
//   workers/avatar-reconstruction/templates/parametric.glb
//
// The owned, license-clean replacement for the Wolf3D template the worker
// started on. Same rig, skin weights and identity sliders as the parametric
// avatar base (scripts/build-parametric-base.mjs, all CC0 Anny data), plus what
// a reconstruction needs:
//
//   - A separate `Head` mesh (the Head+Neck skin-weight region of the body,
//     split at weight 0.5) so the worker can reshape the face without touching
//     the body. Normals are welded across the split, so there is no neck seam.
//   - The 52 ARKit expression shapes on the head, eyes, teeth and tongue,
//     transferred from ICT-FaceKit (MIT) by scripts/build-ict-expression-targets.py,
//     plus the 15 Oculus visemes composed from them with the same recipes the
//     runtime lipsync uses (src/voice/arkit-blendshapes.js OCULUS_TO_ARKIT).
//   - One textured skin material shared by Head and Body (the worker paints
//     the photo into it), and a textured eye material whose iris the worker
//     recolours without tinting the sclera.
//   - Body-type presets (male / female / neutral) as slider weights over the
//     body macro morphs, each with the skeleton re-solved for that shape and
//     the floor offset that keeps the feet on the ground. The worker bakes the
//     preset into the output GLB (glb_ops.bake_body_type), so body_type
//     changes the avatar instead of being ignored.
//
// Everything the worker needs to know about the template (head mesh, material
// names, face anchors for the UV precompute, iris layout, presets) is written
// into the GLB's root `extras.reconstruction`, so the GLB describes itself.
//
// Run: node scripts/build-reconstruction-template.mjs [--out <path>]
// Then: python workers/avatar-reconstruction/precompute_uv.py --template parametric

import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import {
	buildParametricDocument,
	loadTarget,
	MORPHS,
	SRC,
	SCALE,
	FILE_SIZE_BUDGET_MB,
	MORPH_VRAM_BUDGET_MB,
	morphTextureBytes,
} from './build-parametric-base.mjs';
import { ARKIT_NAMES, OCULUS_TO_ARKIT } from '../src/voice/arkit-blendshapes.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARKIT_DIR = resolve(ROOT, 'avatar-sources/ict-facekit/anny-targets');
const DEFAULT_OUT = resolve(ROOT, 'workers/avatar-reconstruction/templates/parametric.glb');

// Must match HEAD_SPLIT_WEIGHT in scripts/build-ict-expression-targets.py: the
// expression deltas fade to zero above this weight, so every vertex the Head
// and Body meshes share is motionless under every expression.
const HEAD_SPLIT_WEIGHT = 0.5;

const SKIN_TEXTURE_SIZE = 2048;
const EYE_TEXTURE_SIZE = 1024;
// Template skin, sRGB. The worker tints the whole texture toward the person's
// sampled complexion and paints the photo over the head, so this is only what
// shows before (or without) a reconstruction.
const SKIN_SRGB = [222, 173, 148];

// Iris layout on the eye texture. Eye UVs are an azimuthal-equidistant map of
// each eyeball around its forward (+Z) axis: texture radius = angle / 180° x 0.5.
// A human iris spans ~11.5 mm on a ~24 mm eyeball, about 28° off the axis.
const IRIS_DEG = 28;
const PUPIL_DEG = 9.5;
const IRIS_RADIUS_UV = (IRIS_DEG / 180) * 0.5;
const PUPIL_RADIUS_UV = (PUPIL_DEG / 180) * 0.5;

// body_type presets: slider weights over the CC0 body macro morphs. The base
// mesh is MakeHuman's neutral phenotype (gender 0.5), so `neutral` is the bare
// base and the other two lean it toward each sex's average build. The gender
// macros already carry most of the stature difference (0.85 of either moves the
// crown about 6 cm, while the full height macro moves it about 70 cm), so the
// height sliders only trim. Baked statures: male 1.74 m, neutral 1.67 m,
// female 1.60 m. Weights stay well short of 1 so each reads as an ordinary adult.
const BODY_TYPES = {
	neutral: {},
	male: { bodyMasculine: 0.85, bodyMuscular: 0.35, bodyHeavier: 0.1, heightTaller: 0.03, hipsNarrower: 0.25 },
	female: { bodyFeminine: 0.85, bodySofter: 0.2, bodyThinner: 0.1, heightShorter: 0.01, hipsWider: 0.3 },
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

const add3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const round = (v, k = 6) => Number(v.toFixed(k));

/** Weighted sum of delta maps (Map(origVertex → [dx,dy,dz])). */
function combine(recipe, lookup) {
	const out = new Map();
	for (const [name, w] of Object.entries(recipe)) {
		if (!w) continue;
		const deltas = lookup(name);
		if (!deltas) throw new Error(`recipe references unknown shape: ${name}`);
		for (const [v, d] of deltas) out.set(v, add3(out.get(v) || [0, 0, 0], d, w));
	}
	return out;
}

/**
 * Viseme recipe → ARKit weights. ARKit's mouthClose is defined relative to an
 * open jaw (it closes the lips over a dropped jaw), so a recipe that seals the
 * lips with mouthClose alone would push them through each other. Pair it with
 * the same jawOpen it is meant to counter, exactly as the face is captured.
 */
function visemeRecipe(name) {
	const r = { ...(OCULUS_TO_ARKIT[name] || {}) };
	if (r.mouthClose && !r.jawOpen) r.jawOpen = r.mouthClose;
	return r;
}

async function encodeJpeg(rgb, size, quality = 92) {
	return sharp(Buffer.from(rgb.buffer), { raw: { width: size, height: size, channels: 3 } })
		.jpeg({ quality, chromaSubsampling: '4:4:4' })
		.toBuffer();
}

function skinTexture(size) {
	const px = new Uint8Array(size * size * 3);
	for (let i = 0; i < size * size; i++) px.set(SKIN_SRGB, i * 3);
	return px;
}

/**
 * Procedural eye: warm off-white sclera, a brown iris with radial fibres and a
 * darker limbal ring, a black pupil. The worker recolours only the iris disc
 * (radius IRIS_RADIUS_UV around the centre), keeping its luminance structure.
 */
function eyeTexture(size) {
	const px = new Uint8Array(size * size * 3);
	const sclera = [236, 232, 226];
	const iris = [112, 74, 46];
	const smooth = (e0, e1, x) => {
		const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
		return t * t * (3 - 2 * t);
	};
	const edge = 1.5 / size;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const u = (x + 0.5) / size - 0.5;
			const v = (y + 0.5) / size - 0.5;
			const r = Math.hypot(u, v);
			const phi = Math.atan2(v, u);
			const t = r / IRIS_RADIUS_UV;
			// Radial fibres and a soft collarette: luminance only.
			const fibre = 0.82 + 0.1 * Math.sin(phi * 61) * Math.sin(phi * 23 + t * 9) + 0.08 * Math.cos(t * 14);
			const limbus = 1 - 0.45 * smooth(0.78, 1.0, t);
			const lum = fibre * limbus;
			const inIris = 1 - smooth(IRIS_RADIUS_UV - edge, IRIS_RADIUS_UV + edge, r);
			const inPupil = 1 - smooth(PUPIL_RADIUS_UV - edge, PUPIL_RADIUS_UV + edge, r);
			const o = (y * size + x) * 3;
			for (let c = 0; c < 3; c++) {
				const irisC = iris[c] * lum * (1 - inPupil) + 8 * inPupil;
				px[o + c] = Math.round(sclera[c] * (1 - inIris) + irisC * inIris);
			}
		}
	}
	return px;
}

/* ── build ───────────────────────────────────────────────────────────────── */

async function main() {
	const outFlag = process.argv.indexOf('--out');
	const OUT = outFlag > 0 ? resolve(process.argv[outFlag + 1]) : DEFAULT_OUT;

	// Head weight per original vertex (Head + Neck bones), as the transfer used.
	const weights = JSON.parse(readFileSync(resolve(SRC, 'rigs/weights.mixamo.json'), 'utf8')).weights;
	const headW = new Map();
	for (const bone of ['mixamorig:Head', 'mixamorig:Neck']) {
		for (const [v, w] of weights[bone]) headW.set(v, (headW.get(v) || 0) + w);
	}
	const isHeadFace = (face) =>
		face.corners.reduce((s, [v]) => s + (headW.get(v) || 0), 0) / face.corners.length >= HEAD_SPLIT_WEIGHT;

	// Eye geometry (source units) for the eye UV map and the face anchors.
	const objText = readFileSync(resolve(SRC, '3dobjs/base.obj'), 'utf8');
	const groupVerts = new Map();
	{
		let group = '';
		for (const line of objText.split('\n')) {
			if (line.startsWith('g ')) group = line.slice(2).trim();
			else if (line.startsWith('f ')) {
				if (!groupVerts.has(group)) groupVerts.set(group, new Set());
				for (const c of line.slice(2).trim().split(/\s+/)) groupVerts.get(group).add(+c.split('/')[0] - 1);
			}
		}
	}
	const positions = [];
	for (const line of objText.split('\n')) {
		if (line.startsWith('v ')) {
			const [, x, y, z] = line.split(/\s+/);
			positions.push([+x, +y, +z]);
		}
	}
	const centroidOf = (set) => {
		const c = [0, 0, 0];
		for (const v of set) for (let k = 0; k < 3; k++) c[k] += positions[v][k];
		return c.map((x) => x / set.size);
	};
	const eyeCentre = { l: centroidOf(groupVerts.get('helper-l-eye')), r: centroidOf(groupVerts.get('helper-r-eye')) };
	const eyeOf = new Map();
	for (const side of ['l', 'r']) for (const v of groupVerts.get(`helper-${side}-eye`)) eyeOf.set(v, side);
	const eyeRadius = (() => {
		let s = 0;
		for (const v of groupVerts.get('helper-l-eye')) {
			const p = positions[v];
			s += Math.hypot(p[0] - eyeCentre.l[0], p[1] - eyeCentre.l[1], p[2] - eyeCentre.l[2]);
		}
		return s / groupVerts.get('helper-l-eye').size;
	})();
	const eyeUv = (v) => {
		const c = eyeCentre[eyeOf.get(v)];
		const p = positions[v];
		const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
		const len = Math.hypot(...d) || 1;
		const theta = Math.acos(Math.max(-1, Math.min(1, d[2] / len)));
		const phi = Math.atan2(d[1], d[0]);
		const r = (theta / Math.PI) * 0.5;
		return [0.5 + r * Math.cos(phi), 0.5 - r * Math.sin(phi)];
	};

	// ARKit shapes (decimetres, original vertex indices) and visemes.
	const arkit = new Map(ARKIT_NAMES.map((n) => [n, loadTarget(n, ARKIT_DIR)]));
	const visemeNames = Object.keys(OCULUS_TO_ARKIT);
	if (visemeNames.length !== 15) throw new Error(`expected 15 visemes, found ${visemeNames.length}`);
	const extraMorphs = [
		...ARKIT_NAMES.map((name) => ({ name, deltas: arkit.get(name), alwaysOn: ['Head'] })),
		...visemeNames.map((name) => ({
			name,
			deltas: combine(visemeRecipe(name), (n) => arkit.get(n)),
			alwaysOn: ['Head'],
		})),
	];

	const materials = new Map();
	const textures = {
		skin: await encodeJpeg(skinTexture(SKIN_TEXTURE_SIZE), SKIN_TEXTURE_SIZE),
		eyes: await encodeJpeg(eyeTexture(EYE_TEXTURE_SIZE), EYE_TEXTURE_SIZE, 94),
	};
	const materialFor = (sub, doc) => {
		const key = sub.material;
		if (materials.has(key)) return materials.get(key);
		const m = doc.createMaterial(key).setMetallicFactor(0).setRoughnessFactor(sub.rough);
		if (sub.texture) {
			const tex = doc.createTexture(key).setImage(new Uint8Array(textures[sub.texture])).setMimeType('image/jpeg');
			m.setBaseColorTexture(tex).setBaseColorFactor([1, 1, 1, 1]);
		} else {
			m.setBaseColorFactor(sub.color);
		}
		materials.set(key, m);
		return m;
	};

	const submeshes = [
		{ name: 'Body', groups: ['body'], normalGroups: ['body'], faceFilter: (f) => !isHeadFace(f), material: 'Parametric_Skin', texture: 'skin', rough: 0.62 },
		{ name: 'Head', groups: ['body'], normalGroups: ['body'], faceFilter: isHeadFace, material: 'Parametric_Skin', texture: 'skin', rough: 0.62 },
		{ name: 'Eyes', groups: ['helper-l-eye', 'helper-r-eye'], uvFor: eyeUv, material: 'Parametric_Eyes', texture: 'eyes', rough: 0.15 },
		{ name: 'Teeth', groups: ['helper-upper-teeth', 'helper-lower-teeth'], material: 'Parametric_Teeth', color: [0.93, 0.91, 0.86, 1], rough: 0.4 },
		{ name: 'Tongue', groups: ['helper-tongue'], material: 'Parametric_Tongue', color: [0.66, 0.3, 0.28, 1], rough: 0.6 },
	];

	const built = buildParametricDocument({
		morphs: MORPHS,
		submeshes,
		extraMorphs,
		materialFor,
		weldNormals: true,
		generator: 'three.ws build-reconstruction-template',
		name: 'ReconstructionTemplate',
	});
	const { doc, stats, boneNames, jointWorld, jointWorldFor, xform, morphDeltas } = built;

	// Face anchors (mesh space, metres) for the UV precompute's alignment of
	// MediaPipe's canonical face onto this head. Same definitions as the ICT
	// transfer: midline nose tip, mouth-angles-up corner clusters, and the
	// visible centre of each eye opening (front of the eyeball).
	const headVerts = [...groupVerts.get('body')].filter((v) => (headW.get(v) || 0) >= HEAD_SPLIT_WEIGHT);
	const mid = headVerts.filter((v) => Math.abs(positions[v][0]) < 1e-3);
	const nose = mid.reduce((a, b) => (positions[b][2] > positions[a][2] ? b : a));
	const angles = loadTarget('mouth/mouth-angles-up');
	let maxMag = 0;
	for (const d of angles.values()) maxMag = Math.max(maxMag, Math.hypot(...d));
	const top = [...angles.entries()]
		.filter(([v, d]) => Math.hypot(...d) >= 0.95 * maxMag && positions[v][2] > positions[nose][2] - 0.45)
		.map(([v]) => v);
	const cornerOf = (sign) => centroidOf(new Set(top.filter((v) => Math.sign(positions[v][0]) === sign)));
	const eyeFront = (c) => [c[0], c[1], c[2] + eyeRadius * 0.85];
	const anchors = {
		noseTip: xform(positions[nose]),
		mouthCornerLeft: xform(cornerOf(1)),
		mouthCornerRight: xform(cornerOf(-1)),
		eyeLeft: xform(eyeFront(eyeCentre.l)),
		eyeRight: xform(eyeFront(eyeCentre.r)),
	};

	// Body-type presets: weights, re-solved skeleton, floor offset.
	const deltaOf = new Map(morphDeltas.map((m) => [m.name, m.deltas]));
	const bodyVerts = [...groupVerts.get('body')];
	const minY = (P) => bodyVerts.reduce((m, v) => Math.min(m, P[v][1]), Infinity);
	const restFloor = minY(positions);
	const bodyTypes = {};
	for (const [type, recipe] of Object.entries(BODY_TYPES)) {
		const moved = combine(recipe, (n) => deltaOf.get(n));
		const P = positions.map((p, v) => (moved.has(v) ? add3(p, moved.get(v)) : p));
		const offsetY = (restFloor - minY(P)) * SCALE;
		const joints = jointWorldFor(P).map(([x, y, z]) => [round(x), round(y + offsetY), round(z)]);
		bodyTypes[type] = { morphs: recipe, offsetY: round(offsetY), joints };
	}

	doc.getRoot().setExtras({
		reconstruction: {
			version: 1,
			headMesh: 'Head',
			skinMeshes: ['Body', 'Head'],
			materials: { skin: 'Parametric_Skin', eyes: 'Parametric_Eyes', hair: null },
			eyeIris: { centerUv: [0.5, 0.5], radiusUv: round(IRIS_RADIUS_UV), pupilRadiusUv: round(PUPIL_RADIUS_UV) },
			anchors: Object.fromEntries(Object.entries(anchors).map(([k, p]) => [k, p.map((x) => round(x))])),
			skinJoints: boneNames,
			bodyTypes,
		},
	});

	await new NodeIO().write(OUT, doc);
	const size = statSync(OUT).size;
	const vram = morphTextureBytes(stats) / 1024 / 1024;
	console.log(`wrote ${OUT} (${(size / 1024 / 1024).toFixed(2)} MB)`);
	for (const s of stats) console.log(` ${s.name}: ${s.verts} verts, ${s.tris} tris, ${s.morphs} morphs`);
	console.log(` hips rest height: ${jointWorld.get('mixamorig:Hips')[1].toFixed(3)} m`);
	for (const [t, b] of Object.entries(bodyTypes)) {
		const hips = b.joints[boneNames.indexOf('mixamorig:Hips')];
		console.log(` body_type ${t}: hips ${hips[1].toFixed(3)} m, floor offset ${(b.offsetY * 100).toFixed(2)} cm`);
	}
	console.log(` morph texture: ${vram.toFixed(1)} MB VRAM (budget ${MORPH_VRAM_BUDGET_MB} MB)`);
	if (size > FILE_SIZE_BUDGET_MB * 1024 * 1024) {
		throw new Error(`output ${(size / 1024 / 1024).toFixed(2)} MB exceeds the ${FILE_SIZE_BUDGET_MB} MB budget`);
	}
	if (vram > MORPH_VRAM_BUDGET_MB) {
		throw new Error(`morph targets need ${vram.toFixed(1)} MB of VRAM, over the ${MORPH_VRAM_BUDGET_MB} MB budget`);
	}
}

await main();
