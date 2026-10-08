// Parts Studio — split a 3D model into selectable, addressable parts.
//
// Drives /api/forge-segment: POST a mesh URL to start a segmentation job, poll
// until it resolves to a segmented GLB (every part is a named node) plus a parts
// manifest. The result is loaded into a real Three.js scene where each part can
// be clicked to isolate, toggled for visibility, recoloured for inspection, and
// exported on its own. Nothing here is faked — the parts, colours, and counts
// all come from the worker's geometry segmentation.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getMeshoptDecoder } from './viewer/internal.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 4 * 60 * 1000;
const HIGHLIGHT = new THREE.Color(0x4f8cff);
const HOVER = new THREE.Color(0x1d3a66);

const els = {
	form: document.getElementById('composer'),
	meshUrl: document.getElementById('mesh-url'),
	method: document.getElementById('method'),
	maxParts: document.getElementById('max-parts'),
	segment: document.getElementById('segment-btn'),
	segmentLabel: document.getElementById('segment-label'),
	stage: document.getElementById('stage'),
	states: {
		empty: document.getElementById('state-empty'),
		loading: document.getElementById('state-loading'),
		result: document.getElementById('state-result'),
		error: document.getElementById('state-error'),
		unconfigured: document.getElementById('state-unconfigured'),
	},
	loadingMeta: document.getElementById('loading-meta'),
	loadingNote: document.getElementById('loading-note'),
	cancel: document.getElementById('cancel'),
	viewport: document.getElementById('viewport'),
	partsList: document.getElementById('parts-list'),
	partsCount: document.getElementById('parts-count'),
	showAll: document.getElementById('show-all'),
	downloadGlb: document.getElementById('download-glb'),
	resetView: document.getElementById('reset-view'),
	selectionLabel: document.getElementById('selection-label'),
	errorMessage: document.getElementById('error-message'),
	retry: document.getElementById('retry'),
};

let pollAbort = false;
let elapsedTimer = null;

// ── three.js scene ────────────────────────────────────────────────────────────

let renderer, scene, camera, controls, pmrem, raycaster, pointer;
let modelRoot = null;
let parts = []; // { id, name, faceCount, color, object, baseEmissive, visible }
let selectedId = null;
let hoveredId = null;
let frameRequested = false;

function initThree() {
	if (renderer) return;
	const mount = els.viewport;

	renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(mount.clientWidth, mount.clientHeight, false);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	mount.appendChild(renderer.domElement);
	renderer.domElement.style.display = 'block';
	renderer.domElement.style.touchAction = 'none';

	scene = new THREE.Scene();

	pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

	camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.01, 1000);
	camera.position.set(0, 1.2, 4);

	const hemi = new THREE.HemisphereLight(0xffffff, 0x202028, 0.9);
	scene.add(hemi);
	const key = new THREE.DirectionalLight(0xffffff, 1.6);
	key.position.set(3, 6, 4);
	scene.add(key);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.addEventListener('change', requestFrame);

	raycaster = new THREE.Raycaster();
	pointer = new THREE.Vector2();

	const ro = new ResizeObserver(() => onResize());
	ro.observe(mount);

	renderer.domElement.addEventListener('pointermove', onPointerMove);
	renderer.domElement.addEventListener('pointerdown', onPointerDown);
	renderer.domElement.addEventListener('pointerleave', () => setHover(null));

	animate();
}

function animate() {
	requestAnimationFrame(animate);
	const damping = controls?.update();
	// Render on demand: whenever damping is active or a frame was requested.
	if (frameRequested || damping) {
		frameRequested = false;
		renderer.render(scene, camera);
	}
}

function requestFrame() {
	frameRequested = true;
}

function onResize() {
	if (!renderer) return;
	const { clientWidth: w, clientHeight: h } = els.viewport;
	if (w === 0 || h === 0) return;
	renderer.setSize(w, h, false);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	requestFrame();
}

