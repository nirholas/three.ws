// Named pictures the terminal stream can play without the caller supplying a GLB.
//
// walk is a real skinned clip (cesium-man) held in profile, because a front view
// of that mesh reads as a blob. The rest are the same rasterizer: a flock, a
// lit torus, a raymarched solid, a lathed profile, a counted point garden, two
// characters sharing one framebuffer. Nothing here is a pre-rendered frame.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadModelFromFile, poseModel } from './model.js';
import { computeFraming, createFramebuffer, poseBounds, poseCenter, renderToFramebuffer } from './raster.js';
import { latheMesh, solidModel, torusMesh } from './solid.js';
import { framebufferToText } from './term.js';

export const SCENE_NAMES = ['walk', 'orbit', 'parade', 'meet', 'birds', 'donut', 'shader', 'draw', 'splats', 'say'];
export const STYLE_NAMES = ['half', 'density', 'braille', 'ascii', 'points', 'matrix'];

const SCENE_SET = new Set(SCENE_NAMES);
const BG = [0.031, 0.031, 0.078];
const SIDE = Math.PI / 2;

export function isScene(name) {
	return SCENE_SET.has(String(name || '').toLowerCase());
}

export function normalizeStyle(value) {
	const style = String(value ?? 'half').toLowerCase();
	return STYLE_NAMES.includes(style) ? style : 'half';
}

/** Printable ASCII, capped, so a speech balloon cannot be a novel. */
export function cleanBalloon(text, fallback = 'gm') {
	const raw = String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e]/g, '').trim();
	return (raw || fallback).slice(0, 42);
}

/**
 * Build one scene.
 *
 * `width` and `height` are character cells. Camera numbers in `options` override
 * the scene only when they are finite, so an omitted spin does not turn the
 * profile walk back into a turntable.
 */
export async function createScene(name, options = {}) {
	const id = String(name || '').toLowerCase();
	if (!SCENE_SET.has(id)) throw new Error(`unknown scene: ${name}`);
	const opts = {
		...options,
		style: normalizeStyle(options.style),
		cwd: options.cwd || process.cwd(),
		text: id === 'say' ? cleanBalloon(options.text) : options.text,
	};
	if (id === 'walk' || id === 'say') return characterScene(id, opts, walkDefaults());
	if (id === 'orbit') return characterScene(id, opts, orbitDefaults());
	if (id === 'parade') return paradeScene(opts);
	if (id === 'meet') return meetScene(opts);
	if (id === 'birds') return birdsScene(opts);
	if (id === 'donut') return meshScene('donut', 'lit torus', torusMesh(0.72, 0.28, 36, 16, [0.95, 0.52, 0.22]), opts, { yaw: 0.4, pitch: 0.55, zoom: 1.2, spin: 0.85 });
	if (id === 'draw') return meshScene('draw', 'lathed solid', latheMesh(VASE, 32, [0.42, 0.7, 0.95]), opts, { yaw: 0.2, pitch: 0.28, zoom: 1.15, spin: 0.7 });
	if (id === 'shader') return shaderScene(opts);
	return splatScene(opts);
}

const VASE = [
	[0.04, -0.95],
	[0.34, -0.86],
	[0.38, -0.5],
	[0.16, -0.18],
	[0.13, 0.18],
	[0.28, 0.46],
	[0.44, 0.62],
	[0.18, 0.82],
	[0.06, 0.98],
];

function walkDefaults() {
	return { file: 'cesium-man.glb', clip: 'clip', label: 'walk', yaw: SIDE, pitch: 0, zoom: 1.05, spin: 0 };
}

function orbitDefaults() {
	return { file: 'cesium-man.glb', clip: 'clip', label: 'orbit', yaw: SIDE, pitch: 0.06, zoom: 1.05, spin: 0.5 };
}

function avatarFile(file, cwd) {
	for (const root of ['public/avatars', 'dist/avatars']) {
		const full = join(cwd, root, file);
		if (existsSync(full)) return full;
	}
	return null;
}

async function loadAvatar(file, cwd) {
	const path = avatarFile(file, cwd);
	if (!path) throw new Error(`missing avatar file: ${file}`);
	return loadModelFromFile(path);
}

