// /pumpkin: carve a 3D pumpkin in the browser.
//
// geometry.js owns the pumpkin and the boolean cuts. This file owns the scene,
// input, undo history, candle, saving and export. Every cut is a real CSG
// subtraction; the page shows a busy indicator while one runs.

import {
	AmbientLight,
	CircleGeometry,
	Color,
	CylinderGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	PCFShadowMap,
	DirectionalLight,
	PerspectiveCamera,
	PointLight,
	Raycaster,
	Scene,
	SphereGeometry,
	TubeGeometry,
	CatmullRomCurve3,
	Vector2,
	Vector3,
	WebGLRenderer,
	SRGBColorSpace,
	DoubleSide,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
	SHAPES,
	SQUASH,
	bakeGeometry,
	carve,
	createCutterGeometry,
	createMaterials,
	createShell,
	cutterMatrix,
	surfaceNormal,
	triangleCount,
} from './geometry.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'twx_pumpkin_v1';
const MAX_HISTORY = 60;
const MAX_KNIFE_STAMPS = 70;

const TOOLS = [
	...SHAPES.map((s, i) => ({ id: s.id, label: s.label, hint: s.hint, kind: 'stamp', key: String(i + 1) })),
	{ id: 'knife', label: 'Knife', hint: 'Drag to cut a freehand line', kind: 'knife', key: '7' },
	{ id: 'turn', label: 'Turn', hint: 'Drag anywhere to rotate the view', kind: 'turn', key: '8' },
];

const TOOL_ICON = {
	round: '<circle cx="12" cy="12" r="9"/>',
	triangle: '<path d="M12 3 22 20H2z"/>',
	square: '<rect x="4" y="4" width="16" height="16" rx="1"/>',
	star: '<path d="m12 2 2.9 6.9 7.1.6-5.4 4.7 1.7 7.3L12 17.8 5.7 21.5l1.7-7.3L2 9.5l7.1-.6z"/>',
	moon: '<path d="M20 14.5A9 9 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
	bat: '<path d="M12 7l1.3-3 1 3.6C16 7 18.5 6 22 8c-1 1-1.5 2.4-1.2 4.2-1.2-.9-2.4-1-3.6-.4-.5 1-.4 2.2.2 3.4-1.4-.7-2.6-.7-3.4.2L12 20l-2-4.6c-.8-.9-2-.9-3.4-.2.6-1.2.7-2.4.2-3.4-1.2-.6-2.4-.5-3.6.4C2.9 10.4 2.4 9 2 8c3.5-2 6-1 7.700-.4l1-3.600z"/>',
	knife: '<path d="M4 20 20 4l-1.500 6L9 19.500z"/>',
	turn: '<path d="M12 4a8 8 0 1 0 7.700 10h-2.100A6 6 0 1 1 12 6v3l5-4-5-4z"/>',
};

const state = {
	tool: 'triangle',
	size: 0.4,
	roll: 0,
	candle: false,
	busy: false,
	history: [], // carved Brushes; history[0] is the uncarved shell
	cuts: [], // every cut applied, in order, for persistence
	steps: [], // steps[i] = how many cuts produced history[i + 1]
};

let renderer, composer, bloom, scene, camera, controls, ray;
let pumpkin, proxy, ghost, candleLight, flame, ambient, key, ground;
let materials, shell;
let stageEl, canvas;
let hover = null; // { point, normal } under the pointer on the surface
let gesture = null; // active pointer gesture
let knifeDots = [];
let rafId = 0;

/* ---------- small helpers ---------- */

function setBusy(text) {
	state.busy = !!text;
	$('pk-busy').hidden = !text;
	if (text) $('pk-busy-text').textContent = text;
	refreshButtons();
}

function nextFrame() {
	return new Promise((r) => requestAnimationFrame(() => r()));
}

function setHelp(text) {
	$('pk-help').textContent = text;
}

