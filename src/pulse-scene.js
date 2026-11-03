// PULSE — a cinematic 3D visualization of the whole three.ws agent economy.
//
// The $THREE core sits at the gravitational center; every agent orbits it as a
// glowing node, pulled inward by reputation and value. Real economy events
// (launches, buybacks, payments, graduations) fire as eased streaks of light
// flowing between an agent and the core.
//
// This module owns ONLY the WebGL scene. The page (pages/pulse.html) and the
// controller (src/pulse.js) drive it through the API exported below:
//
//   const scene = createPulseScene(canvas, opts);
//   scene.setData({ three, agents });   // (re)build from real data
//   scene.pulse({ type, agentId, amountUsdc }); // one event streak
//   scene.focusAgent(id | null);        // fly camera to a node / overview
//   scene.getAgentAtPointer(x, y);      // raycast → agent id | null
//   scene.resize();
//   scene.setReducedMotion(bool);
//   scene.dispose();
//
// Conventions (renderer setup, reduced-motion, render-on-demand, dispose
// discipline) mirror src/galaxy.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyStudioLook } from './render/index.js';

const PREFERS_REDUCED_MOTION =
	typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Palette ──────────────────────────────────────────────────────────────────
// Dark, premium, Linear/Stripe-grade. Reputation ramps from a dim ember red
// (low trust) through teal to a bright gold-white (high trust). The $THREE core
// glows in the platform's signature green.
const PALETTE = {
	core: new THREE.Color('#3be08a'), // $THREE green — the gravitational center
	coreHalo: new THREE.Color('#7af7b8'),
	repLow: new THREE.Color('#ff5a5f'), // low reputation — dim ember
	repMid: new THREE.Color('#26c6da'), // mid reputation — cyan
	repHigh: new THREE.Color('#ffd86b'), // high reputation — bright gold
	rugged: new THREE.Color('#6b3a3a'), // rugged agents read as cold/ashen
	link: new THREE.Color('#1f3b52'),
	// Event hues
	event: {
		payment: new THREE.Color('#22d3ee'), // cyan — value flows to core
		buyback: new THREE.Color('#3be08a'), // $THREE green — buyback pressure
		launch: new THREE.Color('#a78bfa'), // violet — new creation emits outward
		graduation: new THREE.Color('#fff6e0'), // white-hot — a milestone
	},
};

// Map reputation 0..1 onto the ramp.
function reputationColor(rep, rugged) {
	const out = new THREE.Color();
	if (rugged) return out.copy(PALETTE.rugged);
	const r = Math.max(0, Math.min(1, rep || 0));
	if (r < 0.5) out.copy(PALETTE.repLow).lerp(PALETTE.repMid, r / 0.5);
	else out.copy(PALETTE.repMid).lerp(PALETTE.repHigh, (r - 0.5) / 0.5);
	return out;
}