function clipNamed(model, wanted) {
	if (!model.animations.length) return null;
	if (!wanted) return model.animations[0];
	const lower = String(wanted).toLowerCase();
	return model.animations.find((clip) => clip.name.toLowerCase().includes(lower)) ?? model.animations[0];
}

function finiteOr(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}

function makeCam(defaults, opts) {
	const state = {
		yaw: finiteOr(opts.yaw, defaults.yaw),
		pitch: finiteOr(opts.pitch, defaults.pitch),
		zoom: finiteOr(opts.zoom, defaults.zoom),
		spin: finiteOr(opts.spin, defaults.spin),
	};
	return {
		get yaw() { return state.yaw; },
		get pitch() { return state.pitch; },
		get zoom() { return state.zoom; },
		get spin() { return state.spin; },
		orbit() { return { yaw: state.yaw, pitch: state.pitch, zoom: state.zoom }; },
		set(next = {}) {
			if (Number.isFinite(next.yaw)) state.yaw = next.yaw;
			if (Number.isFinite(next.pitch)) state.pitch = Math.max(-1.45, Math.min(1.45, next.pitch));
			if (Number.isFinite(next.zoom)) state.zoom = Math.max(0.25, Math.min(8, next.zoom));
			if (Number.isFinite(next.spin)) state.spin = next.spin;
			return { ...state };
		},
	};
}

function tintOf(opts) {
	const mul = opts.style === 'matrix' ? [0.45, 1, 0.55] : [1, 1, 1];
	const user = opts.tint ?? [1, 1, 1];
	return [mul[0] * user[0], mul[1] * user[1], mul[2] * user[2]];
}

function makeBuffer(width, height, style) {
	const cols = Math.max(8, Math.round(width || 76));
	const rows = Math.max(6, Math.round(height || 30));
	const braille = style === 'braille';
	return {
		cols,
		rows,
		fb: createFramebuffer(braille ? cols * 2 : cols, braille ? rows * 4 : rows * 2),
	};
}

function textOf(fb, opts) {
	const style = opts.style === 'points' || opts.style === 'matrix' ? 'half' : opts.style;
	return framebufferToText(fb, {
		mode: opts.mode ?? 'ansi256',
		background: opts.background ?? BG,
		transparent: Boolean(opts.transparent),
		style,
	});
}

function meshDetail(model) {
	const tris = Math.round(model.triangleCount).toLocaleString('en-US');
	return `${tris} tris${model.skinned ? '  rigged' : ''}`;
}

function publish(fields) {
	const scene = {
		name: fields.name,
		label: fields.label,
		detail: fields.detail,
		width: fields.cols,
		height: fields.rows,
		buffer: fields.fb,
		get orbit() { return fields.cam.orbit(); },
		setOrbit(next) { return fields.cam.set(next); },
		frame(time = 0) {
			fields.draw(time);
			return textOf(fields.fb, fields.opts);
		},
	};
	return scene;
}

async function characterScene(id, opts, defaults) {
	const model = await loadAvatar(defaults.file, opts.cwd);
	const clip = clipNamed(model, defaults.clip);
	const cam = makeCam(defaults, opts);
	const { fb, cols, rows } = makeBuffer(opts.width, opts.height, opts.style);
	const framing = computeFraming(model, clip);
	const tint = tintOf(opts);
	const label = id === 'say' ? 'say' : defaults.label;
	return publish({
		name: id,
		label,
		detail: meshDetail(model),
		fb, cols, rows, cam, opts,
		draw(time) {
			poseModel(model, clip, time);
			renderToFramebuffer(fb, model, {
				yaw: cam.yaw + time * cam.spin,
				pitch: cam.pitch,
				zoom: cam.zoom,
				center: poseCenter(model),
				framing,
				tint,
				points: opts.style === 'points',
				pointRadius: opts.pointRadius ?? 0,
			});
			if (id === 'say') stampBalloon(fb, opts.text);
		},
	});
}

