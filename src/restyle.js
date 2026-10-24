// restyle.js — Restyle Studio: apply PBR material presets and seeded colorway
// variants to any GLB, restyle from a plain-language AI instruction, fine-tune
// metalness/roughness/color/emissive live, and export a validated GLB —
// non-destructively (the original is always one click away). Consumes the
// framework-agnostic PBR preset library shipped in @three-ws/viewer-presets and
// the shared GLB optimize/validate path used by Avatar Studio, so it reuses the
// platform's material vocabulary rather than inventing a parallel one.
//
// Two kinds of history live side by side:
//   - the in-browser breadcrumb (#history) — every preset/slider tweak, purely
//     cosmetic, never leaves the tab.
//   - the real version lineage (#lineage-strip) — every AI restyle and every
//     "Save version" checkpoint mints an actual, durable, gltf-validator-checked
//     GLB via api/material-studio.js and is recorded with the SAME lineage
//     shape refine_model uses (mcp-server/src/tools/_lineage.js: parent → child,
//     revertable, branchable). Clicking a version reloads that exact GLB.
//
// Roadmap prompt 06 (material, restyle & variant tools), client surface.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
	MATERIAL_PRESETS,
	MATERIAL_PRESET_NAMES,
	applyMaterialPreset,
	materialVariants,
} from '../packages/viewer-presets/src/materials.js';
import { optimizeAndValidateGlb } from './avatar-studio-optimize.js';
import { seedLineage, appendVersion, summarizeLineage } from '../mcp-server/src/tools/_lineage.js';
import { verifyPreserved } from '../api/_lib/preserve-contract.js';
import { createAutoRenderer, pagePreference } from './renderer-factory.js';
import { createRestyleEffects } from './restyle-effects.js';

// A small, always-present local sample so the page is never an empty void — the
// platform's default humanoid, served from /avatars.
const DEFAULT_MODEL = '/avatars/realistic-female.glb';

const state = {
	renderer: null,
	scene: null,
	camera: null,
	controls: null,
	root: null, // the loaded glTF scene graph
	originals: new Map(), // material → captured original PBR params (for Reset)
	lineage: [], // cosmetic breadcrumb of applied steps, for the #history strip
	baseName: 'chrome', // which preset variants fan out from
	manual: { metalness: null, roughness: null, emissiveIntensity: 0 },
	sourceLabel: '',
	raf: 0,
	// Real, durable version lineage (parent → child GLB URLs). null until the
	// current model has a public https URL — a bare local File has none until
	// its first checkpoint upload resolves.
	sourceGlbUrl: null,
	sourceUrlPending: null, // in-flight upload promise for a local File origin
	realLineage: null,
	activeIndex: 0,
	// Editable parts (work order 070): top-level named nodes of the loaded
	// model, when there are ≥2. That is the shape workers/segment,
	// model-partcrafter and model-holopart all emit (part_01, part_02, ...),
	// but detection is generic: any multi-mesh GLB with distinct named
	// top-level nodes qualifies, not just the output of those three workers.
	parts: [], // [{ name, node }]
	selectedPartIndex: null,
	dimmed: [], // [{ material, opacity, transparent }] restored on deselect
	regenRunToken: 0,
	benchHold: false, // ?bench hook: pause the on-screen loop while it renders offscreen
	backend: 'webgl', // which renderer the factory actually produced
	fx: null, // view effects for that backend (restyle-effects.js)
};

const el = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
	cache();
	await buildScene();
	buildPresetButtons();
	wireControls();
	const url = new URL(location.href).searchParams.get('url');
	loadModel(url || DEFAULT_MODEL, url ? 'from URL' : 'sample', { originUrl: absoluteUrl(url || DEFAULT_MODEL) });
	window.addEventListener('resize', onResize);
}

function cache() {
	for (const id of [
		'stage', 'canvas-wrap', 'presets', 'variants', 'variant-strip', 'history',
		'metalness', 'roughness', 'emissive', 'basecolor', 'emissivecolor', 'rim', 'rimcolor', 'renderer-badge',
		'seed', 'variant-count', 'gen-variants', 'reset', 'export', 'export-note',
		'file', 'upload', 'url-input', 'load-url', 'load-note', 'status', 'error', 'error-msg', 'retry',
		'ai-instruction', 'ai-restyle', 'ai-texture', 'ai-note',
		'lineage-strip', 'save-version', 'lineage-note',
		'save-variants', 'variants-note',
		'parts-card', 'parts-list', 'part-swap', 'part-swap-file',
		'part-regenerate', 'part-deselect', 'parts-note',
	]) {
		el[id] = document.getElementById(id);
	}
}

