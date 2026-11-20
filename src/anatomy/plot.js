// Anatomy plot: a design spec as a flat isometric line drawing (SVG).
//
// The share card for /anatomy/:id (api/anatomy-og.js) shows the machine
// itself, not a stock image. This module walks the spec the same way the
// viewer does (src/anatomy/viewer.js: repeat group, then pivot with position,
// rotation in degrees and scale, then children under the part), takes each
// part's technical line drawing from buildShape(), and projects it with the
// viewer's isometric camera direction. The result is the default view a
// visitor lands on, drawn as coloured strokes, with no WebGL, so it runs in
// Node and in the browser alike.
//
// Pure: same spec in, same SVG out. Work is bounded (instance and segment
// caps) so a 220 part x 96 repeat spec cannot stall a card render.

import * as THREE from 'three';
import { buildShape } from './shapes.js';

/** The viewer's part colours, used when a part names none. */
export const PALETTE = ['#4f8dff', '#ff8a3d', '#2fbf9b', '#c46cff', '#f2c14e', '#ff5d73', '#5cc8ff', '#8fd14f', '#b08968', '#9aa5b1'];
/** The viewer's isometric camera direction (camera sits along it, looking at the origin). */
export const ISO_DIR = Object.freeze([1, 0.82, 1]);

const DEG = Math.PI / 180;
const AXIS_VEC = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const MAX_INSTANCES = 2400;
const MAX_SEGMENTS = 60000;

function hashIndex(s, n) {
	let h = 0;
	for (const ch of String(s)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
	return Math.abs(h) % n;
}

/** A part's base colour: its own, else its group's palette slot, else a stable hash slot. */
export function partColor(part, groups) {
	if (part.color) return part.color;
	const i = part.group ? groups.indexOf(part.group) : hashIndex(part.id, PALETTE.length);
	return PALETTE[i % PALETTE.length];
}

function isoBasis() {
	const z = new THREE.Vector3(...ISO_DIR).normalize();
	const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
	const y = new THREE.Vector3().crossVectors(z, x);
	return { x, y, z };
}

function repeatMatrix(rep, k, count) {
	const m = new THREE.Matrix4();
	if (rep?.mode === 'radial') {
		const span = rep.angle >= 360 ? (rep.angle / count) * k : count > 1 ? (rep.angle / (count - 1)) * k : 0;
		m.makeRotationFromQuaternion(new THREE.Quaternion().setFromAxisAngle(AXIS_VEC[rep.axis] || AXIS_VEC.y, span * DEG));
	} else if (rep?.mode === 'linear' && Array.isArray(rep.offset)) {
		m.makeTranslation(rep.offset[0] * k, rep.offset[1] * k, rep.offset[2] * k);
	}
	return m;
}

function pivotMatrix(part) {
	const pos = new THREE.Vector3().fromArray(part.position || [0, 0, 0]);
	const r = part.rotation || [0, 0, 0];
	const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG));
	const s = new THREE.Vector3().fromArray(part.scale || [1, 1, 1]);
	return new THREE.Matrix4().compose(pos, q, s);
}

/**
 * Project every part instance of a spec onto the isometric view plane.
 * Returns strokes in view units (x right, y up), each with its colour and
 * mean depth, plus the bounds of the whole drawing.
 *
 * @param {{parts: object[]}} spec
 * @returns {{strokes: {color:string, depth:number, pts:Float32Array}[], bounds: {minX:number,maxX:number,minY:number,maxY:number}, segments:number}}
 */
