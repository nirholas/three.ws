// Granite Vision — show IBM Granite Vision a 3D avatar and watch it read the look.
//
// Renders a three.ws avatar (a real GLB) in 3D, captures the exact frame you're
// looking at, and sends it to a Granite Vision model on watsonx.ai (via
// /api/ibm/vision). Granite returns a complete identity inferred purely from how
// the avatar looks — appearance, vibe, persona, a name, a bio, a fitting voice —
// which we render as an identity card. You can also upload any image or drag one
// anywhere onto the page.
//
// Every read is a real multimodal inference. When watsonx isn't configured the
// panel says so honestly rather than inventing a description.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getMeshoptDecoder } from './viewer/internal.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { log } from './shared/log.js';

const REDUCED_MOTION =
	typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);

// Real shipped GLBs, always available so the demo renders even before the
// subjects API is reachable. Same-origin, so their frames capture cleanly.
const BUILTINS = [
	{ id: 'builtin-default', name: 'Default', model_url: '/avatars/default.glb', builtin: true },
	{ id: 'builtin-realistic-male', name: 'Max', model_url: '/avatars/realistic-male.glb', builtin: true },
];

// Loading steps — shown sequentially so the wait feels transparent, not opaque.
const LOAD_STEPS = ['Capturing frame…', 'Sending to Granite…', 'Reading identity…'];

const els = {};
const state = {
	subjects: [],
	current: null, // { ...subject } | { upload:true, dataUrl, name, subject }
	busy: false,
};

// Three.js
let renderer, scene, camera, controls, env;
let modelRoot = null;
let loadToken = 0;

// Step-progress timer handle
let stepTimer = null;

export const dbg = (window.__vision = {
	ready: false,
	status: 'init',
	subjects: 0,
	modelLoaded: 0, // GLBs successfully rendered
	triangles: 0, // triangles in the last loaded model (proves real 3D)
	lastResult: null,
	error: null,
});

// ── Boot ─────────────────────────────────────────────────────────────────────
function boot() {
	cacheEls();
	setupThree();
	bindUI();
	loadSubjects();
}

function cacheEls() {
	for (const id of [
		'vision-stage', 'v-photo', 'v-photo-img', 'v-model', 'v-stage-hint',
		'v-idle', 'v-loading', 'v-loading-step',
		'v-result', 'v-usage-badge',
		'v-rawstate', 'v-error', 'v-error-title', 'v-error-sub', 'v-error-retry',
		'v-name', 'v-bio', 'v-appearance', 'v-appearance-wrap', 'v-persona', 'v-persona-wrap',
		'v-vibe', 'v-vibe-wrap', 'v-tags', 'v-tags-wrap', 'v-voice', 'v-voice-wrap', 'v-raw',
		'v-copy', 'v-read-again', 'v-read-again-raw', 'v-create', 'v-subjects', 'v-upload', 'v-file', 'v-show',
	]) {
		els[id] = $(id);
	}
}

