// The film as a pure function of time: frame = render(t, layout, assets).
// Nothing here owns a clock. render.mjs calls window.__seek(t) once per frame,
// and the 3D body's baked clip is advanced by the same t, so any frame can be
// rendered directly without playing the ones before it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BEATS, TYPED, DURATION } from './timeline.js';

const FORMAT = new URLSearchParams(location.search).get('format') === 'portrait' ? 'portrait' : 'landscape';
const P = FORMAT === 'portrait';
const W = P ? 1080 : 1920;
const H = P ? 1920 : 1080;
const pick = (land, port) => (P ? port : land);

/* ---------- easing ---------- */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const outExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const outCubic = (x) => 1 - Math.pow(1 - x, 3);
const inCubic = (x) => x * x * x;
const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a, b, x) => a + (b - a) * x;
// Analytic spring: seekable, unlike an integrated one. zeta 1 is critically damped.
function spring(x, zeta = 1, omega = 9) {
	if (x <= 0) return 0;
	if (zeta >= 1) return 1 - (1 + omega * x) * Math.exp(-omega * x);
	const wd = omega * Math.sqrt(1 - zeta * zeta);
	return 1 - Math.exp(-zeta * omega * x) * (Math.cos(wd * x) + ((zeta * omega) / wd) * Math.sin(wd * x));
}
// Piecewise track: keys are [time, value, easing?]; easing belongs to the segment that ends at that key.
function track(t, keys) {
	if (t <= keys[0][0]) return keys[0][1];
	for (let i = 1; i < keys.length; i++) {
		if (t <= keys[i][0]) {
			const [t0, v0] = keys[i - 1];
			const [t1, v1, ease = inOutCubic] = keys[i];
			return lerp(v0, v1, ease(prog(t, t0, t1)));
		}
	}
	return keys[keys.length - 1][1];
}

/* ---------- stage ---------- */
const stage = document.getElementById('stage');
stage.style.width = `${W}px`;
stage.style.height = `${H}px`;
const layers = document.getElementById('layers');
const bloom = document.getElementById('bloom');
const grid = document.getElementById('grid');
const MARGIN = pick(160, 90);

function el(tag, cls, css = {}, parent = layers) {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	Object.assign(node.style, css);
	parent.appendChild(node);
	return node;
}
function words(parent, text, cls, css = {}) {
	return text.split(' ').map((w, i, arr) => {
		const span = el('span', `word ${cls}`, css, parent);
		span.textContent = w;
		if (i < arr.length - 1) parent.appendChild(document.createTextNode(' '));
		return span;
	});
}
function revealWords(ws, now, start, { stagger = 0.07, dur = 0.55, rise = 46, blur = 12 } = {}) {
	ws.forEach((w, i) => {
		const x = outExpo(prog(now, start + i * stagger, start + i * stagger + dur));
		w.style.opacity = x;
		w.style.transform = `translateY(${(1 - x) * rise}px)`;
		w.style.filter = x < 1 ? `blur(${(1 - x) * blur}px)` : 'none';
	});
}
const show = (node, a) => {
	node.style.opacity = a;
	node.style.visibility = a <= 0.001 ? 'hidden' : 'visible';
};

/* ---------- corner stamp: the brand is on screen from frame 0 ---------- */
const stamp = el('div', 'abs', { left: `${MARGIN}px`, top: `${pick(58, 200)}px`, display: 'flex', alignItems: 'center', gap: '16px' });
const stampImg = el('img', '', { width: `${pick(40, 46)}px`, height: 'auto' }, stamp);
stampImg.src = '/brand/three-ws-mark.png';
const stampText = el('div', 'mono', { fontSize: `${pick(24, 28)}px`, letterSpacing: '.04em', color: '#cfcfd6' }, stamp);
stampText.textContent = 'three.ws';