// ── scene ────────────────────────────────────────────────────────────────────
async function buildScene() {
	const { renderer, backend, reason } = await createAutoRenderer(
		{ antialias: true, alpha: true, preserveDrawingBuffer: true },
		{ prefer: pagePreference(), fallback: el['canvas-wrap'] },
	);
	state.backend = backend;
	state.fx = await createRestyleEffects(backend);
	if (el['renderer-badge']) {
		el['renderer-badge'].textContent = backend === 'webgpu' ? 'WebGPU' : 'WebGL2';
		el['renderer-badge'].title = reason;
	}
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	el['canvas-wrap'].appendChild(renderer.domElement);
	state.renderer = renderer;

	const scene = new THREE.Scene();
	state.scene = scene;
	// RoomEnvironment gives metals/glass something real to reflect — chrome and
	// gold read as metal, not flat grey, without shipping an HDRI asset.
	const Pmrem = backend === 'webgpu' ? (await import('three/webgpu')).PMREMGenerator : THREE.PMREMGenerator;
	const pmrem = new Pmrem(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

	const key = new THREE.DirectionalLight(0xffffff, 2.2);
	key.position.set(3, 5, 4);
	scene.add(key);
	const rim = new THREE.DirectionalLight(0x99bbff, 0.8);
	rim.position.set(-4, 2, -3);
	scene.add(rim);
	scene.add(new THREE.AmbientLight(0xffffff, 0.4));

	const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
	camera.position.set(0, 1.4, 4);
	state.camera = camera;

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.target.set(0, 1, 0);
	state.controls = controls;

	if (new URLSearchParams(location.search).has('bench')) exposeBenchHook(renderer, scene, camera, backend);

	onResize();
	const tick = () => {
		state.raf = requestAnimationFrame(tick);
		controls.update();
		if (!state.benchHold) renderer.render(scene, camera);
	};
	tick();
}

// scripts/renderer-bench.mjs hook (opt-in via ?bench). Headless software WebGPU
// cannot present to a canvas, so parity is measured offscreen: render the live
// scene into a render target and read the pixels back on either backend.
function exposeBenchHook(renderer, scene, camera, backend) {
	const gpu = backend === 'webgpu';
	const makeTarget = async (w, h) => {
		if (!gpu) return new THREE.WebGLRenderTarget(w, h);
		return new (await import('three/webgpu')).RenderTarget(w, h);
	};
	const readback = async (rt, w, h) => {
		if (gpu) {
			const raw = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
			const stride = Math.ceil((w * 4) / 256) * 256;
			const out = new Uint8Array(w * h * 4);
			for (let y = 0; y < h; y++) out.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
			return out;
		}
		const raw = new Uint8Array(w * h * 4);
		renderer.readRenderTargetPixels(rt, 0, 0, w, h, raw);
		// GL reads bottom-up; flip to the top-down order WebGPU returns.
		const out = new Uint8Array(w * h * 4);
		for (let y = 0; y < h; y++) out.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
		return out;
	};
	window.__restyleBench = {
		backend,
		setRim: (strength) => state.fx.setRim({ strength }),
		async capture(w, h) {
			state.benchHold = true;
			const rt = await makeTarget(w, h);
			renderer.setRenderTarget(rt);
			renderer.render(scene, camera);
			renderer.setRenderTarget(null);
			const px = Array.from(await readback(rt, w, h));
			state.benchHold = false;
			return px;
		},
		async renderMs(w, h, frames) {
			state.benchHold = true;
			const rt = await makeTarget(w, h);
			renderer.setRenderTarget(rt);
			renderer.render(scene, camera); // warm-up: pipeline + shader compile
			await readback(rt, w, h);
			const t0 = performance.now();
			for (let i = 0; i < frames; i++) renderer.render(scene, camera);
			await readback(rt, w, h); // forces the GPU queue to drain
			const ms = (performance.now() - t0) / frames;
			renderer.setRenderTarget(null);
			state.benchHold = false;
			return ms;
		},
	};
}

function onResize() {
	const wrap = el['canvas-wrap'];
	if (!wrap || !state.renderer) return;
	const w = wrap.clientWidth || 640;
	const h = wrap.clientHeight || 480;
	state.renderer.setSize(w, h, false);
	state.renderer.domElement.style.width = '100%';
	state.renderer.domElement.style.height = '100%';
	state.camera.aspect = w / h;
	state.camera.updateProjectionMatrix();
}

// ── model loading ──────────────────────────────────────────────────────────────
function makeLoader() {
	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder); // platform GLBs are often meshopt-packed
	return loader;
}

// `opts.originUrl` — a public https URL for this exact source (seeds the real
// lineage immediately). `opts.preserveLineage` — set when reverting to an
// existing version (clicked in #lineage-strip): keep state.realLineage /
// activeIndex instead of resetting to a fresh single-version thread.
function loadModel(src, label, opts = {}) {
	showState('loading');
	const onLoaded = (gltf) => {
		try {
			mountModel(gltf.scene, label, opts);
			showState('ready');
		} catch (err) {
			fail(err);
		}
	};
	const onError = (err) => fail(err);
	const loader = makeLoader();
	if (src instanceof File) {
		const reader = new FileReader();
		reader.onload = () => loader.parse(reader.result, '', onLoaded, onError);
		reader.onerror = () => fail(new Error('could not read the file'));
		reader.readAsArrayBuffer(src);
	} else {
		loader.load(src, onLoaded, undefined, onError);
	}
}

function mountModel(newRoot, label, opts = {}) {
	if (state.root) {
		state.scene.remove(state.root);
		disposeTree(state.root);
	}
	state.root = newRoot;
	state.originals.clear();
	state.lineage = [];
	state.manual = { metalness: null, roughness: null, emissiveIntensity: 0 };
	state.sourceLabel = label || '';
	state.fx.adopt(newRoot);
	captureOriginals(newRoot);
	frameModel(newRoot);
	state.scene.add(newRoot);
	state.parts = detectParts(newRoot);
	state.selectedPartIndex = null;
	state.dimmed = [];
	renderPartsPanel();
	pushHistory('Original');
	syncSlidersFromModel();
	markPresetActive(null);

	if (opts.preserveLineage) {
		// Reverting to an existing version: the lineage thread stays, but every
		// downstream operation (AI restyle, Save version, Save all as versions)
		// must now read THIS version's bytes, not the newest checkpoint's.
		if (opts.originUrl) state.sourceGlbUrl = opts.originUrl;
	} else {
		state.sourceUrlPending = null;
		if (opts.originUrl) {
			state.sourceGlbUrl = opts.originUrl;
			state.realLineage = seedLineage({ glbUrl: opts.originUrl, prompt: null });
			state.activeIndex = 0;
		} else {
			// Loaded from a local File with no URL yet — checkpoint the ORIGINAL
			// bytes in the background so AI restyle / Save version have a public
			// https origin to anchor to the moment it resolves. Never blocks the
			// live preview; a failure just leaves AI restyle / Save disabled with
			// an honest note (fail-soft, not fake).
			state.sourceGlbUrl = null;
			state.realLineage = null;
			state.activeIndex = 0;
			state.sourceUrlPending = uploadOriginBytes(newRoot)
				.then((url) => {
					state.sourceGlbUrl = url;
					state.realLineage = seedLineage({ glbUrl: url, prompt: null });
					state.activeIndex = 0;
					renderLineageStrip();
					setNote(el['lineage-note'], '');
				})
				.catch((err) => {
					// The advice has to match the failure. A rejected URL is the
					// user's to fix by loading a public one; a store outage is not,
					// and telling them to retype the URL would send them in circles.
					const reason = err?.message || String(err);
					const storeDown = /model store answered/.test(reason);
					setNote(
						el['lineage-note'],
						storeDown
							? `Could not checkpoint this model: ${reason} AI restyle and Save version need that checkpoint, so they stay unavailable until it recovers.`
							: `Could not checkpoint this model: ${reason}. AI restyle and Save version need a public model URL, so load one with "Load URL" instead.`,
						'error',
					);
				})
				.finally(() => {
					state.sourceUrlPending = null;
				});
		}
	}
	renderLineageStrip();
}

