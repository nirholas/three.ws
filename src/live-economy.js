/**
 * /live — Agent Economy World
 *
 * A Three.js scene where two AI agents live side-by-side in a dark virtual
 * world. Agent B (Trader) pays Agent A (Oracle) for live Solana market data.
 * The purchased data appears on the central TV screen. Real on-chain txs.
 */
import * as THREE from 'three';
import { applyStudioLook, createRenderLoop } from './render/index.js';

// ── Scene constants ───────────────────────────────────────────────────────
const W   = () => window.innerWidth;
const H   = () => window.innerHeight;
const FOV = 60;

// 3D positions (x, y, z). Camera looks slightly down at the stage.
const CAM_POS    = new THREE.Vector3(0, 6, 18);
const CAM_TARGET = new THREE.Vector3(0, 1.5, 0);
const AGENT_A_POS = new THREE.Vector3(-7, 0, 0);   // Oracle (white, right in world space)
const AGENT_B_POS = new THREE.Vector3( 7, 0, 0);   // Trader  (blue,   left)
const TV_POS      = new THREE.Vector3( 0, 4.2, -6);

// ── Renderer ──────────────────────────────────────────────────────────────
const canvas   = document.getElementById('world-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setSize(W(), H());
renderer.toneMapping      = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x04050b);
scene.fog        = new THREE.FogExp2(0x04050b, 0.045);
// Low intensity: the stage is a deliberately dark neon set, so the environment only
// adds gloss to the floor, bezels and pedestals instead of lifting the palette.
applyStudioLook(renderer, scene, { environmentIntensity: 0.25 });

const camera = new THREE.PerspectiveCamera(FOV, W() / H(), 0.1, 200);
camera.position.copy(CAM_POS);
camera.lookAt(CAM_TARGET);

window.addEventListener('resize', () => {
	camera.aspect = W() / H();
	camera.updateProjectionMatrix();
	renderer.setSize(W(), H());
	updateOverlayPositions();
});

// ── Lights ────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x0a0c18, 1.0));

const sunLight = new THREE.DirectionalLight(0xc0cfff, 0.6);
sunLight.position.set(0, 20, 10);
scene.add(sunLight);

// Oracle point light (white)
const oracleLight = new THREE.PointLight(0xffffff, 2.5, 18);
oracleLight.position.set(AGENT_A_POS.x, 4, AGENT_A_POS.z + 2);
scene.add(oracleLight);

// Trader point light (blue)
const traderLight = new THREE.PointLight(0x4e8cff, 3.5, 18);
traderLight.position.set(AGENT_B_POS.x, 4, AGENT_B_POS.z + 2);
scene.add(traderLight);

// TV backlight
const tvLight = new THREE.PointLight(0x78a9ff, 2.0, 14);
tvLight.position.set(TV_POS.x, TV_POS.y, TV_POS.z + 3);
scene.add(tvLight);

// ── Floor grid ────────────────────────────────────────────────────────────
const gridHelper = new THREE.GridHelper(60, 40, 0x0f1428, 0x0f1428);
scene.add(gridHelper);

const floorGeo  = new THREE.PlaneGeometry(60, 60);
const floorMat  = new THREE.MeshStandardMaterial({
	color: 0x060810,
	roughness: 0.95,
	metalness: 0.05,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.01;
scene.add(floor);

// ── Agent platforms ───────────────────────────────────────────────────────
function makePedestal(position, color) {
	const group = new THREE.Group();

	// Ring glow (torus)
	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(1.6, 0.06, 8, 48),
		new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.0 })
	);
	ring.rotation.x = Math.PI / 2;
	ring.position.y = 0.05;
	group.add(ring);

	// Disc platform
	const disc = new THREE.Mesh(
		new THREE.CylinderGeometry(1.55, 1.55, 0.06, 32),
		new THREE.MeshStandardMaterial({ color: 0x0c0e1a, roughness: 0.8, metalness: 0.2 })
	);
	disc.position.y = 0.03;
	group.add(disc);

	group.position.copy(position);
	scene.add(group);
	return { group, ring };
}

const pedestalA = makePedestal(AGENT_A_POS, 0xffffff);  // Oracle white
const pedestalB = makePedestal(AGENT_B_POS, 0x4e8cff);  // Trader blue