/* ---------- S1 hook ---------- */
const hookBlock = el('div', 'abs', { left: `${MARGIN}px`, top: `${pick(330, 640)}px`, width: `${W - MARGIN * 2}px` });
const typed = el('div', 'mono', { fontSize: `${pick(68, 74)}px`, color: '#e8e8ee', height: `${pick(96, 104)}px`, whiteSpace: 'nowrap' }, hookBlock);
const typedText = el('span', '', {}, typed);
const caret = el('span', '', { display: 'inline-block', width: `${pick(32, 36)}px`, height: `${pick(68, 74)}px`, marginLeft: '8px', verticalAlign: '-10px', background: '#fff' }, typed);
const noBody = el('div', 'head', { fontSize: `${pick(200, 214)}px`, marginTop: `${pick(18, 24)}px`, color: '#5c5c66' }, hookBlock);
noBody.textContent = 'No body.';

/* ---------- S2 headline ---------- */
const headBlock = el('div', 'abs head', { left: `${MARGIN}px`, top: `${pick(330, 1130)}px`, width: `${pick(900, W - MARGIN * 2)}px`, fontSize: `${pick(138, 132)}px` });
const hl1 = el('div', '', { whiteSpace: 'nowrap' }, headBlock);
const hl1w = words(hl1, 'Give your AI', '');
const hl2 = el('div', '', { whiteSpace: 'nowrap' }, headBlock);
const hl2w = words(hl2, 'a body.', '');
hl2w[1].classList.add('grad');

/* ---------- product panels (real screenshots, cropped, never redrawn) ---------- */
function makePanel(src, shotW, shotH, crop, box) {
	const wrap = el('div', 'abs', { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, perspective: '2200px' });
	const card = el('div', 'panel', { position: 'absolute', inset: '0', transformOrigin: '50% 50%' }, wrap);
	const scale = box.w / crop.w;
	const img = el('img', '', { width: `${shotW * scale}px`, height: `${shotH * scale}px`, left: `${-crop.x * scale}px`, top: `${-crop.y * scale}px` }, card);
	img.src = src;
	const map = (r) => ({ left: `${(r.x - crop.x) * scale}px`, top: `${(r.y - crop.y) * scale}px`, width: `${r.w * scale}px`, height: `${r.h * scale}px` });
	return { wrap, card, img, map, scale };
}
function ring(card, rect) {
	// A hollow gradient outline: the gradient fills the border box and a mask cuts out the padding box.
	const r = el('div', '', { position: 'absolute', border: '4px solid transparent', borderRadius: '14px', background: 'linear-gradient(100deg,#ff9a56,#ff5fa2 55%,#8b6cff) border-box', boxShadow: '0 0 40px rgba(255,95,162,.35)', ...rect }, card);
	r.style.webkitMask = 'linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0)';
	r.style.webkitMaskComposite = 'xor';
	r.style.maskComposite = 'exclude';
	return r;
}

const forgeBox = pick({ x: 780, y: 170, w: 1000, h: 750 }, { x: 140, y: 280, w: 800, h: 696 });
const forge = makePanel('/marketing/motion-studio/assets/screens/forge.png', 1920, 1080,
	pick({ x: 60, y: 150, w: 960, h: 720 }, { x: 60, y: 150, w: 460, h: 400 }), forgeBox);
const forgeRing = ring(forge.card, forge.map({ x: 69, y: 162, w: 440, h: 172 }));
const forgeCap = el('div', 'abs head', { left: `${pick(100, MARGIN)}px`, top: `${pick(330, 1010)}px`, width: `${pick(560, W - MARGIN * 2)}px`, fontSize: `${pick(66, 92)}px` });
const forgeLines = ['Type a prompt.', 'Get a textured', '3D model.'].map((l) => {
	const line = el('div', '', { whiteSpace: 'nowrap' }, forgeCap);
	return words(line, l, '');
});
const forgeChip = el('div', 'abs chip', { left: `${pick(100, MARGIN)}px`, top: `${pick(660, 1500)}px`, fontSize: `${pick(26, 32)}px`, padding: `${pick(14, 18)}px ${pick(26, 32)}px` });
forgeChip.innerHTML = '<i style="width:.6em;height:.6em"></i>Free · no sign-up';