// Serialise a root to GLB with the classic glTF materials in place, so a WebGPU
// session exports the same asset a WebGL one does (see restyle-effects.js).
function exportGlb(root) {
	const exporter = new GLTFExporter();
	return state.fx.withClassicMaterials(
		root,
		() => new Promise((res, rej) => {
			exporter.parse(root, (result) => res(result), (err) => rej(err), { binary: true });
		}),
	);
}

// Export the CURRENT root as-is (used only to mint an origin URL for a
// locally-uploaded File that has none — runs once, right after mount, before
// any edit, so the "origin" checkpoint really is the original file).
async function uploadOriginBytes(root) {
	const glb = await exportGlb(root);
	return uploadGlbBytes(glb);
}

// Every api/** JSON error is shaped { error, error_description } by
// api/_lib/http.js's error() helper. Reading a "message" key that is never sent
// threw the real reason away and left the user with "restyle failed (400)"
// where the server had actually said "glb_url rejected: scheme not allowed:
// http:". Read the real field, fall back through the ones a proxy or gateway
// might send instead, and only then admit to a bare status code.
function apiReason(data, res) {
	const reason = data?.error_description || data?.message || data?.error;
	return reason ? String(reason) : `the server answered ${res.status}`;
}

// A failed durable-storage call, phrased so the user knows what to do next. A
// 5xx is the model store being down (a bad storage credential answers exactly
// this way), never anything the caller typed, so name it and point at the two
// things that keep working: live editing and Export GLB are wholly in-browser
// and need no server at all.
function apiFailure(data, res) {
	if (res.status >= 500) {
		return new Error(
			`the model store answered ${res.status}. Your edits are still live in the viewer, and Export GLB still works.`,
		);
	}
	return new Error(apiReason(data, res));
}

async function uploadGlbBytes(arrayBufferOrBlob) {
	const res = await fetch('/api/material-studio?action=upload', {
		method: 'POST',
		headers: { 'content-type': 'model/gltf-binary' },
		body: arrayBufferOrBlob,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data?.url) throw apiFailure(data, res);
	return data.url;
}

function captureOriginals(root) {
	root.traverse((n) => {
		for (const m of materialsOf(n)) {
			if (!isStandardLike(m) || state.originals.has(m)) continue;
			state.originals.set(m, {
				color: m.color.getHex(),
				metalness: m.metalness,
				roughness: m.roughness,
				emissive: m.emissive ? m.emissive.getHex() : null,
				emissiveIntensity: m.emissiveIntensity,
				envMapIntensity: m.envMapIntensity,
				transparent: m.transparent,
				opacity: m.opacity,
				map: m.map || null,
			});
		}
	});
}

function frameModel(root) {
	const box = new THREE.Box3().setFromObject(root);
	const size = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());
	root.position.sub(center);
	root.position.y += size.y / 2; // rest feet near y=0
	const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
	const dist = radius / Math.sin((state.camera.fov * Math.PI) / 180 / 2) * 1.3;
	state.camera.position.set(0, size.y * 0.55, dist);
	state.controls.target.set(0, size.y * 0.5, 0);
	state.controls.update();
}

// ── material operations ────────────────────────────────────────────────────────
// Every operation below edits editRoot(): the whole model, or just the
// selected part's subtree when one is picked in the Parts panel. Reset-to-
// original stays whole-model on purpose: it is a global undo, not scoped.
function editRoot() {
	if (state.selectedPartIndex == null) return state.root;
	return state.parts[state.selectedPartIndex]?.node || state.root;
}

function partSuffix() {
	const p = state.selectedPartIndex != null ? state.parts[state.selectedPartIndex] : null;
	return p ? ` · ${p.name}` : '';
}

function applyPreset(name) {
	if (!state.root) return;
	applyMaterialPreset(THREE, editRoot(), name);
	state.baseName = name;
	state.manual = {
		metalness: MATERIAL_PRESETS[name].metalness ?? null,
		roughness: MATERIAL_PRESETS[name].roughness ?? null,
		emissiveIntensity: MATERIAL_PRESETS[name].emissiveIntensity ?? 0,
	};
	markPresetActive(name);
	pushHistory((MATERIAL_PRESETS[name].label || name) + partSuffix());
	syncSlidersFromModel();
}

function applyVariant(config, label) {
	if (!state.root) return;
	applyMaterialPreset(THREE, editRoot(), config);
	pushHistory(label + partSuffix());
	syncSlidersFromModel();
}

// Apply a flat glTF PBR factor set (as returned by api/material-studio's AI
// restyle) onto every standard material — the same shape server-side
// applyFactorsToDoc uses, translated to THREE's live material API instead of
// glTF-Transform's document API. Keeps the browser preview and the durable
// server-exported GLB visually identical.
function applyFactors(factors) {
	if (!state.root || !factors) return;
	editRoot().traverse((n) => {
		for (const m of materialsOf(n)) {
			if (!isStandardLike(m)) continue;
			if (Array.isArray(factors.baseColorFactor) && factors.baseColorFactor.length >= 3) {
				m.color.setRGB(factors.baseColorFactor[0], factors.baseColorFactor[1], factors.baseColorFactor[2]);
			}
			if (factors.metallicFactor != null) m.metalness = clamp01(factors.metallicFactor);
			if (factors.roughnessFactor != null) m.roughness = clamp01(factors.roughnessFactor);
			if (Array.isArray(factors.emissiveFactor) && factors.emissiveFactor.length >= 3 && m.emissive) {
				m.emissive.setRGB(factors.emissiveFactor[0], factors.emissiveFactor[1], factors.emissiveFactor[2]);
				const mag = Math.max(...factors.emissiveFactor);
				m.emissiveIntensity = mag > 0 ? Math.max(1, mag * 2) : 0;
			}
			m.needsUpdate = true;
		}
	});
	syncSlidersFromModel();
}

