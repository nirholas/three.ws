// /haunted: a walk-around 3D graveyard assembled from Kenney's CC0 Graveyard Kit.
//
// Every model is a real GLB from /objects/kenney-graveyard/glb (ingested by
// scripts/ingest-kenney-graveyard.mjs). The layout is deterministic, the five
// characters play the kit's own animation clips, and nothing here is mocked: the
// loading bar counts real fetches and a failed fetch shows a retry.

import {
	ACESFilmicToneMapping, AnimationMixer, BufferAttribute, BufferGeometry, CanvasTexture, Clock, Color,
	DirectionalLight, FogExp2, Group, HemisphereLight, LoopOnce, LoopRepeat, Mesh, MeshBasicMaterial, MeshStandardMaterial,
	PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial, Raycaster, RepeatWrapping,
	Scene, SphereGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const BASE = '/objects/kenney-graveyard/glb/';
const $ = (id) => document.getElementById(id);
const coarse = matchMedia('(pointer: coarse)').matches;
const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- deterministic layout ----------

function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rng = mulberry32(31102026);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const R = 8; // half-width of the fenced yard
const STONES = ['gravestone-cross', 'gravestone-round', 'gravestone-bevel', 'gravestone-wide', 'gravestone-decorative', 'gravestone-roof', 'gravestone-cross-large', 'gravestone-broken'];

/** The whole yard as a flat list of placements: { m: model, x, z, ry, s, tag? }. */
function buildLayout() {
	const items = [];
	const add = (m, x, z, ry = 0, s = 1, tag) => items.push({ m, x, z, ry, s, tag });

	// Fence: four sides, a gate at the front centre, columns at the corners.
	for (let i = -R + 0.5; i <= R - 0.5; i += 1) {
		add('iron-fence-border', i, -R, 0);
		add('iron-fence-border', -R, i, Math.PI / 2);
		add('iron-fence-border', R, i, Math.PI / 2);
		if (Math.abs(i) < 0.6) add('iron-fence-border-gate', i, R, 0);
		else add(rng() < 0.12 ? 'iron-fence-damaged' : 'iron-fence-border', i, R, 0);
	}
	for (const [x, z] of [[-R, -R], [R, -R], [-R, R], [R, R]]) add('iron-fence-border-column', x, z, 0);

	// The road from the gate to the crypt.
	for (let z = R; z > -4.2; z -= 0.79) add('road', 0, z, 0);

	// The crypt, its altar and the light baskets either side of the road.
	add('crypt-large', 0, -R + 2.4, 0, 1.15);
	add('altar-stone', -2.6, -3.2, 0.2);
	add('fire-basket', -1.3, -3.6, 0, 1.4, 'fire');
	add('fire-basket', 1.3, -3.6, 0, 1.4, 'fire');
	add('coffin-old', 2.8, -3.4, -0.5);
	add('urn-round', -0.9, R - 0.9, 0);
	add('urn-round', 0.9, R - 0.9, 0);

	// Graves in three rows either side of the road.
	for (const side of [-1, 1]) {
		for (let row = 0; row < 3; row++) {
			for (let col = 0; col < 3; col++) {
				if (rng() < 0.12) continue;
				const x = side * (1.9 + col * 1.5) + (rng() - 0.5) * 0.25;
				const z = 3.6 - row * 2.2 + (rng() - 0.5) * 0.25;
				add('grave', x, z, (rng() - 0.5) * 0.1);
				add(pick(STONES), x, z - 0.7, (rng() - 0.5) * 0.25);
			}
		}
	}
	add('cross', -6.2, -1.2, 0.3);
	add('cross-wood', 6.1, -0.8, -0.3);
	add('pillar-obelisk', -5.6, -5.4, 0);
	add('pillar-obelisk', 5.6, -5.4, 0);
	add('shovel-dirt', 3.5, 5.2, 0.7);
	add('bench', -3.6, 6.3, 0.15);
	add('debris', 6.3, 4.6, 1.2);

	// Lampposts along the road.
	for (const [x, z] of [[-1.35, 5.2], [1.35, 5.2], [-1.35, 0.6], [1.35, 0.6]]) add('lightpost-single', x, z, x < 0 ? Math.PI / 2 : -Math.PI / 2, 1.5, 'lamp');

	// Pumpkins: a patch by the gate and a few on the crypt steps.
	const PUMPKINS = ['pumpkin', 'pumpkin-carved', 'pumpkin-tall', 'pumpkin-tall-carved'];
	for (let i = 0; i < 9; i++) {
		const m = pick(PUMPKINS);
		add(m, -4.6 + rng() * 1.8, 5.2 + rng() * 1.8, rng() * 6.28, 1.5 + rng() * 0.5, m.includes('carved') ? 'pumpkin' : undefined);
	}
	add('pumpkin-carved', -0.8, -2.6, 0.4, 1.7, 'pumpkin');
	add('pumpkin-tall-carved', 0.8, -2.6, -0.4, 1.7, 'pumpkin');
	add('hay-bale', 4.9, 6.1, 0.4, 1.3);
	add('hay-bale-bundled', 5.6, 5.3, 1.2, 1.3);

	// Trees inside the corners and a ring outside the fence.
	for (const [x, z] of [[-6.6, -6.4], [6.6, -6.4], [-6.8, 6.6], [6.8, 6.4]]) add(pick(['pine', 'pine-crooked', 'pine-fall']), x, z, rng() * 6.28, 1.9);
	for (let i = 0; i < 26; i++) {
		const a = (i / 26) * Math.PI * 2 + rng() * 0.2;
		const d = 10.6 + rng() * 3.2;
		add(pick(['pine', 'pine-crooked', 'pine-fall', 'pine-fall-crooked']), Math.cos(a) * d, Math.sin(a) * d, rng() * 6.28, 1.9 + rng() * 0.9);
	}
	for (let i = 0; i < 9; i++) {
		const a = rng() * Math.PI * 2;
		const d = 9.3 + rng() * 4;
		add(pick(['rocks', 'rocks-tall', 'trunk', 'trunk-long']), Math.cos(a) * d, Math.sin(a) * d, rng() * 6.28, 1.4 + rng() * 0.6);
	}
	return items;
}

const CHARACTERS = [
	{ id: 'character-keeper', name: 'The Keeper', x: -2.2, z: 6.4, ry: 0.6, wander: null },
	{ id: 'character-zombie', name: 'Zombie', x: 3.4, z: 2.4, ry: 2.4, wander: [[3.4, 2.4], [4.6, -0.6], [3.0, -2.2], [5.2, 1.0]] },
	{ id: 'character-skeleton', name: 'Skeleton', x: -3.5, z: -1.8, ry: 1.0, wander: [[-3.5, -1.8], [-5, 1.2], [-3.2, 3.6], [-4.8, -0.4]] },
	{ id: 'character-vampire', name: 'Vampire', x: 0, z: -3.0, ry: 0, wander: [[0, -3.0], [-1.0, -2.2], [1.0, -2.2]] },
	{ id: 'character-ghost', name: 'Ghost', x: 0.2, z: 3.0, ry: 3.1, wander: [[0.2, 3.0], [-1.6, 1.4], [0.4, -0.6], [1.7, 1.6]], ghost: true },
];

const ONE_SHOT = /^(jump|die|pick-up|emote-|attack-|interact-)/;

// ---------- boot ----------

const stage = $('hn-stage');
const canvas = $('hn-canvas');
let started = false;

function showError(message) {
	$('hn-loading').hidden = true;
	$('hn-error').hidden = false;
	$('hn-error-text').textContent = message;
}

function webglOk() {
	try {
		const c = document.createElement('canvas');
		return !!(c.getContext('webgl2') || c.getContext('webgl'));
	} catch (_) {
		return false;
	}
}

async function start() {
	if (started) return;
	started = true;
	$('hn-error').hidden = true;
	$('hn-loading').hidden = false;
	if (!webglOk()) {
		started = false;
		return showError('Your browser or device has WebGL turned off. Turn on hardware acceleration and try again.');
	}
	try {
		await run();
	} catch (err) {
		started = false;
		console.error('haunted yard failed to start', err);
		showError(err?.message ? `${err.message}. Check your connection and try again.` : 'Something went wrong while loading the graveyard. Try again.');
	}
}

async function run() {
	// ----- renderer, scene, camera -----
	const renderer = new WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' });
	renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2));
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFSoftShadowMap;

	const scene = new Scene();
	const night = new Color('#0b0716');
	scene.background = night;
	scene.fog = new FogExp2(night, 0.055);

	const camera = new PerspectiveCamera(48, 1, 0.1, 140);
	camera.position.set(0.5, 3.4, 14.5);
	const controls = new OrbitControls(camera, canvas);
	controls.target.set(0, 0.9, 1.5);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = 2.2;
	controls.maxDistance = 22;
	controls.maxPolarAngle = Math.PI * 0.49;
	controls.screenSpacePanning = false;
	controls.update();

	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.5, 0.7, 0.72);
	composer.addPass(bloom);
	composer.addPass(new OutputPass());

	function resize() {
		const w = Math.max(1, stage.clientWidth);
		const h = Math.max(1, stage.clientHeight);
		renderer.setSize(w, h, false);
		composer.setSize(w, h);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}
	new ResizeObserver(resize).observe(stage);
	resize();

	// ----- light -----
	scene.add(new HemisphereLight('#6a5bb0', '#1a1124', 0.55));
	const moon = new DirectionalLight('#9fb4ff', 1.35);
	moon.position.set(-9, 14, 8);
	moon.castShadow = true;
	const sm = coarse ? 1024 : 2048;
	moon.shadow.mapSize.set(sm, sm);
	Object.assign(moon.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 40 });
	moon.shadow.bias = -0.0004;
	scene.add(moon);

	const moonDisc = new Mesh(new SphereGeometry(2.2, 32, 16), new MeshBasicMaterial({ color: new Color(1.6, 1.6, 1.5), toneMapped: false, fog: false }));
	moonDisc.position.set(-28, 30, -34);
	scene.add(moonDisc);

	const stars = (() => {
		const n = 700;
		const pos = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			const a = rng() * Math.PI * 2;
			const e = 0.12 + rng() * 1.2;
			const r = 70;
			pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
			pos[i * 3 + 1] = Math.sin(e) * r;
			pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
		}
		const g = new BufferGeometry();
		g.setAttribute('position', new BufferAttribute(pos, 3));
		return new Points(g, new PointsMaterial({ color: '#cfd6ff', size: 0.5, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
	})();
	scene.add(stars);

	// ----- ground (a generated grass-and-dirt speckle texture, no external image) -----
	const groundTex = (() => {
		const c = document.createElement('canvas');
		c.width = c.height = 256;
		const g = c.getContext('2d');
		g.fillStyle = '#1b2a1f';
		g.fillRect(0, 0, 256, 256);
		const r = mulberry32(7);
		for (let i = 0; i < 2600; i++) {
			const l = 14 + r() * 16;
			g.fillStyle = `hsl(${105 + r() * 40} ${25 + r() * 20}% ${l}%)`;
			g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 3);
		}
		const t = new CanvasTexture(c);
		t.wrapS = t.wrapT = RepeatWrapping;
		t.repeat.set(20, 20);
		t.colorSpace = SRGBColorSpace;
		t.anisotropy = 4;
		return t;
	})();
	const ground = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 }));
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);

	// ----- models (real fetches, real progress) -----
	const layout = buildLayout();
	const needed = [...new Set([...layout.map((i) => i.m), ...CHARACTERS.map((c) => c.id)])];
	let loaded = 0;
	const loader = new GLTFLoader();
	const cache = new Map();
	await Promise.all(needed.map(async (name) => {
		const gltf = await loader.loadAsync(`${BASE}${name}.glb`);
		cache.set(name, gltf);
		loaded += 1;
		$('hn-bar').style.width = `${Math.round((loaded / needed.length) * 100)}%`;
		$('hn-loading-text').textContent = `Raising the graveyard (${loaded} of ${needed.length} models)`;
	}));

	const yard = new Group();
	scene.add(yard);
	const flickers = [];
	const lightBudget = coarse ? 6 : 10;
	let lightCount = 0;
	const lamps = new Group(); // everything the Lights toggle controls
	yard.add(lamps);

	function glow(x, y, z, color, intensity, distance) {
		const mat = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(2.2), toneMapped: false });
		const bulb = new Mesh(new SphereGeometry(0.07, 12, 8), mat);
		bulb.position.set(x, y, z);
		lamps.add(bulb);
		if (lightCount >= lightBudget) return;
		lightCount += 1;
		const light = new PointLight(color, intensity, distance, 1.6);
		light.position.set(x, y + 0.05, z);
		lamps.add(light);
		flickers.push({ light, bulb, base: intensity, phase: rng() * 100 });
	}

	for (const it of layout) {
		const src = cache.get(it.m).scene;
		const obj = src.clone(true);
		obj.position.set(it.x, 0, it.z);
		obj.rotation.y = it.ry;
		obj.scale.setScalar(it.s);
		obj.traverse((o) => {
			if (o.isMesh) {
				o.castShadow = true;
				o.receiveShadow = true;
			}
		});
		yard.add(obj);
		if (it.tag === 'lamp') glow(it.x, 1.9, it.z, '#ffb35c', 14, 7);
		else if (it.tag === 'fire') glow(it.x, 0.45, it.z, '#ff7a1a', 16, 7);
		else if (it.tag === 'pumpkin') glow(it.x, 0.3, it.z, '#ff8a2a', 3.2, 2.6);
	}

	// ----- characters -----
	const actors = [];
	const clock = new Clock();
	for (const def of CHARACTERS) {
		const gltf = cache.get(def.id);
		const root = cloneSkinned(gltf.scene);
		root.scale.setScalar(1.7);
		root.position.set(def.x, def.ghost ? 0.25 : 0, def.z);
		root.rotation.y = def.ry;
		root.traverse((o) => {
			if (!o.isMesh) return;
			o.castShadow = true;
			o.frustumCulled = false;
			if (def.ghost) {
				o.material = o.material.clone();
				o.material.transparent = true;
				o.material.opacity = 0.7;
				o.material.emissive = new Color('#7fd6ff');
				o.material.emissiveIntensity = 0.25;
				o.castShadow = false;
			}
		});
		yard.add(root);
		const mixer = new AnimationMixer(root);
		const clips = new Map(gltf.animations.map((c) => [c.name, c]));
		const actor = { def, root, mixer, clips, actions: new Map(), current: null, override: null, wp: 1, hover: Math.random() * 6.28 };
		root.userData.actor = actor;
		actors.push(actor);
	}

	function playOn(actor, name, { once = false } = {}) {
		const clip = actor.clips.get(name) || actor.clips.get('idle');
		if (!clip) return;
		let action = actor.actions.get(clip.name);
		if (!action) {
			action = actor.mixer.clipAction(clip);
			actor.actions.set(clip.name, action);
		}
		if (actor.current === action && !once) return;
		action.reset();
		action.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
		action.clampWhenFinished = once;
		if (actor.current && actor.current !== action) actor.current.crossFadeTo(action, 0.25, false);
		action.play();
		actor.current = action;
		actor.currentName = clip.name;
	}
	for (const a of actors) {
		a.mixer.addEventListener('finished', () => {
			a.oneShot = false;
			a.current = null;
			playOn(a, baseClip(a));
			syncSelect();
		});
	}

	let wandering = !reducedMq.matches;
	function baseClip(a) {
		if (a.override) return a.override;
		return wandering && a.def.wander ? 'walk' : 'idle';
	}
	for (const a of actors) playOn(a, baseClip(a));

	// ----- UI: characters, animations, toggles -----
	let selected = actors[0];
	const charBox = $('hn-chars');
	for (const a of actors) {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'hn-chip';
		b.textContent = a.def.name;
		b.setAttribute('role', 'radio');
		b.setAttribute('aria-checked', 'false');
		b.addEventListener('click', () => select(a, true));
		a.chip = b;
		charBox.append(b);
	}
	const animSel = $('hn-anim');
	function fillAnimations() {
		animSel.replaceChildren();
		const names = [...selected.clips.keys()].filter((n) => !/^(wheelchair|holding|drive|sit|crouch|static)/.test(n));
		for (const n of names) {
			const o = document.createElement('option');
			o.value = n;
			o.textContent = n.replace(/-/g, ' ');
			animSel.append(o);
		}
		syncSelect();
	}
	function syncSelect() {
		if (selected.currentName) animSel.value = selected.currentName;
	}
	function select(a, focus) {
		selected = a;
		for (const x of actors) x.chip.setAttribute('aria-checked', String(x === a));
		$('hn-selected').textContent = a.def.name;
		fillAnimations();
		if (focus) flyTo(a);
	}
	animSel.addEventListener('change', () => {
		const name = animSel.value;
		const once = ONE_SHOT.test(name);
		selected.override = once ? null : name;
		selected.oneShot = once;
		playOn(selected, name, { once });
	});
	$('hn-resume').addEventListener('click', () => {
		for (const a of actors) a.override = null;
		wandering = true;
		paintToggles();
		for (const a of actors) playOn(a, baseClip(a));
		syncSelect();
	});

	let lightsOn = true;
	const lightsBtn = $('hn-lights');
	const wanderBtn = $('hn-wander');
	function paintToggles() {
		lightsBtn.setAttribute('aria-pressed', String(lightsOn));
		lightsBtn.textContent = lightsOn ? 'Lights on' : 'Lights off';
		wanderBtn.setAttribute('aria-pressed', String(wandering));
		wanderBtn.textContent = wandering ? 'Wandering' : 'Standing still';
	}
	function setLights(on) {
		lightsOn = on;
		lamps.visible = on;
		paintToggles();
	}
	function setWander(on) {
		wandering = on;
		paintToggles();
		for (const a of actors) if (!a.oneShot && !a.override) playOn(a, baseClip(a));
		syncSelect();
	}
	lightsBtn.addEventListener('click', () => setLights(!lightsOn));
	wanderBtn.addEventListener('click', () => setWander(!wandering));
	const fogRange = $('hn-fog');
	const moonRange = $('hn-moon');
	fogRange.addEventListener('input', () => {
		scene.fog.density = Number(fogRange.value);
		$('hn-fog-out').textContent = Number(fogRange.value).toFixed(3);
	});
	moonRange.addEventListener('input', () => {
		moon.intensity = Number(moonRange.value);
		$('hn-moon-out').textContent = Number(moonRange.value).toFixed(2);
	});
	addEventListener('keydown', (e) => {
		if (e.target.closest?.('input, select, textarea')) return;
		if (e.key === 'l' || e.key === 'L') setLights(!lightsOn);
		else if (e.key === 'w' || e.key === 'W') setWander(!wandering);
		else if (/^[1-5]$/.test(e.key)) select(actors[Number(e.key) - 1], true);
	});

	// ----- picking: click a character to select it and play a reaction -----
	const ray = new Raycaster();
	const ndc = new Vector2();
	let down = null;
	canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
	canvas.addEventListener('pointerup', (e) => {
		if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
		const r = canvas.getBoundingClientRect();
		ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
		ray.setFromCamera(ndc, camera);
		const hit = ray.intersectObjects(actors.map((a) => a.root), true)[0];
		if (!hit) return;
		let o = hit.object;
		while (o && !o.userData.actor) o = o.parent;
		if (!o) return;
		const a = o.userData.actor;
		select(a, false);
		const reaction = a.def.ghost ? 'emote-yes' : pick(['emote-yes', 'emote-no', 'attack-melee-right', 'jump']);
		a.oneShot = true;
		playOn(a, reaction, { once: true });
		syncSelect();
	});

	// ----- camera fly-to -----
	let fly = null;
	function flyTo(a) {
		const t = a.root.position;
		const dir = new Vector3().subVectors(camera.position, controls.target).setY(0).normalize();
		fly = {
			t: 0,
			fromT: controls.target.clone(),
			toT: new Vector3(t.x, t.y + 0.7, t.z),
			fromP: camera.position.clone(),
			toP: new Vector3(t.x + dir.x * 4.2, 1.9, t.z + dir.z * 4.2),
		};
	}
	canvas.addEventListener('pointerdown', () => { fly = null; });

	// ----- save picture -----
	$('hn-png').addEventListener('click', () => {
		composer.render();
		canvas.toBlob((blob) => {
			if (!blob) return;
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'haunted-graveyard-three-ws.png';
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 2000);
		}, 'image/png');
	});

	// ----- loop -----
	const tmp = new Vector3();
	function frame() {
		requestAnimationFrame(frame);
		const dt = Math.min(clock.getDelta(), 0.05);
		const t = clock.elapsedTime;
		const calm = reducedMq.matches;

		for (const a of actors) {
			a.mixer.update(dt);
			if (a.def.ghost) {
				a.hover += dt * (calm ? 0 : 1.6);
				a.root.position.y = 0.3 + Math.sin(a.hover) * 0.12;
			}
			const path = a.def.wander;
			if (wandering && path && !a.override && !a.oneShot) {
				const [tx, tz] = path[a.wp];
				tmp.set(tx - a.root.position.x, 0, tz - a.root.position.z);
				const dist = tmp.length();
				if (dist < 0.12) {
					a.wp = (a.wp + 1) % path.length;
				} else {
					tmp.divideScalar(dist);
					const speed = a.def.ghost ? 0.5 : 0.65;
					a.root.position.x += tmp.x * speed * dt;
					a.root.position.z += tmp.z * speed * dt;
					const want = Math.atan2(tmp.x, tmp.z);
					let d = want - a.root.rotation.y;
					d = Math.atan2(Math.sin(d), Math.cos(d));
					a.root.rotation.y += d * Math.min(1, dt * 4);
				}
			}
		}

		for (const f of flickers) {
			const n = calm ? 1 : 0.86 + 0.14 * Math.sin(t * 9 + f.phase) * Math.sin(t * 3.7 + f.phase * 2) + (Math.random() - 0.5) * 0.04;
			f.light.intensity = f.base * n;
		}

		if (fly) {
			fly.t = Math.min(1, fly.t + dt / 0.9);
			const e = 1 - (1 - fly.t) ** 3;
			controls.target.lerpVectors(fly.fromT, fly.toT, e);
			camera.position.lerpVectors(fly.fromP, fly.toP, e);
			if (fly.t >= 1) fly = null;
		}
		controls.update();
		composer.render();
	}

	select(actors[0], false);
	paintToggles();
	$('hn-loading').hidden = true;
	stage.dataset.ready = 'true';
	frame();
}

$('hn-error-retry').addEventListener('click', start);
start();