const marketBox = pick({ x: 210, y: 500, w: 1500, h: 395 }, { x: 190, y: 560, w: 700, h: 525 });
const market = makePanel('/marketing/motion-studio/assets/screens/marketplace.png', 1920, 1080,
	pick({ x: 270, y: 340, w: 1440, h: 380 }, { x: 285, y: 352, w: 460, h: 345 }), marketBox);
const marketRing = ring(market.card, market.map({ x: 289, y: 358, w: 448, h: 338 }));
const marketCap = el('div', 'abs head', { left: `${pick(330, MARGIN)}px`, top: `${pick(250, 1180)}px`, fontSize: `${pick(104, 100)}px`, width: `${pick(1400, W - MARGIN * 2)}px` });
// Landscape sets the caption on one line above the panel, portrait on two.
const marketLines = (P ? ['Share it in', 'the marketplace.'] : ['Share it in the marketplace.']).map((l) => {
	const line = el('div', '', { whiteSpace: 'nowrap' }, marketCap);
	return words(line, l, '');
});

/* ---------- S4 chips ---------- */
const chipDefs = ['Rigged', 'Animated', 'Embed with two lines of HTML'];
const chipBox = el('div', 'abs', { left: `${MARGIN + pick(20, 0)}px`, top: `${pick(400, 1380)}px`, display: 'flex', flexDirection: 'column', gap: `${pick(26, 30)}px`, alignItems: 'flex-start' });
const chipEls = chipDefs.map((label) => {
	const c = el('div', 'chip', { fontSize: `${pick(44, 40)}px`, padding: `${pick(24, 22)}px ${pick(42, 38)}px`, willChange: 'transform, opacity' }, chipBox);
	c.innerHTML = `<i style="width:.55em;height:.55em"></i>${label}`;
	return c;
});

/* ---------- S6 close ---------- */
const closeBlock = el('div', 'abs', { left: `${MARGIN}px`, top: `${pick(330, 1150)}px`, width: `${pick(900, W - MARGIN * 2)}px` });
const closeBrand = el('div', 'head', { fontSize: `${pick(146, 150)}px`, display: 'flex', alignItems: 'center', gap: '26px' }, closeBlock);
const closeMark = el('img', '', { height: `${pick(124, 126)}px`, width: 'auto' }, closeBrand);
closeMark.src = '/brand/three-ws-mark.png';
const closeWord = el('span', 'word', {}, closeBrand);
closeWord.textContent = 'three.ws';
const closeTag = el('div', 'head', { fontSize: `${pick(70, 76)}px`, marginTop: `${pick(34, 30)}px`, color: '#b8b8c2' }, closeBlock);
const closeTagW = words(closeTag, 'Give your AI a body.', '');
const closeUrl = el('div', 'mono', { fontSize: `${pick(46, 50)}px`, marginTop: `${pick(44, 40)}px`, color: '#fff', display: 'inline-block' }, closeBlock);
closeUrl.innerHTML = 'three.ws/<span class="grad">forge</span>';
const closeUnder = el('div', '', { height: '4px', marginTop: '14px', background: 'linear-gradient(100deg,#ff9a56,#ff5fa2 55%,#8b6cff)', transformOrigin: '0 50%' }, closeBlock);
closeUnder.style.width = `${pick(430, 470)}px`;

/* ---------- 3D body: the real avatar file, driven by t ---------- */
const canvas = document.getElementById('gl');
canvas.width = W;
canvas.height = H;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, W / H, 0.05, 100);
scene.add(new THREE.HemisphereLight(0xbfc4ff, 0x1a1020, 0.55));
const key = new THREE.DirectionalLight(0xffd9bd, 3.0);
key.position.set(2.2, 3.0, 3.4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x8b6cff, 3.4);
rim.position.set(-3.2, 2.2, -2.6);
scene.add(rim);
const rim2 = new THREE.DirectionalLight(0xff5fa2, 1.8);
rim2.position.set(3.4, 1.0, -3.0);
scene.add(rim2);
const pivot = new THREE.Group();
scene.add(pivot);
let mixer = null;
let clipDuration = 1;
let modelHeight = 1;