// Real pixel texture, not just flat PBR color — generates a seamless material
// swatch via the platform's live text→image lanes (api/v1/ai/image, the same
// NIM FLUX / Vertex stack Forge uses) and applies it as every standard
// material's base color map. Free-quota-then-x402 like every other caller of
// this endpoint; a 402 past the daily quota surfaces as an honest note rather
// than a silent failure — flat-PBR restyle above still applied regardless.
async function generateAndApplyTexture(instruction) {
	const prompt =
		`seamless tileable PBR material texture swatch: ${instruction}, physically based rendering, ` +
		'flat studio lighting, no shadows, no vignette, top-down, high detail, 4k';
	const res = await fetch('/api/v1/ai/image', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ prompt, aspect_ratio: '1:1' }),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data?.url) {
		const msg =
			res.status === 402
				? 'texture generation needs payment past the free daily quota — flat PBR restyle still applied'
				: apiReason(data, res);
		throw new Error(msg);
	}
	const tex = await new THREE.TextureLoader().loadAsync(data.url);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	editRoot().traverse((n) => {
		for (const m of materialsOf(n)) {
			if (!isStandardLike(m)) continue;
			m.map = tex;
			m.needsUpdate = true;
		}
	});
}

// Live manual overrides — set the same property across every standard material.
function setManual(prop, value) {
	if (!state.root) return;
	state.manual[prop] = value;
	editRoot().traverse((n) => {
		for (const m of materialsOf(n)) {
			if (!isStandardLike(m)) continue;
			if (prop === 'metalness') m.metalness = value;
			else if (prop === 'roughness') m.roughness = value;
			else if (prop === 'emissiveIntensity') {
				if (m.emissive) m.emissiveIntensity = value;
			} else if (prop === 'color') m.color.set(value);
			else if (prop === 'emissive' && m.emissive) m.emissive.set(value);
			m.needsUpdate = true;
		}
	});
}

function resetModel() {
	if (!state.root) return;
	for (const [m, o] of state.originals) {
		m.color.setHex(o.color);
		m.metalness = o.metalness;
		m.roughness = o.roughness;
		if (m.emissive && o.emissive != null) m.emissive.setHex(o.emissive);
		m.emissiveIntensity = o.emissiveIntensity;
		m.envMapIntensity = o.envMapIntensity;
		m.transparent = o.transparent;
		m.opacity = o.opacity;
		m.map = o.map;
		m.needsUpdate = true;
	}
	state.lineage = [];
	state.manual = { metalness: null, roughness: null, emissiveIntensity: 0 };
	markPresetActive(null);
	pushHistory('Original');
	syncSlidersFromModel();
	// Reset restores every material's true original opacity, which also wipes
	// the dim highlight on non-selected parts, so reapply it if one is active.
	if (state.selectedPartIndex != null) dimOtherParts(state.selectedPartIndex);
}

// ── parts (editable parts, work order 070) ──────────────────────────────────
// Detects the named, separable top-level nodes workers/segment,
// model-partcrafter and model-holopart all emit (part_01, part_02, …), but
// generically: any loaded GLB whose root has ≥2 top-level nodes that each
// contain real geometry qualifies, not just those three workers' output.
// Selecting one scopes every material operation above (editRoot()) to that
// part alone; Swap and Regenerate replace its geometry outright and
// reassemble the result back into the SAME scene graph, under the SAME node
// name, the stability guarantee work order 078 ("keep the rig") depends on.
function detectParts(root) {
	const parts = [];
	for (const child of root.children) {
		let hasMesh = false;
		child.traverse((n) => {
			if (n.isMesh) hasMesh = true;
		});
		if (!hasMesh) continue;
		parts.push({ name: child.name || `Part ${parts.length + 1}`, node: child });
	}
	return parts.length >= 2 ? parts : [];
}

// Golden-ratio hue stepping: the same tinting convention workers/segment,
// model-partcrafter and model-holopart use, so a part's swatch color here
// matches the color it already carries in a manifest-driven viewer.
function partColor(index) {
	const hue = (index * 0.618033988749895) % 1.0;
	return `#${new THREE.Color().setHSL(hue, 0.65, 0.55).getHexString()}`;
}

function renderPartsPanel() {
	if (!el['parts-card']) return;
	const has = state.parts.length >= 2;
	el['parts-card'].hidden = !has;
	if (!has) return;
	el['parts-list'].innerHTML = '';
	state.parts.forEach((p, i) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'rs-preset';
		b.dataset.partIndex = String(i);
		const active = state.selectedPartIndex === i;
		b.setAttribute('aria-pressed', active ? 'true' : 'false');
		b.classList.toggle('is-active', active);
		b.innerHTML = `<span class="rs-preset__swatch" style="background:${partColor(i)}"></span><span>${escapeHtml(p.name)}</span>`;
		b.addEventListener('click', () => selectPart(i));
		el['parts-list'].appendChild(b);
	});
	const selected = state.selectedPartIndex != null;
	el['part-swap'].disabled = !selected;
	el['part-regenerate'].disabled = !selected;
	el['part-deselect'].disabled = !selected;
}

function selectPart(index) {
	if (state.selectedPartIndex === index) {
		deselectPart();
		return;
	}
	restoreDimmed();
	state.selectedPartIndex = index;
	dimOtherParts(index);
	renderPartsPanel();
	syncSlidersFromModel();
	setNote(
		el['parts-note'],
		`Editing "${state.parts[index].name}" only: presets, AI restyle, and fine-tuning now apply to this part alone.`,
	);
}

function deselectPart() {
	restoreDimmed();
	state.selectedPartIndex = null;
	renderPartsPanel();
	syncSlidersFromModel();
	setNote(el['parts-note'], '');
}

// Dims every OTHER part's materials so the one being edited stands out. Pure
// opacity, restored exactly (not blended into state.originals, which is
// Reset-to-original's own baseline) so it never interferes with a real edit.
function dimOtherParts(selectedIndex) {
	state.dimmed = [];
	state.parts.forEach((p, i) => {
		if (i === selectedIndex) return;
		p.node.traverse((n) => {
			for (const m of materialsOf(n)) {
				if (!isStandardLike(m)) continue;
				state.dimmed.push({ material: m, opacity: m.opacity, transparent: m.transparent });
				m.transparent = true;
				m.opacity = Math.min(m.opacity, 0.22);
				m.needsUpdate = true;
			}
		});
	});
}