function clearModel() {
	if (modelRoot) {
		scene.remove(modelRoot);
		modelRoot.traverse((o) => {
			if (o.isMesh) {
				o.geometry?.dispose?.();
				if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
				else o.material?.dispose?.();
			}
		});
	}
	modelRoot = null;
	parts = [];
	selectedId = null;
	hoveredId = null;
}

// Frame the camera to the model's bounding sphere.
function frameModel() {
	const box = new THREE.Box3().setFromObject(modelRoot);
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const center = sphere.center;
	const radius = sphere.radius || 1;

	controls.target.copy(center);
	const fov = (camera.fov * Math.PI) / 180;
	const dist = (radius / Math.sin(fov / 2)) * 1.25;
	const dir = new THREE.Vector3(0.6, 0.45, 1).normalize();
	camera.position.copy(center).addScaledVector(dir, dist);
	camera.near = dist / 100;
	camera.far = dist * 100;
	camera.updateProjectionMatrix();
	controls.update();
	requestFrame();
}

// Find the part id (node name like "part_03") that owns a mesh.
function partIdFor(obj) {
	let cur = obj;
	while (cur) {
		if (/^part_\d+$/i.test(cur.name)) return cur.name.toLowerCase();
		cur = cur.parent;
	}
	return obj.name || null;
}

function loadSegmentedModel(glbUrl, manifest) {
	return new Promise((resolve, reject) => {
		const loader = new GLTFLoader();
		const meshoptReady = getMeshoptDecoder().then((d) => loader.setMeshoptDecoder(d));
		meshoptReady.then(() => loader.load(
			glbUrl,
			(gltf) => {
				clearModel();
				modelRoot = gltf.scene;
				scene.add(modelRoot);

				const manifestById = new Map(
					(manifest?.parts || []).map((p) => [String(p.id).toLowerCase(), p]),
				);

				// Collect one Part record per addressable node, cloning materials so
				// per-part highlight/recolour never bleeds across shared materials.
				const byId = new Map();
				modelRoot.traverse((o) => {
					if (!o.isMesh) return;
					o.material = o.material.clone();
					o.material.vertexColors = true;
					o.material.needsUpdate = true; // force a shader recompile so the per-part tint shows
					const id = partIdFor(o);
					if (!byId.has(id)) {
						const man = manifestById.get(id);
						const faceCount =
							man?.face_count ?? Math.floor((o.geometry.index?.count || o.geometry.attributes.position.count) / 3);
						const color = man?.color || '#888888';
						byId.set(id, {
							id,
							name: man?.name || id,
							faceCount,
							color,
							object: o,
							meshes: [o],
							baseEmissive: o.material.emissive.getHex(),
							visible: true,
						});
					} else {
						byId.get(id).meshes.push(o);
					}
				});

				parts = Array.from(byId.values());
				// Order to match the manifest (top→bottom, larger→smaller) when present.
				if (manifest?.parts?.length) {
					const order = new Map(manifest.parts.map((p, i) => [String(p.id).toLowerCase(), i]));
					parts.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
				} else {
					parts.sort((a, b) => b.faceCount - a.faceCount);
				}

				frameModel();
				resolve();
			},
			undefined,
			(err) => reject(new Error(`Could not load the segmented model: ${err?.message || err}`)),
		));
	});
}

// ── selection / visibility ────────────────────────────────────────────────────

function applyHighlights() {
	for (const p of parts) {
		const hex =
			p.id === selectedId ? HIGHLIGHT.getHex() : p.id === hoveredId ? HOVER.getHex() : p.baseEmissive;
		const intensity = p.id === selectedId ? 0.9 : p.id === hoveredId ? 0.45 : 1;
		for (const m of p.meshes) {
			m.material.emissive.setHex(hex);
			if (m.material.emissiveIntensity !== undefined) m.material.emissiveIntensity = intensity;
		}
	}
	requestFrame();
}