// ── TV Screen ─────────────────────────────────────────────────────────────
const TV_W = 640;
const TV_H = 360;
const tvCanvas = document.createElement('canvas');
tvCanvas.width  = TV_W;
tvCanvas.height = TV_H;
const tvCtx = tvCanvas.getContext('2d');

const tvTex = new THREE.CanvasTexture(tvCanvas);
const tvGeo = new THREE.PlaneGeometry(8, 4.5);
const tvMat = new THREE.MeshBasicMaterial({ map: tvTex, side: THREE.FrontSide });
const tvMesh = new THREE.Mesh(tvGeo, tvMat);
tvMesh.position.copy(TV_POS);
scene.add(tvMesh);

// TV bezel frame
const bezelMat = new THREE.MeshStandardMaterial({ color: 0x141820, roughness: 0.9, metalness: 0.4 });
const bezelGeo = new THREE.BoxGeometry(8.4, 4.9, 0.12);
const bezel    = new THREE.Mesh(bezelGeo, bezelMat);
bezel.position.set(TV_POS.x, TV_POS.y, TV_POS.z - 0.07);
scene.add(bezel);

// TV stand
const standMat = new THREE.MeshStandardMaterial({ color: 0x0e1018, roughness: 0.9, metalness: 0.5 });
const standGeo = new THREE.BoxGeometry(0.3, TV_POS.y - 0.05, 0.3);
const stand    = new THREE.Mesh(standGeo, standMat);
stand.position.set(TV_POS.x, TV_POS.y / 2, TV_POS.z - 0.07);
scene.add(stand);

// ── TV rendering ──────────────────────────────────────────────────────────
function drawTvIdle() {
	tvCtx.fillStyle = '#060810';
	tvCtx.fillRect(0, 0, TV_W, TV_H);

	// Grid lines
	tvCtx.strokeStyle = 'rgba(78,140,255,0.07)';
	tvCtx.lineWidth   = 1;
	for (let x = 0; x < TV_W; x += 32) {
		tvCtx.beginPath(); tvCtx.moveTo(x, 0); tvCtx.lineTo(x, TV_H); tvCtx.stroke();
	}
	for (let y = 0; y < TV_H; y += 32) {
		tvCtx.beginPath(); tvCtx.moveTo(0, y); tvCtx.lineTo(TV_W, y); tvCtx.stroke();
	}

	// Idle text
	tvCtx.fillStyle = 'rgba(107,110,138,0.6)';
	tvCtx.font      = 'bold 15px -apple-system, system-ui, sans-serif';
	tvCtx.textAlign = 'center';
	tvCtx.fillText('AGENT ORACLE — MARKET INTELLIGENCE', TV_W / 2, TV_H / 2 - 12);
	tvCtx.font      = '12px -apple-system, system-ui, sans-serif';
	tvCtx.fillText('Awaiting trade request…', TV_W / 2, TV_H / 2 + 14);
	tvTex.needsUpdate = true;
}