function restoreDimmed() {
	for (const { material, opacity, transparent } of state.dimmed) {
		material.opacity = opacity;
		material.transparent = transparent;
		material.needsUpdate = true;
	}
	state.dimmed = [];
}

// Swaps the selected part's entire node (geometry + material) for newContent,
// reattaching it under the SAME name, position, rotation and scale the old
// node had, so it reassembles back into exactly where it came from, and any
// downstream consumer keyed on the node name still finds it.
function swapSelectedPart(newContent, sourceLabel) {
	const i = state.selectedPartIndex;
	if (i == null) throw new Error('select a part first');
	const entry = state.parts[i];
	const oldNode = entry.node;
	const parent = oldNode.parent;
	if (!parent) throw new Error('the selected part has no parent to reattach to');

	newContent.name = oldNode.name;
	newContent.position.copy(oldNode.position);
	newContent.quaternion.copy(oldNode.quaternion);
	newContent.scale.copy(oldNode.scale);

	oldNode.traverse((n) => {
		for (const m of materialsOf(n)) state.originals.delete(m);
	});
	parent.remove(oldNode);
	disposeTree(oldNode);
	parent.add(newContent); // THREE.Object3D.add() re-parents cleanly on its own

	entry.node = newContent;
	captureOriginals(newContent);
	renderPartsPanel();
	pushHistory(`Swapped ${entry.name} from ${sourceLabel}`);
}

// "Swap part": load a caller-picked local GLB/GLTF and drop its content in as
// the selected part's new geometry, in place.
function acceptPartSwapFile(file) {
	if (state.selectedPartIndex == null) return;
	if (!/\.(glb|gltf)$/i.test(file.name)) {
		setNote(el['parts-note'], `"${file.name}" is not a .glb or .gltf model.`, 'error');
		return;
	}
	const entry = state.parts[state.selectedPartIndex];
	const loader = makeLoader();
	const reader = new FileReader();
	reader.onload = () => {
		loader.parse(
			reader.result,
			'',
			(gltf) => {
				try {
					swapSelectedPart(gltf.scene, file.name);
					setNote(el['parts-note'], `Swapped "${entry.name}" in from ${file.name}.`, 'done');
				} catch (err) {
					setNote(el['parts-note'], `Swap failed: ${err?.message || err}`, 'error');
				}
			},
			(err) => setNote(el['parts-note'], `Could not read "${file.name}": ${err?.message || err}`, 'error'),
		);
	};
	reader.onerror = () => setNote(el['parts-note'], `Could not read "${file.name}".`, 'error');
	reader.readAsArrayBuffer(file);
}

// "Regenerate part": send the WHOLE current model (it already has ≥2 named
// parts, or this panel would be hidden) through the real model-holopart
// worker via /api/forge-holopart, which completes the hidden/occluded
// geometry of every part in one pass, then pull just the regenerated part
// matching the selected node's name back out and swap it in, reassembling
// the result into this same scene while leaving every other part untouched.
async function regenerateSelectedPart() {
	if (state.selectedPartIndex == null) return;
	const entry = state.parts[state.selectedPartIndex];
	if (state.sourceUrlPending) {
		setNote(el['parts-note'], 'Still checkpointing the model, try again in a moment.', 'busy');
		return;
	}
	if (!state.sourceGlbUrl) {
		setNote(
			el['parts-note'],
			'Regenerate needs a public model URL: load one via "Load URL", or wait for the upload checkpoint to finish.',
			'error',
		);
		return;
	}
	const token = ++state.regenRunToken;
	el['part-regenerate'].disabled = true;
	setNote(el['parts-note'], `Completing hidden geometry for "${entry.name}" via HoloPart…`, 'busy');
	try {
		const startRes = await fetch('/api/forge-holopart', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ mesh_url: state.sourceGlbUrl }),
		});
		const startData = await startRes.json().catch(() => ({}));
		if (!startRes.ok || !startData?.job_id) throw apiFailure(startData, startRes);

		const result = await pollHoloPart(startData.job_id, token);
		if (!result || token !== state.regenRunToken) return; // superseded

		// Completing hidden geometry must never cost the model its skeleton or
		// clips (work order 078: "keep the rig"): HoloPart only fills in
		// occluded surfaces, it has no business touching the armature a clip
		// addresses by joint name. Checked for real against the whole-model
		// bytes HoloPart actually received and actually returned, before any
		// part is pulled out of the result and swapped into the live scene.
		setNote(el['parts-note'], `Verifying "${entry.name}" kept the rig intact…`, 'busy');
		const [beforeBytes, afterBytes] = await Promise.all([
			fetch(state.sourceGlbUrl).then((r) => r.arrayBuffer()),
			fetch(result.result_url).then((r) => r.arrayBuffer()),
		]);
		await verifyPreserved(beforeBytes, afterBytes, ['skeleton', 'clips'], { label: 'HoloPart regenerate' });

		const gltf = await makeLoader().loadAsync(result.result_url);
		let regenerated = null;
		gltf.scene.traverse((n) => {
			if (!regenerated && n.name === entry.name) regenerated = n;
		});
		if (!regenerated) {
			throw new Error(`HoloPart's result has no part named "${entry.name}".`);
		}
		swapSelectedPart(regenerated, 'HoloPart');
		setNote(el['parts-note'], `Saving "${entry.name}" as a new version…`, 'busy');
		await persistCurrentSceneAsVersion({
			instruction: `Regenerated "${entry.name}" via HoloPart`,
			refKind: 'part-edit',
			onStatus: (s) => setNote(el['parts-note'], s, 'busy'),
		});
		setNote(el['parts-note'], `"${entry.name}" regenerated via HoloPart, reassembled, and saved as a new version.`, 'done');
	} catch (err) {
		if (token !== state.regenRunToken) return;
		setNote(el['parts-note'], `Regenerate failed: ${err?.message || err}`, 'error');
	} finally {
		if (token === state.regenRunToken) el['part-regenerate'].disabled = state.selectedPartIndex == null;
	}
}