const MAX_PARTICLES = 120; // hard cap on concurrent event streaks
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ── Sprite textures (generated once, reused) ─────────────────────────────────
// Soft radial-gradient glow used for agent nodes and the core halo.
function makeGlowTexture(size = 128) {
	const c = document.createElement('canvas');
	c.width = c.height = size;
	const ctx = c.getContext('2d');
	const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	g.addColorStop(0.0, 'rgba(255,255,255,1)');
	g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
	g.addColorStop(0.45, 'rgba(255,255,255,0.32)');
	g.addColorStop(1.0, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.needsUpdate = true;
	return tex;
}

// A tighter, hotter spark for event streaks.
function makeSparkTexture(size = 64) {
	const c = document.createElement('canvas');
	c.width = c.height = size;
	const ctx = c.getContext('2d');
	const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	g.addColorStop(0.0, 'rgba(255,255,255,1)');
	g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
	g.addColorStop(1.0, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.needsUpdate = true;
	return tex;
}

export function createPulseScene(canvas, opts = {}) {
	if (!(canvas instanceof HTMLCanvasElement)) {
		throw new TypeError('createPulseScene: a canvas element is required');
	}

	let reducedMotion = PREFERS_REDUCED_MOTION || !!opts.reducedMotion;

	// ── Renderer / scene / camera (galaxy.js conventions) ──────────────────────
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: true,
		powerPreference: 'high-performance',
	});
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.15;
	renderer.setClearColor(0x000000, 0);

	const scene = new THREE.Scene();
	// Only the $THREE core gem is PBR; a low-intensity studio environment gives its
	// facets a reflective sheen without lifting the dark galaxy palette.
	const undoStudioLook = applyStudioLook(renderer, scene, { environmentIntensity: 0.35 });
	scene.fog = new THREE.FogExp2(0x05070d, 0.0016);

	const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 6000);
	camera.position.set(0, 60, 520);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.enablePan = false;
	controls.minDistance = 80;
	controls.maxDistance = 1400;
	controls.rotateSpeed = 0.55;
	controls.zoomSpeed = 0.8;
	controls.autoRotate = !reducedMotion;
	controls.autoRotateSpeed = 0.28;

	const clock = new THREE.Clock();
	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();

	// ── Shared, single-allocation resources ────────────────────────────────────
	const glowTex = makeGlowTexture();
	const sparkTex = makeSparkTexture();

	// ── State ──────────────────────────────────────────────────────────────────
	const state = {
		agents: [], // array of normalized agent records (with position + screen radius)
		idToIndex: new Map(),
		nodes: null, // THREE.Points cloud of agent nodes
		nodeGeom: null,
		nodeMat: null,
		links: null, // faint connection lines agent → core
		linkGeom: null,
		linkMat: null,
		coreGroup: null,
		coreMesh: null,
		coreMat: null,
		coreHalo: null,
		coreHaloMat: null,
		ambient: null, // ambient depth particle field
		ambientMat: null,
		starfield: null,
		starMat: null,
	};

	// Camera fly-to tween (galaxy.js style).
	const fly = {
		active: false,
		t: 0,
		dur: 0.9,
		fromPos: new THREE.Vector3(),
		toPos: new THREE.Vector3(),
		fromTgt: new THREE.Vector3(),
		toTgt: new THREE.Vector3(),
	};

	// Idle auto-rotate resumes a few seconds after the user stops interacting.
	let idleTimer = 0;
	function scheduleIdle() {
		clearTimeout(idleTimer);
		if (reducedMotion) return;
		idleTimer = setTimeout(() => {
			controls.autoRotate = true;
		}, 3500);
	}
	controls.addEventListener('start', () => {
		controls.autoRotate = false;
		clearTimeout(idleTimer);
	});
	controls.addEventListener('end', scheduleIdle);

	// ── Background: starfield + ambient depth field ────────────────────────────
	function buildBackground() {
		// Distant starfield shell — purely decorative parallax.
		const N = 1600;
		const pos = new Float32Array(N * 3);
		for (let i = 0; i < N; i++) {
			const r = 1400 + Math.random() * 2800;
			const th = Math.random() * Math.PI * 2;
			const ph = Math.acos(2 * Math.random() - 1);
			pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
			pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
			pos[i * 3 + 2] = r * Math.cos(ph);
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		state.starMat = new THREE.PointsMaterial({
			color: 0x9fb4d6,
			size: 1.5,
			sizeAttenuation: false,
			transparent: true,
			opacity: 0.5,
			depthWrite: false,
		});
		state.starfield = new THREE.Points(g, state.starMat);
		state.starfield.frustumCulled = false;
		scene.add(state.starfield);

		// Ambient dust nearer the core gives the economy field a sense of volume.
		const M = 900;
		const apos = new Float32Array(M * 3);
		for (let i = 0; i < M; i++) {
			const r = 120 + Math.random() * 620;
			const th = Math.random() * Math.PI * 2;
			const ph = Math.acos(2 * Math.random() - 1);
			apos[i * 3] = r * Math.sin(ph) * Math.cos(th);
			apos[i * 3 + 1] = (r * Math.sin(ph) * Math.sin(th)) * 0.55; // flatten into a disk
			apos[i * 3 + 2] = r * Math.cos(ph);
		}
		const ag = new THREE.BufferGeometry();
		ag.setAttribute('position', new THREE.BufferAttribute(apos, 3));
		state.ambientMat = new THREE.PointsMaterial({
			color: 0x2e6f8e,
			size: 2.0,
			map: glowTex,
			sizeAttenuation: true,
			transparent: true,
			opacity: 0.28,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		state.ambient = new THREE.Points(ag, state.ambientMat);
		state.ambient.frustumCulled = false;
		scene.add(state.ambient);
	}

	// ── The $THREE core ────────────────────────────────────────────────────────
	function buildCore() {
		const group = new THREE.Group();

		// Emissive faceted gem — reads as a charged, premium centerpiece.
		const geo = new THREE.IcosahedronGeometry(22, 1);
		const mat = new THREE.MeshStandardMaterial({
			color: PALETTE.core,
			emissive: PALETTE.core,
			emissiveIntensity: 1.6,
			metalness: 0.3,
			roughness: 0.25,
			flatShading: true,
		});
		const mesh = new THREE.Mesh(geo, mat);
		group.add(mesh);

		// Inner wireframe shell adds detail without postprocessing.
		const wireGeo = new THREE.IcosahedronGeometry(26, 1);
		const wireMat = new THREE.MeshBasicMaterial({
			color: PALETTE.coreHalo,
			wireframe: true,
			transparent: true,
			opacity: 0.18,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		const wire = new THREE.Mesh(wireGeo, wireMat);
		group.add(wire);

		// Soft additive halo sprite — the "bloom" without postprocessing cost.
		const haloMat = new THREE.SpriteMaterial({
			map: glowTex,
			color: PALETTE.coreHalo,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		const halo = new THREE.Sprite(haloMat);
		halo.scale.setScalar(170);
		group.add(halo);

		// Two point lights so the gem and nearby nodes catch real shading.
		const keyLight = new THREE.PointLight(PALETTE.coreHalo.getHex(), 3.2, 1200, 1.4);
		group.add(keyLight);

		scene.add(group);
		scene.add(new THREE.AmbientLight(0x3a4a66, 0.6));

		state.coreGroup = group;
		state.coreMesh = mesh;
		state.coreMat = mat;
		state.coreHalo = halo;
		state.coreHaloMat = haloMat;
		// Track auxiliary disposables on the group's userData for clean teardown.
		group.userData.disposables = [geo, mat, wireGeo, wireMat, haloMat];
	}

	// ── Agent nodes ────────────────────────────────────────────────────────────
	// Position each agent in an orbital shell: higher reputation/value pulls the
	// node closer to the core and makes it brighter; node size scales with value
	// and launch activity. Layout is deterministic per agent id so re-renders are
	// stable, with a golden-angle spiral spreading nodes evenly over a sphere.
	function layoutAgents(agents) {
		const GOLDEN = Math.PI * (3 - Math.sqrt(5));
		const maxValue = Math.max(1, ...agents.map((a) => a.value_usdc || 0));
		const maxLaunch = Math.max(1, ...agents.map((a) => a.launches || 0));

		return agents.map((a, i) => {
			const rep = Math.max(0, Math.min(1, a.reputation || 0));
			const valueNorm = Math.log1p(a.value_usdc || 0) / Math.log1p(maxValue);
			const launchNorm = Math.log1p(a.launches || 0) / Math.log1p(maxLaunch);

			// Pull-in: blend reputation and value. 1 = hugs the core, 0 = far rim.
			const pull = 0.6 * rep + 0.4 * valueNorm;
			const radius = 110 + (560 - 110) * (1 - pull);

			// Even spherical distribution via Fibonacci sphere, flattened into a
			// gentle disk so the economy reads as an accretion field, not a ball.
			const y = 1 - (i / Math.max(1, agents.length - 1)) * 2; // 1 → -1
			const ringR = Math.sqrt(Math.max(0, 1 - y * y));
			const theta = GOLDEN * i;
			const pos = new THREE.Vector3(
				radius * ringR * Math.cos(theta),
				radius * y * 0.6,
				radius * ringR * Math.sin(theta),
			);

			// Node size scales with value + launches; graduated agents get a bump.
			const size = 6 + 22 * (0.55 * valueNorm + 0.45 * launchNorm) + (a.graduated ? 6 : 0);

			// Brightness rides reputation; rugged agents are dimmed regardless.
			const brightness = a.rugged ? 0.22 : 0.45 + 0.55 * rep;

			return {
				id: a.id,
				name: a.name || 'Agent',
				avatar_url: a.avatar_url || null,
				launches: a.launches || 0,
				value_usdc: a.value_usdc || 0,
				reputation: rep,
				graduated: !!a.graduated,
				rugged: !!a.rugged,
				best_ath_multiple: a.best_ath_multiple || 0,
				position: pos,
				size,
				brightness,
				color: reputationColor(rep, a.rugged),
			};
		});
	}

	function buildNodes(agents) {
		const n = agents.length;
		const positions = new Float32Array(n * 3);
		const colors = new Float32Array(n * 3);
		const sizes = new Float32Array(n);
		const seeds = new Float32Array(n);
		const bright = new Float32Array(n);

		state.idToIndex.clear();
		agents.forEach((a, i) => {
			state.idToIndex.set(a.id, i);
			positions[i * 3] = a.position.x;
			positions[i * 3 + 1] = a.position.y;
			positions[i * 3 + 2] = a.position.z;
			colors[i * 3] = a.color.r;
			colors[i * 3 + 1] = a.color.g;
			colors[i * 3 + 2] = a.color.b;
			sizes[i] = a.size;
			seeds[i] = Math.random();
			bright[i] = a.brightness;
		});

		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
		geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
		geom.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
		geom.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));

		const mat = new THREE.ShaderMaterial({
			uniforms: {
				uTime: { value: 0 },
				uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
				uTwinkle: { value: reducedMotion ? 0 : 1 },
				uFocus: { value: -1 }, // index of focused node, or -1
				uTex: { value: glowTex },
			},
			vertexShader: NODE_VERT,
			fragmentShader: NODE_FRAG,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});

		const points = new THREE.Points(geom, mat);
		points.frustumCulled = false;
		scene.add(points);

		state.nodes = points;
		state.nodeGeom = geom;
		state.nodeMat = mat;

		// Raycast against points; threshold scaled to node footprint.
		raycaster.params.Points.threshold = 14;
	}

	// Faint lines tying each agent back to the core — the economy's connective tissue.
	function buildLinks(agents) {
		const n = agents.length;
		const positions = new Float32Array(n * 2 * 3);
		const alphas = new Float32Array(n * 2);
		agents.forEach((a, i) => {
			positions[i * 6 + 0] = 0;
			positions[i * 6 + 1] = 0;
			positions[i * 6 + 2] = 0;
			positions[i * 6 + 3] = a.position.x;
			positions[i * 6 + 4] = a.position.y;
			positions[i * 6 + 5] = a.position.z;
			// Brighter, more reputable agents get a slightly more visible tether.
			const al = 0.05 + 0.22 * a.brightness;
			alphas[i * 2] = al * 0.4; // near core
			alphas[i * 2 + 1] = al; // at node
		});
		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geom.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
		const mat = new THREE.ShaderMaterial({
			uniforms: { uColor: { value: PALETTE.link.clone() } },
			vertexShader: LINK_VERT,
			fragmentShader: LINK_FRAG,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		const lines = new THREE.LineSegments(geom, mat);
		lines.frustumCulled = false;
		scene.add(lines);
		state.links = lines;
		state.linkGeom = geom;
		state.linkMat = mat;
	}

	// ── Event particle pool ────────────────────────────────────────────────────
	// One additive Points cloud holds the whole pool. Inactive particles live at
	// the origin with zero alpha; pulse() activates a slot and tick() advances it.
	const particles = {
		points: null,
		geom: null,
		mat: null,
		count: MAX_PARTICLES,
		// Per-particle simulation state (parallel arrays).
		active: new Uint8Array(MAX_PARTICLES),
		t: new Float32Array(MAX_PARTICLES),
		dur: new Float32Array(MAX_PARTICLES),
		from: [],
		to: [],
		baseSize: new Float32Array(MAX_PARTICLES),
		cursor: 0,
	};

	function buildParticles() {
		const N = particles.count;
		for (let i = 0; i < N; i++) {
			particles.from[i] = new THREE.Vector3();
			particles.to[i] = new THREE.Vector3();
		}
		const positions = new Float32Array(N * 3);
		const colors = new Float32Array(N * 3);
		const sizes = new Float32Array(N);
		const alphas = new Float32Array(N);
		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
		geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
		geom.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
		const mat = new THREE.ShaderMaterial({
			uniforms: {
				uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
				uTex: { value: sparkTex },
			},
			vertexShader: PARTICLE_VERT,
			fragmentShader: PARTICLE_FRAG,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		const pts = new THREE.Points(geom, mat);
		pts.frustumCulled = false;
		scene.add(pts);
		particles.points = pts;
		particles.geom = geom;
		particles.mat = mat;
	}

	// Find the next free slot; if the pool is saturated, recycle the oldest
	// (round-robin) so we never allocate beyond the cap.
	function acquireParticle() {
		const N = particles.count;
		for (let k = 0; k < N; k++) {
			const i = (particles.cursor + k) % N;
			if (!particles.active[i]) {
				particles.cursor = (i + 1) % N;
				return i;
			}
		}
		const i = particles.cursor;
		particles.cursor = (i + 1) % N;
		return i;
	}

	function emitParticle(from, to, color, dur, size) {
		const i = acquireParticle();
		particles.active[i] = 1;
		particles.t[i] = 0;
		particles.dur[i] = dur;
		particles.from[i].copy(from);
		particles.to[i].copy(to);
		particles.baseSize[i] = size;
		const col = particles.geom.getAttribute('aColor');
		col.setXYZ(i, color.r, color.g, color.b);
		col.needsUpdate = true;
	}

	function updateParticles(dt) {
		if (!particles.points) return;
		const posAttr = particles.geom.getAttribute('position');
		const sizeAttr = particles.geom.getAttribute('aSize');
		const alphaAttr = particles.geom.getAttribute('aAlpha');
		const N = particles.count;
		const tmp = updateParticles._tmp || (updateParticles._tmp = new THREE.Vector3());
		const ctrl = updateParticles._ctrl || (updateParticles._ctrl = new THREE.Vector3());
		let live = 0;
		for (let i = 0; i < N; i++) {
			if (!particles.active[i]) {
				alphaAttr.setX(i, 0);
				continue;
			}
			live++;
			particles.t[i] += dt / particles.dur[i];
			const t = particles.t[i];
			if (t >= 1) {
				particles.active[i] = 0;
				alphaAttr.setX(i, 0);
				continue;
			}
			const e = easeInOut(t);
			// Curve the streak: lift it out of the straight chord toward the core
			// plane so flows arc gracefully rather than slicing through center.
			const from = particles.from[i];
			const to = particles.to[i];
			ctrl.copy(from).add(to).multiplyScalar(0.5);
			ctrl.multiplyScalar(0.62); // bend toward the core
			ctrl.y += from.length() * 0.18;
			// Quadratic Bézier(from, ctrl, to).
			const mt = 1 - e;
			tmp.copy(from).multiplyScalar(mt * mt);
			tmp.addScaledVector(ctrl, 2 * mt * e);
			tmp.addScaledVector(to, e * e);
			posAttr.setXYZ(i, tmp.x, tmp.y, tmp.z);
			// Fade in fast, linger, fade out; pulse the size near arrival.
			const fade = Math.sin(Math.PI * easeOut(t));
			alphaAttr.setX(i, fade);
			sizeAttr.setX(i, particles.baseSize[i] * (0.7 + 0.6 * fade));
		}
		posAttr.needsUpdate = true;
		sizeAttr.needsUpdate = true;
		alphaAttr.needsUpdate = true;
		return live;
	}

	// ── Camera moves (galaxy.js style) ─────────────────────────────────────────
	function flyTo(toPos, toTgt, dur = 0.9) {
		fly.fromPos.copy(camera.position);
		fly.fromTgt.copy(controls.target);
		fly.toPos.copy(toPos);
		fly.toTgt.copy(toTgt);
		fly.dur = Math.max(0.001, dur);
		fly.t = 0;
		fly.active = true;
		controls.autoRotate = false;
	}
	// Glide closer to a target along the current view direction.
	function flyToTarget(target, dist) {
		const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
		if (dir.lengthSq() < 1e-6) dir.set(0, 0.2, 1);
		dir.normalize().multiplyScalar(dist);
		flyTo(new THREE.Vector3().addVectors(target, dir), target.clone(), 0.9);
	}

	// ── Render loop (render-on-demand via setAnimationLoop; paused when hidden) ─
	let running = true;
	function tick() {
		if (!running) return;
		const dt = Math.min(0.05, clock.getDelta());
		const t = clock.getElapsed();

		if (state.nodeMat) state.nodeMat.uniforms.uTime.value = t;

		// Core breathing: subtle scale + emissive pulse (still under reduced motion,
		// but very gentle).
		if (state.coreGroup) {
			const breathe = reducedMotion ? 0 : 0.06 * Math.sin(t * 1.4);
			state.coreGroup.scale.setScalar(1 + breathe);
			if (!reducedMotion) state.coreMesh.rotation.y += dt * 0.18;
			if (state.coreMat) state.coreMat.emissiveIntensity = 1.5 + (reducedMotion ? 0 : 0.4 * (0.5 + 0.5 * Math.sin(t * 1.4)));
			if (state.coreHalo) state.coreHalo.scale.setScalar(170 * (1 + breathe * 1.4));
		}
		if (state.ambient && !reducedMotion) state.ambient.rotation.y += dt * 0.01;

		updateParticles(dt);

		if (fly.active) {
			fly.t = Math.min(1, fly.t + dt / fly.dur);
			const e = easeInOut(fly.t);
			camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
			controls.target.lerpVectors(fly.fromTgt, fly.toTgt, e);
			if (fly.t >= 1) {
				fly.active = false;
				scheduleIdle();
			}
		}

		controls.update();
		renderer.render(scene, camera);
	}

	// Pause the loop when the tab is hidden to save battery/GPU.
	function onVisibility() {
		if (document.hidden) {
			renderer.setAnimationLoop(null);
		} else if (running) {
			clock.getDelta(); // discard the gap so animations don't jump
			renderer.setAnimationLoop(tick);
		}
	}
	document.addEventListener('visibilitychange', onVisibility);

	// ── Public API ─────────────────────────────────────────────────────────────
	function setData({ three, agents } = {}) {
		disposeSceneContent();
		state.three = three || { symbol: '$THREE' };

		const list = Array.isArray(agents) ? agents.filter((a) => a && a.id != null) : [];
		state.agents = layoutAgents(list);

		buildCore();
		if (state.agents.length) {
			buildLinks(state.agents);
			buildNodes(state.agents);
		}
		buildParticles();

		// Frame the whole field on first build.
		flyTo(new THREE.Vector3(0, 90, 640), new THREE.Vector3(0, 0, 0), 0.001);
		dbg.agentCount = state.agents.length;
		dbg.ready = true;
	}

	function pulse(event = {}) {
		if (!particles.points) return;
		const type = event.type || 'payment';
		const color = PALETTE.event[type] || PALETTE.event.payment;
		const core = new THREE.Vector3(0, 0, 0);

		// Resolve the agent endpoint; fall back to a random node so a streak still
		// fires for events with no agent attached (keeps the field alive).
		let node = null;
		if (event.agentId != null && state.idToIndex.has(event.agentId)) {
			node = state.agents[state.idToIndex.get(event.agentId)];
		} else if (state.agents.length) {
			node = state.agents[(Math.random() * state.agents.length) | 0];
		}
		const nodePos = node ? node.position : new THREE.Vector3(0, 120, 0);

		// Streak size scales gently with amount; graduations/buybacks read bigger.
		const amt = Math.max(0, event.amountUsdc || 0);
		const amtBoost = amt ? Math.min(1, Math.log1p(amt) / Math.log1p(5000)) : 0;
		let size = 18 + 26 * amtBoost;
		let dur = 1.1;

		// Direction & character per event type.
		switch (type) {
			case 'launch':
				// New creation emits OUTWARD from the agent into the field.
				emitParticle(nodePos, outwardPoint(nodePos), color, 1.0, size);
				break;
			case 'graduation':
				// A milestone: a bright burst flowing core ↔ node, slightly larger.
				size += 12;
				dur = 1.4;
				emitParticle(nodePos, core, color, dur, size);
				emitParticle(core, nodePos, color, dur * 0.9, size * 0.7);
				break;
			case 'buyback':
				// Value flows IN to the $THREE core (buyback pressure).
				emitParticle(nodePos, core, color, 1.2, size);
				break;
			case 'payment':
			default:
				// Payments flow IN to the core as well, cyan-tinted.
				emitParticle(nodePos, core, color, dur, size);
				break;
		}
		dbg.pulseCount++;
	}

	// A point flung outward from a node, away from the core, for launch streaks.
	function outwardPoint(nodePos) {
		const dir = nodePos.clone();
		if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
		dir.normalize();
		return nodePos.clone().addScaledVector(dir, 140 + Math.random() * 120);
	}

	function focusAgent(id) {
		if (id == null || !state.idToIndex.has(id)) {
			// Return to overview.
			if (state.nodeMat) state.nodeMat.uniforms.uFocus.value = -1;
			flyTo(new THREE.Vector3(0, 90, 640), new THREE.Vector3(0, 0, 0), 1.1);
			return;
		}
		const idx = state.idToIndex.get(id);
		const a = state.agents[idx];
		if (state.nodeMat) state.nodeMat.uniforms.uFocus.value = idx;
		flyToTarget(a.position, 130);
	}

	function getAgentAtPointer(clientX, clientY) {
		if (!state.nodes) return null;
		const rect = renderer.domElement.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
		raycaster.setFromCamera(pointer, camera);
		const hits = raycaster.intersectObject(state.nodes, false);
		if (!hits.length) return null;
		const a = state.agents[hits[0].index];
		return a ? a.id : null;
	}

	function resize() {
		const parent = renderer.domElement.parentElement;
		const w = (parent && parent.clientWidth) || renderer.domElement.clientWidth || window.innerWidth;
		const h = (parent && parent.clientHeight) || renderer.domElement.clientHeight || window.innerHeight;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}

	function setReducedMotion(bool) {
		reducedMotion = !!bool;
		controls.autoRotate = !reducedMotion;
		if (reducedMotion) {
			clearTimeout(idleTimer);
			controls.autoRotate = false;
		} else {
			scheduleIdle();
		}
		if (state.nodeMat) state.nodeMat.uniforms.uTwinkle.value = reducedMotion ? 0 : 1;
	}

	// ── Teardown ───────────────────────────────────────────────────────────────
	// Dispose scene content (nodes, links, core, particles) without killing the
	// renderer — used by setData() for safe rebuilds and by dispose().
	function disposeSceneContent() {
		const drop = (obj, ...extra) => {
			if (!obj) return;
			scene.remove(obj);
			obj.geometry?.dispose?.();
			if (obj.material) {
				if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
				else obj.material.dispose();
			}
			for (const d of extra) d?.dispose?.();
		};

		drop(state.nodes);
		state.nodes = state.nodeGeom = state.nodeMat = null;
		drop(state.links);
		state.links = state.linkGeom = state.linkMat = null;
		drop(particles.points);
		particles.points = particles.geom = particles.mat = null;
		particles.active.fill(0);

		if (state.coreGroup) {
			scene.remove(state.coreGroup);
			for (const d of state.coreGroup.userData.disposables || []) d?.dispose?.();
			state.coreGroup.traverse((o) => {
				o.geometry?.dispose?.();
				if (o.material && !Array.isArray(o.material)) o.material.dispose?.();
			});
			state.coreGroup = state.coreMesh = state.coreMat = null;
			state.coreHalo = state.coreHaloMat = null;
		}
		// Strip ambient lights added alongside the core so they don't accumulate.
		for (const o of [...scene.children]) {
			if (o.isAmbientLight) scene.remove(o);
		}
	}

	function dispose() {
		running = false;
		try {
			clearTimeout(idleTimer);
			renderer.setAnimationLoop(null);
			document.removeEventListener('visibilitychange', onVisibility);
			controls.dispose();

			disposeSceneContent();

			drop(state.starfield);
			state.starfield = state.starMat = null;
			drop(state.ambient);
			state.ambient = state.ambientMat = null;

			glowTex.dispose();
			sparkTex.dispose();
			undoStudioLook();
			renderer.dispose();
		} catch {
			/* best-effort teardown */
		}
		if (window.__pulseScene === controller) delete window.__pulseScene;

		function drop(obj) {
			if (!obj) return;
			scene.remove(obj);
			obj.geometry?.dispose?.();
			obj.material?.dispose?.();
		}
	}

	// ── Boot the loop ──────────────────────────────────────────────────────────
	buildBackground();
	resize();
	renderer.setAnimationLoop(tick);

	// Public debug/verification surface.
	const dbg = {
		ready: false,
		agentCount: 0,
		pulseCount: 0,
		get particlesLive() {
			let n = 0;
			for (let i = 0; i < particles.count; i++) n += particles.active[i];
			return n;
		},
		camera,
		scene,
		focus: (id) => focusAgent(id),
		emit: (type, agentId, amountUsdc) => pulse({ type, agentId, amountUsdc }),
	};

	const controller = {
		setData,
		pulse,
		focusAgent,
		getAgentAtPointer,
		resize,
		setReducedMotion,
		dispose,
		debug: dbg,
	};

	// Tiny debug handle for browser-console verification.
	window.__pulseScene = controller;

	return controller;
}

// ── Shaders ────────────────────────────────────────────────────────────────────
// Agent nodes: soft additive glow, gentle twinkle, size attenuates with distance,
// focused node pulses brighter.
const NODE_VERT = /* glsl */ `
	attribute vec3 aColor;
	attribute float aSize;
	attribute float aSeed;
	attribute float aBright;
	uniform float uTime;
	uniform float uPixelRatio;
	uniform float uTwinkle;
	uniform float uFocus;
	varying vec3 vColor;
	varying float vBright;
	void main() {
		vColor = aColor;
		vBright = aBright;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		float size = aSize;
		size *= 1.0 + uTwinkle * 0.14 * sin(uTime * 1.5 + aSeed * 6.2831);
		// Focused node pulses larger/brighter.
		float focused = step(0.5, 1.0 - abs(float(gl_VertexID) - uFocus));
		size *= mix(1.0, 1.9 + 0.5 * sin(uTime * 4.0), focused);
		vBright += focused * 0.6;
		float dist = max(-mv.z, 1.0);
		gl_PointSize = clamp(size * (320.0 / dist), 1.0, 80.0) * uPixelRatio;
		gl_Position = projectionMatrix * mv;
	}
`;
const NODE_FRAG = /* glsl */ `
	precision mediump float;
	uniform sampler2D uTex;
	varying vec3 vColor;
	varying float vBright;
	void main() {
		vec4 tex = texture2D(uTex, gl_PointCoord);
		float a = tex.a;
		if (a < 0.01) discard;
		// Hot white core fading to the agent's reputation color at the edges.
		vec3 col = mix(vColor, vec3(1.0), pow(a, 2.5) * 0.6);
		gl_FragColor = vec4(col * (0.5 + vBright), a);
	}
`;

// Connection tethers: per-vertex alpha so the line fades from core to node.
const LINK_VERT = /* glsl */ `
	attribute float aAlpha;
	varying float vAlpha;
	void main() {
		vAlpha = aAlpha;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;
const LINK_FRAG = /* glsl */ `
	precision mediump float;
	uniform vec3 uColor;
	varying float vAlpha;
	void main() {
		gl_FragColor = vec4(uColor, vAlpha);
	}
`;

// Event streaks: textured additive sparks; per-particle color/size/alpha.
const PARTICLE_VERT = /* glsl */ `
	attribute vec3 aColor;
	attribute float aSize;
	attribute float aAlpha;
	uniform float uPixelRatio;
	varying vec3 vColor;
	varying float vAlpha;
	void main() {
		vColor = aColor;
		vAlpha = aAlpha;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		float dist = max(-mv.z, 1.0);
		gl_PointSize = clamp(aSize * (340.0 / dist), 1.0, 110.0) * uPixelRatio;
		gl_Position = projectionMatrix * mv;
	}
`;
const PARTICLE_FRAG = /* glsl */ `
	precision mediump float;
	uniform sampler2D uTex;
	varying vec3 vColor;
	varying float vAlpha;
	void main() {
		if (vAlpha < 0.01) discard;
		vec4 tex = texture2D(uTex, gl_PointCoord);
		float a = tex.a * vAlpha;
		vec3 col = mix(vColor, vec3(1.0), pow(tex.a, 3.0) * 0.7);
		gl_FragColor = vec4(col, a);
	}
`;