export function drawTvData(markets) {
	tvCtx.fillStyle = '#060810';
	tvCtx.fillRect(0, 0, TV_W, TV_H);

	// Header bar
	tvCtx.fillStyle = 'rgba(255,255,255,0.07)';
	tvCtx.fillRect(0, 0, TV_W, 44);
	tvCtx.fillStyle = '#888888';
	tvCtx.font      = 'bold 13px -apple-system, system-ui, sans-serif';
	tvCtx.textAlign = 'left';
	tvCtx.fillText('● ORACLE INTEL FEED  ·  SOLANA LIVE', 16, 28);
	tvCtx.fillStyle = 'rgba(107,110,138,0.8)';
	tvCtx.font      = '11px -apple-system, system-ui, sans-serif';
	tvCtx.textAlign = 'right';
	tvCtx.fillText(new Date().toUTCString().replace(/:\d\d GMT/, ' UTC'), TV_W - 16, 28);

	if (!markets?.length) {
		tvCtx.fillStyle = '#6b6e8a';
		tvCtx.textAlign = 'center';
		tvCtx.font      = '13px -apple-system, system-ui, sans-serif';
		tvCtx.fillText('No data', TV_W / 2, TV_H / 2);
		tvTex.needsUpdate = true;
		return;
	}

	const rowH = (TV_H - 60) / Math.min(markets.length, 6);
	markets.slice(0, 6).forEach((m, i) => {
		const y = 54 + i * rowH;
		const isEven = i % 2 === 0;

		tvCtx.fillStyle = isEven ? 'rgba(255,255,255,0.025)' : 'transparent';
		tvCtx.fillRect(0, y, TV_W, rowH);

		const change = m.change24h;
		const upDown = change == null ? '—' : change >= 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;
		const color  = change == null ? '#6b6e8a' : change >= 0 ? '#42be65' : '#fa4d56';

		// Name
		tvCtx.fillStyle = '#e8eaf4';
		tvCtx.textAlign = 'left';
		tvCtx.font      = `bold 12px -apple-system, system-ui, sans-serif`;
		const name = m.name || '—';
		tvCtx.fillText(name.length > 20 ? name.slice(0, 18) + '…' : name, 16, y + rowH * 0.62);

		// Price
		tvCtx.fillStyle = '#e8eaf4';
		tvCtx.textAlign = 'center';
		tvCtx.font      = '12px -apple-system, system-ui, sans-serif';
		const price = m.priceUsd != null ? `$${m.priceUsd < 0.01 ? m.priceUsd.toExponential(3) : m.priceUsd.toFixed(4)}` : '—';
		tvCtx.fillText(price, TV_W / 2, y + rowH * 0.62);

		// Change
		tvCtx.fillStyle = color;
		tvCtx.textAlign = 'right';
		tvCtx.font      = `bold 12px -apple-system, system-ui, sans-serif`;
		tvCtx.fillText(upDown, TV_W - 16, y + rowH * 0.62);
	});

	tvTex.needsUpdate = true;
}

drawTvIdle();

// ── Payment beam particles ────────────────────────────────────────────────
const BEAM_COUNT = 80;
const beamPositions = new Float32Array(BEAM_COUNT * 3);
const beamGeo = new THREE.BufferGeometry();
beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPositions, 3));
const beamMat = new THREE.PointsMaterial({
	color: 0x4e8cff,
	size: 0.18,
	transparent: true,
	opacity: 0,
	blending: THREE.AdditiveBlending,
	depthWrite: false,
});
const beamPoints = new THREE.Points(beamGeo, beamMat);
scene.add(beamPoints);

let beamActive   = false;
let beamProgress = 0;  // 0 → 1
let beamDir      = 1;  // 1 = B→A, -1 = A→B

export function fireBeam(fromBtoA = true) {
	beamActive   = true;
	beamProgress = 0;
	beamDir      = fromBtoA ? 1 : -1;
	beamMat.opacity = 0.9;
}

function updateBeam(dt) {
	if (!beamActive) return;
	beamProgress = Math.min(1, beamProgress + dt * 0.7);

	const src = beamDir > 0 ? AGENT_B_POS : AGENT_A_POS;
	const dst = beamDir > 0 ? AGENT_A_POS : AGENT_B_POS;
	const pos = beamGeo.attributes.position;

	for (let i = 0; i < BEAM_COUNT; i++) {
		const t     = (i / BEAM_COUNT + beamProgress) % 1;
		const jitter = 0.25;
		pos.setX(i, THREE.MathUtils.lerp(src.x, dst.x, t) + (Math.random() - .5) * jitter);
		pos.setY(i, THREE.MathUtils.lerp(src.y + 1.5, dst.y + 1.5, t) + (Math.random() - .5) * jitter * 0.5);
		pos.setZ(i, THREE.MathUtils.lerp(src.z, dst.z, t) + (Math.random() - .5) * jitter);
	}
	pos.needsUpdate = true;

	if (beamProgress >= 1) {
		beamActive = false;
		beamMat.opacity = 0;
	}
}

// ── Ambient floating particles ────────────────────────────────────────────
const FLOAT_N  = 200;
const floatBuf = new Float32Array(FLOAT_N * 3);
for (let i = 0; i < FLOAT_N; i++) {
	floatBuf[i * 3 + 0] = (Math.random() - .5) * 30;
	floatBuf[i * 3 + 1] = Math.random() * 12;
	floatBuf[i * 3 + 2] = (Math.random() - .5) * 20;
}
const floatGeo = new THREE.BufferGeometry();
floatGeo.setAttribute('position', new THREE.BufferAttribute(floatBuf, 3));
const floatPoints = new THREE.Points(floatGeo, new THREE.PointsMaterial({
	color: 0x304060,
	size: 0.08,
	transparent: true,
	opacity: 0.5,
	blending: THREE.AdditiveBlending,
	depthWrite: false,
}));
scene.add(floatPoints);

