/**
 * /readme-3d: convert a model URL into a GitHub-renderable ```stl block.
 *
 * Calls POST /api/readme-3d through the shared client (readme-3d-copy.js) and
 * previews the returned STL with three.js, so what the visitor sees here is
 * the exact geometry GitHub will render.
 */

import './readme-3d.css';
import { fetchReadme3d } from './readme-3d-copy.js';

const $ = (id) => document.getElementById(id);
const form = $('r3-form');
const urlInput = $('r3-url');
const budgetSelect = $('r3-budget');
const goBtn = $('r3-go');
const statusEl = $('r3-status');
const resultEl = $('r3-result');
const statsEl = $('r3-stats');
const mdArea = $('r3-md');
const copyBtn = $('r3-copy');
const downloadBtn = $('r3-download');
const canvas = $('r3-canvas');

const TEXTAREA_PREVIEW_CHARS = 1800;
const DEFAULT_URL = 'https://three.ws/avatars/fox.glb';

let current = null;
let preview = null;

function setStatus(html, isError = false) {
	statusEl.innerHTML = html;
	statusEl.classList.toggle('is-error', isError);
}

function stat(label, value) {
	return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function renderStats(r) {
	const kb = (r.bytes / 1024).toFixed(0);
	statsEl.innerHTML =
		stat('Facets', `${r.facets.toLocaleString()}`) +
		stat('Source facets', r.sourceFacets.toLocaleString()) +
		stat('Block size', `${kb} KB ${r.fitsGithub ? '✓' : '(over GitHub limit)'}`);
}

async function ensurePreview() {
	if (preview) return preview;
	const [THREE, { STLLoader }, { OrbitControls }] = await Promise.all([
		import('three'),
		import('three/addons/loaders/STLLoader.js'),
		import('three/addons/controls/OrbitControls.js'),
	]);
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 2000);
	scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
	const key = new THREE.DirectionalLight(0xffffff, 2.2);
	key.position.set(120, -160, 200);
	scene.add(key);
	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
	controls.autoRotateSpeed = 1.5;
	preview = { THREE, STLLoader, renderer, scene, camera, controls, mesh: null };

	const resize = () => {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	new ResizeObserver(resize).observe(canvas);
	resize();
	renderer.setAnimationLoop(() => {
		controls.update();
		renderer.render(scene, camera);
	});
	return preview;
}

async function showPreview(markdown) {
	const stl = markdown.replace(/^[\s\S]*?```stl\n/, '').replace(/\n```[\s\S]*$/, '');
	const p = await ensurePreview();
	const geometry = new p.STLLoader().parse(stl);
	geometry.computeVertexNormals();
	if (p.mesh) {
		p.scene.remove(p.mesh);
		p.mesh.geometry.dispose();
	} else {
		p.material = new p.THREE.MeshStandardMaterial({ color: 0x9fb4ff, roughness: 0.55, metalness: 0.1 });
	}
	p.mesh = new p.THREE.Mesh(geometry, p.material);
	p.mesh.rotation.x = -Math.PI / 2; // STL is Z-up, three.js is Y-up
	p.scene.add(p.mesh);
	geometry.computeBoundingBox();
	const size = geometry.boundingBox.getSize(new p.THREE.Vector3());
	const radius = Math.max(size.x, size.y, size.z) * 1.4 || 100;
	p.camera.position.set(radius * 0.9, radius * 0.5, radius * 1.4);
	p.controls.target.set(0, size.z / 2, 0);
	p.controls.update();
}

async function convert(modelUrl) {
	goBtn.disabled = true;
	resultEl.hidden = true;
	setStatus('<span class="r3-skeleton"></span> Fetching and simplifying the model…');
	try {
		const result = await fetchReadme3d(modelUrl, { name: 'model', budget: Number(budgetSelect.value) });
		current = result;
		renderStats(result);
		const text = result.markdown;
		mdArea.value =
			text.length > TEXTAREA_PREVIEW_CHARS ? `${text.slice(0, TEXTAREA_PREVIEW_CHARS)}\n…` : text;
		resultEl.hidden = false;
		await showPreview(text);
		setStatus(
			result.fitsGithub
				? 'Ready. Paste the block into a README, issue or pull request on GitHub.'
				: 'This block is over GitHub\'s 512 KB markdown limit. Pick a smaller size budget.',
			!result.fitsGithub,
		);
	} catch (err) {
		current = null;
		const why = err?.message || 'the conversion failed';
		setStatus(`Could not convert this model: ${why}.`, true);
	} finally {
		goBtn.disabled = false;
	}
}

form.addEventListener('submit', (e) => {
	e.preventDefault();
	const value = urlInput.value.trim();
	if (!value) {
		setStatus('Enter a public https URL to a .glb, .gltf, .obj or .stl file.', true);
		urlInput.focus();
		return;
	}
	convert(value);
});

document.querySelectorAll('.r3-chip').forEach((chip) => {
	chip.addEventListener('click', () => {
		urlInput.value = chip.dataset.url;
		convert(chip.dataset.url);
	});
});

copyBtn.addEventListener('click', async () => {
	if (!current) return;
	try {
		await navigator.clipboard.writeText(current.markdown);
		setStatus('Copied. Paste it into your README.');
	} catch {
		setStatus('Your browser blocked the clipboard. Use Download .md instead.', true);
	}
});

downloadBtn.addEventListener('click', () => {
	if (!current) return;
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([current.markdown], { type: 'text/markdown' }));
	a.download = 'model-readme-3d.md';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
});

const preset = new URLSearchParams(location.search).get('url');
urlInput.value = preset || DEFAULT_URL;
convert(urlInput.value);