async function pollHoloPart(jobId, token) {
	const POLL_MS = 3000;
	const MAX_MS = 6 * 60 * 1000;
	const deadline = performance.now() + MAX_MS;
	while (token === state.regenRunToken && performance.now() < deadline) {
		await sleep(POLL_MS);
		if (token !== state.regenRunToken) return null;
		const res = await fetch(`/api/forge-holopart?job=${encodeURIComponent(jobId)}`);
		const data = await res.json().catch(() => ({}));
		if (data.error === 'unconfigured') {
			throw new Error(data.message || 'Hidden-part completion is not configured on this deployment.');
		}
		if (data.status === 'done' && data.result_url) return data;
		if (data.status === 'failed') throw new Error(data.error || 'Part completion failed.');
	}
	if (token !== state.regenRunToken) return null;
	throw new Error('Part completion timed out.');
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

// ── variants ─────────────────────────────────────────────────────────────────
function generateVariants() {
	if (!state.root) return;
	const seed = parseInt(el.seed.value, 10) || 0;
	const count = clampInt(parseInt(el['variant-count'].value, 10) || 6, 1, 12);
	const variants = materialVariants(state.baseName, { seed, count });
	el['variant-strip'].innerHTML = '';
	for (const v of variants) {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'rs-swatch';
		b.style.background = v.config.color;
		b.title = `${v.label} · seed ${v.seed}`;
		b.setAttribute('aria-label', `Apply ${v.label}`);
		b.addEventListener('click', () => applyVariant(v.config, v.label));
		el['variant-strip'].appendChild(b);
	}
	el.variants.hidden = false;
}

// ── seeded variants: persist all N as real, durable versions ─────────────────
// The swatch strip (generateVariants, below) is an instant, free, client-only
// preview. "Save all as versions" is the durable counterpart: it asks
// api/material-studio's variants action to actually export, gltf-validate, and
// persist N independent GLBs (branching off the SAME parent version) and folds
// every one into the real lineage, so each variant is a separately addressable,
// revertable asset — not just a color swap that vanishes on reload.
async function persistVariants() {
	if (!state.root) return;
	if (state.sourceUrlPending) {
		setNote(el['variants-note'], 'Still checkpointing the model — try again in a moment.', 'busy');
		return;
	}
	if (!state.sourceGlbUrl) {
		setNote(el['variants-note'], 'Saving variants needs a public model URL — load one via "Load URL", or wait for the upload checkpoint to finish.', 'error');
		return;
	}
	const seed = parseInt(el.seed.value, 10) || 0;
	const count = clampInt(parseInt(el['variant-count'].value, 10) || 6, 1, 12);
	el['save-variants'].disabled = true;
	setNote(el['variants-note'], `Generating and saving ${count} variants…`, 'busy');
	try {
		const res = await fetch('/api/material-studio?action=variants', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				glb_url: state.sourceGlbUrl,
				preset: state.baseName,
				seed,
				count,
				parent_lineage: state.realLineage,
				parent_index: state.activeIndex,
			}),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data?.ok) throw apiFailure(data, res);

		state.realLineage = data.lineage;
		// Leave the active pointer where it was — the variants are new siblings
		// to pick from, not an implicit navigation to the last one.
		renderLineageStrip();
		setNote(
			el['variants-note'],
			`Saved ${data.variants.length} variant${data.variants.length === 1 ? '' : 's'} as new versions — pick one below in Versions.`,
			'done',
		);
	} catch (err) {
		setNote(el['variants-note'], `Save failed: ${err?.message || err}`, 'error');
	} finally {
		el['save-variants'].disabled = false;
	}
}

// ── AI restyle ───────────────────────────────────────────────────────────────
async function aiRestyle() {
	const instruction = (el['ai-instruction'].value || '').trim();
	if (!instruction) {
		setNote(el['ai-note'], 'Describe a look first — e.g. "cyberpunk neon" or "worn copper".', 'error');
		return;
	}
	if (state.sourceUrlPending) {
		setNote(el['ai-note'], 'Still checkpointing the model — try again in a moment.', 'busy');
		return;
	}
	if (!state.sourceGlbUrl) {
		setNote(el['ai-note'], 'AI restyle needs a public model URL — load one via "Load URL", or wait for the upload checkpoint to finish.', 'error');
		return;
	}
	const wantTexture = el['ai-texture']?.checked !== false;
	el['ai-restyle'].disabled = true;
	setNote(el['ai-note'], 'Asking IBM Granite for a PBR material…', 'busy');
	try {
		const res = await fetch('/api/material-studio?action=restyle', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				glb_url: state.sourceGlbUrl,
				instruction,
				parent_lineage: state.realLineage,
				parent_index: state.activeIndex,
			}),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data?.ok) throw apiFailure(data, res);

		applyFactors(data.factors);
		const scopedToPart = state.selectedPartIndex != null;
		// The server restyled the WHOLE model's GLB (it has no concept of a
		// selected part), but the live preview above was applied to editRoot()
		// alone. Adopting the server's checkpoint here would silently restyle
		// every other part the next time anything reads state.sourceGlbUrl, so
		// a part-scoped restyle keeps the PREVIOUS checkpoint and leaves "Save
		// version" (which exports the actual live scene, correctly scoped) as
		// the way to persist it.
		if (!scopedToPart) {
			state.realLineage = data.lineage;
			state.activeIndex = data.activeIndex;
			state.sourceGlbUrl = data.glbUrl; // anchor further edits to this new checkpoint
			renderLineageStrip();
		}
		pushHistory(`AI: ${instruction}${partSuffix()}`);

		const savedNote = scopedToPart
			? 'applied to this part, click "Save version" below to persist it'
			: 'applied and saved as a new version';
		if (wantTexture) {
			setNote(el['ai-note'], 'PBR applied — generating a texture too…', 'busy');
			try {
				await generateAndApplyTexture(instruction);
				setNote(el['ai-note'], `Restyled "${instruction}": PBR + texture ${savedNote}.`, 'done');
			} catch (texErr) {
				setNote(el['ai-note'], `PBR ${savedNote}. Texture skipped: ${texErr?.message || texErr}`, 'error');
			}
		} else {
			setNote(el['ai-note'], `Restyled "${instruction}": ${savedNote}.`, 'done');
		}
	} catch (err) {
		setNote(el['ai-note'], `Restyle failed: ${err?.message || err}`, 'error');
	} finally {
		el['ai-restyle'].disabled = false;
	}
}

// ── versions (real lineage) ───────────────────────────────────────────────────