// ── CSS overlay: project 3D positions → screen positions ─────────────────
const v3 = new THREE.Vector3();

function toScreen(worldPos) {
	v3.copy(worldPos);
	v3.project(camera);
	return {
		x: (v3.x * 0.5 + 0.5) * W(),
		y: (-v3.y * 0.5 + 0.5) * H(),
	};
}

export function updateOverlayPositions() {
	const aScreen = toScreen(AGENT_A_POS.clone().add(new THREE.Vector3(0, 4, 2)));
	const bScreen = toScreen(AGENT_B_POS.clone().add(new THREE.Vector3(0, 4, 2)));

	const iframeA = document.getElementById('iframe-oracle');
	const iframeB = document.getElementById('iframe-trader');
	const W_HALF  = Math.min(W() * 0.24, 300);
	const H_FULL  = Math.min(H() * 0.65, 500);

	if (iframeA) {
		iframeA.style.left   = `${aScreen.x - W_HALF / 2}px`;
		iframeA.style.top    = `${aScreen.y - H_FULL}px`;
		iframeA.style.width  = `${W_HALF}px`;
		iframeA.style.height = `${H_FULL}px`;
	}
	if (iframeB) {
		iframeB.style.left   = `${bScreen.x - W_HALF / 2}px`;
		iframeB.style.top    = `${bScreen.y - H_FULL}px`;
		iframeB.style.width  = `${W_HALF}px`;
		iframeB.style.height = `${H_FULL}px`;
	}
}

// ── Flash glow ring ───────────────────────────────────────────────────────
// A single reusable ring: built once and re-targeted/-tinted per flash so each
// payment event doesn't leak a RingGeometry + material on the GPU. It stays in
// the scene and is shown/hidden via visibility + opacity.
const flashRing = new THREE.Mesh(
	new THREE.RingGeometry(1.7, 2.0, 32),
	new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
);
flashRing.rotation.x = -Math.PI / 2;
flashRing.visible = false;
scene.add(flashRing);
let flashTimer  = 0;
let flashTarget = null;

export function flashAgent(which) {
	flashTarget = which === 'A' ? AGENT_A_POS : AGENT_B_POS;
	const color  = which === 'A' ? 0xa855f7 : 0x4e8cff;
	flashRing.material.color.setHex(color);
	flashRing.material.opacity = 0.9;
	flashRing.position.set(flashTarget.x, 0.06, flashTarget.z);
	flashRing.scale.set(1, 1, 1);
	flashRing.visible = true;
	flashTimer = 1.0;
}

// ── Render loop ───────────────────────────────────────────────────────────
let lastTime = performance.now();

function frame() {
	const now = performance.now();
	const dt  = Math.min((now - lastTime) / 1000, 0.05);
	lastTime  = now;

	const t = now * 0.001;

	// Pedestal ring pulse
	pedestalA.ring.material.emissiveIntensity = 1.5 + Math.sin(t * 1.8) * 0.5;
	pedestalB.ring.material.emissiveIntensity = 1.5 + Math.sin(t * 1.8 + 1.2) * 0.5;

	// Light pulse
	oracleLight.intensity = 2.5 + Math.sin(t * 2.1) * 0.8;
	traderLight.intensity = 2.5 + Math.sin(t * 2.1 + 1.0) * 0.8;
	tvLight.intensity     = 1.5 + Math.sin(t * 1.3) * 0.4;

	// Ambient float drift
	const fp = floatGeo.attributes.position;
	for (let i = 0; i < FLOAT_N; i++) {
		fp.setY(i, fp.getY(i) + Math.sin(t + i * 0.37) * 0.003);
	}
	fp.needsUpdate = true;

	// Payment beam
	updateBeam(dt);

	// Flash ring fade
	if (flashTimer > 0) {
		flashTimer -= dt * 1.4;
		flashRing.material.opacity = Math.max(0, flashTimer);
		const s = 1 + (1 - flashTimer) * 0.6;
		flashRing.scale.set(s, s, s);
		if (flashTimer <= 0) { flashRing.visible = false; flashRing.material.opacity = 0; }
	}

	renderer.render(scene, camera);
}

createRenderLoop({ renderer, frame }).start();

// ── Init overlay positions ────────────────────────────────────────────────
updateOverlayPositions();