async function loadAvatar() {
	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);
	const gltf = await loader.loadAsync('/avatars/michelle.glb');
	const model = gltf.scene;
	pivot.add(model);
	model.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(model);
	const size = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());
	model.position.sub(center);
	modelHeight = size.y;
	const fill = pick(0.7, 0.5);
	const dist = modelHeight / fill / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
	camera.position.set(0, 0, dist);
	camera.lookAt(0, 0, 0);
	if (gltf.animations.length) {
		const clip = gltf.animations.find((c) => /dance/i.test(c.name)) || gltf.animations.find((c) => !/idle/i.test(c.name)) || gltf.animations[0];
		mixer = new THREE.AnimationMixer(model);
		const action = mixer.clipAction(clip);
		action.play();
		clipDuration = clip.duration;
		window.__avatarClip = { name: clip.name, duration: clip.duration, all: gltf.animations.map((c) => c.name) };
	}
}

/* ---------- avatar choreography ---------- */
const POSE_A = pick({ x: 0.235, y: 0.01, s: 1.0 }, { x: 0, y: -0.19, s: 0.86 });
const POSE_ALIVE = pick({ x: 0.2, y: -0.02, s: 1.1 }, { x: 0, y: -0.12, s: 0.92 });
function avatarState(t) {
	const rise = 0.1;
	const enter = (t0, t1, pose) => outCubic(prog(t, t0, t1));
	const out = (t0, t1) => inCubic(prog(t, t0, t1));
	let st = { op: 0, x: POSE_A.x, y: POSE_A.y, s: POSE_A.s };
	const place = (pose, e, o) => ({
		op: e * (1 - o),
		x: pose.x,
		y: pose.y + (1 - e) * rise - o * 0.08,
		s: pose.s * (0.92 + 0.08 * e) * (1 - 0.06 * o),
	});
	if (t < BEATS.forgeIn) {
		st = place(POSE_A, enter(BEATS.reveal, BEATS.reveal + 0.9), out(BEATS.forgeIn - 0.1, BEATS.forgeIn + 0.45));
	} else if (t < BEATS.aliveIn - 0.01) {
		st = { ...st, op: 0 };
	} else if (t < BEATS.close) {
		st = place(POSE_ALIVE, enter(BEATS.aliveIn, BEATS.aliveIn + 0.8), out(BEATS.aliveOut, BEATS.aliveOut + 0.4));
	} else {
		st = place(POSE_A, enter(BEATS.close, BEATS.close + 0.8), 0);
	}
	return st;
}