function setSelected(id) {
	selectedId = selectedId === id ? null : id;
	applyHighlights();
	syncListSelection();
	updateSelectionLabel();
}

function setHover(id) {
	if (hoveredId === id) return;
	hoveredId = id;
	renderer.domElement.style.cursor = id ? 'pointer' : 'default';
	applyHighlights();
}

function setPartVisible(id, visible) {
	const p = parts.find((x) => x.id === id);
	if (!p) return;
	p.visible = visible;
	for (const m of p.meshes) m.visible = visible;
	if (!visible && selectedId === id) setSelected(id); // deselect a hidden part
	requestFrame();
}

function isolate(id) {
	const onlyThis = parts.every((p) => (p.id === id ? p.visible : !p.visible));
	for (const p of parts) setPartVisible(p.id, onlyThis ? true : p.id === id);
	if (!onlyThis) {
		selectedId = id;
		applyHighlights();
		updateSelectionLabel();
	}
	syncListVisibility();
	syncListSelection();
}

function showAll() {
	for (const p of parts) setPartVisible(p.id, true);
	syncListVisibility();
}

function updateSelectionLabel() {
	const p = parts.find((x) => x.id === selectedId);
	els.selectionLabel.textContent = p
		? `${p.name} · ${p.faceCount.toLocaleString()} faces`
		: `${parts.length} parts · click one to inspect`;
}

// ── parts panel ───────────────────────────────────────────────────────────────

function renderPartsPanel() {
	els.partsCount.textContent = `${parts.length}`;
	els.partsList.innerHTML = '';
	for (const p of parts) {
		const row = document.createElement('div');
		row.className = 'part-row';
		row.dataset.partId = p.id;
		row.setAttribute('role', 'listitem');

		row.innerHTML = `
			<button class="part-main" type="button" data-act="select" aria-label="Select ${escapeHtml(p.name)}">
				<span class="swatch" style="background:${p.color}"></span>
				<span class="part-text">
					<span class="part-name">${escapeHtml(p.name)}</span>
					<span class="part-sub">${p.id} · ${p.faceCount.toLocaleString()} faces</span>
				</span>
			</button>
			<span class="part-actions">
				<button class="icon-btn" type="button" data-act="isolate" title="Isolate this part" aria-label="Isolate ${escapeHtml(p.name)}">⤢</button>
				<button class="icon-btn" type="button" data-act="visibility" title="Toggle visibility" aria-label="Toggle visibility of ${escapeHtml(p.name)}" aria-pressed="true">👁</button>
				<button class="icon-btn" type="button" data-act="download" title="Download this part as GLB" aria-label="Download ${escapeHtml(p.name)}">⭳</button>
			</span>`;

		row.addEventListener('mouseenter', () => setHover(p.id));
		row.addEventListener('mouseleave', () => setHover(null));
		els.partsList.appendChild(row);
	}
	syncListSelection();
	syncListVisibility();
	updateSelectionLabel();
}

function syncListSelection() {
	for (const row of els.partsList.querySelectorAll('.part-row')) {
		row.classList.toggle('is-selected', row.dataset.partId === selectedId);
	}
}

function syncListVisibility() {
	for (const row of els.partsList.querySelectorAll('.part-row')) {
		const p = parts.find((x) => x.id === row.dataset.partId);
		if (!p) continue;
		row.classList.toggle('is-hidden-part', !p.visible);
		const eye = row.querySelector('[data-act="visibility"]');
		if (eye) {
			eye.textContent = p.visible ? '👁' : '🚫';
			eye.setAttribute('aria-pressed', String(p.visible));
		}
	}
}