// Export the live scene exactly as it stands, validate + persist it as a real
// GLB, and append it to the real lineage. Shared by the manual "Save version"
// button and any edit (e.g. a part regenerate) that needs to record a durable
// lineage entry on its own rather than wait for a manual save.
async function persistCurrentSceneAsVersion({ instruction, refKind, onStatus }) {
	const glb = await exportGlb(state.root);
	const rawBlob = new Blob([glb], { type: 'model/gltf-binary' });
	const { blob } = await optimizeAndValidateGlb(rawBlob, { onStatus });
	const url = await uploadGlbBytes(blob);
	if (!state.realLineage) state.realLineage = seedLineage({ glbUrl: url, prompt: null });
	else {
		state.realLineage = appendVersion(state.realLineage, {
			glbUrl: url,
			instruction,
			refKind,
			parentIndex: state.activeIndex,
		});
		state.activeIndex = state.realLineage.length - 1;
	}
	state.sourceGlbUrl = url;
	renderLineageStrip();
	return url;
}

async function saveVersion() {
	if (!state.root) return;
	if (state.sourceUrlPending) {
		setNote(el['lineage-note'], 'Still checkpointing the model — try again in a moment.', 'busy');
		return;
	}
	el['save-version'].disabled = true;
	setNote(el['lineage-note'], 'Saving version…', 'busy');
	try {
		await persistCurrentSceneAsVersion({
			instruction: state.lineage[state.lineage.length - 1] || 'Manual edit',
			refKind: 'material-edit',
			onStatus: (s) => setNote(el['lineage-note'], s, 'busy'),
		});
		setNote(el['lineage-note'], 'Version saved.', 'done');
	} catch (err) {
		setNote(el['lineage-note'], `Save failed: ${err?.message || err}`, 'error');
	} finally {
		el['save-version'].disabled = false;
	}
}

function renderLineageStrip() {
	const host = el['lineage-strip'];
	if (!host) return;
	if (!state.realLineage || !state.realLineage.length) {
		host.innerHTML = '<span class="rs-step">No versions saved yet</span>';
		return;
	}
	const summary = summarizeLineage(state.realLineage, state.activeIndex);
	host.innerHTML = summary
		.map((v, i) => {
			const parent = Number.isInteger(v.parentIndex) ? state.realLineage.find((p) => p.index === v.parentIndex) : null;
			// A "Diff" link only makes sense once a version has a parent to
			// compare against (the origin version never does): it opens Model
			// Diff pre-loaded with exactly this edit's before/after pair, so the
			// preserve contract this edit declared is checkable by eye, not just
			// trusted from the API response.
			const diffLink = parent
				? `<a class="rs-step-diff" href="/diff?a=${encodeURIComponent(parent.glbUrl)}&b=${encodeURIComponent(v.glbUrl)}" target="_blank" rel="noopener" title="Compare this version against its parent in Model Diff">Diff</a>`
				: '';
			return `<button type="button" class="rs-step${v.active ? ' is-current' : ' is-versioned'}" data-index="${v.index}" title="${escapeHtml(v.glbUrl)}">${escapeHtml(v.label)}</button>${diffLink}${i < summary.length - 1 ? '<span class="rs-arrow">→</span>' : ''}`;
		})
		.join('');
	host.querySelectorAll('.rs-step[data-index]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const idx = Number(btn.dataset.index);
			const entry = state.realLineage.find((v) => v.index === idx);
			if (!entry) return;
			state.activeIndex = idx;
			loadModel(entry.glbUrl, entry.label || `Version ${idx}`, {
				preserveLineage: true,
				originUrl: entry.glbUrl,
			});
		});
	});
}

// ── export ─────────────────────────────────────────────────────────────────────
async function exportModel() {
	if (!state.root) return;
	el.export.disabled = true;
	setNote(el['export-note'], 'Exporting…');
	try {
		const glb = await exportGlb(state.root);
		const rawBlob = new Blob([glb], { type: 'model/gltf-binary' });
		const { blob, optimized, outputBytes, report } = await optimizeAndValidateGlb(rawBlob, {
			onStatus: (s) => setNote(el['export-note'], s),
		});
		const valid = !report || report.issues?.numErrors === 0;
		download(blob, 'restyled.glb');
		setNote(
			el['export-note'],
			`Saved restyled.glb · ${fmtBytes(outputBytes)}${optimized ? ' · optimized' : ''}${valid ? ' · valid glTF ✓' : ' · exported'}`,
		);
	} catch (err) {
		setNote(el['export-note'], `Export failed: ${err?.message || err}`);
	} finally {
		el.export.disabled = false;
	}
}

// ── UI wiring ───────────────────────────────────────────────────────────────────
function buildPresetButtons() {
	el.presets.innerHTML = '';
	for (const name of MATERIAL_PRESET_NAMES) {
		const preset = MATERIAL_PRESETS[name];
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'rs-preset';
		b.dataset.preset = name;
		b.setAttribute('aria-pressed', 'false');
		b.innerHTML = `<span class="rs-preset__swatch" style="background:${swatchCss(preset)}"></span><span>${preset.label || name}</span>`;
		b.addEventListener('click', () => applyPreset(name));
		el.presets.appendChild(b);
	}
}