export function projectDesign(spec) {
	const parts = Array.isArray(spec?.parts) ? spec.parts : [];
	const byId = new Map(parts.map((p) => [p.id, p]));
	const childrenOf = new Map();
	for (const p of parts) {
		const key = p.parent && byId.has(p.parent) ? p.parent : null;
		if (!childrenOf.has(key)) childrenOf.set(key, []);
		childrenOf.get(key).push(p);
	}
	const groups = [...new Set(parts.map((p) => p.group).filter(Boolean))];
	const basis = isoBasis();
	const lineCache = new Map();
	const strokes = [];
	const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
	const v = new THREE.Vector3();
	let instances = 0;
	let segments = 0;

	const linesOf = (part) => {
		if (!lineCache.has(part.id)) {
			let lines = null;
			try {
				lines = buildShape(part.shape).lines;
			} catch {
				lines = null;
			}
			lineCache.set(part.id, lines);
		}
		return lineCache.get(part.id);
	};

	const visit = (part, parentWorld) => {
		const rep = part.repeat;
		const count = rep ? Math.max(1, rep.count | 0) : 1;
		const pivot = pivotMatrix(part);
		for (let k = 0; k < count; k++) {
			if (instances >= MAX_INSTANCES || segments >= MAX_SEGMENTS) return;
			instances++;
			const world = new THREE.Matrix4().multiplyMatrices(parentWorld, repeatMatrix(rep, k, count)).multiply(pivot);
			const lines = linesOf(part);
			if (lines && lines.length >= 6) {
				const n = Math.min(lines.length / 3, (MAX_SEGMENTS - segments) * 2);
				const pts = new Float32Array(n * 2);
				let depth = 0;
				for (let i = 0; i < n; i++) {
					v.set(lines[i * 3], lines[i * 3 + 1], lines[i * 3 + 2]).applyMatrix4(world);
					const sx = v.dot(basis.x);
					const sy = v.dot(basis.y);
					depth += v.dot(basis.z);
					pts[i * 2] = sx;
					pts[i * 2 + 1] = sy;
					if (sx < bounds.minX) bounds.minX = sx;
					if (sx > bounds.maxX) bounds.maxX = sx;
					if (sy < bounds.minY) bounds.minY = sy;
					if (sy > bounds.maxY) bounds.maxY = sy;
				}
				segments += n / 2;
				strokes.push({ color: partColor(part, groups), depth: depth / n, pts });
			}
			for (const child of childrenOf.get(part.id) || []) visit(child, world);
		}
	};

	for (const p of childrenOf.get(null) || []) visit(p, new THREE.Matrix4());
	return { strokes, bounds, segments };
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();

/**
 * The design as a standalone SVG line drawing fitted into width x height.
 * Parts farther from the camera are drawn first and fainter, so the front of
 * the machine reads on top. Returns null when the spec has nothing to draw.
 *
 * @param {{parts: object[]}} spec
 * @param {{width?:number, height?:number, pad?:number, stroke?:number}} [o]
 * @returns {string|null}
 */
export function plotDesignSvg(spec, { width = 640, height = 560, pad = 24, stroke = 1.4 } = {}) {
	const { strokes, bounds } = projectDesign(spec);
	if (!strokes.length) return null;
	const spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
	const spanY = Math.max(1e-6, bounds.maxY - bounds.minY);
	const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
	const offX = (width - spanX * scale) / 2;
	const offY = (height - spanY * scale) / 2;
	const toX = (x) => offX + (x - bounds.minX) * scale;
	const toY = (y) => height - (offY + (y - bounds.minY) * scale);

	const depths = strokes.map((s) => s.depth);
	const near = Math.max(...depths);
	const far = Math.min(...depths);
	const range = near - far || 1;
	const paths = strokes
		.slice()
		.sort((a, b) => a.depth - b.depth)
		.map((s) => {
			let d = '';
			for (let i = 0; i < s.pts.length; i += 4) {
				d += `M${fmt(toX(s.pts[i]))} ${fmt(toY(s.pts[i + 1]))}L${fmt(toX(s.pts[i + 2]))} ${fmt(toY(s.pts[i + 3]))}`;
			}
			const opacity = 0.45 + 0.55 * ((s.depth - far) / range);
			return `<path d="${d}" stroke="${s.color}" stroke-opacity="${opacity.toFixed(2)}"/>`;
		});
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g></svg>`;
}
