// The 3D card stage for the /play card gacha modal (gacha-ui.js).
//
// Two jobs, one renderer:
//   - The pull reveal. A capsule spins and shakes while light gathers into
//     it, holding the rarity colour back until the last moment on rare and
//     epic pulls. Then it cracks: a white flash, a shockwave, a light pillar
//     in the tier colour and a spark burst. The real graded slab spins out of
//     the capsule and settles face up. Epic pulls get a second gold burst.
//   - The inspector, used for the reveal once it settles and for every card in
//     "My cards". The slab floats, can be dragged or flipped to show its real
//     back, and tilts toward the pointer. The holographic foil shader shifts
//     colour with the viewing angle, so it moves the way a real foil does.
//
// Card art comes through the same-origin image proxy, so the WebGL textures
// are never tainted by a host that sends no CORS headers. createCardStage()
// returns null when WebGL is unavailable and the caller falls back to the CSS
// flip card.

import {
	WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Points, Sprite,
	PlaneGeometry, SphereGeometry, TorusGeometry, CylinderGeometry, RingGeometry, BoxGeometry, BufferGeometry, Float32BufferAttribute,
	ShaderMaterial, MeshPhysicalMaterial, MeshBasicMaterial, PointsMaterial, SpriteMaterial,
	CanvasTexture, TextureLoader, SRGBColorSpace, Color, Vector2, AdditiveBlending, DoubleSide, BackSide, PMREMGenerator, NoToneMapping, DirectionalLight, HemisphereLight,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { cardImageUrl, TIER_STYLE } from './gacha-client.js';

const CARD_H = 1.7;
const DEFAULT_ASPECT = 0.6; // graded slabs are roughly 3 x 5
const FOV = 30;
const TAU = Math.PI * 2;

// How loud each rarity is. `build` is the seconds of suspense before the
// capsule cracks; `tease` holds the tier colour back until late in the build.
const TIER_FX = {
	common: { holo: 0.08, turns: 1, sparks: 110, pillar: 0.55, shake: 0, build: 1.35, tease: false, encore: false },
	uncommon: { holo: 0.17, turns: 1, sparks: 170, pillar: 0.8, shake: 0.012, build: 1.45, tease: false, encore: false },
	rare: { holo: 0.3, turns: 2, sparks: 240, pillar: 1.05, shake: 0.028, build: 1.75, tease: true, encore: false },
	epic: { holo: 0.46, turns: 2, sparks: 320, pillar: 1.45, shake: 0.05, build: 2.05, tease: true, encore: true },
};
const AURA_SCALE = 2.6; // the settled card's halo, in world units
const AURA_OPACITY = 0.3;
const CARD_IN_S = 1.1; // capsule crack -> card face up
const SETTLE_S = 1.3; // capsule crack -> interactive

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOutCubic = (k) => 1 - (1 - k) ** 3;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
function easeOutBack(k) {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
}

// ── shaders ─────────────────────────────────────────────────────────────────

const FOIL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
void main() {
	vUv = uv;
	vN = normalize(normalMatrix * normal);
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Holographic foil over the card photo. The rainbow phase follows the
// view-space normal, so turning the slab sweeps colour across it; fine
// diffraction lines and twinkling glints sit on the brighter areas, and a
// specular band rides across with the tilt. Brightness above 1 is what the
// bloom pass picks up.
const FOIL_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uHolo;
uniform float uTime;
uniform float uSweep;
uniform float uFlash;
uniform float uDim;
uniform vec3 uTint;
varying vec2 vUv;
varying vec3 vN;

vec3 hue(float h) {
	return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
	vec3 base = texture2D(map, vUv).rgb * uDim;
	vec3 n = normalize(vN);
	float h = fract(vUv.x * 0.9 + vUv.y * 0.55 + n.x * 1.8 - n.y * 1.3 + uTime * 0.02);
	vec3 rainbow = mix(hue(h), uTint, 0.25);
	float lines = 0.72 + 0.28 * sin((vUv.x * 0.7 + vUv.y) * 90.0 + n.x * 24.0);
	float lum = dot(base, vec3(0.299, 0.587, 0.114));
	float mask = (0.35 + 0.65 * smoothstep(0.08, 0.7, lum)) * lines;
	vec3 col = 1.0 - (1.0 - base) * (1.0 - rainbow * mask * uHolo);

	float d = vUv.x * 0.85 - vUv.y * 0.5 + n.x * 1.4 - uSweep;
	col += exp(-d * d * 28.0) * (0.06 + uHolo * 0.5);

	float r = hash(floor(vUv * vec2(70.0, 110.0)));
	float tw = pow(max(0.0, sin(uTime * 2.6 + r * 60.0 + n.x * 18.0)), 14.0);
	col += uTint * step(0.982, r) * tw * uHolo * 3.0;

	col = mix(col, vec3(1.6), uFlash);
	gl_FragColor = vec4(col, 1.0);
	#include <colorspace_fragment>
}`;

const PILLAR_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
	vUv = uv;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	vec3 n = normalize(normalMatrix * normal);
	vFacing = abs(dot(n, normalize(-mv.xyz)));
	gl_Position = projectionMatrix * mv;
}`;

// A volumetric-looking beam: bright down the middle (surfaces facing the
// camera), soft at the silhouette, fading out at both ends, with streaks
// racing upward.
const PILLAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
varying float vFacing;
void main() {
	float y = vUv.y;
	float ends = smoothstep(0.0, 0.18, y) * (1.0 - smoothstep(0.4, 1.0, y));
	float streak = 0.7 + 0.3 * sin(vUv.x * 6.2831 * 7.0 + uTime * 2.0) * sin(y * 34.0 - uTime * 9.0);
	float core = pow(vFacing, 2.2);
	gl_FragColor = vec4(uColor * 2.2 * ends * streak * core * uAlpha, 1.0);
}`;

// ── environment ─────────────────────────────────────────────────────────────

// A small photo studio for the acrylic and the capsule to reflect: a dark
// room, one broad softbox overhead, two strip lights at the sides and a faint
// warm kicker behind. The panel brightness is chosen for this stage's untone-
// mapped output (the card photo has to keep its true colours), so a glossy
// edge catches a clean highlight instead of clipping the slab to white the
// way the stock RoomEnvironment, built for tone-mapped scenes, does.
function studioScene() {
	const scene = new Scene();
	const geos = [];
	const mats = [];
	const add = (geo, color, pos, rot) => {
		const mat = new MeshBasicMaterial({ color, side: geo.type === 'BoxGeometry' ? BackSide : DoubleSide });
		const mesh = new Mesh(geo, mat);
		mesh.position.set(...pos);
		if (rot) mesh.rotation.set(...rot);
		geos.push(geo);
		mats.push(mat);
		scene.add(mesh);
	};
	add(new BoxGeometry(12, 8, 12), new Color(0x0a0b10), [0, 0, 0]);
	add(new PlaneGeometry(5, 2.6), new Color(1.5, 1.5, 1.6), [0, 3.6, 1], [Math.PI / 2, 0, 0]);
	add(new PlaneGeometry(0.7, 5), new Color(1.1, 1.15, 1.25), [-5, 0.3, 1.5], [0, Math.PI / 2, 0]);
	add(new PlaneGeometry(0.7, 5), new Color(1.1, 1.15, 1.25), [5, 0.3, 1.5], [0, -Math.PI / 2, 0]);
	add(new PlaneGeometry(4, 1.2), new Color(0.55, 0.4, 0.28), [0, -1.5, -5.5]);
	return { scene, dispose: () => { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); } };
}

// ── textures ────────────────────────────────────────────────────────────────

function canvasTex(w, h, draw) {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	draw(c.getContext('2d'), w, h);
	const tex = new CanvasTexture(c);
	tex.colorSpace = SRGBColorSpace;
	return tex;
}

function radialTex(stops) {
	return canvasTex(128, 128, (ctx, w, h) => {
		const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
		for (const [at, color] of stops) g.addColorStop(at, color);
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
	});
}

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

// Shown while the photo loads, or for good if the art is unavailable.
function slabPlaceholder(label) {
	return canvasTex(384, 640, (ctx, w, h) => {
		const g = ctx.createLinearGradient(0, 0, w, h);
		g.addColorStop(0, '#2a2d36');
		g.addColorStop(1, '#121318');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = '#e9e6de';
		roundRect(ctx, 24, 24, w - 48, 92, 10);
		ctx.fill();
		ctx.strokeStyle = 'rgba(255,255,255,0.16)';
		ctx.lineWidth = 3;
		roundRect(ctx, 36, 140, w - 72, h - 176, 14);
		ctx.stroke();
		ctx.fillStyle = 'rgba(255,255,255,0.5)';
		ctx.font = '700 26px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, w / 2, h * 0.6);
	});
}

// The card's reverse when Collector Crypt has no photo of the slab's back.
function designedBack(tierColor) {
	return canvasTex(384, 640, (ctx, w, h) => {
		const g = ctx.createLinearGradient(0, 0, 0, h);
		g.addColorStop(0, '#1c1e25');
		g.addColorStop(1, '#0b0c10');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
		ctx.strokeStyle = tierColor;
		ctx.globalAlpha = 0.22;
		ctx.lineWidth = 2;
		for (let i = -h; i < w + h; i += 28) {
			ctx.beginPath();
			ctx.moveTo(i, 0);
			ctx.lineTo(i + h * 0.6, h);
			ctx.moveTo(i + h * 0.6, 0);
			ctx.lineTo(i, h);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
		ctx.lineWidth = 6;
		roundRect(ctx, 20, 20, w - 40, h - 40, 18);
		ctx.stroke();
		ctx.fillStyle = '#f2efe8';
		ctx.font = '900 40px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('GRADED', w / 2, h / 2 - 22);
		ctx.font = '700 20px system-ui, sans-serif';
		ctx.fillStyle = tierColor;
		ctx.fillText('VAULTED  ·  INSURED', w / 2, h / 2 + 24);
	});
}

function backdropTex(glow) {
	return canvasTex(512, 512, (ctx, w, h) => {
		ctx.fillStyle = '#060608';
		ctx.fillRect(0, 0, w, h);
		const g = ctx.createRadialGradient(w / 2, h * 0.46, 0, w / 2, h * 0.46, w * 0.5);
		g.addColorStop(0, glow);
		g.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.globalAlpha = 0.32;
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
		ctx.globalAlpha = 1;
		const v = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.75);
		v.addColorStop(0, 'rgba(0,0,0,0)');
		v.addColorStop(1, 'rgba(0,0,0,0.7)');
		ctx.fillStyle = v;
		ctx.fillRect(0, 0, w, h);
	});
}

// ── particles ───────────────────────────────────────────────────────────────

// A compacted pool of additive points. Mode 0 is ballistic (gravity + drag),
// mode 1 is drawn into the origin (the capsule) and dies on arrival.
class Sparks {
	constructor(max, map, size) {
		this.max = max;
		this.n = 0;
		this.pos = new Float32Array(max * 3);
		this.col = new Float32Array(max * 3);
		this.vel = new Float32Array(max * 3);
		this.base = new Float32Array(max * 3);
		this.life = new Float32Array(max);
		this.ttl = new Float32Array(max);
		this.grav = new Float32Array(max);
		this.drag = new Float32Array(max);
		this.mode = new Uint8Array(max);
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
		geo.setAttribute('color', new Float32BufferAttribute(this.col, 3));
		geo.setDrawRange(0, 0);
		this.points = new Points(geo, new PointsMaterial({
			size, map, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, sizeAttenuation: true,
		}));
		this.points.frustumCulled = false;
	}

	emit(count, init) {
		for (let k = 0; k < count && this.n < this.max; k++) {
			const i = this.n++;
			this.life[i] = 0;
			this.grav[i] = 0;
			this.drag[i] = 0;
			this.mode[i] = 0;
			init(i, this);
		}
	}

	set(i, field, x, y, z) {
		this[field][i * 3] = x;
		this[field][i * 3 + 1] = y;
		this[field][i * 3 + 2] = z;
	}

	_move(from, to) {
		for (const f of ['pos', 'vel', 'base']) {
			this[f][to * 3] = this[f][from * 3];
			this[f][to * 3 + 1] = this[f][from * 3 + 1];
			this[f][to * 3 + 2] = this[f][from * 3 + 2];
		}
		for (const f of ['life', 'ttl', 'grav', 'drag', 'mode']) this[f][to] = this[f][from];
	}

	update(dt) {
		const { pos, vel, col, base } = this;
		for (let i = 0; i < this.n; i++) {
			this.life[i] += dt;
			const o = i * 3;
			const dead = this.life[i] >= this.ttl[i]
				|| (this.mode[i] === 1 && pos[o] * pos[o] + pos[o + 1] * pos[o + 1] + pos[o + 2] * pos[o + 2] < 0.03);
			if (dead) {
				this.n--;
				if (i !== this.n) this._move(this.n, i);
				i--;
				continue;
			}
			if (this.mode[i] === 1) {
				// Accelerate toward the capsule, with a swirl around the Y axis.
				const k = 9 * dt;
				vel[o] += (-pos[o] * k) - pos[o + 2] * dt * 3;
				vel[o + 1] += -pos[o + 1] * k;
				vel[o + 2] += (-pos[o + 2] * k) + pos[o] * dt * 3;
			} else {
				vel[o + 1] -= this.grav[i] * dt;
			}
			const damp = Math.exp(-this.drag[i] * dt);
			vel[o] *= damp;
			vel[o + 1] *= damp;
			vel[o + 2] *= damp;
			pos[o] += vel[o] * dt;
			pos[o + 1] += vel[o + 1] * dt;
			pos[o + 2] += vel[o + 2] * dt;
			const k = this.life[i] / this.ttl[i];
			const fade = Math.min(1, this.life[i] / 0.08) * (1 - k) ** 1.4;
			col[o] = base[o] * fade;
			col[o + 1] = base[o + 1] * fade;
			col[o + 2] = base[o + 2] * fade;
		}
		const geo = this.points.geometry;
		geo.setDrawRange(0, this.n);
		geo.attributes.position.needsUpdate = true;
		geo.attributes.color.needsUpdate = true;
	}

	clear() {
		this.n = 0;
		this.points.geometry.setDrawRange(0, 0);
	}
}

// ── the stage ───────────────────────────────────────────────────────────────

/**
 * Mount a 3D card stage in `host`. Returns null when WebGL is unavailable.
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {object} opts.card       normalized card ({ image, back, name, tier })
 * @param {boolean} [opts.intro]   play the capsule reveal before settling
 * @param {boolean} [opts.reduced] prefers-reduced-motion: no intro, no idle motion
 * @param {() => void} [opts.onSettled]  the card is face up and interactive
 * @param {() => void} [opts.onLost]     the WebGL context died; show a fallback
 */
export function createCardStage(host, opts) {
	let renderer;
	try {
		renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
	} catch {
		return null;
	}
	if (!renderer.getContext()) {
		renderer.dispose();
		return null;
	}
	return new CardStage(host, renderer, opts);
}

class CardStage {
	constructor(host, renderer, { card, intro = false, reduced = false, onSettled, onLost }) {
		this.host = host;
		this.card = card || {};
		this.reduced = reduced;
		this.onSettled = onSettled;
		this.onLost = onLost;
		const tierKey = TIER_STYLE[this.card.tier] ? this.card.tier : null;
		this.tierColor = new Color((TIER_STYLE[tierKey] || TIER_STYLE.common).color);
		// An unranked wallet card still gets a visible foil: it is a display piece.
		this.fx = tierKey ? TIER_FX[tierKey] : { ...TIER_FX.uncommon, holo: 0.2 };
		this.t = 0;
		this.mode = intro && !reduced ? 'intro' : 'idle';
		this.cracked = false;
		this.encored = false;
		this.aspect = DEFAULT_ASPECT;
		this.spin = 0;
		this.spinVel = 0;
		this.flipAnim = null;
		this.hover = new Vector2();
		this.hoverTarget = new Vector2();
		this.drag = null;
		this.shake = 0;
		this.bloomKick = 0;
		this.disposed = false;
		this._textures = [];

		this.renderer = renderer;
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.outputColorSpace = SRGBColorSpace;
		renderer.toneMapping = NoToneMapping;
		this.canvas = renderer.domElement;
		this.canvas.className = 'ga-r3-canvas';
		this.canvas.tabIndex = 0;
		this.canvas.setAttribute('role', 'img');
		this.canvas.setAttribute('aria-label', `${this.card.name || 'Graded card'}. Drag to turn it, or press Enter to flip it over.`);
		this.flash = document.createElement('div');
		this.flash.className = 'ga-r3-flash';
		this.flash.setAttribute('aria-hidden', 'true');
		host.append(this.canvas, this.flash);

		this._buildScene();
		this._buildComposer();
		this._loadArt();
		this._bindInput();

		this._ro = new ResizeObserver(() => this._resize());
		this._ro.observe(host);
		this._resize();

		this._onLost = (e) => {
			e.preventDefault();
			this.dispose();
			this.onLost?.();
		};
		this.canvas.addEventListener('webglcontextlost', this._onLost);

		if (this.mode === 'idle') {
			this.card3d.visible = true;
			this.enter = reduced ? null : { t: 0 };
			this.capsule.visible = false;
			queueMicrotask(() => this.onSettled?.());
		}
		this._last = performance.now();
		this._raf = requestAnimationFrame((now) => this._frame(now));
	}

	// ── build ──────────────────────────────────────────────────────────────

	_buildScene() {
		const scene = new Scene();
		this.scene = scene;
		const glow = (TIER_STYLE[this.card.tier] || TIER_STYLE.common).glow;
		scene.background = this._own(backdropTex(glow));
		this.camera = new PerspectiveCamera(FOV, 1, 0.1, 60);
		this.camera.position.set(0, 0, 5);

		this.pmrem = new PMREMGenerator(this.renderer);
		const studio = studioScene();
		this.envTex = this.pmrem.fromScene(studio.scene, 0.03).texture;
		studio.dispose();
		// A key and a sky fill shape the capsule; the card's foil shader is
		// unlit, so the photo itself is never relit.
		const key = new DirectionalLight(0xffffff, 1.25);
		key.position.set(-2, 3, 4);
		scene.add(key, new HemisphereLight(0xdfe6ff, 0x16141c, 0.55));

		this.dot = this._own(radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]));
		const halo = this._own(radialTex([[0, 'rgba(255,255,255,0.85)'], [0.18, 'rgba(255,255,255,0.42)'], [0.42, 'rgba(255,255,255,0.13)'], [0.7, 'rgba(255,255,255,0.03)'], [1, 'rgba(255,255,255,0)']]));

		// Soft halo behind everything: grows with the build-up, then stays as
		// the card's aura.
		this.glow = new Sprite(new SpriteMaterial({ map: halo, color: 0xffffff, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
		this.glow.position.z = -0.6;
		this.glow.scale.setScalar(this.mode === 'intro' ? 1.2 : AURA_SCALE);
		this.glow.material.opacity = this.mode === 'intro' ? 0.35 : AURA_OPACITY;
		if (this.mode !== 'intro') this.glow.material.color.copy(this.tierColor);
		scene.add(this.glow);

		this._buildCard();
		this._buildCapsule();
		this._buildBurstFx();

		this.sparks = new Sparks(760, this.dot, 0.075);
		this.dust = new Sparks(160, this.dot, 0.04);
		scene.add(this.sparks.points, this.dust.points);
	}

	_buildCard() {
		const g = new Group();
		g.visible = false;
		this.card3d = g;
		const foil = (map, holo) => new ShaderMaterial({
			vertexShader: FOIL_VERT,
			fragmentShader: FOIL_FRAG,
			uniforms: {
				map: { value: map },
				uHolo: { value: holo },
				uTime: { value: 0 },
				uSweep: { value: 0 },
				uFlash: { value: 0 },
				uDim: { value: 0.93 },
				uTint: { value: this.tierColor.clone() },
			},
		});
		const plane = new PlaneGeometry(1, 1);
		this.frontMat = foil(this._own(slabPlaceholder('Loading card…')), this.fx.holo);
		this.backMat = foil(this._own(slabPlaceholder('')), this.fx.holo * 0.45);
		this.front = new Mesh(plane, this.frontMat);
		this.back = new Mesh(plane, this.backMat);
		this.back.rotation.y = Math.PI;
		this.front.position.z = 0.013;
		this.back.position.z = -0.013;
		// The acrylic edge of the slab: glossy, reflective, mostly clear.
		this.caseMat = new MeshPhysicalMaterial({
			color: 0xffffff, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.2,
			clearcoat: 1, clearcoatRoughness: 0.04, envMap: this.envTex, envMapIntensity: 1.4, depthWrite: false,
		});
		this.caseMesh = new Mesh(new RoundedBoxGeometry(1, 1, 1, 3, 0.02), this.caseMat);
		this.caseMesh.renderOrder = 2;
		g.add(this.front, this.back, this.caseMesh);
		this._sizeCard();
		this.scene.add(g);
	}

	_sizeCard() {
		const h = CARD_H;
		const w = h * this.aspect;
		this.cardW = w;
		this.front.scale.set(w, h, 1);
		this.back.scale.set(w, h, 1);
		this.caseMesh.geometry.dispose();
		this.caseMesh.geometry = new RoundedBoxGeometry(w + 0.07, h + 0.07, 0.05, 3, 0.024);
		this._fitCamera();
	}

	_buildCapsule() {
		const R = 0.5;
		const cap = new Group();
		const pearl = new Color(0xe9ecf3);
		this.capTopMat = new MeshPhysicalMaterial({
			color: this.fx.tease ? pearl : this.tierColor, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.05,
			envMap: this.envTex, envMapIntensity: 1.1, transparent: true,
		});
		this.capBotMat = new MeshPhysicalMaterial({
			color: 0xffffff, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.55, clearcoat: 1,
			envMap: this.envTex, envMapIntensity: 1.3, depthWrite: false,
		});
		this.capTop = new Group();
		this.capTop.add(new Mesh(new SphereGeometry(R, 40, 20, 0, TAU, 0, Math.PI / 2), this.capTopMat));
		const band = new Mesh(new TorusGeometry(R, 0.022, 10, 48), new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, envMap: this.envTex, transparent: true }));
		band.rotation.x = Math.PI / 2;
		this.capTop.add(band);
		this.capBot = new Group();
		this.capBot.add(new Mesh(new SphereGeometry(R * 0.985, 40, 20, 0, TAU, Math.PI / 2, Math.PI / 2), this.capBotMat));
		// The light gathering inside, visible through the clear half.
		this.core = new Sprite(new SpriteMaterial({ map: this.glow.material.map, color: 0xffffff, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
		this.core.scale.setScalar(0.5);
		cap.add(this.capTop, this.capBot, this.core);
		cap.rotation.x = 0.35;
		cap.scale.setScalar(0.001);
		this.capsule = cap;
		this.scene.add(cap);
	}

	_buildBurstFx() {
		this.pillar = new Mesh(
			new CylinderGeometry(0.75, 0.75, 9, 48, 1, true),
			new ShaderMaterial({
				vertexShader: PILLAR_VERT,
				fragmentShader: PILLAR_FRAG,
				uniforms: { uColor: { value: this.tierColor.clone() }, uAlpha: { value: 0 }, uTime: { value: 0 } },
				transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
			}),
		);
		this.pillar.position.set(0, 2.6, -0.8);
		this.pillar.visible = false;
		this.scene.add(this.pillar);

		const ringMat = () => new MeshBasicMaterial({ color: this.tierColor.clone().multiplyScalar(2), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide });
		this.rings = [0, 1, 2].map((i) => {
			const ring = new Mesh(new RingGeometry(0.93, 1, 96), ringMat());
			if (i === 1) { ring.rotation.x = -Math.PI / 2.5; ring.position.y = -0.95; }
			ring.visible = false;
			this.scene.add(ring);
			return { mesh: ring, t: -1, dur: i === 1 ? 1 : 0.75, max: i === 1 ? 4.2 : 5.5 };
		});
	}

	_buildComposer() {
		this.composer = new EffectComposer(this.renderer);
		this.composer.addPass(new RenderPass(this.scene, this.camera));
		this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.55, 0.5, 0.95);
		this.composer.addPass(this.bloom);
		this.composer.addPass(new OutputPass());
	}

	_own(tex) {
		this._textures.push(tex);
		return tex;
	}

	// ── art ────────────────────────────────────────────────────────────────

	_loadArt() {
		const loader = new TextureLoader();
		const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
		const load = (src, onTex, onFail) => {
			const url = cardImageUrl(src, 960);
			if (!url) { onFail(); return; }
			loader.load(url, (tex) => {
				if (this.disposed) { tex.dispose(); return; }
				tex.colorSpace = SRGBColorSpace;
				tex.anisotropy = maxAniso;
				this._own(tex);
				onTex(tex);
			}, undefined, () => { if (!this.disposed) onFail(); });
		};
		load(this.card.image, (tex) => {
			const img = tex.image;
			if (img?.width && img?.height) {
				this.aspect = Math.min(1, Math.max(0.45, img.width / img.height));
				this._sizeCard();
			}
			this.frontMat.uniforms.map.value = tex;
		}, () => {
			this.frontMat.uniforms.map.value = this._own(slabPlaceholder('Card art unavailable'));
		});
		const designed = () => { this.backMat.uniforms.map.value = this._own(designedBack(`#${this.tierColor.getHexString()}`)); };
		if (this.card.back) load(this.card.back, (tex) => { this.backMat.uniforms.map.value = tex; }, designed);
		else designed();
	}

	// ── input ──────────────────────────────────────────────────────────────

	_bindInput() {
		const c = this.canvas;
		this._onDown = (e) => {
			if (this.mode !== 'idle') return;
			c.setPointerCapture?.(e.pointerId);
			this.flipAnim = null;
			this.drag = { id: e.pointerId, x: e.clientX, last: performance.now(), vel: 0, moved: 0 };
		};
		this._onMove = (e) => {
			const r = c.getBoundingClientRect();
			if (this.drag && e.pointerId === this.drag.id) {
				const dx = e.clientX - this.drag.x;
				const now = performance.now();
				const dAngle = (dx / Math.max(1, r.width)) * Math.PI * 1.6;
				this.spin += dAngle;
				this.drag.vel = dAngle / Math.max(0.008, (now - this.drag.last) / 1000);
				this.drag.x = e.clientX;
				this.drag.last = now;
				this.drag.moved += Math.abs(dx);
				return;
			}
			if (e.pointerType === 'mouse') {
				this.hoverTarget.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
			}
		};
		this._onUp = (e) => {
			if (!this.drag || e.pointerId !== this.drag.id) return;
			const tap = this.drag.moved < 6;
			this.spinVel = tap ? 0 : Math.max(-14, Math.min(14, this.drag.vel));
			this.drag = null;
			if (tap && e.pointerType !== 'mouse') this.flip();
		};
		this._onLeave = () => this.hoverTarget.set(0, 0);
		this._onKey = (e) => {
			if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				e.preventDefault();
				this.flip(e.key === 'ArrowLeft' ? -1 : 1);
			}
		};
		this._onDbl = () => this.flip();
		c.addEventListener('pointerdown', this._onDown);
		c.addEventListener('pointermove', this._onMove);
		c.addEventListener('pointerup', this._onUp);
		c.addEventListener('pointercancel', this._onUp);
		c.addEventListener('pointerleave', this._onLeave);
		c.addEventListener('keydown', this._onKey);
		c.addEventListener('dblclick', this._onDbl);
	}

	/** Turn the slab over (front to back or back to front). */
	flip(dir = 1) {
		if (this.mode !== 'idle' || this.disposed) return;
		const from = this.spin;
		const to = Math.round(from / Math.PI) * Math.PI + dir * Math.PI;
		this.spinVel = 0;
		this.flipAnim = this.reduced ? null : { from, to, t: 0, dur: 0.75 };
		if (this.reduced) this.spin = to;
	}

	/** True while the photo side faces the viewer. */
	showingFront() {
		return Math.cos(this.spin) >= 0;
	}

	/** Jump straight to the settled card (the Skip button). */
	skip() {
		if (this.mode !== 'intro') return;
		this._crackCleanup();
		this.sparks.clear();
		this.pillar.visible = false;
		for (const r of this.rings) { r.t = -1; r.mesh.visible = false; }
		this.frontMat.uniforms.uFlash.value = 0;
		this.backMat.uniforms.uFlash.value = 0;
		this.glow.material.color.copy(this.tierColor);
		this.glow.scale.setScalar(AURA_SCALE);
		this.glow.material.opacity = AURA_OPACITY;
		this.bloomKick = 0;
		this.shake = 0;
		this._settle();
	}

	_settle() {
		this.mode = 'idle';
		this.card3d.visible = true;
		this.card3d.scale.setScalar(1);
		this.card3d.position.set(0, 0, 0);
		this.spin = 0;
		this.spinVel = 0;
		this.onSettled?.();
	}

	// ── layout ─────────────────────────────────────────────────────────────

	_resize() {
		if (this.disposed) return;
		const w = Math.max(1, this.host.clientWidth);
		const h = Math.max(1, this.host.clientHeight);
		this.renderer.setSize(w, h, false);
		this.composer.setPixelRatio(this.renderer.getPixelRatio());
		this.composer.setSize(w, h);
		this.camera.aspect = w / h;
		this._fitCamera();
	}

	_fitCamera() {
		if (!this.camera) return;
		const tanHalf = Math.tan((FOV * Math.PI) / 360);
		const distV = (CARD_H / 2) * 1.24 / tanHalf;
		const distW = ((this.cardW || CARD_H * DEFAULT_ASPECT) / 2) * 1.5 / (tanHalf * this.camera.aspect);
		this.baseZ = Math.max(distV, distW);
		this.camera.position.z = this.baseZ;
		this.camera.updateProjectionMatrix();
	}

	// ── reveal timeline ────────────────────────────────────────────────────

	_intro(dt) {
		const fx = this.fx;
		const B = fx.build;
		const t = this.t;
		if (t < B) {
			const k = t / B;
			this.capsule.scale.setScalar(Math.max(0.001, easeOutBack(clamp01(t / 0.42))));
			this.capsule.rotation.y += dt * (1.6 + 11 * k * k);
			const jit = this.reduced ? 0 : k ** 3 * 0.07;
			this.capsule.position.set(Math.sin(t * 47) * jit, Math.sin(t * 39 + 1) * jit * 0.6, 0);
			this.capsule.rotation.z = Math.sin(t * 31) * jit * 3;
			// Light gathers: motes spiral in and the core and halo swell.
			if (k < 0.9) {
				this.sparks.emit(Math.ceil(dt * 90), (i, s) => {
					const a = Math.random() * TAU;
					const y = (Math.random() - 0.5) * 2.4;
					const r = 2 + Math.random() * 1.2;
					s.set(i, 'pos', Math.cos(a) * r, y, Math.sin(a) * r * 0.6);
					s.set(i, 'vel', 0, 0, 0);
					const c = this._buildColor(k);
					s.set(i, 'base', c.r, c.g, c.b);
					s.mode[i] = 1;
					s.drag[i] = 1.5;
					s.ttl[i] = 2;
				});
			}
			const c = this._buildColor(k);
			this.glow.material.color.copy(c);
			this.glow.scale.setScalar(1.2 + 2 * k * k);
			this.glow.material.opacity = 0.3 + 0.35 * k;
			this.core.material.color.copy(c).multiplyScalar(1 + 2 * k);
			this.core.scale.setScalar(0.4 + 0.5 * k + Math.sin(t * (8 + 20 * k)) * 0.06 * k);
			if (fx.tease && k > 0.72) this.capTopMat.color.lerpColors(new Color(0xe9ecf3), this.tierColor, clamp01((k - 0.72) / 0.2));
			this.bloom.strength = 0.55 + 0.45 * k;
			return;
		}
		if (!this.cracked) this._crack();
		const s = t - B;
		this._halves(dt, s);

		// The card spins out of the capsule and lands face up.
		const kc = clamp01(s / CARD_IN_S);
		this.card3d.visible = true;
		this.card3d.scale.setScalar(0.12 + 0.88 * easeOutBack(kc));
		this.card3d.position.set(0, -0.35 * (1 - easeOutCubic(kc)), 0);
		this.spin = (1 - easeOutCubic(kc)) * (Math.PI + TAU * fx.turns);
		const flash = Math.max(0, 1 - s / 0.5);
		this.frontMat.uniforms.uFlash.value = flash;
		this.backMat.uniforms.uFlash.value = flash;
		this.glow.scale.setScalar(AURA_SCALE + Math.max(0, 1 - s / 0.6) * 3);
		this.glow.material.opacity = AURA_OPACITY + Math.max(0, 1 - s / 0.8) * 0.45;

		if (fx.encore && !this.encored && s >= CARD_IN_S + 0.05) {
			this.encored = true;
			this._burst(180, new Color(0xffd36a), 3.4);
			this._ring(0);
			this.bloomKick = 1;
		}
		if (s >= SETTLE_S + (fx.encore ? 0.15 : 0)) this._settle();
	}

	_buildColor(k) {
		if (!this.fx.tease || k < 0.72) return new Color(1, 1, 1);
		return new Color(1, 1, 1).lerp(this.tierColor, clamp01((k - 0.72) / 0.2));
	}

	_crack() {
		this.cracked = true;
		this.capTopMat.color.copy(this.tierColor);
		this.core.visible = false;
		this.glow.material.color.copy(this.tierColor);
		this.sparks.clear();
		this._burst(this.fx.sparks, this.tierColor, 4.2);
		this._ring(0);
		this._ring(1);
		if (this.fx.pillar >= 1) this._ring(2, 0.18);
		this.pillar.visible = true;
		this.pillarT = 0;
		this.shake = this.fx.shake;
		this.bloomKick = 1;
		if (!this.reduced) {
			this.flash.classList.remove('is-on');
			void this.flash.offsetWidth;
			this.flash.classList.add('is-on');
		}
		this.halfVel = { top: { y: 2.8, z: -0.8, spin: 6 }, bot: { y: -2.4, z: 0.5, spin: -5 } };
	}

	_halves(dt, s) {
		if (!this.capsule.visible) return;
		const v = this.halfVel;
		this.capTop.position.y += v.top.y * dt;
		this.capTop.position.z += v.top.z * dt;
		this.capTop.rotation.x += v.top.spin * dt;
		this.capBot.position.y += v.bot.y * dt;
		this.capBot.position.z += v.bot.z * dt;
		this.capBot.rotation.x += v.bot.spin * dt;
		const fade = Math.max(0, 1 - s / 0.7);
		this.capTopMat.opacity = fade;
		this.capBotMat.opacity = 0.55 * fade;
		if (fade <= 0) this._crackCleanup();
	}

	_crackCleanup() {
		this.capsule.visible = false;
	}

	_burst(count, color, speed) {
		const white = new Color(1, 1, 1);
		this.sparks.emit(count, (i, s) => {
			const u = Math.random() * 2 - 1;
			const a = Math.random() * TAU;
			const r = Math.sqrt(1 - u * u);
			const sp = speed * (0.35 + Math.random() * 0.75);
			s.set(i, 'pos', 0, 0, 0);
			s.set(i, 'vel', r * Math.cos(a) * sp, u * sp * 0.8 + 0.6, r * Math.sin(a) * sp * 0.6);
			const c = color.clone().lerp(white, Math.random() * 0.45).multiplyScalar(1.6 + Math.random() * 1.6);
			s.set(i, 'base', c.r, c.g, c.b);
			s.grav[i] = 2.2;
			s.drag[i] = 1.4;
			s.ttl[i] = 0.9 + Math.random() * 1.1;
		});
	}

	_ring(i, delay = 0) {
		const r = this.rings[i];
		r.t = -delay;
		r.mesh.visible = false;
	}

	// ── frame ──────────────────────────────────────────────────────────────

	_frame(now) {
		if (this.disposed) return;
		const dt = Math.min(0.05, (now - this._last) / 1000);
		this._last = now;
		this.t += dt;
		const time = this.t;

		if (this.mode === 'intro') this._intro(dt);
		else this._idle(dt);

		// Effects that outlive the intro.
		if (this.pillar.visible) {
			this.pillarT += dt;
			const k = this.pillarT / 1.6;
			const open = easeOutCubic(clamp01(this.pillarT / 0.18));
			this.pillar.scale.set(Math.max(0.05, open * (1 - 0.6 * clamp01(k))), 1, Math.max(0.05, open * (1 - 0.6 * clamp01(k))));
			this.pillar.material.uniforms.uAlpha.value = this.fx.pillar * (1 - clamp01(k)) ** 1.2;
			this.pillar.material.uniforms.uTime.value = time;
			if (k >= 1) this.pillar.visible = false;
		}
		for (const r of this.rings) {
			if (r.t === -1 && !r.mesh.visible) continue;
			r.t += dt;
			if (r.t < 0) continue;
			const k = r.t / r.dur;
			if (k >= 1) { r.t = -1; r.mesh.visible = false; continue; }
			r.mesh.visible = true;
			r.mesh.scale.setScalar(0.3 + easeOutCubic(k) * r.max);
			r.mesh.material.opacity = (1 - k) ** 1.5;
		}
		this.sparks.update(dt);
		this.dust.update(dt);

		if (this.shake > 0) {
			this.shake *= Math.exp(-dt * 5);
			if (this.shake < 0.001) this.shake = 0;
		}
		this.camera.position.x = this.shake ? Math.sin(time * 61) * this.shake : 0;
		this.camera.position.y = this.shake ? Math.cos(time * 53) * this.shake : 0;

		if (this.bloomKick > 0) this.bloomKick = Math.max(0, this.bloomKick - dt * 1.6);
		if (this.mode === 'idle' || this.cracked) this.bloom.strength = 0.55 + this.bloomKick * 1.5;

		const sweep = this.reduced ? 0.3 : -1.6 + ((time * 0.32) % 1) * 3.6;
		for (const m of [this.frontMat, this.backMat]) {
			m.uniforms.uTime.value = time;
			m.uniforms.uSweep.value = sweep;
		}
		this.card3d.rotation.y = this.spin + this.hover.x * 0.32 + (this.mode === 'idle' && !this.reduced && !this.drag ? Math.sin(time * 0.7) * 0.09 : 0);
		this.card3d.rotation.x = this.hover.y * 0.22 + (this.mode === 'idle' && !this.reduced ? Math.sin(time * 0.9) * 0.035 : 0);

		this.composer.render(dt);
		this._raf = requestAnimationFrame((n) => this._frame(n));
	}

	_idle(dt) {
		const time = this.t;
		// Entering the inspector without the capsule: a short scale-in.
		if (this.enter) {
			this.enter.t += dt;
			const k = clamp01(this.enter.t / 0.45);
			this.card3d.scale.setScalar(0.85 + 0.15 * easeOutBack(k));
			if (k >= 1) this.enter = null;
		}
		const ease = 1 - Math.exp(-dt * 8);
		this.hover.lerp(this.hoverTarget, ease);
		if (this.flipAnim) {
			const f = this.flipAnim;
			f.t += dt;
			const k = clamp01(f.t / f.dur);
			this.spin = f.from + (f.to - f.from) * easeInOut(k);
			if (k >= 1) this.flipAnim = null;
		} else if (!this.drag) {
			this.spin += this.spinVel * dt;
			this.spinVel *= Math.exp(-dt * 2.6);
			if (Math.abs(this.spinVel) < 1.2) {
				this.spinVel = 0;
				const target = Math.round(this.spin / Math.PI) * Math.PI;
				this.spin += (target - this.spin) * (1 - Math.exp(-dt * 6));
			}
		}
		if (!this.reduced) {
			this.card3d.position.y = Math.sin(time * 1.3) * 0.035;
			this.glow.material.opacity = AURA_OPACITY + Math.sin(time * 1.6) * 0.05;
			// A slow drift of motes in the tier colour keeps the stage alive.
			if (this.dust.n < 60 && Math.random() < dt * 14) {
				this.dust.emit(1, (i, s) => {
					s.set(i, 'pos', (Math.random() - 0.5) * 3, -1.3 + Math.random() * 0.6, -0.5 - Math.random() * 0.8);
					s.set(i, 'vel', (Math.random() - 0.5) * 0.08, 0.2 + Math.random() * 0.25, 0);
					const c = this.tierColor.clone().multiplyScalar(0.9 + Math.random() * 0.8);
					s.set(i, 'base', c.r, c.g, c.b);
					s.ttl[i] = 3 + Math.random() * 3;
				});
			}
		}
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		cancelAnimationFrame(this._raf);
		this._ro?.disconnect();
		const c = this.canvas;
		c.removeEventListener('pointerdown', this._onDown);
		c.removeEventListener('pointermove', this._onMove);
		c.removeEventListener('pointerup', this._onUp);
		c.removeEventListener('pointercancel', this._onUp);
		c.removeEventListener('pointerleave', this._onLeave);
		c.removeEventListener('keydown', this._onKey);
		c.removeEventListener('dblclick', this._onDbl);
		c.removeEventListener('webglcontextlost', this._onLost);
		this.scene.traverse((n) => {
			if (n.geometry) n.geometry.dispose();
			if (n.material) n.material.dispose();
		});
		for (const tex of this._textures) tex.dispose();
		this.envTex?.dispose();
		this.pmrem?.dispose();
		this.composer?.dispose?.();
		this.renderer.dispose();
		this.renderer.forceContextLoss?.();
		c.remove();
		this.flash.remove();
	}
}
