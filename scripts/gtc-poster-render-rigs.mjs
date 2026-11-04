#!/usr/bin/env node
// Render the figure frames for the GTC 2027 poster (docs/nvidia-gtc-2027).
// ---------------------------------------------------------------------------
// The poster's "one track, any rig" figure has to be real: the same
// Audio2Face-3D frame, applied by the shipping A2FPlayer to real avatar files
// from public/avatars, rendered with the same three.js the site uses. This
// script serves the repository root to a headless Chromium (software WebGL),
// loads each rig, samples the saved production track
// (docs/nvidia-gtc-2027/data/a2f-track-sample.json) at its peak jaw frame,
// and writes one PNG per rig and mapping path into docs/nvidia-gtc-2027/figures.
//
// Variants per rig:
//   rest          every morph at 0 (bind pose)
//   direct        A2FPlayer as shipped (ARKit names drive their morphs directly)
//   derived-only  the rig's ARKit jaw/mouth morphs hidden from the player, so
//                 only its viseme morphs remain and the derived path fires
//   both          direct AND derived applied together (the overshoot the
//                 suppression rule in a2f-player.js exists to prevent)
//
// Usage: node scripts/gtc-poster-render-rigs.mjs [--size 1200] [--t 5.3333]
// Needs the Playwright Chromium that `npm test` already uses.

import http from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pw from 'playwright';

const { chromium } = pw;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/nvidia-gtc-2027/figures');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SIZE = Number(opt('size', 1200));
const T = Number(opt('t', 5.3333));

const RIGS = [
	{ id: 'selfie', file: '/avatars/selfie-girl.glb', label: 'Selfie reconstruction, ARKit names', variants: ['rest', 'direct'] },
	{ id: 'default', file: '/avatars/default.glb', label: 'Web avatar, Oculus visemes plus ARKit', variants: ['rest', 'direct', 'derived-only', 'both'] },
	{ id: 'realistic', file: '/avatars/realistic-female.glb', label: 'Creator export, ARKit plus visemes', variants: ['rest', 'direct'] },
];

const MIME = {
	'.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
	'.glb': 'model/gltf-binary', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp',
};

// Repo root first (node_modules, src), then public/ (avatars, decoders).
function resolveFile(urlPath) {
	const clean = decodeURIComponent(urlPath.split('?')[0]);
	for (const base of [ROOT, path.join(ROOT, 'public')]) {
		const p = path.join(base, clean);
		if (p.startsWith(base) && existsSync(p) && statSync(p).isFile()) return p;
	}
	return null;
}

const PAGE = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<body style="margin:0;background:#fff"><canvas id="c"></canvas>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getDecoders } from '/src/viewer/internal.js';
import { A2FPlayer, deriveExpressionWeight } from '/src/voice/a2f-player.js';
import { ARKIT_GROUPS, OCULUS_TO_ARKIT, canonicalARKitName } from '/src/voice/arkit-blendshapes.js';

const SIZE = ${SIZE};
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0.6, 1.2, 2.0); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.8); fill.position.set(-1.2, 0.4, 1.2); scene.add(fill);
const camera = new THREE.PerspectiveCamera(18, 1, 0.01, 100);
const track = await (await fetch('/docs/nvidia-gtc-2027/data/a2f-track-sample.json')).json();
const MOUTH = new Set([...ARKIT_GROUPS.jaw, ...ARKIT_GROUPS.mouth]);
const ALL_ARKIT = Object.values(ARKIT_GROUPS).flat();