function refreshButtons() {
	const cuts = state.cuts.length;
	$('pk-undo').disabled = state.busy || state.history.length < 2;
	$('pk-reset').disabled = state.busy || cuts === 0;
	$('pk-png').disabled = !renderer;
	$('pk-glb').disabled = state.busy || !renderer;
	const tris = triangleCount(current());
	$('pk-stats').textContent = cuts === 0 ? 'No cuts yet' : `${cuts} cut${cuts === 1 ? '' : 's'}, ${tris.toLocaleString()} triangles`;
}

const current = () => state.history[state.history.length - 1];

/* ---------- scene ---------- */

function buildStem() {
	const curve = new CatmullRomCurve3([
		new Vector3(0, SQUASH * 0.9, 0),
		new Vector3(0.02, SQUASH * 1.05, 0.01),
		new Vector3(0.1, SQUASH * 1.2, 0.03),
		new Vector3(0.2, SQUASH * 1.27, 0.02),
	]);
	const mat = new MeshStandardMaterial({ color: 0x5b6b2a, roughness: 0.9 });
	const stem = new Mesh(new TubeGeometry(curve, 24, 0.075, 10, false), mat);
	const cap = new Mesh(new SphereGeometry(0.095, 12, 8), mat);
	cap.position.copy(curve.getPoint(1));
	cap.scale.y = 0.6;
	const g = new Group();
	g.add(stem, cap);
	g.traverse((o) => (o.castShadow = true));
	return g;
}

function initScene() {
	renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFShadowMap;

	scene = new Scene();
	scene.background = new Color(0x0b0414);

	camera = new PerspectiveCamera(40, 1, 0.1, 50);
	camera.position.set(0.6, 0.7, 4.1);

	controls = new OrbitControls(camera, canvas);
	controls.enablePan = false;
	controls.enableDamping = true;
	controls.minDistance = 2.2;
	controls.maxDistance = 7;
	controls.maxPolarAngle = Math.PI * 0.62;
	controls.target.set(0, 0.05, 0);

	ambient = new AmbientLight(0xcdb8ff, 0.7);
	scene.add(ambient);

	key = new DirectionalLight(0xfff0dc, 2.4);
	key.position.set(3, 4, 5);
	scene.add(key);

	ground = new Mesh(
		new CircleGeometry(6, 64),
		new MeshStandardMaterial({ color: 0x2a1a22, roughness: 0.95 }),
	);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -SQUASH * 1.02;
	ground.receiveShadow = true;
	scene.add(ground);

	materials = createMaterials();
	shell = createShell(materials);
	state.history = [shell];

	pumpkin = new Mesh(shell.geometry, shell.material);
	pumpkin.castShadow = true;
	scene.add(pumpkin);
	scene.add(buildStem());

	// Invisible ellipsoid standing in for the surface: cheap to raycast and its
	// normals stay stable even where cuts have opened the real mesh.
	proxy = new Mesh(new SphereGeometry(1, 48, 32), new MeshBasicMaterial({ side: DoubleSide }));
	proxy.scale.set(1, SQUASH, 1);
	proxy.visible = false;
	scene.add(proxy);

	candleLight = new PointLight(0xff9a3a, 0, 9, 1.6);
	candleLight.position.set(0, -SQUASH * 0.45, 0);
	candleLight.castShadow = true;
	candleLight.shadow.mapSize.set(1024, 1024);
	candleLight.shadow.bias = -0.002;
	candleLight.shadow.normalBias = 0.03;
	scene.add(candleLight);

	flame = new Mesh(
		new SphereGeometry(0.07, 12, 10),
		new MeshBasicMaterial({ color: 0xffd27a }),
	);
	flame.scale.set(0.8, 1.5, 0.8);
	flame.position.set(0, -SQUASH * 0.45, 0);
	flame.visible = false;
	scene.add(flame);
	const candleBody = new Mesh(
		new CylinderGeometry(0.06, 0.06, 0.3, 14),
		new MeshStandardMaterial({ color: 0xf3e9d2, roughness: 0.7 }),
	);
	candleBody.position.set(0, -SQUASH * 0.45 - 0.2, 0);
	scene.add(candleBody);

	ghost = new Mesh(
		createCutterGeometry('round'),
		new MeshBasicMaterial({ color: 0x1a0a02, transparent: true, opacity: 0.55, depthTest: false }),
	);
	ghost.renderOrder = 5;
	ghost.visible = false;
	scene.add(ghost);

	ray = new Raycaster();

	composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	bloom = new UnrealBloomPass(new Vector2(256, 256), 0, 0.7, 0.85);
	composer.addPass(bloom);
	composer.addPass(new OutputPass());

	resize();
	new ResizeObserver(resize).observe(stageEl);
}

