/**
 * Studio Lab — free, client-side 3D generators.
 *
 * Every generator is pure three.js (npm `three` + its github `examples/jsm`
 * addons) and returns a `THREE.Object3D`. The Lab controller (lab.js) exports
 * whatever they return to a real binary GLB, so each one is a genuine
 * text/parameters → downloadable 3D model pipeline — no API keys, no network.
 *
 * Adding a generator: export a `{ id, label, blurb, controls, build }` object
 * and register it in GENERATORS at the bottom. `controls` is a declarative
 * field list the Lab renders; `build(params)` returns an Object3D (or a promise).
 */

import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
// Vendored: three r186 stopped shipping examples/fonts. Source: three r184 (MgOpen, license in ./fonts/LICENSE).
import helvetikerBold from './fonts/helvetiker_bold.typeface.json';

// ── Shared helpers ────────────────────────────────────────────────────────────

const _fontCache = new Map();
function getFont() {
	if (!_fontCache.has('helvetiker')) {
		_fontCache.set('helvetiker', new FontLoader().parse(helvetikerBold));
	}
	return _fontCache.get('helvetiker');
}

function standardMesh(geometry, color, opts = {}) {
	geometry.computeVertexNormals();
	const mat = new THREE.MeshStandardMaterial({
		color: new THREE.Color(color),
		metalness: opts.metalness ?? 0.1,
		roughness: opts.roughness ?? 0.55,
		flatShading: !!opts.flatShading,
		vertexColors: !!opts.vertexColors,
		side: opts.side ?? THREE.FrontSide,
	});
	return new THREE.Mesh(geometry, mat);
}

// Deterministic value noise (no deps) for terrain — seeded so the same seed
// always rebuilds the same model.
function makeNoise(seed) {
	const perm = new Uint8Array(512);
	let s = (seed * 1013904223 + 1664525) >>> 0;
	const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
	const p = Array.from({ length: 256 }, (_, i) => i);
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[p[i], p[j]] = [p[j], p[i]];
	}
	for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
	const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
	const lerp = (a, b, t) => a + t * (b - a);
	const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
	return (x, y) => {
		const X = Math.floor(x) & 255;
		const Y = Math.floor(y) & 255;
		const xf = x - Math.floor(x);
		const yf = y - Math.floor(y);
		const u = fade(xf);
		const v = fade(yf);
		const aa = perm[perm[X] + Y];
		const ab = perm[perm[X] + Y + 1];
		const ba = perm[perm[X + 1] + Y];
		const bb = perm[perm[X + 1] + Y + 1];
		const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
		const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
		return (lerp(x1, x2, v) + 1) / 2; // 0..1
	};
}

// ── 1. Parametric solids (superformula + presets) ─────────────────────────────

const PARAMETRIC_PRESETS = {
	knot: { geo: () => new THREE.TorusKnotGeometry(1, 0.32, 220, 32, 2, 3) },
	torus: { geo: () => new THREE.TorusGeometry(1, 0.4, 48, 120) },
	spring: {
		geo: () => {
			const pts = [];
			const turns = 5;
			const steps = 600;
			for (let i = 0; i <= steps; i++) {
				const t = (i / steps) * Math.PI * 2 * turns;
				pts.push(new THREE.Vector3(Math.cos(t) * 0.9, (i / steps) * 2.4 - 1.2, Math.sin(t) * 0.9));
			}
			return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 600, 0.16, 16, false);
		},
	},
	capsule: { geo: () => new THREE.CapsuleGeometry(0.7, 1.2, 24, 48) },
	icosa: { geo: () => new THREE.IcosahedronGeometry(1.2, 1) },
};