// ── Subjects ─────────────────────────────────────────────────────────────────
async function loadSubjects() {
	let fetched = [];
	let model = 'granite-vision-3-2';
	try {
		const res = await fetch('/api/ibm/vision', { headers: { accept: 'application/json' } });
		if (res.ok) {
			const body = await res.json();
			fetched = Array.isArray(body.subjects) ? body.subjects : [];
			if (body.visionModel) model = body.visionModel.replace(/^ibm\//, '');
		}
	} catch {
		/* dev / not-yet-deployed: fall back to built-ins */
	}
	els['v-model'].textContent = model;
	state.subjects = [...BUILTINS, ...fetched];
	dbg.subjects = state.subjects.length;
	renderSubjects();
	selectSubject(0);
	dbg.ready = true;
	dbg.status = 'ready';
}

function renderSubjects() {
	els['v-subjects'].innerHTML = '';
	state.subjects.forEach((s, i) => {
		const b = document.createElement('button');
		b.className = 'subject';
		b.type = 'button';
		b.dataset.index = String(i);
		b.title = s.name || 'Avatar';
		if (s.thumbnail) b.style.backgroundImage = `url("${s.thumbnail}")`;
		else b.textContent = (s.name || '?').trim().charAt(0).toUpperCase();
		const cap = document.createElement('span');
		cap.className = 'cap';
		cap.textContent = s.name || 'Avatar';
		b.appendChild(cap);
		b.addEventListener('click', () => selectSubject(i));
		els['v-subjects'].appendChild(b);
	});
}

function selectSubject(i) {
	const s = state.subjects[i];
	if (!s) return;
	state.current = { ...s, subject: 'avatar' };
	for (const b of els['v-subjects'].querySelectorAll('.subject')) {
		b.classList.toggle('sel', Number(b.dataset.index) === i);
	}
	showStage();
	loadModel(s.model_url);
}

function showStage() {
	els['v-photo'].style.display = 'none';
	els['vision-stage'].style.display = 'block';
	if (els['v-stage-hint']) els['v-stage-hint'].style.opacity = '1';
}

// ── Upload / Drag-and-drop ────────────────────────────────────────────────────
function handleUpload(file) {
	if (!file || !file.type.startsWith('image/')) return;
	const reader = new FileReader();
	reader.onload = () => {
		const dataUrl = String(reader.result || '');
		state.current = { upload: true, dataUrl, name: file.name, subject: 'image' };
		els['v-photo-img'].src = dataUrl;
		els['v-photo'].style.display = 'flex';
		els['vision-stage'].style.display = 'none';
		if (els['v-stage-hint']) els['v-stage-hint'].style.opacity = '0';
		for (const b of els['v-subjects'].querySelectorAll('.subject')) b.classList.remove('sel');
	};
	reader.readAsDataURL(file);
}

// ── Show Granite ─────────────────────────────────────────────────────────────
async function showGranite() {
	if (state.busy || !state.current) return;
	state.busy = true;
	els['v-show'].disabled = true;
	const prevLabel = els['v-show'].textContent;
	els['v-show'].textContent = 'Looking…';
	setState('loading');
	startLoadingSteps();

	try {
		const payload = await buildPayload(state.current);
		const res = await fetch('/api/ibm/vision', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		});
		const body = await res.json().catch(() => ({}));

		if (!res.ok) {
			if (res.status === 503 && body.error === 'watsonx_unavailable') {
				return showError(
					'IBM Granite Vision isn’t connected',
					body.error_description ||
						'Granite Vision runs on watsonx.ai. Once credentials are configured, it can see your avatar.',
					false,
				);
			}
			return showError(
				body.error === 'model_unavailable' ? 'Model not available in this region' : 'Granite couldn’t look',
				body.error_description || `Request failed (${res.status}).`,
			);
		}

		dbg.lastResult = body;
		if (body.vision && body.vision.structured) renderResult(body.vision, body);
		else renderRaw(body.raw || (body.vision && body.vision.persona) || 'Granite returned no readable description.');
	} catch (err) {
		showError('Granite couldn’t look', err?.message || 'Network error.');
	} finally {
		stopLoadingSteps();
		state.busy = false;
		els['v-show'].disabled = false;
		els['v-show'].textContent = prevLabel;
	}
}

// Decide what image to send: an uploaded data URL, a clean live capture of the 3D
// frame, or the avatar's thumbnail URL for the server to fetch (when the canvas
// is cross-origin-tainted, e.g. headless or public CDN textures).
async function buildPayload(subject) {
	if (subject.upload) return { image: subject.dataUrl, subject: 'image' };

	const captured = captureFrame();
	if (captured) {
		return { image: captured, subject: 'avatar', hint: subject.builtin ? '' : subject.name || '' };
	}
	if (subject.thumbnail) {
		return { imageUrl: subject.thumbnail, subject: 'avatar', hint: subject.name || '' };
	}
	throw new Error('Could not capture this avatar — try another or upload an image.');
}

// Capture the current 3D frame as a JPEG data URL against a solid background so
// Granite sees the avatar clearly. Returns null if the canvas is tainted.
function captureFrame() {
	if (!renderer || !modelRoot) return null;
	const prevBg = scene.background;
	try {
		scene.background = new THREE.Color(0x10141f);
		renderer.render(scene, camera);
		const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
		return url && url.length > 1000 ? url : null;
	} catch {
		return null; // SecurityError: tainted canvas from cross-origin textures
	} finally {
		scene.background = prevBg;
	}
}

// ── Step progress ─────────────────────────────────────────────────────────────
function startLoadingSteps() {
	let i = 0;
	if (els['v-loading-step']) els['v-loading-step'].textContent = LOAD_STEPS[0];
	stopLoadingSteps(); // clear any prior timer
	stepTimer = setInterval(() => {
		i = Math.min(i + 1, LOAD_STEPS.length - 1);
		if (els['v-loading-step']) els['v-loading-step'].textContent = LOAD_STEPS[i];
	}, 1300);
}
function stopLoadingSteps() {
	if (stepTimer) { clearInterval(stepTimer); stepTimer = null; }
}

