// Pumpkin geometry and carving, free of any DOM so the same code runs in the
// page and in the test suite.
//
// The pumpkin is a hollow ribbed shell: an outer ribbed ellipsoid minus a
// smaller copy of itself. Carving is real constructive solid geometry
// (three-bvh-csg): each cut extrudes a shape along the surface normal, through
// the wall, and subtracts it from the shell. The walls a cut exposes get the
// pale flesh material, so a lit candle shows through the opening.

import {
	BufferGeometry,
	Float32BufferAttribute,
	CylinderGeometry,
	ExtrudeGeometry,
	IcosahedronGeometry,
	Matrix4,
	MeshStandardMaterial,
	Shape,
	Vector3,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

export const RIBS = 10;
export const SQUASH = 0.82; // height of the pumpkin relative to its width
export const WALL = 0.14; // wall thickness, as a fraction of the radius
const CUT_DEPTH = 0.7; // cutters reach well past the wall on both sides

export const SHAPES = [
	{ id: 'round', label: 'Round', hint: 'Eyes and mouths' },
	{ id: 'triangle', label: 'Triangle', hint: 'Classic jack-o-lantern eyes' },
	{ id: 'square', label: 'Square', hint: 'Teeth and windows' },
	{ id: 'star', label: 'Star', hint: 'Five-point star' },
	{ id: 'moon', label: 'Moon', hint: 'Crescent moon' },
	{ id: 'bat', label: 'Bat', hint: 'Bat silhouette' },
];

/** Radius of the ribbed pumpkin surface along a unit direction (before squash). */
export function ribRadius(x, z, sinPolar) {
	return 1 + 0.06 * Math.cos(RIBS * Math.atan2(z, x)) * sinPolar;
}

/** Outward unit normal of the squashed ellipsoid at a point on it. */
export function surfaceNormal(point, target = new Vector3()) {
	return target.set(point.x, point.y / (SQUASH * SQUASH), point.z).normalize();
}

/** Indexed, watertight ribbed pumpkin body with a dimple at each pole. */
export function createBodyGeometry(detail = 22) {
	let g = new IcosahedronGeometry(1, detail);
	g.deleteAttribute('uv');
	g.deleteAttribute('normal');
	g = mergeVertices(g, 1e-5);
	const pos = g.getAttribute('position');
	const v = new Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const sinPolar = Math.hypot(v.x, v.z);
		const r = ribRadius(v.x, v.z, sinPolar);
		const dimple = 0.14 * Math.pow(Math.max(0, Math.abs(v.y) - 0.82) / 0.18, 2);
		pos.setXYZ(i, v.x * r, (v.y - Math.sign(v.y) * dimple) * SQUASH * r, v.z * r);
	}
	g.computeVertexNormals();
	return g;
}

export function createMaterials() {
	return {
		skin: new MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.52, metalness: 0 }),
		flesh: new MeshStandardMaterial({
			color: 0xffc766,
			roughness: 0.85,
			metalness: 0,
			emissive: 0xff8a1a,
			emissiveIntensity: 0.0,
		}),
	};
}

function makeEvaluator() {
	const ev = new Evaluator();
	ev.attributes = ['position', 'normal'];
	ev.useGroups = true;
	return ev;
}

/**
 * The uncarved hollow pumpkin: a Brush whose outer wall uses `skin` and whose
 * inner cavity uses `flesh`.
 */
export function createShell(materials, detail = 22) {
	const outer = new Brush(createBodyGeometry(detail), materials.skin);
	const inner = new Brush(createBodyGeometry(detail), materials.flesh);
	inner.scale.setScalar(1 - WALL);
	inner.updateMatrixWorld(true);
	outer.updateMatrixWorld(true);
	return makeEvaluator().evaluate(outer, inner, SUBTRACTION);
}

function shapeOutline(id) {
	const s = new Shape();
	switch (id) {
		case 'triangle':
			s.moveTo(0, 0.5).lineTo(-0.5, -0.4).lineTo(0.5, -0.4).closePath();
			break;
		case 'square':
			s.moveTo(-0.4, -0.4).lineTo(0.4, -0.4).lineTo(0.4, 0.4).lineTo(-0.4, 0.4).closePath();
			break;
		case 'star': {
			for (let i = 0; i < 10; i++) {
				const a = Math.PI / 2 + (i * Math.PI) / 5;
				const r = i % 2 === 0 ? 0.52 : 0.22;
				if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
				else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
			}
			s.closePath();
			break;
		}
		case 'moon': {
			s.absarc(0, 0, 0.5, Math.PI * 0.2, Math.PI * 1.8, false);
			s.absarc(0.2, 0, 0.4, Math.PI * 1.75, Math.PI * 0.25, true);
			break;
		}
		case 'bat': {
			s.moveTo(0, 0.18)
				.lineTo(0.1, 0.34)
				.lineTo(0.16, 0.16)
				.quadraticCurveTo(0.34, 0.34, 0.55, 0.2)
				.quadraticCurveTo(0.46, 0.04, 0.5, -0.12)
				.quadraticCurveTo(0.36, -0.02, 0.28, -0.14)
				.quadraticCurveTo(0.18, -0.06, 0.1, -0.2)
				.lineTo(0, -0.34)
				.lineTo(-0.1, -0.2)
				.quadraticCurveTo(-0.18, -0.06, -0.28, -0.14)
				.quadraticCurveTo(-0.36, -0.02, -0.5, -0.12)
				.quadraticCurveTo(-0.46, 0.04, -0.55, 0.2)
				.quadraticCurveTo(-0.34, 0.34, -0.16, 0.16)
				.lineTo(-0.1, 0.34)
				.closePath();
			break;
		}
		default:
			return null;
	}
	return s;
}