function resize() {
	const w = Math.max(1, stageEl.clientWidth);
	const h = Math.max(1, stageEl.clientHeight);
	renderer.setSize(w, h, false);
	composer.setSize(w, h);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}

function setCandle(on) {
	state.candle = on;
	flame.visible = on;
	materials.flesh.emissiveIntensity = on ? 0.55 : 0;
	bloom.strength = on ? 0.55 : 0;
	ambient.intensity = on ? 0.18 : 0.7;
	key.intensity = on ? 0 : 2.4;
	const btn = $('pk-candle');
	btn.setAttribute('aria-pressed', String(on));
	btn.textContent = on ? 'Snuff the candle' : 'Light the candle';
}

function tick(t) {
	rafId = requestAnimationFrame(tick);
	if (state.candle) {
		const f = 0.82 + 0.1 * Math.sin(t * 0.017) + 0.08 * Math.sin(t * 0.043 + 1.3) + 0.04 * Math.sin(t * 0.11);
		candleLight.intensity = 3.2 * f;
		flame.scale.set(0.8, 1.35 + 0.35 * f, 0.8);
	} else {
		candleLight.intensity = 0;
	}
	controls.update();
	composer.render();
}

/* ---------- pointer input ---------- */

function pointerNdc(e) {
	const r = canvas.getBoundingClientRect();
	return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
}

function surfaceAt(e) {
	proxy.updateMatrixWorld(true);
	ray.setFromCamera(pointerNdc(e), camera);
	const hit = ray.intersectObject(proxy, false)[0];
	if (!hit) return null;
	const point = hit.point.clone();
	return { point, normal: surfaceNormal(point) };
}

function currentTool() {
	return TOOLS.find((t) => t.id === state.tool);
}

function updateGhost() {
	const tool = currentTool();
	if (!hover || tool.kind === 'turn' || state.busy) {
		ghost.visible = false;
		return;
	}
	const id = tool.kind === 'knife' ? 'round' : tool.id;
	if (ghost.userData.shape !== id) {
		ghost.geometry.dispose();
		ghost.geometry = createCutterGeometry(id);
		ghost.userData.shape = id;
	}
	const size = tool.kind === 'knife' ? state.size * 0.35 : state.size;
	const m = cutterMatrix({
		point: hover.point.clone().addScaledVector(hover.normal, 0.012),
		normal: hover.normal,
		size,
		roll: tool.kind === 'knife' ? 0 : (state.roll * Math.PI) / 180,
		depth: 0.02,
	});
	ghost.matrixAutoUpdate = false;
	ghost.matrix.copy(m);
	ghost.matrixWorldNeedsUpdate = true;
	ghost.visible = true;
}

function setCursor(kind) {
	canvas.dataset.cursor = kind;
}

function onPointerMove(e) {
	if (gesture?.mode === 'orbit') return;
	const tool = currentTool();
	hover = tool.kind === 'turn' ? null : surfaceAt(e);
	if (gesture?.mode === 'knife' && hover) addKnifePoint(hover);
	setCursor(tool.kind === 'turn' ? 'grab' : hover ? 'carve' : 'grab');
	updateGhost();
}