// ── Result rendering ─────────────────────────────────────────────────────────
function renderResult(v, response) {
	els['v-name'].textContent = v.suggested_name || 'Unnamed';
	setText(els['v-bio'], v.bio);
	setField('v-appearance', 'v-appearance-wrap', v.appearance);
	setField('v-persona', 'v-persona-wrap', v.persona);
	renderChips('v-vibe', 'v-vibe-wrap', splitList(v.vibe));
	renderChips('v-tags', 'v-tags-wrap', v.tone_tags || []);
	setField('v-voice', 'v-voice-wrap', v.voice);

	// Token usage badge: makes the demo feel transparent and shows it's real AI.
	const u = response?.usage;
	if (u && els['v-usage-badge']) {
		const total = u.total_tokens || ((u.prompt_tokens || 0) + (u.completion_tokens || 0));
		els['v-usage-badge'].textContent = `${total} tokens · ${(response.model || '').replace('ibm/', '')}`;
		els['v-usage-badge'].hidden = false;
	}

	// Stash for agent creator deep-link + copy.
	const identity = {
		name: v.suggested_name, bio: v.bio, appearance: v.appearance,
		persona: v.persona, vibe: v.vibe, tone_tags: v.tone_tags, voice: v.voice,
	};
	els['v-copy'].onclick = () => copyJson(identity, els['v-copy']);
	if (els['v-read-again']) els['v-read-again'].onclick = showGranite;
	if (els['v-read-again-raw']) els['v-read-again-raw'].onclick = showGranite;
	try { localStorage.setItem('gv:identity', JSON.stringify(identity)); } catch { /* ok */ }

	const q = new URLSearchParams();
	if (v.suggested_name) q.set('name', v.suggested_name);
	if (v.bio) q.set('bio', v.bio);
	els['v-create'].href = `/create${q.toString() ? `?${q}` : ''}`;

	setState('result');
}

function renderRaw(text) {
	els['v-raw'].textContent = text;
	setState('rawstate');
}

function showError(title, sub, retryable = true) {
	dbg.status = 'error';
	dbg.error = sub;
	els['v-error-title'].textContent = title;
	els['v-error-sub'].textContent = sub;
	els['v-error-retry'].hidden = !retryable;
	setState('error');
}

function setState(name) {
	const map = {
		idle: 'v-idle', loading: 'v-loading', result: 'v-result',
		rawstate: 'v-rawstate', error: 'v-error',
	};
	for (const [key, id] of Object.entries(map)) {
		els[id].classList.toggle('on', key === name);
	}
}

// ── Three.js ─────────────────────────────────────────────────────────────────
function setupThree() {
	const stage = els['vision-stage'];
	renderer = new THREE.WebGLRenderer({
		antialias: true,
		alpha: true,
		preserveDrawingBuffer: true, // required so captureFrame() can read the buffer
		powerPreference: 'high-performance',
	});
	renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	stage.appendChild(renderer.domElement);

	scene = new THREE.Scene();
	const pmrem = new THREE.PMREMGenerator(renderer);
	env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	scene.environment = env;

	camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
	camera.position.set(0, 1.4, 3.4);

	scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x202434, 1.1));
	const key = new THREE.DirectionalLight(0xffffff, 2.0);
	key.position.set(2.5, 4, 3);
	scene.add(key);
	const rim = new THREE.DirectionalLight(0x78a9ff, 1.4);
	rim.position.set(-3, 2, -2);
	scene.add(rim);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.enablePan = false;
	controls.minDistance = 1.4;
	controls.maxDistance = 8;
	controls.target.set(0, 1.25, 0);
	controls.autoRotate = !REDUCED_MOTION;
	controls.autoRotateSpeed = 0.9;
	controls.addEventListener('start', () => (controls.autoRotate = false));

	const ro = new ResizeObserver(resize);
	ro.observe(stage);
	resize();
	renderer.setAnimationLoop(() => {
		controls.update();
		renderer.render(scene, camera);
	});
	window.addEventListener('pagehide', dispose, { once: true });
}

let _draco = null;
function gltfLoader() {
	const loader = new GLTFLoader();
	loader.setCrossOrigin('anonymous');
	if (!_draco) {
		_draco = new DRACOLoader();
		_draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
	}
	loader.setDRACOLoader(_draco);
	return loader;
}

function loadModel(url) {
	const token = ++loadToken;
	if (modelRoot) {
		scene.remove(modelRoot);
		disposeObject(modelRoot);
		modelRoot = null;
	}
	const loader = gltfLoader();
	// three.ws GLBs may carry EXT_meshopt_compression — decoder required before load
	getMeshoptDecoder().then((d) => loader.setMeshoptDecoder(d)).then(() => loader.load(
		url,
		(gltf) => {
			if (token !== loadToken) { disposeObject(gltf.scene); return; }
			modelRoot = gltf.scene;
			frameModel(modelRoot);
			scene.add(modelRoot);
			renderer.render(scene, camera);
			dbg.modelLoaded += 1;
			dbg.triangles = renderer.info.render.triangles;
		},
		undefined,
		(err) => {
			if (token !== loadToken) return;
			log.warn('[granite-vision] model load failed', url, err);
			if (!state.current?.thumbnail) {
				showError(
					'Couldn’t load this avatar',
					'The 3D model failed to load. Pick another, or upload an image.',
				);
			}
		},
	));
}