/* ---------- the frame function ---------- */
function render(t) {
	// Background: grid drifts slowly, bloom follows the body.
	grid.style.transform = `translate(${-(t * 6) % 64}px, ${-(t * 3) % 64}px)`;
	const av = avatarState(t);
	const bloomSize = pick(980, 1100);
	bloom.style.width = bloom.style.height = `${bloomSize}px`;
	const bx = W / 2 + av.x * W - bloomSize / 2;
	const by = H / 2 + av.y * H - bloomSize / 2;
	bloom.style.transform = `translate(${bx}px, ${by}px) scale(${0.85 + 0.15 * av.op})`;
	bloom.style.opacity = av.op * 0.9;

	// 3D body
	canvas.style.opacity = av.op;
	canvas.style.visibility = av.op <= 0.001 ? 'hidden' : 'visible';
	if (av.op > 0.001) {
		camera.zoom = av.s;
		camera.setViewOffset(W, H, -av.x * W, -av.y * H, W, H);
		camera.updateProjectionMatrix();
		pivot.rotation.y = 0.2 + t * THREE.MathUtils.degToRad(18);
		if (mixer) mixer.setTime((t * 0.9) % clipDuration);
		renderer.render(scene, camera);
	}

	// S1 hook
	const typedCount = clamp(Math.floor((t - TYPED.start) / TYPED.perChar) + 1, 0, TYPED.text.length);
	typedText.textContent = TYPED.text.slice(0, typedCount);
	const caretOn = t < TYPED.start + TYPED.text.length * TYPED.perChar + 0.1 ? true : Math.floor(t * 2) % 2 === 0;
	caret.style.opacity = t < TYPED.start ? (Math.floor(t * 2) % 2 === 0 ? 1 : 0) : caretOn ? 1 : 0;
	const nb = spring(t - BEATS.noBody, 0.62, 16);
	noBody.style.opacity = t >= BEATS.noBody ? Math.min(1, (t - BEATS.noBody) / 0.08) : 0;
	noBody.style.transform = `translateY(${(1 - nb) * 34}px) scale(${0.96 + 0.04 * nb})`;
	noBody.style.transformOrigin = '0 50%';
	const hookOut = inCubic(prog(t, 2.05, 2.5));
	hookBlock.style.opacity = 1 - hookOut;
	hookBlock.style.transform = `translateY(${-hookOut * 60}px)`;
	hookBlock.style.visibility = hookOut >= 1 ? 'hidden' : 'visible';

	// S2 headline
	revealWords(hl1w, t, BEATS.reveal + 0.15);
	revealWords(hl2w, t, BEATS.reveal + 0.15 + 0.28);
	const headOut = inCubic(prog(t, BEATS.forgeIn - 0.1, BEATS.forgeIn + 0.35));
	const headIn = t >= BEATS.close;
	if (!headIn) {
		headBlock.style.opacity = 1 - headOut;
		headBlock.style.transform = `translateX(${-headOut * 120}px)`;
		headBlock.style.visibility = t < BEATS.reveal || headOut >= 1 ? 'hidden' : 'visible';
	} else {
		headBlock.style.visibility = 'hidden';
	}

	// S3 forge panel
	panelState(forge, t, BEATS.forgeIn, BEATS.forgeSettle, BEATS.forgeOut, +1);
	const fr = prog(t, BEATS.forgeSettle + 0.2, BEATS.forgeSettle + 0.7) * (1 - prog(t, BEATS.forgeOut - 0.4, BEATS.forgeOut));
	forgeRing.style.opacity = fr;
	forgeRing.style.transform = `scale(${0.96 + 0.04 * outExpo(prog(t, BEATS.forgeSettle + 0.2, BEATS.forgeSettle + 0.7))})`;
	const fcOut = inCubic(prog(t, BEATS.forgeOut - 0.2, BEATS.forgeOut + 0.2));
	forgeCap.style.visibility = t < BEATS.forgeIn + 0.1 || fcOut >= 1 ? 'hidden' : 'visible';
	forgeCap.style.opacity = 1 - fcOut;
	forgeLines.forEach((ws, i) => revealWords(ws, t, BEATS.forgeIn + 0.2 + i * 0.28));
	const chipT = BEATS.forgeIn + 1.15;
	const ce = spring(t - chipT, 0.55, 20);
	forgeChip.style.visibility = t < chipT || fcOut >= 1 ? 'hidden' : 'visible';
	forgeChip.style.opacity = Math.min(1, (t - chipT) / 0.1) * (1 - fcOut);
	forgeChip.style.transform = `translateY(${(1 - ce) * 24}px) scale(${0.9 + 0.1 * ce})`;

	// S4 chips
	chipEls.forEach((c, i) => {
		const at = BEATS.chips[i];
		const e = spring(t - at, 0.55, 22);
		const out = inCubic(prog(t, BEATS.aliveOut - 0.1 + i * 0.05, BEATS.aliveOut + 0.3 + i * 0.05));
		c.style.visibility = t < at || out >= 1 ? 'hidden' : 'visible';
		c.style.opacity = Math.min(1, Math.max(0, (t - at) / 0.08)) * (1 - out);
		c.style.transform = `translateX(${(1 - e) * -60}px) scale(${0.92 + 0.08 * e})`;
		c.style.transformOrigin = '0 50%';
	});

	// S5 marketplace panel
	panelState(market, t, BEATS.marketIn, BEATS.marketSettle, BEATS.marketOut, -1);
	const mr = prog(t, BEATS.marketSettle + 0.1, BEATS.marketSettle + 0.6) * (1 - prog(t, BEATS.marketOut - 0.35, BEATS.marketOut));
	marketRing.style.opacity = mr;
	marketRing.style.transform = `scale(${0.96 + 0.04 * outExpo(prog(t, BEATS.marketSettle + 0.1, BEATS.marketSettle + 0.6))})`;
	const mcOut = inCubic(prog(t, BEATS.marketOut - 0.2, BEATS.marketOut + 0.2));
	marketCap.style.visibility = t < BEATS.marketIn + 0.1 || mcOut >= 1 ? 'hidden' : 'visible';
	marketCap.style.opacity = 1 - mcOut;
	marketLines.forEach((ws, i) => revealWords(ws, t, BEATS.marketIn + 0.2 + i * 0.25));

	// S6 close
	const showClose = t >= BEATS.close;
	closeBlock.style.visibility = showClose ? 'visible' : 'hidden';
	if (showClose) {
		const m = spring(t - BEATS.close, 0.8, 14);
		closeMark.style.opacity = Math.min(1, (t - BEATS.close) / 0.15);
		closeMark.style.transform = `scale(${0.7 + 0.3 * m}) rotate(${(1 - m) * -40}deg)`;
		revealWords([closeWord], t, BEATS.close + 0.1);
		revealWords(closeTagW, t, BEATS.close + 0.45, { stagger: 0.09 });
		const u = spring(t - BEATS.finalHit, 0.55, 18);
		closeUrl.style.opacity = t >= BEATS.finalHit ? Math.min(1, (t - BEATS.finalHit) / 0.08) : 0;
		closeUrl.style.transform = `translateY(${(1 - u) * 22}px)`;
		closeUnder.style.transform = `scaleX(${outExpo(prog(t, BEATS.finalHit + 0.05, BEATS.finalHit + 0.6))})`;
	}
}