function onPointerDown(e) {
	if (e.button !== 0 && e.pointerType === 'mouse') return;
	if (state.busy) return;
	const tool = currentTool();
	const hit = tool.kind === 'turn' ? null : surfaceAt(e);
	if (!hit) {
		gesture = { mode: 'orbit' };
		controls.enabled = true;
		setCursor('grabbing');
		return;
	}
	// A carve gesture: keep OrbitControls out of it for this pointer.
	controls.enabled = false;
	canvas.setPointerCapture?.(e.pointerId);
	hover = hit;
	if (tool.kind === 'knife') {
		gesture = { mode: 'knife', points: [] };
		addKnifePoint(hit);
	} else {
		gesture = { mode: 'stamp', start: { x: e.clientX, y: e.clientY } };
	}
}

async function onPointerUp(e) {
	const g = gesture;
	gesture = null;
	controls.enabled = true;
	const tool = currentTool();
	setCursor(tool.kind === 'turn' ? 'grab' : hover ? 'carve' : 'grab');
	if (!g || g.mode === 'orbit') return;
	if (g.mode === 'stamp') {
		const moved = Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y);
		if (moved > 8 || !hover) return;
		await applyCuts([stampCut(hover)], 'Carving');
	} else if (g.mode === 'knife') {
		const cuts = g.points.map((p) => ({
			shape: 'round',
			point: p.point.toArray(),
			normal: p.normal.toArray(),
			size: state.size * 0.35,
			roll: 0,
		}));
		clearKnifeDots();
		await applyCuts(cuts, 'Cutting');
	}
}

function stampCut(h) {
	return {
		shape: state.tool,
		point: h.point.toArray(),
		normal: h.normal.toArray(),
		size: state.size,
		roll: (state.roll * Math.PI) / 180,
	};
}

function addKnifePoint(h) {
	const g = gesture;
	if (!g || g.mode !== 'knife') return;
	const r = state.size * 0.35;
	const last = g.points[g.points.length - 1];
	if (last && last.point.distanceTo(h.point) < r * 0.9) return;
	if (g.points.length >= MAX_KNIFE_STAMPS) return;
	g.points.push({ point: h.point.clone(), normal: h.normal.clone() });
	const dot = new Mesh(
		new SphereGeometry(r * 0.5, 10, 8),
		new MeshBasicMaterial({ color: 0x2a1204 }),
	);
	dot.position.copy(h.point).addScaledVector(h.normal, 0.01);
	scene.add(dot);
	knifeDots.push(dot);
}

function clearKnifeDots() {
	for (const d of knifeDots) {
		scene.remove(d);
		d.geometry.dispose();
		d.material.dispose();
	}
	knifeDots = [];
}

/* ---------- carving and history ---------- */

function inflate(cut) {
	return { ...cut, point: new Vector3(...cut.point), normal: new Vector3(...cut.normal) };
}

function showBrush(brush) {
	pumpkin.geometry = brush.geometry;
	pumpkin.material = brush.material;
}

// `grouped` makes the whole batch one undo step (a knife stroke); a restore
// from storage keeps every cut as its own step.
async function applyCuts(cuts, label, grouped = true) {
	if (!cuts.length || state.busy) return;
	setBusy(cuts.length > 1 ? `${label} 0/${cuts.length}` : label);
	ghost.visible = false;
	try {
		let brush = current();
		let done = 0;
		const produced = [];
		for (const cut of cuts) {
			await nextFrame();
			brush = carve(brush, inflate(cut), materials);
			produced.push(brush);
			done++;
			if (cuts.length > 1) $('pk-busy-text').textContent = `${label} ${done}/${cuts.length}`;
		}
		if (grouped) {
			for (const b of produced.slice(0, -1)) b.geometry.dispose();
			state.history.push(brush);
			state.steps.push(cuts.length);
		} else {
			for (const b of produced) {
				state.history.push(b);
				state.steps.push(1);
			}
		}
		state.cuts.push(...cuts);
		trimHistory();
		showBrush(current());
		persist();
		setHelp(helpText());
	} catch (err) {
		console.error('Carve failed', err);
		setHelp('That cut did not land. Try a slightly different spot or a smaller shape.');
	} finally {
		setBusy(null);
		updateGhost();
	}
}

