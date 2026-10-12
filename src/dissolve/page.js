// /dissolve: page controller.
//
// Owns the renderer, camera, post-processing and the DOM. All particle physics
// is in engine.js, all geometry maths in sample-core.js; this file wires the
// shelf, the pointer tools, the morph timeline, the mic, capture and share
// links to them, and decides what the person sees while something loads or
// fails.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { getMeshoptDecoder } from '../viewer/internal.js';
import { DissolveEngine, TOOL, probeSupport } from './engine.js';
import { buildShapeCloud } from './shape.js';
import { MicLevels } from './audio.js';
import { CanvasRecorder, extensionFor } from './recorder.js';
import { SHELF, PRESETS, QUALITY, shelfEntry, parseModelUrl, readState, writeState } from './shelf.js';

const FOV = 40;
const MORPH_SECONDS = 3.4;
const LOOP_HOLD_SECONDS = 1.2;
const QUALITY_KEY = 'twx_dissolve_quality';

const $ = (id) => document.getElementById(id);
const el = {
	stage: $('dsStage'),
	canvas: $('dsCanvas'),
	hero: $('dsHero'),
	count: $('dsCount'),
	loading: $('dsLoading'),
	loadingLabel: $('dsLoadingLabel'),
	barFill: $('dsBarFill'),
	fallback: $('dsFallback'),
	fallbackTitle: $('dsFallbackTitle'),
	fallbackBody: $('dsFallbackBody'),
	rec: $('dsRec'),
	recTime: $('dsRecTime'),
	dock: $('dsDock'),
	dockToggle: $('dsDockToggle'),
	shelfA: $('dsShelfA'),
	shelfB: $('dsShelfB'),
	file: $('dsFile'),
	pickA: $('dsPickA'),
	pickB: $('dsPickB'),
	urlForm: $('dsUrlForm'),
	url: $('dsUrl'),
	morph: $('dsMorph'),
	swap: $('dsSwap'),
	loop: $('dsLoop'),
	mix: $('dsMix'),
	tools: $('dsTools'),
	toolHint: $('dsToolHint'),
	collapse: $('dsCollapse'),
	detonate: $('dsDetonate'),
	presets: $('dsPresets'),
	size: $('dsSize'),
	glow: $('dsGlow'),
	chaos: $('dsChaos'),
	orbit: $('dsOrbit'),
	mic: $('dsMic'),
	shot: $('dsShot'),
	record: $('dsRecord'),
	share: $('dsShare'),
	quality: $('dsQuality'),
	toast: $('dsToast'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const TOOL_HINTS = {
	orbit: 'Drag to turn the camera, scroll to zoom.',
	gravity: 'Hold and drag to open a black hole. Particles that cross the horizon leave as jets.',
	vortex: 'Hold and drag to spin a tornado through the shape.',
	burst: 'Click anywhere to send a shockwave through the shape.',
};

// ── State ─────────────────────────────────────────────────────────────────
const initial = readState(location.search);
const state = {
	a: initial.a,
	b: initial.b,
	preset: initial.preset,
	quality: initial.quality || savedQuality() || defaultQuality(),
	tool: 'gravity',
	bloom: PRESETS[initial.preset].bloom,
	autoOrbit: !reducedMotion,
	loopOn: false,
	collapsed: false,
	tween: null,
	pressed: false,
	hovering: false,
	engine: null,
	models: new Map(), // key -> Promise<THREE.Group>
	loadToken: { A: 0, B: 0 },
	busy: 0,
	labels: { A: '', B: '' },
	custom: { A: null, B: null },
};

function savedQuality() {
	try {
		const q = localStorage.getItem(QUALITY_KEY);
		return QUALITY[q] ? q : null;
	} catch {
		return null;
	}
}

function defaultQuality() {
	const weak = (navigator.hardwareConcurrency || 4) <= 4 || window.matchMedia('(pointer: coarse)').matches;
	return weak ? 'lite' : 'standard';
}

// ── Toasts and loading ────────────────────────────────────────────────────
let toastTimer = 0;
function toast(message, { action = null, ms = 5200 } = {}) {
	clearTimeout(toastTimer);
	el.toast.replaceChildren();
	const text = document.createElement('span');
	text.textContent = message;
	el.toast.append(text);
	if (action) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'ds-toast-action';
		btn.textContent = action.label;
		btn.addEventListener('click', () => {
			el.toast.hidden = true;
			action.run();
		});
		el.toast.append(btn);
	}
	el.toast.hidden = false;
	toastTimer = setTimeout(() => (el.toast.hidden = true), ms);
}

function setLoading(on, label = '', progress = null) {
	el.loading.hidden = !on;
	if (!on) return;
	el.loadingLabel.textContent = label;
	el.barFill.style.transform = `scaleX(${progress == null ? 0.08 : Math.max(0.04, progress)})`;
	el.barFill.classList.toggle('is-indeterminate', progress == null);
}

function showFallback(title, body) {
	el.fallbackTitle.textContent = title;
	el.fallbackBody.textContent = body;
	el.fallback.hidden = false;
	el.dock.hidden = true;
	el.dockToggle.hidden = true;
	el.hero.hidden = true;
}

// ── Renderer, scene, post ─────────────────────────────────────────────────
const support = probeSupport();
if (!support.ok) {
	showFallback(
		'This browser cannot run Dissolve',
		support.reason === 'webgl2'
			? 'Dissolve simulates its particles on the GPU and needs WebGL 2. Turn on hardware acceleration, or try a current Chrome, Edge, Firefox or Safari.'
			: 'Your GPU cannot render to floating-point textures, which the particle simulation needs. Update your graphics driver or try another browser.',
	);
} else {
	boot();
}

function boot() {
	const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;
	renderer.setClearColor(0x04060b, 1);

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);
	camera.position.set(0.0, 0.5, 5.4);

	const controls = new OrbitControls(camera, el.canvas);
	controls.target.set(0, -0.1, 0);
	controls.enableDamping = true;
	controls.dampingFactor = 0.07;
	controls.minDistance = 1.6;
	controls.maxDistance = 14;
	controls.maxPolarAngle = Math.PI * 0.62;
	controls.autoRotateSpeed = 0.7;
	controls.enablePan = false;

	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), state.bloom, 0.5, 0.3);
	composer.addPass(bloom);
	composer.addPass(new OutputPass());

	const backdrop = buildBackdrop();
	scene.add(backdrop.group);

	const loader = new GLTFLoader();
	const draco = new DRACOLoader();
	draco.setDecoderPath('/three/draco/gltf/');
	loader.setDRACOLoader(draco);
	getMeshoptDecoder().then((d) => loader.setMeshoptDecoder(d));

	const mic = new MicLevels();
	const recorder = new CanvasRecorder(el.canvas);
	const pointerPlane = new THREE.Plane();
	const ray = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const forward = new THREE.Vector3();
	const hit = new THREE.Vector3();

	// ── Model loading ────────────────────────────────────────────────────
	function loadGltf(url, onProgress) {
		return new Promise((resolve, reject) => {
			loader.load(
				url,
				(gltf) => resolve(gltf.scene),
				(e) => e.lengthComputable && onProgress(e.loaded / e.total),
				(err) => reject(err instanceof Error ? err : new Error('The model could not be loaded.')),
			);
		});
	}

	function modelSource(key) {
		const entry = shelfEntry(key);
		if (entry) return { url: entry.url, label: entry.label };
		const custom = state.custom.A?.key === key ? state.custom.A : state.custom.B?.key === key ? state.custom.B : null;
		if (custom) return { url: custom.url, label: custom.label };
		const safe = parseModelUrl(key);
		if (safe) return { url: safe, label: safe.split('/').pop().slice(0, 28) || 'Linked model' };
		return null;
	}

	function getModel(key, onProgress) {
		if (!state.models.has(key)) {
			const source = modelSource(key);
			if (!source) return Promise.reject(new Error('That model link is not valid.'));
			const promise = loadGltf(source.url, onProgress).catch((err) => {
				state.models.delete(key);
				throw err;
			});
			state.models.set(key, promise);
		}
		return state.models.get(key);
	}

	async function setSlot(slot, key) {
		const token = ++state.loadToken[slot];
		const source = modelSource(key);
		const label = source ? source.label : 'model';
		state.busy++;
		setLoading(true, `Loading ${label}`, null);
		try {
			const group = await getModel(key, (p) => token === state.loadToken[slot] && setLoading(true, `Loading ${label}`, p * 0.5));
			if (token !== state.loadToken[slot]) return;
			const engine = state.engine;
			const cloud = await buildShapeCloud(group, engine.count, {
				seed: slot === 'A' ? 7 : 11,
				onProgress: (p) => token === state.loadToken[slot] && setLoading(true, `Dissolving ${label} into ${engine.count.toLocaleString()} points`, 0.5 + p * 0.5),
			});
			if (token !== state.loadToken[slot] || engine !== state.engine) return;
			engine.setShape(slot, cloud);
			state[slot.toLowerCase()] = key;
			state.labels[slot] = label;
			syncShelves();
			syncUrl();
			updateAria();
			if (slot === 'A') el.hero.classList.add('is-compact');
		} catch (err) {
			if (token !== state.loadToken[slot]) return;
			const reason = err && err.message ? err.message : 'The model could not be loaded.';
			toast(`Could not dissolve ${label}. ${reason}`);
			if (!state.engine.shapes[slot]) {
				// First load failed and nothing is on stage: fall back to the default.
				if (key !== 'agent') await setSlot(slot, slot === 'A' ? 'agent' : 'fox');
			}
		} finally {
			state.busy--;
			if (state.busy === 0) setLoading(false);
		}
	}

	// ── Engine lifecycle ─────────────────────────────────────────────────
	function createEngine() {
		if (state.engine) {
			scene.remove(state.engine.group);
			state.engine.dispose();
		}
		const side = QUALITY[state.quality].side;
		const engine = new DissolveEngine(renderer, side);
		scene.add(engine.group);
		state.engine = engine;
		applyPreset(state.preset, { silent: true });
		engine.setMix(0);
		engine.params.gravity = state.collapsed ? 9 : 0;
		el.mix.value = '0';
		el.count.textContent = `${engine.count.toLocaleString()} GPU particles`;
		resize();
	}

	function applyPreset(name, { silent = false } = {}) {
		const p = PRESETS[name];
		state.preset = name;
		const engine = state.engine;
		for (const key of ['spring', 'damp', 'turb', 'arc', 'stagger', 'size', 'bright']) engine.setParam(key, p[key]);
		state.bloom = p.bloom;
		bloom.strength = p.bloom;
		el.size.value = p.size;
		el.glow.value = p.bloom;
		el.chaos.value = p.turb;
		engine.setView(renderer.domElement.height, FOV);
		syncPresets();
		if (!silent) syncUrl();
	}

	// ── Layout ───────────────────────────────────────────────────────────
	function resize() {
		const w = el.stage.clientWidth;
		const h = el.stage.clientHeight;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		composer.setSize(w, h);
		bloom.resolution.set(w, h);
		camera.aspect = w / h;
		// Keep the whole figure in frame on a portrait phone.
		camera.fov = w / h < 0.8 ? FOV + 16 : FOV;
		camera.updateProjectionMatrix();
		if (state.engine) state.engine.setView(renderer.domElement.height, camera.fov);
	}
	new ResizeObserver(resize).observe(el.stage);

	// ── Pointer tools ────────────────────────────────────────────────────
	function updatePointer(e) {
		const rect = el.canvas.getBoundingClientRect();
		ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
		ray.setFromCamera(ndc, camera);
		camera.getWorldDirection(forward);
		pointerPlane.setFromNormalAndCoplanarPoint(forward, controls.target);
		if (ray.ray.intersectPlane(pointerPlane, hit)) state.engine.pointer.point.copy(hit);
		state.engine.pointer.axis.copy(forward);
	}

	function applyToolState() {
		const engine = state.engine;
		const tool = state.tool;
		controls.enableRotate = tool === 'orbit';
		el.canvas.dataset.tool = tool;
		if (tool === 'gravity' || tool === 'vortex') {
			engine.pointer.mode = tool === 'gravity' ? TOOL.gravity : TOOL.vortex;
			const active = state.pressed ? 1 : state.hovering ? 0.28 : 0;
			engine.pointer.strength = active;
		} else {
			engine.pointer.mode = TOOL.none;
			engine.pointer.strength = 0;
		}
	}

	el.canvas.addEventListener('pointerenter', (e) => {
		if (e.pointerType === 'mouse') state.hovering = true;
	});
	el.canvas.addEventListener('pointerleave', () => {
		state.hovering = false;
		state.pressed = false;
	});
	el.canvas.addEventListener('pointermove', (e) => {
		if (state.engine) updatePointer(e);
	});
	el.canvas.addEventListener('pointerdown', (e) => {
		if (!state.engine) return;
		updatePointer(e);
		state.pressed = true;
		if (state.tool === 'burst') state.engine.shockwave(state.engine.pointer.point, 1);
		try {
			el.canvas.setPointerCapture(e.pointerId);
		} catch {
			/* capture is a nicety; the tool still works without it */
		}
	});
	const release = () => (state.pressed = false);
	el.canvas.addEventListener('pointerup', release);
	el.canvas.addEventListener('pointercancel', release);

	function selectTool(tool) {
		state.tool = tool;
		for (const btn of el.tools.querySelectorAll('[data-tool]')) {
			const on = btn.dataset.tool === tool;
			btn.setAttribute('aria-checked', String(on));
			btn.tabIndex = on ? 0 : -1;
		}
		el.toolHint.textContent = TOOL_HINTS[tool];
	}
	el.tools.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-tool]');
		if (btn) selectTool(btn.dataset.tool);
	});
	el.tools.addEventListener('keydown', (e) => {
		const order = [...el.tools.querySelectorAll('[data-tool]')];
		const i = order.findIndex((b) => b.dataset.tool === state.tool);
		const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
		if (!step) return;
		e.preventDefault();
		const next = order[(i + step + order.length) % order.length];
		selectTool(next.dataset.tool);
		next.focus();
	});

	// ── Morph timeline ───────────────────────────────────────────────────
	function morphTo(target) {
		const engine = state.engine;
		if (!engine.shapes.B || engine.shapes.B === engine.shapes.A) {
			toast('Pick a different shape for B first.');
			return;
		}
		const from = engine.mix;
		if (reducedMotion) {
			engine.setMix(target);
			syncMorphUi();
			return;
		}
		state.tween = { from, to: target, t: 0, hold: 0 };
		syncMorphUi();
	}

	function stepTween(dt) {
		const tw = state.tween;
		if (!tw) return;
		if (tw.t < 1) {
			tw.t = Math.min(1, tw.t + dt / MORPH_SECONDS);
			const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
			state.engine.setMix(tw.from + (tw.to - tw.from) * e);
			el.mix.value = String(Math.round(state.engine.mix * 1000));
			if (tw.t >= 1) {
				tw.hold = 0;
				syncMorphUi();
			}
			return;
		}
		if (state.loopOn) {
			tw.hold += dt;
			if (tw.hold >= LOOP_HOLD_SECONDS) morphTo(tw.to > 0.5 ? 0 : 1);
		} else {
			state.tween = null;
		}
	}

	function syncMorphUi() {
		const atB = state.engine.mix > 0.5 && !(state.tween && state.tween.to < 0.5);
		el.morph.textContent = atB ? 'Morph to A' : 'Morph to B';
	}

	el.morph.addEventListener('click', () => {
		const e = state.engine;
		const goingTo = state.tween ? (state.tween.to > 0.5 ? 0 : 1) : e.mix > 0.5 ? 0 : 1;
		morphTo(goingTo);
	});
	el.swap.addEventListener('click', swap);
	function swap() {
		const e = state.engine;
		if (!e.shapes.B) return;
		e.swap();
		[state.a, state.b] = [state.b, state.a];
		[state.labels.A, state.labels.B] = [state.labels.B, state.labels.A];
		[state.custom.A, state.custom.B] = [state.custom.B, state.custom.A];
		state.tween = null;
		el.mix.value = String(Math.round(e.mix * 1000));
		syncShelves();
		syncUrl();
		syncMorphUi();
	}
	el.loop.addEventListener('click', () => {
		state.loopOn = !state.loopOn;
		el.loop.setAttribute('aria-pressed', String(state.loopOn));
		if (state.loopOn && !state.tween) morphTo(state.engine.mix > 0.5 ? 0 : 1);
	});
	el.mix.addEventListener('input', () => {
		state.tween = null;
		state.engine.setMix(Number(el.mix.value) / 1000);
		syncMorphUi();
	});

	// ── Forces ───────────────────────────────────────────────────────────
	function setCollapse(on) {
		state.collapsed = on;
		state.engine.params.gravity = on ? 9 : 0;
		el.collapse.setAttribute('aria-pressed', String(on));
	}
	el.collapse.addEventListener('click', () => setCollapse(!state.collapsed));
	function detonate() {
		state.engine.shockwave(new THREE.Vector3(0, -0.15, 0), 1.7);
	}
	el.detonate.addEventListener('click', detonate);

	// ── Looks ────────────────────────────────────────────────────────────
	function syncPresets() {
		for (const btn of el.presets.children) {
			const on = btn.dataset.preset === state.preset;
			btn.setAttribute('aria-checked', String(on));
			btn.tabIndex = on ? 0 : -1;
		}
	}
	for (const [id, p] of Object.entries(PRESETS)) {
		const btn = chip(p.label, 'preset', id);
		btn.addEventListener('click', () => applyPreset(id));
		el.presets.append(btn);
	}
	el.size.addEventListener('input', () => {
		state.engine.setParam('size', Number(el.size.value));
		state.engine.setView(renderer.domElement.height, camera.fov);
	});
	el.glow.addEventListener('input', () => {
		state.bloom = Number(el.glow.value);
		bloom.strength = state.bloom;
	});
	el.chaos.addEventListener('input', () => state.engine.setParam('turb', Number(el.chaos.value)));
	el.orbit.addEventListener('click', () => {
		state.autoOrbit = !state.autoOrbit;
		el.orbit.setAttribute('aria-pressed', String(state.autoOrbit));
	});
	el.orbit.setAttribute('aria-pressed', String(state.autoOrbit));

	// ── Mic ──────────────────────────────────────────────────────────────
	async function toggleMic() {
		if (mic.active) {
			mic.stop();
			state.engine.audio.bass = state.engine.audio.mid = 0;
			el.mic.setAttribute('aria-pressed', 'false');
			return;
		}
		if (!MicLevels.isSupported()) {
			toast('This browser does not expose a microphone to web pages.');
			return;
		}
		try {
			await mic.start();
			el.mic.setAttribute('aria-pressed', 'true');
			toast('Listening. Bass swells the storm, mids stir it. Nothing is recorded.');
		} catch (err) {
			const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
			toast(denied ? 'Microphone access was blocked. Allow it in the address bar, then press Mic again.' : `The microphone is not available: ${err && err.message ? err.message : 'unknown error'}.`);
		}
	}
	el.mic.addEventListener('click', toggleMic);
	if (!MicLevels.isSupported()) {
		el.mic.disabled = true;
		el.mic.title = 'This browser does not expose a microphone';
	}

	// ── Capture and share ────────────────────────────────────────────────
	function download(blob, name) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 4000);
	}
	function stamp() {
		return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	}
	function snapshot() {
		composer.render();
		el.canvas.toBlob((blob) => {
			if (!blob) return toast('The snapshot could not be encoded.');
			download(blob, `dissolve-${stamp()}.png`);
			toast('Saved a PNG.');
		}, 'image/png');
	}
	el.shot.addEventListener('click', snapshot);

	let recTimer = 0;
	let recStart = 0;
	async function toggleRecord() {
		if (recorder.recording) {
			clearInterval(recTimer);
			el.rec.hidden = true;
			el.record.textContent = 'Record';
			const mime = recorder.mime;
			try {
				const blob = await recorder.stop();
				download(blob, `dissolve-${stamp()}.${extensionFor(mime)}`);
				toast('Saved your clip.');
			} catch (err) {
				toast(`Recording failed: ${err.message}`);
			}
			return;
		}
		if (!CanvasRecorder.isSupported()) {
			toast('This browser cannot record the canvas. Use Snapshot instead.');
			return;
		}
		try {
			recorder.start(60);
		} catch (err) {
			toast(err.message);
			return;
		}
		recStart = performance.now();
		el.rec.hidden = false;
		el.record.textContent = 'Stop';
		recTimer = setInterval(() => {
			const s = Math.floor((performance.now() - recStart) / 1000);
			el.recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
		}, 250);
	}
	el.record.addEventListener('click', toggleRecord);

	function shareUrl() {
		const q = writeState({ a: state.a, b: state.b, preset: state.preset, quality: state.quality }, '');
		return `${location.origin}${location.pathname}${q}`;
	}
	el.share.addEventListener('click', async () => {
		const customised = state.custom.A || state.custom.B;
		const url = shareUrl();
		try {
			await navigator.clipboard.writeText(url);
			toast(customised ? 'Link copied. Files from your device cannot travel in a link, so those slots will show the defaults.' : 'Link copied. Anyone who opens it sees this exact pair.');
		} catch {
			toast(`Copy this link: ${url}`, { ms: 12000 });
		}
	});
	function syncUrl() {
		const shareable = (k) => (shelfEntry(k) || parseModelUrl(k) ? k : k === state.a ? 'agent' : 'fox');
		const q = writeState({ a: shareable(state.a), b: shareable(state.b), preset: state.preset, quality: state.quality }, '');
		history.replaceState(null, '', `${location.pathname}${q}`);
	}

	// ── Shelves, files, links ────────────────────────────────────────────
	function chip(label, kind, id) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'ds-chip-btn';
		btn.setAttribute('role', 'radio');
		btn.setAttribute('aria-checked', 'false');
		btn.dataset[kind] = id;
		btn.textContent = label;
		return btn;
	}
	function buildShelf(container, slot) {
		for (const item of SHELF) {
			const btn = chip(item.label, 'model', item.id);
			btn.addEventListener('click', () => setSlot(slot, item.id));
			container.append(btn);
		}
		const mine = chip('Yours', 'model', 'custom');
		mine.hidden = true;
		mine.dataset.custom = 'true';
		container.append(mine);
	}
	buildShelf(el.shelfA, 'A');
	buildShelf(el.shelfB, 'B');

	function syncShelves() {
		for (const [container, slot] of [[el.shelfA, 'A'], [el.shelfB, 'B']]) {
			const key = state[slot.toLowerCase()];
			const custom = state.custom[slot];
			for (const btn of container.children) {
				if (btn.dataset.custom) {
					btn.hidden = !custom;
					if (custom) btn.textContent = custom.label;
					const on = !!custom && custom.key === key;
					btn.setAttribute('aria-checked', String(on));
					btn.tabIndex = on ? 0 : -1;
					continue;
				}
				const on = btn.dataset.model === key;
				btn.setAttribute('aria-checked', String(on));
				btn.tabIndex = on || (!container.querySelector('[aria-checked="true"]') && btn === container.firstChild) ? 0 : -1;
			}
		}
	}

	let pickSlot = 'B';
	el.pickA.addEventListener('click', () => ((pickSlot = 'A'), el.file.click()));
	el.pickB.addEventListener('click', () => ((pickSlot = 'B'), el.file.click()));
	el.file.addEventListener('change', () => {
		const file = el.file.files && el.file.files[0];
		el.file.value = '';
		if (file) loadFile(file, pickSlot);
	});
	function loadFile(file, slot) {
		if (!/\.(glb|gltf)$/i.test(file.name)) {
			toast('Dissolve reads .glb and .gltf files. Convert other formats in the Forge first.');
			return;
		}
		if (file.size > 80 * 1024 * 1024) {
			toast('That file is over 80 MB. Compress it with meshopt or Draco, then try again.');
			return;
		}
		const key = `file:${file.name}:${file.size}:${file.lastModified}`;
		state.custom[slot] = { key, url: URL.createObjectURL(file), label: file.name.replace(/\.(glb|gltf)$/i, '').slice(0, 24) };
		setSlot(slot, key);
	}
	el.urlForm.addEventListener('submit', (e) => {
		e.preventDefault();
		const slot = e.submitter && e.submitter.dataset.slot ? e.submitter.dataset.slot : 'B';
		const safe = parseModelUrl(el.url.value.trim());
		if (!safe) {
			toast('Use an https link to a .glb file.');
			return;
		}
		state.custom[slot] = { key: safe, url: safe, label: safe.split('/').pop().slice(0, 24) || 'Linked model' };
		setSlot(slot, safe);
	});
	for (const type of ['dragenter', 'dragover']) {
		el.stage.addEventListener(type, (e) => {
			if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
				e.preventDefault();
				el.stage.classList.add('is-drop');
			}
		});
	}
	el.stage.addEventListener('dragleave', (e) => {
		if (e.target === el.stage) el.stage.classList.remove('is-drop');
	});
	el.stage.addEventListener('drop', (e) => {
		e.preventDefault();
		el.stage.classList.remove('is-drop');
		const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
		if (file) loadFile(file, e.shiftKey ? 'A' : 'B');
	});

	// ── Quality ──────────────────────────────────────────────────────────
	for (const [id, q] of Object.entries(QUALITY)) {
		const opt = document.createElement('option');
		opt.value = id;
		opt.textContent = `${q.label} · ${(q.side * q.side).toLocaleString()}`;
		el.quality.append(opt);
	}
	el.quality.value = state.quality;
	el.quality.addEventListener('change', async () => {
		state.quality = el.quality.value;
		try {
			localStorage.setItem(QUALITY_KEY, state.quality);
		} catch {
			/* the choice just will not persist */
		}
		await rebuild();
	});

	async function rebuild() {
		const [a, b] = [state.a, state.b];
		const mix = state.engine ? state.engine.mix : 0;
		state.tween = null;
		createEngine();
		await setSlot('A', a);
		if (b && b !== a) await setSlot('B', b);
		state.engine.setMix(mix);
		el.mix.value = String(Math.round(mix * 1000));
		syncUrl();
	}

	// ── Chrome ───────────────────────────────────────────────────────────
	el.dockToggle.addEventListener('click', () => {
		const open = el.dock.classList.toggle('is-closed') === false;
		el.dockToggle.setAttribute('aria-expanded', String(open));
	});
	if (window.matchMedia('(max-width: 760px)').matches) {
		el.dock.classList.add('is-closed');
		el.dockToggle.setAttribute('aria-expanded', 'false');
	}

	function updateAria() {
		const a = state.labels.A;
		const b = state.labels.B;
		el.canvas.setAttribute('aria-label', a && b && a !== b ? `${a} dissolved into a storm of glowing particles, ready to morph into ${b}` : `${a || 'A 3D model'} dissolved into a storm of glowing particles`);
	}

	window.addEventListener('keydown', (e) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
		if (t && t.tagName === 'BUTTON' && e.key === ' ') return;
		const map = { 1: 'orbit', 2: 'gravity', 3: 'vortex', 4: 'burst' };
		if (map[e.key]) return selectTool(map[e.key]);
		switch (e.key.toLowerCase()) {
			case ' ':
				e.preventDefault();
				return el.morph.click();
			case 's':
				return swap();
			case 'c':
				return setCollapse(!state.collapsed);
			case 'b':
				return detonate();
			case 'm':
				return toggleMic();
			case 'p':
				return snapshot();
			case 'r':
				return toggleRecord();
			case 'h':
				return el.dockToggle.click();
		}
	});

	// ── Frame loop ───────────────────────────────────────────────────────
	let last = performance.now();
	const tick = () => {
		const now = performance.now();
		const d = (now - last) / 1000;
		last = now;
		return d;
	};
	let slowFrames = 0;
	let slowWarned = false;
	function frame() {
		requestAnimationFrame(frame);
		const engine = state.engine;
		if (!engine) return;
		const dt = Math.min(tick(), 0.1);

		const levels = mic.active ? mic.sample() : null;
		if (levels) {
			engine.audio.bass = levels.bass;
			engine.audio.mid = levels.mid;
		}
		stepTween(dt);
		applyToolState();
		controls.autoRotate = state.autoOrbit && !state.pressed && state.tool !== 'orbit' ? true : state.autoOrbit && state.tool === 'orbit' && !state.pressed;
		controls.update();
		engine.step(dt);
		backdrop.update(engine.time, levels ? levels.bass : 0);
		composer.render();

		if (dt > 1 / 24 && state.quality !== 'lite' && state.busy === 0) slowFrames++;
		else slowFrames = Math.max(0, slowFrames - 1);
		if (slowFrames > 150 && !slowWarned) {
			slowWarned = true;
			toast('This is running slowly on your GPU.', {
				action: {
					label: 'Switch to Lite',
					run: () => {
						el.quality.value = 'lite';
						el.quality.dispatchEvent(new Event('change'));
					},
				},
				ms: 10000,
			});
		}
	}

	// ── Go ───────────────────────────────────────────────────────────────
	selectTool(state.tool);
	syncPresets();
	createEngine();
	frame();
	setSlot('A', state.a).then(() => (state.b !== state.a ? setSlot('B', state.b) : null));
	document.addEventListener('visibilitychange', tick);
	window.__dissolve = { state, get engine() { return state.engine; } };
}

