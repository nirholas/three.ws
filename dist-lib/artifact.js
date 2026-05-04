// artifact.js — zero-dep three.ws viewer for Claude.ai Artifacts
// Self-contained ES module. No imports from this repo.
// Usage: <div data-agent-id="YOUR_ID"></div>
//        <script type="module" src="https://three.ws/artifact.js"></script>

import * as THREE from 'https://esm.sh/three@0.160.0';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const BASE = 'https://three.ws/';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CSS = `
.a3d-wrap{position:relative;overflow:hidden}
.a3d-wrap canvas{display:block;width:100%!important;height:100%!important}
.a3d-err{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font:14px/1.4 system-ui,sans-serif;color:#f87171;background:rgba(0,0,0,.55);
  padding:16px;text-align:center;border-radius:8px;pointer-events:none}
`;

function injectCSS() {
	if (document.getElementById('a3d-style')) return;
	const s = document.createElement('style');
	s.id = 'a3d-style';
	s.textContent = CSS;
	document.head.appendChild(s);
}

function showError(wrap, msg) {
	// remove any previous error
	wrap.querySelector('.a3d-err')?.remove();
	const d = document.createElement('div');
	d.className = 'a3d-err';
	d.textContent = msg;
	wrap.appendChild(d);
}

async function fetchAgent(agentId) {
	const r = await fetch(`${BASE}/api/agents/${agentId}`, { mode: 'cors', credentials: 'omit' });
	if (!r.ok) throw new Error(`Agent lookup failed (${r.status})`);
	const data = await r.json();
	const manifestUrl = data.agent?.manifest_url ?? data.manifest_url;
	if (!manifestUrl) throw new Error('No manifest_url in agent response');
	return manifestUrl;
}

async function fetchGLB(manifestUrl) {
	const r = await fetch(manifestUrl, { mode: 'cors', credentials: 'omit' });
	if (!r.ok) throw new Error(`Manifest fetch failed (${r.status})`);
	const manifest = await r.json();
	const base = manifest._baseURI ?? manifestUrl.replace(/[^/]*$/, '');
	const raw = manifest.body?.uri ?? manifest.avatar?.uri ?? manifest.glb_url ?? '';
	if (!raw) throw new Error('No GLB URI in manifest');
	return raw.match(/^https?:\/\//) ? raw : base + raw;
}

function buildScene(container) {
	const w = container.clientWidth || 400;
	const h = container.clientHeight || 400;

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.setSize(w, h);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.1;
	container.appendChild(renderer.domElement);

	const scene = new THREE.Scene();

	const camera = new THREE.PerspectiveCamera(42, w / h, 0.01, 100);
	camera.position.set(0, 1.35, 2.6);
	camera.lookAt(0, 1.0, 0);

	scene.add(new THREE.AmbientLight(0xffffff, 0.9));
	const key = new THREE.DirectionalLight(0xffffff, 1.3);
	key.position.set(2, 5, 3);
	scene.add(key);
	const fill = new THREE.DirectionalLight(0x99bbff, 0.4);
	fill.position.set(-3, 1, -2);
	scene.add(fill);

	// resize via ResizeObserver
	const ro = new ResizeObserver(() => {
		const nw = container.clientWidth;
		const nh = container.clientHeight;
		camera.aspect = nw / nh;
		camera.updateProjectionMatrix();
		renderer.setSize(nw, nh);
	});
	ro.observe(container);

	return { renderer, scene, camera };
}

function loadAvatar(glbUrl, scene, onError) {
	return new Promise((resolve) => {
		const loader = new GLTFLoader();
		loader.load(
			glbUrl,
			(gltf) => {
				const root = gltf.scene;

				// fit avatar into a normalized 1.8-unit tall box
				const box = new THREE.Box3().setFromObject(root);
				const size = box.getSize(new THREE.Vector3());
				const center = box.getCenter(new THREE.Vector3());
				const scale = 1.8 / Math.max(size.x, size.y, size.z);
				root.scale.setScalar(scale);
				root.position.copy(center.multiplyScalar(-scale));
				root.position.y += size.y * scale * 0.05;
				scene.add(root);

				let mixer = null;
				if (gltf.animations?.length) {
					mixer = new THREE.AnimationMixer(root);
					const clip =
						gltf.animations.find((a) => /idle|breathing|t.?pose/i.test(a.name)) ??
						gltf.animations[0];
					mixer.clipAction(clip).play();
				}

				resolve({ root, mixer, baseScale: root.scale.clone() });
			},
			undefined,
			(err) => {
				onError(`GLB load failed: ${err.message ?? err}`);
				resolve(null);
			}
		);
	});
}

function startLoop(renderer, scene, camera, avatar) {
	const clock = new THREE.Clock();
	let t = 0;

	function tick() {
		requestAnimationFrame(tick);
		const dt = clock.getDelta();
		t += dt;

		if (avatar) {
			avatar.mixer?.update(dt);
			if (!REDUCED) {
				// auto-rotate
				avatar.root.rotation.y += dt * 0.35;
				// breathing: gentle Y-scale pulse
				avatar.root.scale.y = avatar.baseScale.y * (1 + Math.sin(t * 1.15) * 0.007);
			}
		}

		renderer.render(scene, camera);
	}
	tick();
}

async function mount(container) {
	const agentId = container.dataset.agentId?.trim();
	if (!agentId) {
		showError(container, 'Missing data-agent-id attribute');
		return;
	}

	container.classList.add('a3d-wrap');

	let manifestUrl;
	try {
		manifestUrl = await fetchAgent(agentId);
	} catch (e) {
		showError(container, `Agent not found — ${e.message}`);
		return;
	}

	let glbUrl;
	try {
		glbUrl = await fetchGLB(manifestUrl);
	} catch (e) {
		showError(container, `Manifest error — ${e.message}`);
		return;
	}

	const { renderer, scene, camera } = buildScene(container);

	const avatar = await loadAvatar(glbUrl, scene, (msg) => showError(container, msg));

	startLoop(renderer, scene, camera, avatar);
}

document.addEventListener('DOMContentLoaded', () => {
	injectCSS();
	document.querySelectorAll('[data-agent-id]').forEach(mount);
});