function trimHistory() {
	while (state.history.length > MAX_HISTORY + 1) {
		// Dropping the oldest snapshot makes it the new "base"; undo cannot go further back,
		// but the cut log still replays from the pristine shell on reload.
		const old = state.history.splice(1, 1)[0];
		state.steps.shift();
		old.geometry.dispose();
	}
}

function undo() {
	if (state.busy || state.history.length < 2) return;
	const dropped = state.history.pop();
	state.cuts.length = Math.max(0, state.cuts.length - state.steps.pop());
	dropped.geometry.dispose();
	showBrush(current());
	persist();
	refreshButtons();
}

function startOver() {
	if (state.busy || !state.cuts.length) return;
	while (state.history.length > 1) state.history.pop().geometry.dispose();
	state.cuts = [];
	state.steps = [];
	showBrush(current());
	persist();
	setHelp(helpText());
}

function helpText() {
	const tool = currentTool();
	if (tool.kind === 'turn') return 'Drag to turn the pumpkin. Scroll or pinch to zoom.';
	if (tool.kind === 'knife') return 'Press on the pumpkin and drag to cut a freehand line. Release to carve it.';
	return `${tool.hint}. Click the pumpkin to cut. Drag on the background to turn it.`;
}

/* ---------- persistence ---------- */

function persist() {
	refreshButtons();
	try {
		const slim = state.cuts.slice(-300).map((c) => ({
			s: c.shape,
			p: c.point.map((n) => +n.toFixed(4)),
			n: c.normal.map((n) => +n.toFixed(4)),
			z: +c.size.toFixed(3),
			r: +c.roll.toFixed(3),
		}));
		localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, cuts: slim }));
	} catch {
		/* private mode or full storage: carving still works, it just is not remembered */
	}
}

function savedCuts() {
	try {
		const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
		if (!raw || raw.v !== 1 || !Array.isArray(raw.cuts)) return [];
		return raw.cuts
			.filter((c) => SHAPES.some((s) => s.id === c.s) && c.p?.length === 3 && c.n?.length === 3)
			.map((c) => ({ shape: c.s, point: c.p, normal: c.n, size: c.z, roll: c.r || 0 }));
	} catch {
		return [];
	}
}

/* ---------- save and export ---------- */

function download(blob, name) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function savePicture() {
	composer.render();
	canvas.toBlob((blob) => {
		if (!blob) return setHelp('Could not save the picture. Try again.');
		download(blob, 'my-three-ws-pumpkin.png');
	}, 'image/png');
}

async function downloadGlb() {
	setBusy('Building GLB');
	await nextFrame();
	try {
		const exportMesh = new Mesh(bakeGeometry(current()), [...(Array.isArray(current().material) ? current().material : [current().material])]);
		const group = new Group();
		group.name = 'Pumpkin';
		group.add(exportMesh);
		const stem = buildStem();
		group.add(stem);
		const exporter = new GLTFExporter();
		const result = await exporter.parseAsync(group, { binary: true });
		download(new Blob([result], { type: 'model/gltf-binary' }), 'my-three-ws-pumpkin.glb');
		exportMesh.geometry.dispose();
	} catch (err) {
		console.error('GLB export failed', err);
		setHelp('The GLB export failed. Try again after one more cut or a reset.');
	} finally {
		setBusy(null);
	}
}

/* ---------- ui ---------- */