function frameModel(root) {
	const box = new THREE.Box3().setFromObject(root);
	const size = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());
	root.position.x -= center.x;
	root.position.z -= center.z;
	root.position.y -= box.min.y; // feet on the ground

	const height = size.y || 1.7;
	controls.target.set(0, height * 0.62, 0);
	const dist = height * 1.5 + 0.6;
	camera.position.set(0, height * 0.7, dist);
	camera.near = dist / 50;
	camera.far = dist * 12;
	camera.updateProjectionMatrix();
	controls.update();
}

function resize() {
	const stage = els['vision-stage'];
	const w = stage.clientWidth || window.innerWidth;
	const h = stage.clientHeight || window.innerHeight;
	renderer.setSize(w, h, false);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}

// ── UI wiring ────────────────────────────────────────────────────────────────
function bindUI() {
	els['v-show'].addEventListener('click', showGranite);
	els['v-upload'].addEventListener('click', () => els['v-file'].click());
	els['v-file'].addEventListener('change', (e) => handleUpload(e.target.files?.[0]));
	els['v-error-retry'].addEventListener('click', () => setState('idle'));

	// Fade the stage hint once the user first touches it.
	els['vision-stage'].addEventListener('pointerdown', () => {
		if (els['v-stage-hint']) els['v-stage-hint'].style.opacity = '0';
	}, { once: true });

	// ── Drag-and-drop anywhere on the page ───────────────────────────────────
	// Users can drag an image from desktop/Finder/browser onto the stage or the
	// photo area without having to click Upload first.
	let dragDepth = 0;
	document.addEventListener('dragenter', (e) => {
		if (!hasDragFile(e)) return;
		dragDepth++;
		document.body.classList.add('drag-active');
	});
	document.addEventListener('dragleave', () => {
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) document.body.classList.remove('drag-active');
	});
	document.addEventListener('dragover', (e) => {
		if (hasDragFile(e)) e.preventDefault();
	});
	document.addEventListener('drop', (e) => {
		dragDepth = 0;
		document.body.classList.remove('drag-active');
		const file = e.dataTransfer?.files?.[0];
		if (file?.type.startsWith('image/')) {
			e.preventDefault();
			handleUpload(file);
		}
	});

	// ── Keyboard shortcuts ────────────────────────────────────────────────────
	document.addEventListener('keydown', (e) => {
		// Enter triggers Show Granite when not in a text input.
		if (e.key === 'Enter' && !isInput(e.target) && !state.busy) showGranite();
		// Escape → back to idle (dismiss result/error, clear focus).
		if (e.key === 'Escape') {
			const active = ['v-result', 'v-rawstate', 'v-error'].find((id) => els[id]?.classList.contains('on'));
			if (active) setState('idle');
		}
	});
}

function hasDragFile(e) {
	return Array.from(e.dataTransfer?.items || []).some((i) => i.kind === 'file');
}
function isInput(el) {
	return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function setText(el, text) {
	if (text) { el.textContent = text; el.style.display = ''; }
	else el.style.display = 'none';
}
function setField(textId, wrapId, value) {
	els[textId].textContent = value || '';
	els[wrapId].style.display = value ? '' : 'none';
}
function renderChips(listId, wrapId, items) {
	els[listId].innerHTML = '';
	if (!items?.length) { els[wrapId].style.display = 'none'; return; }
	els[wrapId].style.display = '';
	for (const t of items) {
		const c = document.createElement('span');
		c.className = 'v-chip';
		c.textContent = t;
		els[listId].appendChild(c);
	}
}
function splitList(s) {
	return String(s || '').split(/[,/]/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
}
async function copyJson(obj, btn) {
	const text = JSON.stringify(obj, null, 2);
	try { await navigator.clipboard.writeText(text); }
	catch {
		const ta = document.createElement('textarea');
		ta.value = text;
		document.body.appendChild(ta);
		ta.select();
		try { document.execCommand('copy'); } catch { /* not available */ }
		ta.remove();
	}
	const prev = btn.textContent;
	btn.textContent = 'Copied ✓';
	setTimeout(() => (btn.textContent = prev), 1400);
}
function disposeObject(obj) {
	obj.traverse((c) => {
		if (c.geometry) c.geometry.dispose();
		if (c.material) {
			for (const m of [].concat(c.material)) {
				for (const k in m) if (m[k]?.isTexture) m[k].dispose();
				m.dispose();
			}
		}
	});
}
function dispose() {
	try {
		stopLoadingSteps();
		renderer?.setAnimationLoop(null);
		if (modelRoot) disposeObject(modelRoot);
		env?.dispose?.();
		renderer?.dispose();
	} catch { /* unloading */ }
}

// ── Start ────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
	boot();
}