// Per-part export — clone the part's geometry/material into a fresh scene and
// serialize it to a standalone .glb with the real GLTFExporter.
function downloadPart(id) {
	const p = parts.find((x) => x.id === id);
	if (!p) return;
	const exportScene = new THREE.Scene();
	for (const m of p.meshes) {
		const mat = m.material.clone();
		mat.emissive.setHex(p.baseEmissive); // strip any highlight before export
		if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 1;
		const clone = new THREE.Mesh(m.geometry, mat);
		clone.applyMatrix4(m.matrixWorld);
		clone.name = p.id;
		exportScene.add(clone);
	}
	const exporter = new GLTFExporter();
	exporter.parse(
		exportScene,
		(glb) => {
			const blob = new Blob([glb], { type: 'model/gltf-binary' });
			triggerDownload(blob, `${safeFileName(p.name)}.glb`);
		},
		(err) => showError(`Export failed: ${err?.message || err}`),
		{ binary: true },
	);
}

// ── job lifecycle ─────────────────────────────────────────────────────────────

function showState(name) {
	for (const [key, node] of Object.entries(els.states)) {
		if (node) node.classList.toggle('is-hidden', key !== name);
	}
	if (name === 'result') onResize();
}

function setBusy(busy) {
	els.segment.disabled = busy;
	els.segmentLabel.textContent = busy ? 'Segmenting…' : 'Segment';
}

function startElapsed() {
	const started = performance.now();
	stopElapsed();
	const tick = () => {
		els.loadingMeta.textContent = `Elapsed ${Math.floor((performance.now() - started) / 1000)}s`;
	};
	tick();
	elapsedTimer = window.setInterval(tick, 1000);
}

function stopElapsed() {
	if (elapsedTimer) {
		window.clearInterval(elapsedTimer);
		elapsedTimer = null;
	}
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function startJob(meshUrl) {
	const res = await fetch('/api/forge-segment', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			mesh_url: meshUrl,
			method: els.method.value,
			max_parts: Math.max(2, Math.min(64, Number(els.maxParts.value) || 24)),
		}),
	});
	const data = await res.json().catch(() => ({}));
	if (res.status === 503 || data.error === 'unconfigured') {
		const e = new Error(data.message || 'unconfigured');
		e.kind = 'unconfigured';
		throw e;
	}
	if (res.status === 429 || data.error === 'rate_limited') {
		const secs = Number(data.retry_after) > 0 ? Math.ceil(Number(data.retry_after)) : 10;
		throw new Error(`The segmenter is busy. Try again in about ${secs} seconds.`);
	}
	if (!res.ok) throw new Error(data.message || `The segmenter returned ${res.status}.`);
	return data;
}

async function pollUntilDone(jobId) {
	const deadline = performance.now() + MAX_POLL_MS;
	while (!pollAbort && performance.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);
		if (pollAbort) return null;
		const res = await fetch(`/api/forge-segment?job=${encodeURIComponent(jobId)}`);
		const data = await res.json().catch(() => ({}));
		if (data.error === 'unconfigured') {
			const e = new Error(data.message || 'unconfigured');
			e.kind = 'unconfigured';
			throw e;
		}
		if (data.status === 'done' && data.result_url) return data;
		if (data.status === 'failed') throw new Error(data.error || 'Segmentation failed.');
		if (data.status === 'running') els.loadingNote.textContent = 'Splitting at shells and concave creases…';
	}
	if (pollAbort) return null;
	throw new Error('Segmentation timed out. Try a simpler mesh or fewer parts.');
}