function buildToolbar() {
	const host = $('pk-tools');
	for (const t of TOOLS) {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'pk-tool';
		b.dataset.tool = t.id;
		b.setAttribute('role', 'radio');
		b.setAttribute('aria-checked', String(t.id === state.tool));
		b.title = `${t.hint} (${t.key})`;
		b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TOOL_ICON[t.id]}</svg><span>${t.label}</span>`;
		b.addEventListener('click', () => selectTool(t.id));
		host.appendChild(b);
	}
}

function selectTool(id) {
	state.tool = id;
	for (const b of $('pk-tools').children) b.setAttribute('aria-checked', String(b.dataset.tool === id));
	hover = null;
	updateGhost();
	setCursor(currentTool().kind === 'turn' ? 'grab' : 'carve');
	setHelp(helpText());
}

function setSize(v) {
	state.size = Math.min(0.9, Math.max(0.1, v));
	$('pk-size').value = String(state.size);
	$('pk-size-out').textContent = state.size.toFixed(2);
	updateGhost();
}

function setRoll(deg) {
	let d = deg;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	state.roll = d;
	$('pk-roll').value = String(d);
	$('pk-roll-out').innerHTML = `${Math.round(d)}&deg;`;
	updateGhost();
}

function bindUi() {
	$('pk-size').addEventListener('input', (e) => setSize(+e.target.value));
	$('pk-roll').addEventListener('input', (e) => setRoll(+e.target.value));
	$('pk-candle').addEventListener('click', () => setCandle(!state.candle));
	$('pk-undo').addEventListener('click', undo);
	$('pk-reset').addEventListener('click', startOver);
	$('pk-png').addEventListener('click', savePicture);
	$('pk-glb').addEventListener('click', downloadGlb);

	canvas.addEventListener('pointermove', onPointerMove);
	// Capture phase on the stage so this runs before OrbitControls' own
	// pointerdown and can switch it off for a carving gesture.
	stageEl.addEventListener('pointerdown', (e) => {
		if (e.target === canvas) onPointerDown(e);
	}, true);
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointercancel', () => {
		gesture = null;
		clearKnifeDots();
		controls.enabled = true;
	});
	canvas.addEventListener('pointerleave', () => {
		if (gesture) return;
		hover = null;
		updateGhost();
	});

	window.addEventListener('keydown', (e) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			undo();
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const tool = TOOLS.find((t) => t.key === e.key);
		if (tool) return selectTool(tool.id);
		const k = e.key.toLowerCase();
		if (k === 'q') setRoll(state.roll - 15);
		else if (k === 'e') setRoll(state.roll + 15);
		else if (e.key === '[') setSize(state.size - 0.05);
		else if (e.key === ']') setSize(state.size + 0.05);
		else if (k === 'c') setCandle(!state.candle);
	});
}

/* ---------- boot ---------- */

function showError(err) {
	$('pk-loading').hidden = true;
	$('pk-error').hidden = false;
	$('pk-error-text').textContent =
		err?.message && /webgl/i.test(err.message)
			? 'WebGL is turned off or unsupported in this browser. Enable hardware acceleration, or try a recent Chrome, Edge, Firefox or Safari.'
			: `Something went wrong while starting: ${err?.message || 'unknown error'}.`;
}

async function boot() {
	stageEl = $('pk-stage');
	canvas = $('pk-canvas');
	try {
		buildToolbar();
		bindUi();
		await nextFrame();
		initScene();
		showBrush(current());
		setCursor('carve');
		setHelp(helpText());
		refreshButtons();
		cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(tick);
		$('pk-loading').hidden = true;

		const restore = savedCuts();
		if (restore.length) {
			$('pk-loading-text').textContent = 'Restoring your pumpkin';
			await applyCuts(restore, 'Restoring', false);
		}
	} catch (err) {
		console.error('Pumpkin failed to start', err);
		showError(err);
	}
}

$('pk-error-retry').addEventListener('click', () => {
	$('pk-error').hidden = true;
	$('pk-loading').hidden = false;
	boot();
});

boot();