async function paradeScene(opts) {
	const cesium = await loadAvatar('cesium-man.glb', opts.cwd);
	const fox = await loadAvatar('fox.glb', opts.cwd);
	const cesiumClip = clipNamed(cesium, 'clip');
	const foxClip = clipNamed(fox, 'walk');
	const cam = makeCam({ yaw: SIDE, pitch: 0, zoom: 1.05, spin: 0 }, opts);
	const { fb, cols, rows } = makeBuffer(opts.width, opts.height, opts.style);
	const framingA = computeFraming(cesium, cesiumClip);
	const framingB = computeFraming(fox, foxClip);
	const tint = tintOf(opts);
	const hold = 3;
	return publish({
		name: 'parade',
		label: 'parade',
		detail: 'cesium man, then fox',
		fb, cols, rows, cam, opts,
		draw(time) {
			const local = ((time % (hold * 2)) + hold * 2) % (hold * 2);
			const model = local < hold ? cesium : fox;
			const clip = local < hold ? cesiumClip : foxClip;
			const framing = local < hold ? framingA : framingB;
			poseModel(model, clip, local % hold);
			renderToFramebuffer(fb, model, {
				yaw: cam.yaw + local * cam.spin,
				pitch: cam.pitch,
				zoom: cam.zoom,
				center: poseCenter(model),
				framing,
				tint,
				points: opts.style === 'points',
				pointRadius: opts.pointRadius ?? 0,
			});
		},
	});
}

async function meetScene(opts) {
	const cesium = await loadAvatar('cesium-man.glb', opts.cwd);
	const fox = await loadAvatar('fox.glb', opts.cwd);
	const cesiumClip = clipNamed(cesium, 'clip');
	const foxClip = clipNamed(fox, 'walk');
	// The fox file is tens of times taller than cesium-man. Scale it to the
	// walker's height or the union framing hides the person inside the fox.
	const shot = measurePair(cesium, fox, cesiumClip, foxClip);
	const cam = makeCam({ yaw: SIDE, pitch: 0.04, zoom: 1, spin: 0 }, opts);
	const { fb, cols, rows } = makeBuffer(opts.width, opts.height, opts.style);
	const tint = tintOf(opts);
	return publish({
		name: 'meet',
		label: 'meet',
		detail: 'two characters',
		fb, cols, rows, cam, opts,
		draw(time) {
			poseModel(cesium, cesiumClip, time);
			poseModel(fox, foxClip, time);
			const yaw = cam.yaw + time * cam.spin;
			const shared = {
				yaw,
				pitch: cam.pitch,
				zoom: cam.zoom,
				center: shot.center,
				framing: shot.framing,
				tint,
				points: opts.style === 'points',
				pointRadius: opts.pointRadius ?? 0,
			};
			const left = placement(cesium, 1, 0, -shot.gap);
			const right = placement(fox, shot.foxScale, Math.PI, shot.gap);
			renderToFramebuffer(fb, cesium, { ...shared, ...left, clear: true });
			renderToFramebuffer(fb, fox, { ...shared, ...right, clear: false });
		},
	});
}

function modelHeight(model) {
	const b = poseBounds(model);
	return Math.max(1e-4, b.max[1] - b.min[1]);
}

function halfDepth(model, scale) {
	const b = poseBounds(model);
	return Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2 * scale;
}

function placement(model, scale, rotate, zTarget) {
	const b = poseBounds(model);
	const c = poseCenter(model);
	const [cx, , cz] = yawScale(c[0], c[1], c[2], scale, rotate);
	const feet = b.min[1] * scale;
	return {
		scale,
		rotate,
		translate: [-cx, -feet, zTarget - cz],
	};
}

function yawScale(x, y, z, scale, rotate) {
	const sx = x * scale;
	const sy = y * scale;
	const sz = z * scale;
	const c = Math.cos(rotate);
	const s = Math.sin(rotate);
	return [sx * c + sz * s, sy, -sx * s + sz * c];
}