function superformulaGeometry(m, n1, n2, n3, segments) {
	// 3D supershape: two superformula profiles (lat × lon) swept onto a sphere.
	const sf = (angle) => {
		const t1 = Math.pow(Math.abs(Math.cos((m * angle) / 4)), n2);
		const t2 = Math.pow(Math.abs(Math.sin((m * angle) / 4)), n3);
		const r = Math.pow(t1 + t2, -1 / n1);
		return Number.isFinite(r) ? r : 0;
	};
	const lonSteps = segments;
	const latSteps = Math.max(8, Math.floor(segments / 2));
	const positions = [];
	const grid = [];
	for (let i = 0; i <= latSteps; i++) {
		const lat = -Math.PI / 2 + (i / latSteps) * Math.PI;
		const r2 = sf(lat);
		const row = [];
		for (let j = 0; j <= lonSteps; j++) {
			const lon = -Math.PI + (j / lonSteps) * 2 * Math.PI;
			const r1 = sf(lon);
			const x = r1 * Math.cos(lon) * r2 * Math.cos(lat);
			const y = r1 * Math.sin(lon) * r2 * Math.cos(lat);
			const z = r2 * Math.sin(lat);
			row.push(positions.length / 3);
			positions.push(x, z, y);
		}
		grid.push(row);
	}
	const indices = [];
	for (let i = 0; i < latSteps; i++) {
		for (let j = 0; j < lonSteps; j++) {
			const a = grid[i][j];
			const b = grid[i][j + 1];
			const c = grid[i + 1][j];
			const d = grid[i + 1][j + 1];
			indices.push(a, b, d, a, d, c);
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geo.setIndex(indices);
	geo.scale(1.4, 1.4, 1.4);
	return geo;
}

const parametric = {
	id: 'parametric',
	label: 'Parametric',
	blurb: 'Math-driven solids — supershapes, knots, springs. Pure geometry, infinitely tweakable.',
	controls: [
		{
			key: 'preset',
			label: 'Shape',
			type: 'select',
			default: 'supershape',
			options: [
				{ value: 'supershape', label: 'Supershape' },
				{ value: 'knot', label: 'Torus knot' },
				{ value: 'torus', label: 'Torus' },
				{ value: 'spring', label: 'Spring' },
				{ value: 'capsule', label: 'Capsule' },
				{ value: 'icosa', label: 'Icosahedron' },
			],
		},
		{ key: 'm', label: 'Symmetry (m)', type: 'range', min: 1, max: 20, step: 1, default: 7, when: { preset: 'supershape' } },
		{ key: 'n1', label: 'Roundness (n1)', type: 'range', min: 0.2, max: 4, step: 0.1, default: 0.4, when: { preset: 'supershape' } },
		{ key: 'detail', label: 'Detail', type: 'range', min: 24, max: 220, step: 4, default: 140, when: { preset: 'supershape' } },
		{ key: 'color', label: 'Color', type: 'color', default: '#b8c0ff' },
	],
	build(p) {
		let geo;
		if (p.preset === 'supershape') {
			geo = superformulaGeometry(Number(p.m), Number(p.n1), 1.7, 1.7, Number(p.detail));
		} else {
			geo = PARAMETRIC_PRESETS[p.preset].geo();
		}
		return standardMesh(geo, p.color || '#b8c0ff', { metalness: 0.25, roughness: 0.4 });
	},
};

// ── 2. 3D Text ────────────────────────────────────────────────────────────────

const text3d = {
	id: 'text3d',
	label: '3D Text',
	blurb: 'Extruded, beveled 3D lettering from any string. Export and drop into a scene or logo.',
	controls: [
		{ key: 'text', label: 'Text', type: 'text', default: 'three.ws', maxlength: 24, placeholder: 'Your text' },
		{ key: 'depth', label: 'Depth', type: 'range', min: 0.05, max: 1, step: 0.05, default: 0.3 },
		{ key: 'bevel', label: 'Bevel', type: 'range', min: 0, max: 0.1, step: 0.01, default: 0.03 },
		{ key: 'color', label: 'Color', type: 'color', default: '#ffd166' },
	],
	build(p) {
		const str = (p.text || 'three.ws').slice(0, 24) || 'three.ws';
		const geo = new TextGeometry(str, {
			font: getFont(),
			size: 1,
			depth: Number(p.depth),
			curveSegments: 8,
			bevelEnabled: Number(p.bevel) > 0,
			bevelThickness: Number(p.bevel),
			bevelSize: Number(p.bevel) * 0.7,
			bevelSegments: 3,
		});
		geo.center();
		return standardMesh(geo, p.color || '#ffd166', { metalness: 0.3, roughness: 0.35 });
	},
};

// ── 3. SVG → 3D (extrude vector art) ──────────────────────────────────────────

const DEFAULT_SVG = `<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>`;

const svg3d = {
	id: 'svg3d',
	label: 'SVG → 3D',
	blurb: 'Turn any SVG path — an icon, a logo, a sketch — into a solid extruded 3D model.',
	controls: [
		{ key: 'svg', label: 'SVG markup', type: 'textarea', default: DEFAULT_SVG, placeholder: 'Paste <svg>…</svg>' },
		{ key: 'depth', label: 'Depth', type: 'range', min: 0.5, max: 12, step: 0.5, default: 4 },
		{ key: 'color', label: 'Color', type: 'color', default: '#8be9fd' },
	],
	build(p) {
		const markup = (p.svg && p.svg.trim()) || DEFAULT_SVG;
		const data = new SVGLoader().parse(markup);
		const geometries = [];
		for (const path of data.paths) {
			const shapes = SVGLoader.createShapes(path);
			for (const shape of shapes) {
				const g = new THREE.ExtrudeGeometry(shape, {
					depth: Number(p.depth),
					bevelEnabled: true,
					bevelThickness: Number(p.depth) * 0.08,
					bevelSize: Number(p.depth) * 0.06,
					bevelSegments: 2,
					curveSegments: 12,
				});
				geometries.push(g);
			}
		}
		if (!geometries.length) throw new Error('No drawable paths found in that SVG.');
		const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
		// SVG Y grows downward; flip and center so it stands upright.
		merged.scale(1, -1, 1);
		merged.computeBoundingBox();
		const c = merged.boundingBox.getCenter(new THREE.Vector3());
		merged.translate(-c.x, -c.y, -c.z);
		const s = 2.6 / Math.max(merged.boundingBox.max.x - merged.boundingBox.min.x, merged.boundingBox.max.y - merged.boundingBox.min.y, 0.001);
		merged.scale(s, s, s);
		return standardMesh(merged, p.color || '#8be9fd', { metalness: 0.15, roughness: 0.5, side: THREE.DoubleSide });
	},
};

// ── 4. Lithophane (image → 3D relief) ─────────────────────────────────────────

const lithophane = {
	id: 'lithophane',
	label: 'Lithophane',
	blurb: 'Drop a photo — its brightness becomes 3D relief. The classic backlit-panel print, generated in your browser.',
	controls: [
		{ key: 'image', label: 'Image', type: 'image', default: null },
		{ key: 'relief', label: 'Relief depth', type: 'range', min: 0.1, max: 2, step: 0.1, default: 0.8 },
		{ key: 'res', label: 'Resolution', type: 'range', min: 64, max: 256, step: 16, default: 160 },
		{ key: 'invert', label: 'Invert (light = deep)', type: 'checkbox', default: false },
	],
	async build(p) {
		const img = await loadImage(p.image || PLACEHOLDER_IMG);
		const res = Number(p.res);
		const aspect = img.width / img.height || 1;
		const cols = aspect >= 1 ? res : Math.round(res * aspect);
		const rows = aspect >= 1 ? Math.round(res / aspect) : res;
		const canvas = document.createElement('canvas');
		canvas.width = cols;
		canvas.height = rows;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(img, 0, 0, cols, rows);
		const { data } = ctx.getImageData(0, 0, cols, rows);
		const lum = new Float32Array(cols * rows);
		for (let i = 0; i < cols * rows; i++) {
			const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
			let l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
			if (p.invert) l = 1 - l;
			lum[i] = l;
		}
		const w = 3 * (cols / Math.max(cols, rows));
		const h = 3 * (rows / Math.max(cols, rows));
		const geo = new THREE.PlaneGeometry(w, h, cols - 1, rows - 1);
		const pos = geo.attributes.position;
		const relief = Number(p.relief);
		for (let i = 0; i < pos.count; i++) {
			// PlaneGeometry verts run left→right, top→bottom.
			const col = i % cols;
			const row = Math.floor(i / cols);
			const l = lum[row * cols + col] ?? 0;
			pos.setZ(i, (1 - l) * relief);
		}
		geo.computeVertexNormals();
		return standardMesh(geo, '#f5f5f5', { metalness: 0, roughness: 0.85, side: THREE.DoubleSide });
	},
};

// ── 5. Terrain (procedural noise heightfield) ─────────────────────────────────

const terrain = {
	id: 'terrain',
	label: 'Terrain',
	blurb: 'Procedural landscape from layered value noise, colored by elevation. New seed, new world.',
	controls: [
		{ key: 'seed', label: 'Seed', type: 'range', min: 1, max: 999, step: 1, default: 42 },
		{ key: 'height', label: 'Height', type: 'range', min: 0.3, max: 3, step: 0.1, default: 1.4 },
		{ key: 'roughness', label: 'Roughness', type: 'range', min: 1, max: 8, step: 0.5, default: 4 },
		{ key: 'res', label: 'Resolution', type: 'range', min: 48, max: 220, step: 4, default: 140 },
	],
	build(p) {
		const seg = Number(p.res);
		const size = 4;
		const geo = new THREE.PlaneGeometry(size, size, seg, seg);
		geo.rotateX(-Math.PI / 2);
		const noise = makeNoise(Number(p.seed));
		const pos = geo.attributes.position;
		const colors = new Float32Array(pos.count * 3);
		const H = Number(p.height);
		const freq = Number(p.roughness) / size;
		const low = new THREE.Color('#2c5364');
		const mid = new THREE.Color('#4e944f');
		const high = new THREE.Color('#e8e8e8');
		let maxE = 0.0001;
		const elev = new Float32Array(pos.count);
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const z = pos.getZ(i);
			let e = 0, amp = 1, f = freq;
			for (let o = 0; o < 4; o++) {
				e += noise(x * f + 100, z * f + 100) * amp;
				amp *= 0.5;
				f *= 2;
			}
			elev[i] = e;
			if (e > maxE) maxE = e;
		}
		for (let i = 0; i < pos.count; i++) {
			const n = elev[i] / maxE;
			pos.setY(i, n * H - H * 0.3);
			const c = n < 0.45 ? low.clone().lerp(mid, n / 0.45) : mid.clone().lerp(high, (n - 0.45) / 0.55);
			colors[i * 3] = c.r;
			colors[i * 3 + 1] = c.g;
			colors[i * 3 + 2] = c.b;
		}
		geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geo.computeVertexNormals();
		return standardMesh(geo, '#ffffff', { vertexColors: true, roughness: 0.9, metalness: 0, flatShading: false });
	},
};

// 1×1 transparent-ish gray PNG used when Lithophane has no upload yet (so the
// feature always produces a real model on first click — a soft radial gradient).
const PLACEHOLDER_IMG = (() => {
	const c = document.createElement('canvas');
	c.width = c.height = 256;
	const g = c.getContext('2d');
	const grad = g.createRadialGradient(128, 110, 20, 128, 128, 150);
	grad.addColorStop(0, '#ffffff');
	grad.addColorStop(0.5, '#9aa');
	grad.addColorStop(1, '#111');
	g.fillStyle = grad;
	g.fillRect(0, 0, 256, 256);
	g.fillStyle = '#000';
	g.font = 'bold 64px sans-serif';
	g.textAlign = 'center';
	g.fillText('3D', 128, 150);
	return c.toDataURL('image/png');
})();

function loadImage(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Could not read that image.'));
		img.src = src;
	});
}

export const GENERATORS = [parametric, text3d, svg3d, lithophane, terrain];