// ── Backdrop: starfield, floor glow and rings that breathe with the bass ────
function buildBackdrop() {
	const group = new THREE.Group();
	const n = 2600;
	const pos = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) {
		const r = 18 + Math.random() * 22;
		const th = Math.random() * Math.PI * 2;
		const u = Math.random() * 2 - 1;
		const s = Math.sqrt(1 - u * u);
		pos[i * 3] = Math.cos(th) * s * r;
		pos[i * 3 + 1] = u * r;
		pos[i * 3 + 2] = Math.sin(th) * s * r;
	}
	const stars = new THREE.Points(
		new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)),
		new THREE.PointsMaterial({ color: 0x8fb4ff, size: 0.06, transparent: true, opacity: 0.55, depthWrite: false }),
	);
	group.add(stars);

	const floor = new THREE.Mesh(
		new THREE.CircleGeometry(4.2, 96),
		new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			uniforms: { uTime: { value: 0 }, uBass: { value: 0 } },
			vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
			fragmentShader: `
				varying vec2 vP; uniform float uTime; uniform float uBass;
				void main(){
					float r = length(vP);
					float glow = exp(-r*r*0.55) * 0.20;
					float ring = 0.0;
					for (int i = 1; i <= 4; i++) {
						float rr = float(i) * 0.85 + uBass * 0.25;
						ring += exp(-pow((r - rr) * 14.0, 2.0)) * (0.20 / float(i));
					}
					float fade = smoothstep(4.2, 1.2, r);
					gl_FragColor = vec4(vec3(0.15, 0.55, 1.0) * (glow + ring * fade), 1.0);
				}
			`,
		}),
	);
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = -1.002;
	group.add(floor);

	return {
		group,
		update(time, bass) {
			floor.material.uniforms.uTime.value = time;
			floor.material.uniforms.uBass.value = bass;
			stars.rotation.y = time * 0.01;
		},
	};
}