function measurePair(a, b, clipA, clipB) {
	const span = Math.max(clipA?.duration || 1, clipB?.duration || 1);
	let heightA = 0;
	let heightB = 0;
	for (let i = 0; i < 6; i += 1) {
		const t = (span * i) / 6;
		poseModel(a, clipA, t);
		poseModel(b, clipB, t);
		heightA = Math.max(heightA, modelHeight(a));
		heightB = Math.max(heightB, modelHeight(b));
	}
	const foxScale = heightA / heightB;
	let reachA = 0;
	let reachB = 0;
	for (let i = 0; i < 6; i += 1) {
		const t = (span * i) / 6;
		poseModel(a, clipA, t);
		poseModel(b, clipB, t);
		reachA = Math.max(reachA, halfDepth(a, 1));
		reachB = Math.max(reachB, halfDepth(b, foxScale));
	}
	const gap = reachA + reachB + heightA * 0.15;
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < 6; i += 1) {
		const t = (span * i) / 6;
		poseModel(a, clipA, t);
		poseModel(b, clipB, t);
		absorbPlacement(a, placement(a, 1, 0, -gap), min, max);
		absorbPlacement(b, placement(b, foxScale, Math.PI, gap), min, max);
	}
	const center = min.map((v, k) => (v + max[k]) / 2);
	return {
		foxScale,
		gap,
		center,
		framing: {
			halfHeight: Math.max(0.4, (max[1] - min[1]) / 2),
			halfWidth: Math.max(0.4, (max[0] - min[0]) / 2, (max[2] - min[2]) / 2),
		},
	};
}

function absorbPlacement(model, place, min, max) {
	const b = poseBounds(model);
	const xs = [b.min[0], b.max[0]];
	const ys = [b.min[1], b.max[1]];
	const zs = [b.min[2], b.max[2]];
	for (const x of xs) {
		for (const y of ys) {
			for (const z of zs) {
				const [px, py, pz] = yawScale(x, y, z, place.scale, place.rotate);
				const point = [px + place.translate[0], py + place.translate[1], pz + place.translate[2]];
				for (let k = 0; k < 3; k += 1) {
					if (point[k] < min[k]) min[k] = point[k];
					if (point[k] > max[k]) max[k] = point[k];
				}
			}
		}
	}
}

function meshScene(name, label, model, opts, defaults) {
	const cam = makeCam(defaults, opts);
	const { fb, cols, rows } = makeBuffer(opts.width, opts.height, opts.style);
	const framing = computeFraming(model, null);
	const tint = tintOf(opts);
	return publish({
		name,
		label,
		detail: meshDetail(model),
		fb, cols, rows, cam, opts,
		draw(time) {
			poseModel(model, null, 0);
			renderToFramebuffer(fb, model, {
				yaw: cam.yaw + time * cam.spin,
				pitch: cam.pitch,
				zoom: cam.zoom,
				center: poseCenter(model),
				framing,
				tint,
				points: opts.style === 'points',
				pointRadius: opts.pointRadius ?? (opts.style === 'points' ? 1 : 0),
			});
		},
	});
}

const BIRD_COUNT = 36;
const BIRD_PALETTE = [
	[0.96, 0.56, 0.22],
	[0.38, 0.76, 0.96],
	[0.96, 0.9, 0.34],
	[0.5, 0.9, 0.48],
	[0.92, 0.4, 0.56],
];
const BIRD_BOX = { min: [-1.35, -0.62, -1.15], max: [1.35, 0.62, 1.15] };

function birdsScene(opts) {
	const birds = [];
	const parts = [];
	for (let i = 0; i < BIRD_COUNT; i += 1) {
		const col = i % 6;
		const row = Math.floor(i / 6);
		birds.push({
			x: -1.05 + col * 0.4,
			y: -0.4 + (row % 3) * 0.32,
			z: -0.75 + Math.floor(row / 3) * 0.7,
			vx: 0.25 + (i % 5) * 0.06,
			vy: ((i % 3) - 1) * 0.08,
			vz: 0.42 + (i % 4) * 0.04,
			phase: i * 0.65,
		});
		parts.push({
			positions: new Float32Array(12),
			indices: new Uint32Array([0, 2, 1, 0, 1, 2, 0, 1, 3, 0, 3, 1]),
			color: BIRD_PALETTE[i % BIRD_PALETTE.length],
		});
	}
	const model = solidModel(parts);
	const cam = makeCam({ yaw: 0.4, pitch: 0.32, zoom: 1.08, spin: 0.35 }, opts);
	const { fb, cols, rows } = makeBuffer(opts.width, opts.height, opts.style);
	const tint = tintOf(opts);
	const framing = { halfHeight: 1.05, halfWidth: 1.5 };
	let last = null;
	return publish({
		name: 'birds',
		label: 'birds',
		detail: `${BIRD_COUNT} birds`,
		fb, cols, rows, cam, opts,
		draw(time) {
			if (last === null) {
				const steps = Math.min(48, Math.max(0, Math.floor(time / 0.05)));
				for (let i = 0; i < steps; i += 1) stepBirds(birds, 0.05);
				last = steps * 0.05;
			}
			const dt = Math.min(0.08, Math.max(0, time - last));
			if (dt > 0) stepBirds(birds, dt);
			last = time;
			writeBirds(model, birds, time);
			poseModel(model, null, 0);
			renderToFramebuffer(fb, model, {
				yaw: cam.yaw + time * cam.spin,
				pitch: cam.pitch,
				zoom: cam.zoom,
				center: [0, 0, 0],
				framing,
				tint,
				points: opts.style === 'points',
			});
		},
	});
}