async function fetchManifest(url) {
	if (!url) return null;
	try {
		const res = await fetch(url);
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

async function run(meshUrl) {
	pollAbort = false;
	setBusy(true);
	els.loadingNote.textContent = 'Fetching and analysing the mesh…';
	startElapsed();
	showState('loading');

	try {
		const job = await startJob(meshUrl);
		const done = await pollUntilDone(job.job_id);
		if (pollAbort || !done) return;

		// Prefer the inline parts list; fall back to the manifest URL.
		let manifest = done.parts ? { parts: done.parts } : null;
		if (!manifest && done.manifest_url) manifest = await fetchManifest(done.manifest_url);

		initThree();
		showState('result');
		await loadSegmentedModel(done.result_url, manifest);
		renderPartsPanel();

		els.downloadGlb.href = done.result_url;
		els.downloadGlb.setAttribute('download', `${safeFileName('segmented')}.glb`);
		stopElapsed();
		document.dispatchEvent(
			new CustomEvent('tws:feature-done', {
				detail: { feature: 'segment', model: { glbUrl: done.result_url, label: 'Segmented model' } },
			}),
		);
	} catch (err) {
		if (pollAbort) return;
		stopElapsed();
		if (err.kind === 'unconfigured') {
			showState('unconfigured');
			return;
		}
		showError(err.message || 'Something went wrong while segmenting.');
	} finally {
		setBusy(false);
	}
}

function showError(message) {
	stopElapsed();
	els.errorMessage.textContent = message;
	showState('error');
}

// ── interactions ──────────────────────────────────────────────────────────────

function setPointer(e) {
	const rect = renderer.domElement.getBoundingClientRect();
	pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
	pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function pick() {
	raycaster.setFromCamera(pointer, camera);
	const visibleMeshes = parts.filter((p) => p.visible).flatMap((p) => p.meshes);
	const hits = raycaster.intersectObjects(visibleMeshes, false);
	return hits.length ? partIdFor(hits[0].object) : null;
}

let downX = 0;
let downY = 0;
function onPointerDown(e) {
	downX = e.clientX;
	downY = e.clientY;
}
function onPointerMove(e) {
	if (!parts.length) return;
	setPointer(e);
	setHover(pick());
}
function onPointerUp(e) {
	if (!parts.length) return;
	// Only the canvas selects — a release on a parts-panel button (or anywhere
	// else) must not clobber the current selection.
	if (e.target !== renderer.domElement) return;
	// Ignore drags (orbit) — only treat a near-stationary release as a click.
	if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
	setPointer(e);
	setSelected(pick());
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeFileName(s) {
	return String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48) || 'part';
}
function triggerDownload(blob, name) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── wiring ────────────────────────────────────────────────────────────────────

els.form.addEventListener('submit', (e) => {
	e.preventDefault();
	const url = els.meshUrl.value.trim();
	if (!url.startsWith('https://')) {
		els.meshUrl.focus();
		showError('Enter a public https URL to a GLB/OBJ/STL/PLY mesh.');
		return;
	}
	run(url);
});

els.cancel.addEventListener('click', () => {
	pollAbort = true;
	stopElapsed();
	setBusy(false);
	showState(parts.length ? 'result' : 'empty');
});

els.retry.addEventListener('click', () => {
	const url = els.meshUrl.value.trim();
	if (url.startsWith('https://')) run(url);
	else {
		showState('empty');
		els.meshUrl.focus();
	}
});

els.showAll.addEventListener('click', showAll);
els.resetView.addEventListener('click', () => modelRoot && frameModel());

// Delegated part-row actions.
els.partsList.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-act]');
	const row = e.target.closest('.part-row');
	if (!btn || !row) return;
	const id = row.dataset.partId;
	switch (btn.dataset.act) {
		case 'select':
			setSelected(id);
			break;
		case 'isolate':
			isolate(id);
			break;
		case 'visibility': {
			const p = parts.find((x) => x.id === id);
			if (p) {
				setPartVisible(id, !p.visible);
				syncListVisibility();
			}
			break;
		}
		case 'download':
			downloadPart(id);
			break;
	}
});

// pointerup is registered on window so a release outside the canvas still ends a drag.
window.addEventListener('pointerup', onPointerUp);

document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') {
		if (selectedId) setSelected(selectedId);
		else showAll();
	}
});

// Deep-link: /segment?mesh=<glb_url> (e.g. from the forge result panel).
(function handleQuery() {
	const params = new URLSearchParams(location.search);
	const mesh = params.get('mesh');
	if (mesh && mesh.startsWith('https://')) {
		els.meshUrl.value = mesh;
		run(mesh);
	}
})();
