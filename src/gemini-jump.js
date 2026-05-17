/**
 * Gemini-jump demo
 *
 * A faithful port of the viral tactile UI concept (Gemini sketch):
 * the avatar leaps onto a HEAVY 3D button mesh sitting next to it in the
 * Three.js scene. Volume-preserving squish, elastic recoil, shockwave ring,
 * cinematic spotlight. Real `cz.glb` + real `jump` / `idle` / `celebrate`
 * clips via Act2Viewer + the project's animation manifest.
 *
 * Loaded from /public/demos/gemini-jump.html as an ES module so Vite resolves
 * the `three` and `gsap` imports.
 */
import {
	CylinderGeometry,
	TorusGeometry,
	MeshStandardMaterial,
	MeshBasicMaterial,
	Mesh,
	SpotLight,
	Vector3,
} from 'three';
import { gsap } from 'https://esm.sh/gsap@3.12.5';
import { Act2Viewer } from './home-act2-viewer.js';

const JUMP_CLIP_MS = 1867;
const CELEBRATE_MS = 1867;
const ARC_PEAK_UNITS = 1.8;
const BUTTON_OFFSET_X = -1.6;

const canvas = document.getElementById('stage-canvas');
const veil = document.getElementById('loading-veil');
const statusEl = document.getElementById('status');
const triggerBtn = document.getElementById('trigger-btn');

let viewer = null;
let buttonMesh = null;
let shockwave = null;
let jumping = false;

const avatarHome = new Vector3();
const cameraHome = new Vector3();

function setStatus(t) {
	if (statusEl) statusEl.textContent = t;
}

function smoothstep(t) {
	return t * t * (3 - 2 * t);
}

function buildSceneFurniture() {
	const scene = viewer.scene;

	const buttonGeo = new CylinderGeometry(0.45, 0.45, 0.18, 64);
	const buttonMat = new MeshStandardMaterial({
		color: 0xd6ff3d,
		metalness: 0.3,
		roughness: 0.18,
		emissive: 0x1a2900,
		emissiveIntensity: 0.6,
	});
	buttonMesh = new Mesh(buttonGeo, buttonMat);
	buttonMesh.position.set(BUTTON_OFFSET_X, 0.09, 0);
	scene.add(buttonMesh);

	const ringGeo = new TorusGeometry(0.5, 0.025, 16, 96);
	const ringMat = new MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0,
	});
	shockwave = new Mesh(ringGeo, ringMat);
	shockwave.rotation.x = Math.PI / 2;
	shockwave.position.set(BUTTON_OFFSET_X, 0.02, 0);
	scene.add(shockwave);

	const spot = new SpotLight(0xffffff, 6, 12, 0.55, 0.85, 1.4);
	spot.position.set(BUTTON_OFFSET_X, 4, 1.2);
	spot.target = buttonMesh;
	scene.add(spot);
	scene.add(spot.target);
}

function animateModelX(targetX, durationMs) {
	const startX = viewer.model.position.x;
	const startCamX = viewer.camera.position.x;
	const t0 = performance.now();
	return new Promise((resolve) => {
		(function step(now) {
			const p = Math.min((now - t0) / durationMs, 1);
			const ease = smoothstep(p);
			if (viewer.model) {
				viewer.model.position.x = startX + (targetX - startX) * ease;
				viewer.camera.position.x = startCamX + (targetX - startX) * ease;
				viewer.camera.lookAt(
					viewer.model.position.x,
					viewer._modelFocusY,
					0,
				);
			}
			if (p < 1) requestAnimationFrame(step);
			else resolve();
		})(performance.now());
	});
}

function animateArc(durationMs, onImpact) {
	const t0 = performance.now();
	const baseY = avatarHome.y;
	let impactFired = false;
	return new Promise((resolve) => {
		(function step(now) {
			const p = Math.min((now - t0) / durationMs, 1);
			if (viewer.model) {
				viewer.model.position.y =
					baseY + ARC_PEAK_UNITS * 4 * p * (1 - p);
			}
			if (!impactFired && p >= 0.9) {
				impactFired = true;
				onImpact();
			}
			if (p < 1) requestAnimationFrame(step);
			else {
				if (viewer.model) viewer.model.position.y = baseY;
				resolve();
			}
		})(performance.now());
	});
}

function fireImpact() {
	gsap.to(buttonMesh.scale, {
		y: 0.3,
		x: 1.8,
		z: 1.8,
		duration: 0.08,
		ease: 'power4.out',
		onComplete: () => {
			gsap.to(buttonMesh.scale, {
				y: 1,
				x: 1,
				z: 1,
				duration: 1.5,
				ease: 'elastic.out(1.2, 0.15)',
			});
		},
	});

	shockwave.scale.set(1, 1, 1);
	gsap.to(shockwave.scale, {
		x: 3.5,
		y: 3.5,
		z: 3.5,
		duration: 0.6,
		ease: 'power2.out',
	});
	gsap.fromTo(
		shockwave.material,
		{ opacity: 0.85 },
		{ opacity: 0, duration: 0.6, ease: 'power2.out' },
	);
}

async function doJump() {
	if (jumping || !viewer || !viewer.model) return;
	jumping = true;
	setStatus('jump');

	viewer._externalOrbit = true;
	viewer.playClip('jump').catch(() => {});

	await Promise.all([
		animateModelX(BUTTON_OFFSET_X, JUMP_CLIP_MS * 0.92),
		animateArc(JUMP_CLIP_MS, fireImpact),
	]);

	setStatus('celebrate');
	viewer.playClip('celebrate').catch(() => {});

	setTimeout(async () => {
		setStatus('returning');
		await animateModelX(avatarHome.x, 700);
		viewer.camera.position.copy(cameraHome);
		viewer.camera.lookAt(avatarHome.x, viewer._modelFocusY, 0);
		viewer.playClip('idle').catch(() => {});
		setStatus('idle');
		jumping = false;
	}, CELEBRATE_MS);
}

triggerBtn.addEventListener('click', (e) => {
	e.preventDefault();
	doJump();
});

viewer = new Act2Viewer(canvas, { fov: 22 });
viewer
	.loadModel('/avatars/cz.glb', { autoPlay: false })
	.then(async () => {
		viewer._externalOrbit = true;
		avatarHome.copy(viewer.model.position);
		cameraHome.copy(viewer.camera.position);

		buildSceneFurniture();

		try {
			await viewer.playClip('falling');
		} catch (_) {}

		veil.classList.add('hidden');
		setStatus('idle');

		setTimeout(() => {
			viewer.playClip('idle').catch(() => {});
		}, 2200);
	})
	.catch((err) => {
		setStatus('error: ' + err.message);
		console.error('[gemini-jump]', err);
	});