function stepBirds(birds, dt) {
	for (const bird of birds) {
		let sx = 0; let sy = 0; let sz = 0;
		let ax = 0; let ay = 0; let az = 0;
		let cx = 0; let cy = 0; let cz = 0;
		let n = 0;
		for (const other of birds) {
			if (other === bird) continue;
			const dx = bird.x - other.x;
			const dy = bird.y - other.y;
			const dz = bird.z - other.z;
			const d2 = dx * dx + dy * dy + dz * dz;
			if (d2 > 0.28 || d2 < 1e-8) continue;
			const d = Math.sqrt(d2);
			sx += dx / d; sy += dy / d; sz += dz / d;
			ax += other.vx; ay += other.vy; az += other.vz;
			cx += other.x; cy += other.y; cz += other.z;
			n += 1;
		}
		if (n) {
			bird.vx += sx * 0.9 + (ax / n - bird.vx) * 0.35 + (cx / n - bird.x) * 0.12;
			bird.vy += sy * 0.9 + (ay / n - bird.vy) * 0.35 + (cy / n - bird.y) * 0.12;
			bird.vz += sz * 0.9 + (az / n - bird.vz) * 0.35 + (cz / n - bird.z) * 0.12;
		}
		const pad = 0.22;
		if (bird.x < BIRD_BOX.min[0] + pad) bird.vx += 0.7;
		if (bird.x > BIRD_BOX.max[0] - pad) bird.vx -= 0.7;
		if (bird.y < BIRD_BOX.min[1] + pad) bird.vy += 0.7;
		if (bird.y > BIRD_BOX.max[1] - pad) bird.vy -= 0.7;
		if (bird.z < BIRD_BOX.min[2] + pad) bird.vz += 0.7;
		if (bird.z > BIRD_BOX.max[2] - pad) bird.vz -= 0.7;
		const sp = Math.hypot(bird.vx, bird.vy, bird.vz) || 1;
		const target = 0.7;
		bird.vx = (bird.vx / sp) * target;
		bird.vy = (bird.vy / sp) * target;
		bird.vz = (bird.vz / sp) * target;
		bird.x = clamp(bird.x + bird.vx * dt, BIRD_BOX.min[0], BIRD_BOX.max[0]);
		bird.y = clamp(bird.y + bird.vy * dt, BIRD_BOX.min[1], BIRD_BOX.max[1]);
		bird.z = clamp(bird.z + bird.vz * dt, BIRD_BOX.min[2], BIRD_BOX.max[2]);
	}
}

