// Source for the inlined artifact viewer bundle.
//
// Bundled to a single self-contained IIFE by scripts/build-artifact-viewer.mjs.
// The bundle is then inlined verbatim into the HTML returned by /api/artifact.
//
// Why a separate viewer (vs. agent-3d)?
// Claude.ai's artifact sandbox CSP forbids fetch() to any host except
// cdn.jsdelivr.net/pyodide/. The agent-3d bundle calls back to three.ws/api
// to resolve agents and pulls GLBs from R2 — both blocked. This viewer takes
// every byte from inline data: GLB ArrayBuffer parsed directly via
// GLTFLoader.parse(), persona embedded in <script type=application/json>.
// Scene, lights, camera, animation loop are minimal but production-quality.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const PALETTES = {
	dark: { bg: '#0a0e27', amb: 0xffffff, key: 0xffffff, fill: 0x99bbff },
	light: { bg: '#f5f5f7', amb: 0xffffff, key: 0xffffff, fill: 0xffe8c8 },
};

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function readConfig() {
	const node = document.getElementById('artifact-config');
	if (!node) throw new Error('artifact-config script tag not found');
	const cfg = JSON.parse(node.textContent);
	if (!cfg.glb) throw new Error('artifact-config.glb missing');
	return cfg;
}

function base64ToArrayBuffer(b64) {
	const bin = atob(b64);
	const len = bin.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
	return bytes.buffer;
}

function pickPalette(cfg) {
	const base = PALETTES[cfg.theme === 'light' ? 'light' : 'dark'];
	const bg = cfg.bg && /^#?[0-9a-f]{6}$/i.test(cfg.bg) ? `#${cfg.bg.replace(/^#/, '')}` : base.bg;
	return { ...base, bg };
}

function buildScene(host, palette) {
	const w = host.clientWidth || 600;
	const h = host.clientHeight || 600;

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setSize(w, h, false);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.domElement.style.display = 'block';
	renderer.domElement.style.width = '100%';
	renderer.domElement.style.height = '100%';
	host.appendChild(renderer.domElement);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(palette.bg);

	const camera = new THREE.PerspectiveCamera(38, w / h, 0.05, 50);
	camera.position.set(0, 1.4, 2.7);
	camera.lookAt(0, 1.05, 0);

	scene.add(new THREE.AmbientLight(palette.amb, 0.85));
	const key = new THREE.DirectionalLight(palette.key, 1.25);
	key.position.set(2.5, 5, 3);
	scene.add(key);
	const fill = new THREE.DirectionalLight(palette.fill, 0.45);
	fill.position.set(-3, 1.5, -2);
	scene.add(fill);

	const ro = new ResizeObserver(() => {
		const nw = host.clientWidth;
		const nh = host.clientHeight;
		if (!nw || !nh) return;
		camera.aspect = nw / nh;
		camera.updateProjectionMatrix();
		renderer.setSize(nw, nh, false);
	});
	ro.observe(host);

	return { renderer, scene, camera };
}

function fitAvatar(root) {
	const box = new THREE.Box3().setFromObject(root);
	const size = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());
	const targetHeight = 1.8;
	const scale = targetHeight / Math.max(size.y, 0.001);
	root.scale.setScalar(scale);
	root.position.copy(center.multiplyScalar(-scale));
	root.position.y += (size.y * scale) / 2;
}

function pickIdleClip(animations, requested) {
	if (!animations?.length) return null;
	if (requested) {
		const named = animations.find((a) => a.name === requested);
		if (named) return named;
	}
	return (
		animations.find((a) => /idle|breathing|stand/i.test(a.name)) || animations[0]
	);
}

function showError(host, msg) {
	host.querySelector('.artifact-error')?.remove();
	const div = document.createElement('div');
	div.className = 'artifact-error';
	div.textContent = msg;
	Object.assign(div.style, {
		position: 'absolute',
		inset: '0',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		background: 'rgba(0,0,0,0.65)',
		color: '#f87171',
		font: '14px/1.4 system-ui, sans-serif',
		padding: '24px',
		textAlign: 'center',
	});
	host.appendChild(div);
}

function renderNamePlate(host, cfg, palette) {
	if (!cfg.name) return;
	const plate = document.createElement('div');
	plate.className = 'artifact-name-plate';
	plate.textContent = cfg.name;
	const isLight = palette.bg && /^#[ef]/i.test(palette.bg);
	Object.assign(plate.style, {
		position: 'absolute',
		left: '16px',
		bottom: '16px',
		padding: '6px 12px',
		borderRadius: '999px',
		font: '500 13px/1 system-ui, -apple-system, sans-serif',
		letterSpacing: '0.01em',
		color: isLight ? '#111' : '#fff',
		background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)',
		backdropFilter: 'blur(8px)',
		pointerEvents: 'none',
		userSelect: 'none',
	});
	host.appendChild(plate);
}

async function start() {
	const host = document.getElementById('artifact-stage');
	if (!host) throw new Error('artifact-stage element not found');
	host.style.position = 'relative';

	const cfg = readConfig();
	const palette = pickPalette(cfg);
	host.style.background = palette.bg;

	const { renderer, scene, camera } = buildScene(host, palette);

	let glbBuffer;
	try {
		glbBuffer = base64ToArrayBuffer(cfg.glb);
	} catch (err) {
		showError(host, 'Failed to decode embedded model: ' + err.message);
		return;
	}

	const loader = new GLTFLoader();
	loader.parse(
		glbBuffer,
		'',
		(gltf) => {
			const root = gltf.scene || gltf.scenes?.[0];
			if (!root) {
				showError(host, 'Embedded GLB has no scene');
				return;
			}
			fitAvatar(root);
			scene.add(root);

			let mixer = null;
			const clip = pickIdleClip(gltf.animations, cfg.idle);
			if (clip) {
				mixer = new THREE.AnimationMixer(root);
				mixer.clipAction(clip).play();
			}

			renderNamePlate(host, cfg, palette);

			const clock = new THREE.Clock();
			let t = 0;
			const baseScale = root.scale.clone();
			function tick() {
				requestAnimationFrame(tick);
				const dt = clock.getDelta();
				t += dt;
				if (mixer) mixer.update(dt);
				if (!REDUCED) {
					root.rotation.y += dt * 0.32;
					root.scale.y = baseScale.y * (1 + Math.sin(t * 1.1) * 0.006);
				}
				renderer.render(scene, camera);
			}
			tick();
		},
		(err) => {
			showError(host, 'Model parse failed: ' + (err?.message || err));
		},
	);
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		start().catch((err) => console.error('[artifact-viewer]', err));
	});
} else {
	start().catch((err) => console.error('[artifact-viewer]', err));
}