// Panels enter on a turn that resolves with a controlled settle, then leave fast.
function panelState(panel, t, tIn, tSettle, tOut, dir) {
	const e = spring((t - tIn) / (tSettle - tIn), 1, 6.2);
	const out = inCubic(prog(t, tOut - 0.35, tOut));
	const visible = t >= tIn && out < 1;
	panel.wrap.style.visibility = visible ? 'visible' : 'hidden';
	panel.wrap.style.opacity = Math.min(1, Math.max(0, (t - tIn) / 0.18)) * (1 - out);
	const yaw = dir * lerp(16, 4, e) + dir * out * 6;
	const pitch = lerp(5, 2, e);
	const z = lerp(-420, 0, e) - out * 200;
	const x = lerp(dir * 140, 0, e) + dir * out * 80;
	const drift = Math.sin((t - tIn) * 0.9) * 0.6;
	panel.card.style.transform = `translate3d(${x}px, ${out * 30}px, ${z}px) rotateY(${yaw - drift * dir}deg) rotateX(${pitch}deg)`;
}

window.__seek = (t) => render(clamp(t, 0, DURATION));
window.__format = { name: FORMAT, W, H };
window.__ready = (async () => {
	await Promise.all([
		document.fonts.load('700 100px "Space Grotesk"'),
		document.fonts.load('500 40px "JetBrains Mono"'),
		document.fonts.load('500 40px "Inter"'),
		...[...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))),
		loadAvatar(),
	]);
	await document.fonts.ready;
	render(0);
	return true;
})();