function writeBirds(model, birds, time) {
	for (let i = 0; i < birds.length; i += 1) {
		const bird = birds[i];
		const positions = model.primitives[i].positions;
		const heading = Math.atan2(bird.vx, bird.vz);
		const c = Math.cos(heading);
		const s = Math.sin(heading);
		const flap = Math.sin(time * 11 + bird.phase) * 0.08;
		const local = [
			[-0.28, flap, -0.06],
			[0.28, -flap, -0.06],
			[0, 0.03, 0.24],
			[0, -0.02, -0.16],
		];
		for (let v = 0; v < 4; v += 1) {
			const [lx, ly, lz] = local[v];
			positions[v * 3] = bird.x + lx * c + lz * s;
			positions[v * 3 + 1] = bird.y + ly;
			positions[v * 3 + 2] = bird.z + (-lx * s + lz * c);
		}
	}
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

function shaderScene(opts) {
	const cam = makeCam({ yaw: 0.6, pitch: 0.18, zoom: 1, spin: 0.45 }, opts);
	const { fb, cols, rows } = makeBuffer(opts.width, opts.height, opts.style);
	const tint = tintOf(opts);
	return publish({
		name: 'shader',
		label: 'shader',
		detail: 'raymarched sdf',
		fb, cols, rows, cam, opts,
		draw(time) {
			marchShader(fb, time, cam, tint);
		},
	});
}

function marchShader(fb, time, cam, tint) {
	fb.color.fill(0);
	fb.depth.fill(Infinity);
	fb.coverage.fill(0);
	const yaw = cam.yaw + time * cam.spin;
	const pitch = cam.pitch;
	const dist = 2.85 / Math.max(0.35, cam.zoom);
	const eyeX = Math.cos(pitch) * Math.sin(yaw) * dist;
	const eyeY = Math.sin(pitch) * dist * 0.45 + 0.08;
	const eyeZ = Math.cos(pitch) * Math.cos(yaw) * dist;
	let fx = -eyeX; let fy = -eyeY; let fz = -eyeZ;
	const fl = Math.hypot(fx, fy, fz) || 1;
	fx /= fl; fy /= fl; fz /= fl;
	let rx = -fz; let ry = 0; let rz = fx;
	const rl = Math.hypot(rx, ry, rz) || 1;
	rx /= rl; ry /= rl; rz /= rl;
	const ux = ry * fz - rz * fy;
	const uy = rz * fx - rx * fz;
	const uz = rx * fy - ry * fx;
	const w = fb.width;
	const h = fb.height;
	const aspect = w / h;
	const fov = 0.7;
	const radius = 1.2;
	for (let py = 0; py < h; py += 1) {
		const v = (1 - ((py + 0.5) / h) * 2) * fov;
		for (let px = 0; px < w; px += 1) {
			const u = (((px + 0.5) / w) * 2 - 1) * aspect * fov;
			let dx = fx + rx * u + ux * v;
			let dy = fy + ry * u + uy * v;
			let dz = fz + rz * u + uz * v;
			const dl = Math.hypot(dx, dy, dz) || 1;
			dx /= dl; dy /= dl; dz /= dl;
			const b = eyeX * dx + eyeY * dy + eyeZ * dz;
			const c0 = eyeX * eyeX + eyeY * eyeY + eyeZ * eyeZ - radius * radius;
			const disc = b * b - c0;
			if (disc < 0) continue;
			const root = Math.sqrt(disc);
			let t = -b - root;
			const tFar = -b + root;
			if (tFar < 0) continue;
			if (t < 0) t = 0;
			let hit = false;
			for (let step = 0; step < 22 && t < tFar; step += 1) {
				const d = sdf(eyeX + dx * t, eyeY + dy * t, eyeZ + dz * t);
				if (d < 0.005) { hit = true; break; }
				t += Math.max(d, 0.012);
			}
			if (!hit) continue;
			const hx = eyeX + dx * t;
			const hy = eyeY + dy * t;
			const hz = eyeZ + dz * t;
			const n = sdfNormal(hx, hy, hz);
			const key = Math.max(0, n[0] * -0.3 + n[1] * 0.72 + n[2] * 0.5);
			const lit = 0.28 + key * 0.9;
			const idx = py * w + px;
			fb.coverage[idx] = 1;
			fb.depth[idx] = t;
			const o = idx * 3;
			fb.color[o] = Math.min(1, (0.62 + 0.4 * n[0]) * lit * tint[0]);
			fb.color[o + 1] = Math.min(1, (0.28 + 0.45 * (n[1] * 0.5 + 0.5)) * lit * tint[1]);
			fb.color[o + 2] = Math.min(1, (0.78 + 0.22 * n[2]) * lit * tint[2]);
		}
	}
}

function sdf(x, y, z) {
	const qx = Math.hypot(x, z) - 0.58;
	const torus = Math.hypot(qx, y) - 0.2;
	const sphere = Math.hypot(x, y - 0.12, z) - 0.34;
	return smin(torus, sphere, 0.32);
}

function smin(a, b, k) {
	const h = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.min(a, b) - h * h * k * 0.25;
}

function sdfNormal(x, y, z) {
	const e = 0.005;
	const nx = sdf(x + e, y, z) - sdf(x - e, y, z);
	const ny = sdf(x, y + e, z) - sdf(x, y - e, z);
	const nz = sdf(x, y, z + e) - sdf(x, y, z - e);
	const len = Math.hypot(nx, ny, nz) || 1;
	return [nx / len, ny / len, nz / len];
}

function splatScene(opts) {
	const { model, count } = gardenModel();
	const cam = makeCam({ yaw: 0.5, pitch: 0.4, zoom: 1.12, spin: 0.4 }, opts);
	const { fb, cols, rows } = makeBuffer(opts.width, opts.height, opts.style);
	const tint = tintOf(opts);
	const framing = { halfHeight: 1.15, halfWidth: 1.25 };
	return publish({
		name: 'splats',
		label: 'point garden',
		detail: `${count.toLocaleString('en-US')} points`,
		fb, cols, rows, cam, opts,
		draw(time) {
			poseModel(model, null, 0);
			renderToFramebuffer(fb, model, {
				yaw: cam.yaw + time * cam.spin,
				pitch: cam.pitch,
				zoom: cam.zoom,
				center: [0, 0.1, 0],
				framing,
				tint,
				points: true,
				pointRadius: opts.pointRadius ?? 1.45,
			});
		},
	});
}

function gardenModel() {
	const rand = mulberry(0x74ee01);
	const ground = [];
	const trunk = [];
	const canopy = [];
	const fruit = [];
	for (let i = 0; i < 720; i += 1) {
		const a = rand() * Math.PI * 2;
		const r = Math.sqrt(rand()) * 1.15;
		ground.push(Math.cos(a) * r, -0.86 + rand() * 0.03, Math.sin(a) * r);
	}
	for (let i = 0; i < 200; i += 1) {
		const a = rand() * Math.PI * 2;
		const r = rand() * 0.07;
		trunk.push(Math.cos(a) * r, -0.86 + rand() * 1.05, Math.sin(a) * r);
	}
	let leaves = 0;
	while (leaves < 1500) {
		const x = (rand() * 2 - 1) * 0.74;
		const y = (rand() * 2 - 1) * 0.58;
		const z = (rand() * 2 - 1) * 0.74;
		if ((x * x) / (0.74 * 0.74) + (y * y) / (0.58 * 0.58) + (z * z) / (0.74 * 0.74) > 1) continue;
		canopy.push(x, 0.55 + y, z);
		leaves += 1;
	}
	for (let i = 0; i < 64; i += 1) {
		const a = rand() * Math.PI * 2;
		const b = rand() * Math.PI;
		fruit.push(
			Math.cos(a) * Math.sin(b) * 0.6,
			0.55 + Math.cos(b) * 0.46,
			Math.sin(a) * Math.sin(b) * 0.6,
		);
	}
	const parts = [
		{ pts: ground, color: [0.34, 0.5, 0.22] },
		{ pts: trunk, color: [0.5, 0.3, 0.16] },
		{ pts: canopy, color: [0.2, 0.68, 0.32] },
		{ pts: fruit, color: [0.93, 0.3, 0.22] },
	];
	const model = solidModel(parts.map((part) => ({
		positions: Float32Array.from(part.pts),
		indices: new Uint32Array(0),
		color: part.color,
	})));
	const count = parts.reduce((sum, part) => sum + part.pts.length / 3, 0);
	return { model, count };
}

function mulberry(seed) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function stampBalloon(fb, text) {
	const glyphs = String(text).toUpperCase().split('').map((ch) => FONT[ch] || FONT[' ']);
	const scale = fb.width >= 120 ? 2 : 1;
	const gw = 3 * scale;
	const gh = 5 * scale;
	const gap = scale;
	const textW = glyphs.length * (gw + gap) - gap;
	const pad = 2 * scale;
	const boxW = textW + pad * 2;
	const boxH = gh + pad * 2;
	const x0 = Math.max(0, Math.floor((fb.width - boxW) / 2));
	const y0 = 1;
	for (let y = y0; y < y0 + boxH; y += 1) {
		for (let x = x0; x < x0 + boxW; x += 1) paint(fb, x, y, 0.94, 0.95, 0.97);
	}
	const tail = x0 + Math.floor(boxW / 2);
	for (let i = 0; i < 3 * scale; i += 1) {
		paint(fb, tail, y0 + boxH + i, 0.94, 0.95, 0.97);
		if (i > 0) paint(fb, tail - 1, y0 + boxH + i - 1, 0.94, 0.95, 0.97);
	}
	for (let i = 0; i < glyphs.length; i += 1) {
		const rows = glyphs[i];
		const gx = x0 + pad + i * (gw + gap);
		const gy = y0 + pad;
		for (let ry = 0; ry < 5; ry += 1) {
			for (let rx = 0; rx < 3; rx += 1) {
				if (rows[ry][rx] !== '1') continue;
				for (let sy = 0; sy < scale; sy += 1) {
					for (let sx = 0; sx < scale; sx += 1) {
						paint(fb, gx + rx * scale + sx, gy + ry * scale + sy, 0.07, 0.08, 0.11);
					}
				}
			}
		}
	}
}

function paint(fb, x, y, r, g, b) {
	if (x < 0 || y < 0 || x >= fb.width || y >= fb.height) return;
	const idx = y * fb.width + x;
	fb.coverage[idx] = 1;
	fb.depth[idx] = 0;
	const o = idx * 3;
	fb.color[o] = r;
	fb.color[o + 1] = g;
	fb.color[o + 2] = b;
}

// 3x5 glyphs. Enough for a balloon, not a typesetter.
const FONT = {
	' ': ['000', '000', '000', '000', '000'],
	A: ['010', '101', '111', '101', '101'],
	B: ['110', '101', '110', '101', '110'],
	C: ['011', '100', '100', '100', '011'],
	D: ['110', '101', '101', '101', '110'],
	E: ['111', '100', '110', '100', '111'],
	F: ['111', '100', '110', '100', '100'],
	G: ['011', '100', '101', '101', '011'],
	H: ['101', '101', '111', '101', '101'],
	I: ['111', '010', '010', '010', '111'],
	J: ['001', '001', '001', '101', '010'],
	K: ['101', '101', '110', '101', '101'],
	L: ['100', '100', '100', '100', '111'],
	M: ['101', '111', '101', '101', '101'],
	N: ['110', '101', '101', '101', '101'],
	O: ['010', '101', '101', '101', '010'],
	P: ['110', '101', '110', '100', '100'],
	Q: ['010', '101', '101', '011', '001'],
	R: ['110', '101', '110', '101', '101'],
	S: ['011', '100', '010', '001', '110'],
	T: ['111', '010', '010', '010', '010'],
	U: ['101', '101', '101', '101', '111'],
	V: ['101', '101', '101', '101', '010'],
	W: ['101', '101', '101', '111', '101'],
	X: ['101', '101', '010', '101', '101'],
	Y: ['101', '101', '010', '010', '010'],
	Z: ['111', '001', '010', '100', '111'],
	0: ['111', '101', '101', '101', '111'],
	1: ['010', '110', '010', '010', '111'],
	2: ['110', '001', '010', '100', '111'],
	3: ['110', '001', '110', '001', '110'],
	4: ['101', '101', '111', '001', '001'],
	5: ['111', '100', '110', '001', '110'],
	6: ['011', '100', '110', '101', '011'],
	7: ['111', '001', '010', '010', '010'],
	8: ['111', '101', '111', '101', '111'],
	9: ['111', '101', '111', '001', '110'],
	'.': ['000', '000', '000', '000', '010'],
	'!': ['010', '010', '010', '000', '010'],
	'?': ['110', '001', '010', '000', '010'],
	',': ['000', '000', '000', '010', '100'],
	"'": ['010', '010', '000', '000', '000'],
	'-': ['000', '000', '111', '000', '000'],
};