function wireControls() {
	el.metalness.addEventListener('input', () => setManual('metalness', +el.metalness.value));
	el.roughness.addEventListener('input', () => setManual('roughness', +el.roughness.value));
	el.emissive.addEventListener('input', () => setManual('emissiveIntensity', +el.emissive.value));
	el.basecolor.addEventListener('input', () => setManual('color', el.basecolor.value));
	el.emissivecolor.addEventListener('input', () => setManual('emissive', el.emissivecolor.value));
	el.rim.addEventListener('input', () => state.fx.setRim({ strength: +el.rim.value }));
	el.rimcolor.addEventListener('input', () => state.fx.setRim({ color: el.rimcolor.value }));
	el['gen-variants'].addEventListener('click', generateVariants);
	el['save-variants'].addEventListener('click', persistVariants);
	el.reset.addEventListener('click', resetModel);
	el.export.addEventListener('click', exportModel);
	el.retry.addEventListener('click', () => {
		const next = new URL(location.href);
		if (next.searchParams.has('url')) {
			next.searchParams.delete('url');
			history.replaceState(null, '', next.toString());
		}
		setNote(el['load-note'], '');
		loadModel(DEFAULT_MODEL, 'sample', { originUrl: absoluteUrl(DEFAULT_MODEL) });
	});
	el['ai-restyle'].addEventListener('click', aiRestyle);
	el['ai-instruction'].addEventListener('keydown', (e) => {
		if (e.key === 'Enter') aiRestyle();
	});
	el['save-version'].addEventListener('click', saveVersion);

	el['part-swap'].addEventListener('click', () => el['part-swap-file'].click());
	el['part-swap-file'].addEventListener('change', (e) => {
		const f = e.target.files?.[0];
		if (f) acceptPartSwapFile(f);
		e.target.value = '';
	});
	el['part-regenerate'].addEventListener('click', regenerateSelectedPart);
	el['part-deselect'].addEventListener('click', deselectPart);

	// The file input itself is off-screen (a bare styled <label> is not
	// keyboard-focusable, so it left upload unreachable without a mouse).
	el.upload.addEventListener('click', () => el.file.click());
	el.file.addEventListener('change', (e) => {
		const f = e.target.files?.[0];
		if (f) acceptLocalFile(f);
		// Clearing the value lets the same file be picked twice in a row; the
		// browser fires no change event for an unchanged selection otherwise.
		e.target.value = '';
	});
	el['load-url'].addEventListener('click', () => {
		const u = (el['url-input'].value || '').trim();
		if (!u) {
			setNote(el['load-note'], 'Paste a public .glb or .gltf URL first.', 'error');
			el['url-input'].focus();
			return;
		}
		const next = new URL(location.href);
		next.searchParams.set('url', u);
		location.href = next.toString();
	});
	el['url-input'].addEventListener('keydown', (e) => {
		if (e.key === 'Enter') el['load-url'].click();
	});
	// Drag & drop onto the stage, with a visible drop target and an honest
	// rejection for anything that is not a glTF binary.
	const stage = el.stage;
	stage.addEventListener('dragover', (e) => {
		e.preventDefault();
		stage.classList.add('is-dropping');
	});
	stage.addEventListener('dragleave', () => stage.classList.remove('is-dropping'));
	stage.addEventListener('drop', (e) => {
		e.preventDefault();
		stage.classList.remove('is-dropping');
		const f = e.dataTransfer?.files?.[0];
		if (!f) return;
		acceptLocalFile(f);
	});
}

// A local file has no public URL yet, so mountModel checkpoints its bytes in
// the background. Report both the accept and the reject honestly rather than
// letting a wrong-format drop vanish silently.
function acceptLocalFile(file) {
	if (!/\.(glb|gltf)$/i.test(file.name)) {
		setNote(el['load-note'], `"${file.name}" is not a .glb or .gltf model.`, 'error');
		return;
	}
	setNote(el['load-note'], `Loaded ${file.name}.`, 'done');
	loadModel(file, file.name);
}

function syncSlidersFromModel() {
	// Reflect the first standard material's values back into the sliders
	// (editRoot()'s, so the sliders read the selected part when one is active).
	let first = null;
	editRoot()?.traverse((n) => {
		if (first) return;
		for (const m of materialsOf(n)) if (isStandardLike(m)) { first = m; break; }
	});
	if (!first) return;
	el.metalness.value = first.metalness;
	el.roughness.value = first.roughness;
	el.emissive.value = first.emissiveIntensity || 0;
	el.basecolor.value = '#' + first.color.getHexString();
	if (first.emissive) el.emissivecolor.value = '#' + first.emissive.getHexString();
}

function markPresetActive(name) {
	el.presets.querySelectorAll('.rs-preset').forEach((b) => {
		const on = b.dataset.preset === name;
		b.classList.toggle('is-active', on);
		b.setAttribute('aria-pressed', on ? 'true' : 'false');
	});
}

function pushHistory(label) {
	state.lineage.push(label);
	el.history.innerHTML = state.lineage
		.map((s, i) => `<span class="rs-step${i === state.lineage.length - 1 ? ' is-current' : ''}">${escapeHtml(s)}</span>`)
		.join('<span class="rs-arrow">→</span>');
}

function showState(kind) {
	el.status.hidden = kind !== 'loading';
	el.error.hidden = kind !== 'error';
	el['canvas-wrap'].classList.toggle('is-hidden', kind === 'error');
}

function fail(err) {
	console.warn('[restyle] load failed:', err?.message || err);
	el['error-msg'].textContent =
		'That model could not be loaded. Check the URL is a public .glb/.gltf, or upload a file.';
	showState('error');
}

// ── small helpers ────────────────────────────────────────────────────────────
function materialsOf(node) {
	if (!node || !node.material) return [];
	return Array.isArray(node.material) ? node.material.filter(Boolean) : [node.material];
}
function isStandardLike(m) {
	return !!m && 'metalness' in m && 'roughness' in m && !!m.color && typeof m.color.getHex === 'function';
}
function disposeTree(root) {
	root.traverse((n) => {
		if (n.geometry) n.geometry.dispose?.();
		for (const m of materialsOf(n)) {
			for (const v of Object.values(m)) if (v && v.isTexture) v.dispose?.();
			m.dispose?.();
		}
	});
}
function swatchCss(p) {
	if (p.emissive && (p.emissiveIntensity || 0) > 0.5) return p.emissive;
	if (p.transparent) return `${p.color}88`;
	return p.color || '#888';
}
function download(blob, name) {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function setNote(node, text, kind) {
	if (!node) return;
	node.textContent = text;
	node.classList.toggle('is-error', kind === 'error');
	node.classList.toggle('is-busy', kind === 'busy');
	node.classList.toggle('is-done', kind === 'done');
}
function fmtBytes(n) {
	return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}
function clampInt(n, lo, hi) {
	return Math.min(hi, Math.max(lo, Math.round(n)));
}
function clamp01(n) {
	return Math.min(1, Math.max(0, Number(n) || 0));
}
// Resolve a possibly-relative URL (e.g. the local /avatars/*.glb sample) to an
// absolute https URL against the current origin — api/material-studio.js's SSRF
// guard requires a real, publicly resolvable https URL, so a bare path like
// "/avatars/realistic-female.glb" must become "https://three.ws/avatars/..."
// before it's ever sent as glb_url.
function absoluteUrl(u) {
	try {
		return new URL(u, location.href).href;
	} catch {
		return u;
	}
}
function escapeHtml(s) {
	return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