let root = null, meshes = [];
window.loadRig = async (url) => {
	if (root) { scene.remove(root); root = null; }
	const loader = new GLTFLoader();
	const { dracoLoader, ktx2Loader, meshoptDecoder } = await getDecoders();
	loader.setDRACOLoader(dracoLoader).setKTX2Loader(ktx2Loader.detectSupport(renderer)).setMeshoptDecoder(meshoptDecoder);
	const gltf = await loader.loadAsync(url);
	root = gltf.scene; scene.add(root);
	root.updateMatrixWorld(true);
	meshes = [];
	root.traverse((n) => { if (n.isMesh && n.morphTargetDictionary && n.morphTargetInfluences) meshes.push(n); });
	// Frame the head: the union of every morphed mesh (face, eyes, teeth) is the
	// head region; hair and body carry no morph targets on these rigs.
	const box = new THREE.Box3();
	for (const m of meshes) box.union(new THREE.Box3().setFromObject(m));
	const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
	const h = Math.max(size.x, size.y) * 1.08;
	const dist = (h / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
	camera.position.set(center.x, center.y, center.z + dist + size.z / 2);
	camera.lookAt(center.x, center.y, center.z);
	camera.updateProjectionMatrix();
	return { meshes: meshes.map((m) => ({ name: m.name, morphs: m.morphTargetInfluences.length })) };
};

function resetAll() { for (const m of meshes) m.morphTargetInfluences.fill(0); }

function maskedDict(dict) {
	const out = {};
	for (const [name, idx] of Object.entries(dict)) {
		const canon = canonicalARKitName(name);
		out[canon && MOUTH.has(canon) ? 'zz_' + name : name] = idx;
	}
	return out;
}

window.renderVariant = async (variant, t) => {
	resetAll();
	const info = { variant, t };
	if (variant !== 'rest') {
		const player = new A2FPlayer();
		const originals = new Map();
		if (variant === 'derived-only') {
			for (const m of meshes) { originals.set(m, m.morphTargetDictionary); m.morphTargetDictionary = maskedDict(m.morphTargetDictionary); }
		}
		player.attach(root);
		for (const [m, d] of originals) m.morphTargetDictionary = d;
		player.setTrack(track);
		player.update(t);
		const d = player.describe();
		info.direct = d.direct.length; info.expression = d.expression.length;
		info.jawOpen = player.currentWeight('jawOpen');
		if (variant === 'both') {
			// Re-apply the derived pass on top of the direct one: what a mesh
			// receives when both paths fire (the overshoot the player suppresses).
			const frame = {}; for (const n of ALL_ARKIT) frame[n] = player.currentWeight(n);
			let added = 0;
			for (const m of meshes) for (const [name, idx] of Object.entries(m.morphTargetDictionary)) {
				const comps = OCULUS_TO_ARKIT[name]; if (!comps || !Object.keys(comps).length) continue;
				const w = deriveExpressionWeight(frame, comps); m.morphTargetInfluences[idx] += w; if (w > 0.01) added++;
			}
			info.derivedAdded = added;
		}
	}
	renderer.render(scene, camera);
	await new Promise((r) => requestAnimationFrame(r));
	renderer.render(scene, camera);
	info.png = canvas.toDataURL('image/png');
	return info;
};
window.__ready = true;
</script></body>`;

const server = http.createServer((req, res) => {
	if (req.url === '/__page') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
	const file = resolveFile(req.url);
	if (!file) { res.writeHead(404); res.end('not found'); return; }
	res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
	createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/__page`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });

const manifest = { rendered_at: new Date().toISOString(), size_px: SIZE, track: 'data/a2f-track-sample.json', t_seconds: T, rigs: [] };
for (const rig of RIGS) {
	const loaded = await page.evaluate((url) => window.loadRig(url), rig.file);
	const entry = { ...rig, meshes: loaded.meshes, variants: [] };
	for (const variant of rig.variants) {
		const info = await page.evaluate(({ v, t }) => window.renderVariant(v, t), { v: variant, t: T });
		const file = `rig-${rig.id}-${variant}.png`;
		writeFileSync(path.join(OUT, file), Buffer.from(info.png.split(',')[1], 'base64'));
		delete info.png;
		entry.variants.push({ ...info, file });
		console.log(rig.id, variant, JSON.stringify({ direct: info.direct, expression: info.expression, jawOpen: info.jawOpen, derivedAdded: info.derivedAdded }));
	}
	manifest.rigs.push(entry);
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
await browser.close();
server.close();
console.log(`wrote ${manifest.rigs.reduce((n, r) => n + r.variants.length, 0)} frames to ${path.relative(ROOT, OUT)}`);