/** Unit-sized cutter geometry for a shape, extruded along local Z and centred. */
export function createCutterGeometry(id) {
	let g;
	const outline = shapeOutline(id);
	if (outline) {
		g = new ExtrudeGeometry(outline, { depth: 1, bevelEnabled: false, curveSegments: 14 });
		g.translate(0, 0, -0.5);
	} else {
		g = new CylinderGeometry(0.5, 0.5, 1, 28, 1, false);
		g.rotateX(Math.PI / 2);
	}
	g.deleteAttribute('uv');
	g = mergeVertices(g, 1e-5);
	g.computeVertexNormals();
	return g;
}

const _basis = { x: new Vector3(), y: new Vector3(), z: new Vector3() };
const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);

/**
 * Orientation of a cutter laid on the surface: local Z along the outward
 * normal, local Y toward world up (so a triangle eye points up), then rolled.
 */
export function cutterMatrix({ point, normal, size, roll = 0, depth = CUT_DEPTH }) {
	const { x, y, z } = _basis;
	z.copy(normal).normalize();
	const ref = Math.abs(z.dot(UP)) > 0.98 ? SIDE : UP;
	x.crossVectors(ref, z).normalize();
	y.crossVectors(z, x).normalize();
	const m = new Matrix4().makeBasis(x, y, z);
	m.multiply(new Matrix4().makeRotationZ(roll));
	m.scale(new Vector3(size, size, depth));
	m.setPosition(point);
	return m;
}

const cutterCache = new Map();
function cutterGeometry(id) {
	let g = cutterCache.get(id);
	if (!g) {
		g = createCutterGeometry(id);
		cutterCache.set(id, g);
	}
	return g;
}

const evaluator = makeEvaluator();

/**
 * Subtract one cut from `shell` and return the new carved Brush. The input is
 * never mutated, so the caller can keep it for undo.
 *
 * cut: { shape, point: Vector3, normal: Vector3, size: number, roll?: number }
 */
export function carve(shell, cut, materials) {
	const cutter = new Brush(cutterGeometry(cut.shape), materials.flesh);
	cutter.matrix.copy(cutterMatrix(cut));
	cutter.matrix.decompose(cutter.position, cutter.quaternion, cutter.scale);
	cutter.updateMatrixWorld(true);
	shell.updateMatrixWorld(true);
	return evaluator.evaluate(shell, cutter, SUBTRACTION);
}

/** Number of triangles actually drawn by a carved brush. */
export function triangleCount(brush) {
	const g = brush.geometry;
	const n = g.index ? g.index.count : g.getAttribute('position').count;
	return Math.floor(Math.min(n, g.drawRange.count) / 3);
}

/**
 * A plain BufferGeometry holding only the triangles the brush draws, with its
 * material groups intact, so a glTF exporter does not write the unused
 * capacity three-bvh-csg keeps past the draw range.
 */
export function bakeGeometry(brush) {
	const src = brush.geometry;
	const drawn = triangleCount(brush) * 3;
	const out = new BufferGeometry();
	const verts = src.index ? src.getAttribute('position').count : drawn;
	for (const name of ['position', 'normal']) {
		const a = src.getAttribute(name);
		if (!a) continue;
		out.setAttribute(name, new Float32BufferAttribute(a.array.slice(0, verts * 3), 3));
	}
	if (src.index) out.setIndex(Array.from(src.index.array.slice(0, drawn)));
	for (const grp of src.groups) {
		if (grp.start >= drawn) continue;
		out.addGroup(grp.start, Math.min(grp.count, drawn - grp.start), grp.materialIndex);
	}
	return out;
}

/** Signed volume of a baked or indexed geometry: positive when it is a closed outward-facing solid. */
export function meshVolume(geometry) {
	const pos = geometry.getAttribute('position');
	const idx = geometry.index;
	const count = idx ? idx.count : pos.count;
	const a = new Vector3();
	const b = new Vector3();
	const c = new Vector3();
	let vol = 0;
	for (let i = 0; i < count; i += 3) {
		const ia = idx ? idx.getX(i) : i;
		const ib = idx ? idx.getX(i + 1) : i + 1;
		const ic = idx ? idx.getX(i + 2) : i + 2;
		a.fromBufferAttribute(pos, ia);
		b.fromBufferAttribute(pos, ib);
		c.fromBufferAttribute(pos, ic);
		vol += a.dot(b.cross(c)) / 6;
	}
	return vol;
}
