// The card gacha machine, a walk-up vending machine on the /play plaza that
// pulls real, professionally graded trading cards from Collector Crypt.
//
// This module is the landmark only: a procedural, lit capsule vending machine
// (glossy cabinet, glass globe full of two-tone capsules, chasing marquee bulbs,
// a chrome crank, a live price display and a "last pull" card window fed by the
// real recent-winners feed), a walk-up prompt, and the pull/reveal animations.
// Pressing E lazy-imports the pull modal (gacha-ui.js, which drags in
// @solana/web3.js for signing), so none of that weight touches the /play bundle.
//
// Where it stands comes from multiplayer/src/world-features.js GACHA, the same
// registry every other station's range check reads.

import {
	Group, Mesh, InstancedMesh, Object3D, Color, CanvasTexture, TextureLoader, SRGBColorSpace,
	BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, PlaneGeometry, RingGeometry, CircleGeometry,
	MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial,
	DoubleSide, AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GACHA, gachaInRange } from '../../multiplayer/src/world-features.js';
import { gachaApi, gachaNet, cardImageUrl, pickFeatured, TIER_STYLE, usd } from './gacha-client.js';
import { prefersReducedMotion } from './a11y.js';

// Cabinet dimensions (metres). The machine is ~2.3 m to the top of the
// marquee: a touch taller than an avatar, the scale of a real arcade unit.
const W = 1.1;
const D = 0.78;
const BASE_H = 0.98;
const GLOBE_H = 0.92;
const MARQUEE_H = 0.34;
const GLOBE_Y = 0.1 + BASE_H; // bottom of the glass section
const MARQUEE_Y = GLOBE_Y + GLOBE_H; // bottom of the marquee

const CAPSULE_COUNT = 64;
const CAPSULE_R = 0.072;
const CAPSULE_COLORS = [0xff4d6d, 0xffc43d, 0x3fb6ff, 0x7bd88f, 0xb06bff, 0xff8a3d, 0xf5f5f5, 0x4de1d2];
const BULB_COUNT = 26;

// Only ask for live data while someone could actually see it.
const LIVE_RADIUS = 45;
const WINNERS_EVERY_S = 30;
const MACHINES_EVERY_S = 120;

function el(tag, props = {}) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') n.className = v;
		else if (k === 'text') n.textContent = v;
		else if (k === 'hidden') n.hidden = !!v;
		else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
		else if (v != null) n.setAttribute(k, v);
	}
	return n;
}

// Deterministic PRNG so every client builds the identical capsule pile.
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function canvasTexture(w, h, draw) {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	draw(c.getContext('2d'), w, h);
	const tex = new CanvasTexture(c);
	tex.colorSpace = SRGBColorSpace;
	tex.anisotropy = 4;
	return tex;
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

export class GachaStation {
	/**
	 * @param {object} opts
	 * @param {import('three').Scene} opts.scene
	 * @param {() => ({x,y,z})} opts.getPlayer  local avatar pose
	 */
	constructor({ scene, getPlayer }) {
		this.scene = scene;
		this.getPlayer = getPlayer;
		this._spot = GACHA[0];
		this._t = 0;
		this._near = false;
		this._ui = null; // the open GachaUI controller, or null
		this._opening = false;
		this._machine = null; // featured machine (price display)
		this._lastWinner = null;
		this._liveClock = { winners: WINNERS_EVERY_S, machines: MACHINES_EVERY_S };
		this._crank = { t: -1, dur: 1.3 };
		this._drop = { t: -1, dur: 1.1 };
		this._burst = { t: -1, dur: 1.6 };
		this._jiggle = 0;
		this._reduced = prefersReducedMotion();
		this._disposed = false;
		this._loader = new TextureLoader();
		this._ac = new AbortController();

		this._buildScene();
		this._buildPrompt();
	}

	// ── scene ──────────────────────────────────────────────────────────────

	_buildScene() {
		const s = this._spot;
		const g = new Group();
		g.name = 'gacha-machine';
		g.position.set(s.x, 0, s.z);
		g.rotation.y = s.yaw;
		this._group = g;

		const cabinet = new MeshPhysicalMaterial({ color: 0xd3243c, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06 });
		const trim = new MeshPhysicalMaterial({ color: 0xf4f1ea, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.15 });
		const chrome = new MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.12, metalness: 1 });
		const darkMetal = new MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.45, metalness: 0.6 });
		const rubber = new MeshStandardMaterial({ color: 0x111214, roughness: 0.9 });
		this._mats = { cabinet, trim, chrome, darkMetal, rubber };

		// Plinth + rubber feet.
		const plinth = new Mesh(new RoundedBoxGeometry(W + 0.14, 0.1, D + 0.14, 2, 0.03), darkMetal);
		plinth.position.y = 0.05;
		plinth.receiveShadow = true;
		g.add(plinth);

		// Lower cabinet: the coin mechanism, crank and prize chute live here.
		const base = new Mesh(new RoundedBoxGeometry(W, BASE_H, D, 4, 0.06), cabinet);
		base.position.y = 0.1 + BASE_H / 2;
		base.castShadow = true;
		base.receiveShadow = true;
		g.add(base);

		// Cream front fascia, inset a hair proud of the cabinet face.
		const fasciaH = BASE_H - 0.12;
		const fascia = new Mesh(new RoundedBoxGeometry(W - 0.12, fasciaH, 0.03, 3, 0.012), trim);
		fascia.position.set(0, 0.1 + BASE_H / 2, D / 2 + 0.006);
		g.add(fascia);
		const FRONT = D / 2 + 0.024; // z of the fascia's front face

		this._buildCardWindow(g, FRONT);
		this._buildControls(g, FRONT, chrome, darkMetal, rubber);
		this._buildChute(g, FRONT, darkMetal, chrome);
		this._buildGlobe(g, chrome, cabinet);
		this._buildMarquee(g, cabinet, chrome);

		// Ground halo: a soft additive glow pool plus the interaction ring, the
		// same walk-up affordance every /play station draws.
		const halo = new Mesh(
			new CircleGeometry(1.9, 40),
			new MeshBasicMaterial({ map: this._haloTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
		);
		halo.rotation.x = -Math.PI / 2;
		halo.position.set(0, 0.012, 0.35);
		g.add(halo);
		this._halo = halo;

		this._marker = new Mesh(
			new RingGeometry(s.r + 0.9, s.r + 1.06, 48),
			new MeshBasicMaterial({ color: 0xff5470, transparent: true, opacity: 0.2, side: DoubleSide, depthWrite: false }),
		);
		this._marker.rotation.x = -Math.PI / 2;
		this._marker.position.y = 0.03;
		g.add(this._marker);

		this._buildBurst(g);
		this.scene.add(g);
	}

	_haloTexture() {
		return canvasTexture(128, 128, (ctx, w, h) => {
			const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
			grd.addColorStop(0, 'rgba(255,90,120,0.55)');
			grd.addColorStop(0.45, 'rgba(255,70,110,0.18)');
			grd.addColorStop(1, 'rgba(255,60,100,0)');
			ctx.fillStyle = grd;
			ctx.fillRect(0, 0, w, h);
		});
	}

	// Left half of the fascia: a lit display window holding a graded "slab"
	// that shows the latest real card pulled from this machine.
	_buildCardWindow(g, FRONT) {
		const frame = new Mesh(new RoundedBoxGeometry(0.4, 0.62, 0.03, 3, 0.012), new MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.4 }));
		frame.position.set(-0.24, 0.66, FRONT + 0.012);
		g.add(frame);

		// Backlit field behind the slab.
		const back = new Mesh(new PlaneGeometry(0.36, 0.58), new MeshBasicMaterial({ color: 0x2a1018, toneMapped: false }));
		back.position.set(-0.24, 0.66, FRONT + 0.028);
		g.add(back);

		// The slab: a clear acrylic case with a label strip on top and the card.
		const slab = new Group();
		slab.position.set(-0.24, 0.655, FRONT + 0.04);
		const caseMesh = new Mesh(
			new RoundedBoxGeometry(0.27, 0.46, 0.018, 2, 0.008),
			new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, depthWrite: false }),
		);
		slab.add(caseMesh);
		this._slabLabelTex = canvasTexture(256, 64, (ctx, w, h) => this._drawSlabLabel(ctx, w, h, null));
		const label = new Mesh(new PlaneGeometry(0.25, 0.062), new MeshBasicMaterial({ map: this._slabLabelTex, toneMapped: false }));
		label.position.set(0, 0.185, 0.0095);
		slab.add(label);
		this._cardMat = new MeshBasicMaterial({ color: 0xffffff, map: this._cardPlaceholder(), toneMapped: false });
		const card = new Mesh(new PlaneGeometry(0.21, 0.293), this._cardMat);
		card.position.set(0, -0.035, 0.0095);
		slab.add(card);
		g.add(slab);
		this._slab = slab;

		// Caption under the window: "LAST PULL" plus the card's value.
		this._captionTex = canvasTexture(256, 48, (ctx, w, h) => this._drawCaption(ctx, w, h, null));
		const caption = new Mesh(new PlaneGeometry(0.36, 0.0675), new MeshBasicMaterial({ map: this._captionTex, toneMapped: false, transparent: true }));
		caption.position.set(-0.24, 0.31, FRONT + 0.005);
		g.add(caption);
	}

	_cardPlaceholder() {
		return canvasTexture(128, 178, (ctx, w, h) => {
			const grd = ctx.createLinearGradient(0, 0, w, h);
			grd.addColorStop(0, '#2b2f3a');
			grd.addColorStop(1, '#14161c');
			ctx.fillStyle = grd;
			ctx.fillRect(0, 0, w, h);
			ctx.strokeStyle = 'rgba(255,255,255,0.18)';
			ctx.lineWidth = 3;
			roundRect(ctx, 8, 8, w - 16, h - 16, 8);
			ctx.stroke();
			ctx.fillStyle = 'rgba(255,255,255,0.55)';
			ctx.font = '700 46px system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText('?', w / 2, h / 2);
		});
	}

	_drawSlabLabel(ctx, w, h, card) {
		ctx.fillStyle = '#f6f3ec';
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = '#c8102e';
		ctx.fillRect(0, 0, 10, h);
		ctx.fillStyle = '#16171b';
		ctx.textBaseline = 'middle';
		ctx.font = '700 17px system-ui, sans-serif';
		const name = card?.name || 'Graded card';
		ctx.fillText(name.length > 22 ? `${name.slice(0, 21)}…` : name, 18, h * 0.34);
		ctx.font = '600 13px system-ui, sans-serif';
		ctx.fillStyle = '#4a4d55';
		const sub = card ? [card.year, card.set].filter(Boolean).join(' ').slice(0, 30) : 'Pull to reveal';
		ctx.fillText(sub, 18, h * 0.72);
		if (card?.grader || card?.grade) {
			const gradeNum = String(card.grade || '').match(/\d+(\.\d+)?/)?.[0] || '';
			ctx.textAlign = 'right';
			ctx.font = '800 26px system-ui, sans-serif';
			ctx.fillStyle = '#16171b';
			ctx.fillText(gradeNum, w - 12, h * 0.42);
			ctx.font = '700 11px system-ui, sans-serif';
			ctx.fillStyle = '#c8102e';
			ctx.fillText(String(card.grader || '').slice(0, 6), w - 12, h * 0.8);
			ctx.textAlign = 'left';
		}
	}

	_drawCaption(ctx, w, h, card) {
		ctx.clearRect(0, 0, w, h);
		ctx.textBaseline = 'middle';
		ctx.font = '800 15px system-ui, sans-serif';
		ctx.fillStyle = '#c8102e';
		ctx.fillText('LAST PULL', 6, h / 2);
		if (card) {
			const tier = TIER_STYLE[card.tier];
			const right = [tier?.label, card.insuredValue ? usd(card.insuredValue, { cents: false }) : null].filter(Boolean).join(' · ');
			ctx.textAlign = 'right';
			ctx.fillStyle = '#16171b';
			ctx.font = '700 15px system-ui, sans-serif';
			ctx.fillText(right, w - 6, h / 2);
			ctx.textAlign = 'left';
		}
	}

	// Right half: price display, coin slot, crank.
	_buildControls(g, FRONT, chrome, darkMetal, rubber) {
		// Price LCD.
		const bezel = new Mesh(new RoundedBoxGeometry(0.38, 0.17, 0.03, 2, 0.012), darkMetal);
		bezel.position.set(0.24, 0.88, FRONT + 0.012);
		g.add(bezel);
		this._lcdTex = canvasTexture(320, 128, (ctx, w, h) => this._drawLcd(ctx, w, h));
		const lcd = new Mesh(new PlaneGeometry(0.34, 0.136), new MeshBasicMaterial({ map: this._lcdTex, toneMapped: false }));
		lcd.position.set(0.24, 0.88, FRONT + 0.028);
		g.add(lcd);

		// Coin slot with a chrome bezel and a lit "insert" arrow.
		const slotPlate = new Mesh(new RoundedBoxGeometry(0.15, 0.17, 0.025, 2, 0.01), chrome);
		slotPlate.position.set(0.39, 0.66, FRONT + 0.01);
		g.add(slotPlate);
		const slot = new Mesh(new BoxGeometry(0.018, 0.09, 0.02), rubber);
		slot.position.set(0.39, 0.67, FRONT + 0.022);
		g.add(slot);
		this._slotLight = new Mesh(new PlaneGeometry(0.05, 0.016), new MeshBasicMaterial({ color: 0x35ff9a, toneMapped: false }));
		this._slotLight.position.set(0.39, 0.6, FRONT + 0.024);
		g.add(this._slotLight);

		// The crank: a chrome hub plate, a turning disc, and a T-handle.
		const hub = new Mesh(new CylinderGeometry(0.13, 0.14, 0.03, 40), chrome);
		hub.rotation.x = Math.PI / 2;
		hub.position.set(0.13, 0.63, FRONT + 0.015);
		g.add(hub);
		const crank = new Group();
		crank.position.set(0.13, 0.63, FRONT + 0.035);
		const disc = new Mesh(new CylinderGeometry(0.1, 0.1, 0.025, 40), new MeshPhysicalMaterial({ color: 0xd3243c, roughness: 0.25, clearcoat: 1 }));
		disc.rotation.x = Math.PI / 2;
		crank.add(disc);
		const bar = new Mesh(new BoxGeometry(0.2, 0.034, 0.05), chrome);
		bar.position.z = 0.03;
		crank.add(bar);
		for (const sx of [-1, 1]) {
			const knob = new Mesh(new SphereGeometry(0.026, 16, 12), chrome);
			knob.position.set(sx * 0.1, 0, 0.04);
			crank.add(knob);
		}
		const cap = new Mesh(new CylinderGeometry(0.03, 0.03, 0.03, 20), chrome);
		cap.rotation.x = Math.PI / 2;
		cap.position.z = 0.06;
		crank.add(cap);
		g.add(crank);
		this._crankGroup = crank;
	}

	_drawLcd(ctx, w, h) {
		ctx.fillStyle = '#071510';
		ctx.fillRect(0, 0, w, h);
		// Subtle scanlines so it reads as a real segment display.
		ctx.fillStyle = 'rgba(0,0,0,0.25)';
		for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
		const m = this._machine;
		ctx.textBaseline = 'middle';
		ctx.shadowColor = '#35ff9a';
		ctx.shadowBlur = 10;
		ctx.fillStyle = '#7dffbf';
		if (!m) {
			ctx.font = '700 28px ui-monospace, monospace';
			ctx.textAlign = 'center';
			ctx.fillText(this._lcdError ? 'OFFLINE' : 'LOADING', w / 2, h / 2);
			return;
		}
		ctx.textAlign = 'left';
		const price = usd(m.price, { cents: false });
		ctx.font = '800 50px ui-monospace, monospace';
		const priceW = ctx.measureText(price).width;
		ctx.fillText(price, 14, h * 0.4);
		ctx.font = '700 20px ui-monospace, monospace';
		ctx.fillText('USDC', 14 + priceW + 10, h * 0.46);
		ctx.font = '700 17px ui-monospace, monospace';
		ctx.fillStyle = '#4fd894';
		const sub = `${(m.shortName || m.name || '').toUpperCase().slice(0, 14)}  ${m.totalStock} LEFT`;
		ctx.fillText(sub, 14, h * 0.8);
		if (gachaNet() === 'devnet') {
			ctx.textAlign = 'right';
			ctx.fillStyle = '#ffd34d';
			ctx.fillText('DEVNET', w - 12, h * 0.2);
		}
	}

	// Prize chute: a dark recess with a smoked, hinged flap.
	_buildChute(g, FRONT, darkMetal, chrome) {
		const surround = new Mesh(new RoundedBoxGeometry(0.4, 0.2, 0.04, 2, 0.015), chrome);
		surround.position.set(0.24, 0.3, FRONT + 0.01);
		g.add(surround);
		const recess = new Mesh(new BoxGeometry(0.34, 0.15, 0.03), new MeshStandardMaterial({ color: 0x050506, roughness: 1 }));
		recess.position.set(0.24, 0.3, FRONT + 0.02);
		g.add(recess);
		const flapPivot = new Group();
		flapPivot.position.set(0.24, 0.375, FRONT + 0.04);
		const flap = new Mesh(
			new PlaneGeometry(0.34, 0.15),
			new MeshPhysicalMaterial({ color: 0x2a2d33, roughness: 0.15, transparent: true, opacity: 0.72, clearcoat: 1, side: DoubleSide }),
		);
		flap.position.y = -0.075;
		flapPivot.add(flap);
		g.add(flapPivot);
		this._flap = flapPivot;
		this._chuteFront = { x: 0.24, y: 0.3, z: FRONT + 0.04 };

		// The capsule that drops out on a pull (hidden until then).
		const prize = this._makeCapsule(0xffc43d);
		prize.visible = false;
		g.add(prize);
		this._prize = prize;
	}

	_makeCapsule(colorHex) {
		const cap = new Group();
		const top = new Mesh(new SphereGeometry(CAPSULE_R * 1.25, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new MeshPhysicalMaterial({ color: colorHex, roughness: 0.2, clearcoat: 1 }));
		const bottom = new Mesh(
			new SphereGeometry(CAPSULE_R * 1.25, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
			new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1 }),
		);
		const band = new Mesh(new TorusGeometry(CAPSULE_R * 1.25, 0.006, 8, 24), new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
		band.rotation.x = Math.PI / 2;
		cap.add(top, bottom, band);
		cap.userData.topMat = top.material;
		return cap;
	}

	// The glass globe: chrome corner posts, a lit back panel, a pile of
	// two-tone capsules, and the glass itself drawn last.
	_buildGlobe(g, chrome, cabinet) {
		const inner = { w: W - 0.12, d: D - 0.12, h: GLOBE_H };
		for (const sx of [-1, 1]) {
			for (const sz of [-1, 1]) {
				const post = new Mesh(new CylinderGeometry(0.026, 0.026, GLOBE_H, 16), chrome);
				post.position.set(sx * (W / 2 - 0.04), GLOBE_Y + GLOBE_H / 2, sz * (D / 2 - 0.04));
				post.castShadow = true;
				g.add(post);
			}
		}
		// Capsule floor (a shallow red tray) and the lit back panel.
		const tray = new Mesh(new BoxGeometry(inner.w, 0.03, inner.d), cabinet);
		tray.position.y = GLOBE_Y + 0.015;
		g.add(tray);
		const backTex = canvasTexture(64, 256, (ctx, w, h) => {
			const grd = ctx.createLinearGradient(0, 0, 0, h);
			grd.addColorStop(0, '#ff6f8c');
			grd.addColorStop(0.55, '#c51d47');
			grd.addColorStop(1, '#5a0a24');
			ctx.fillStyle = grd;
			ctx.fillRect(0, 0, w, h);
		});
		const back = new Mesh(new PlaneGeometry(inner.w, inner.h), new MeshBasicMaterial({ map: backTex, toneMapped: false }));
		back.position.set(0, GLOBE_Y + inner.h / 2, -inner.d / 2 + 0.005);
		g.add(back);

		// Capsule pile: a jittered hex-ish packing, deterministic so every
		// client sees the same pile. Two instanced halves (coloured top, clear
		// bottom) keep it to two draw calls.
		const rnd = mulberry32(0x6ac4a);
		const topGeo = new SphereGeometry(CAPSULE_R, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
		const botGeo = new SphereGeometry(CAPSULE_R, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
		const topMesh = new InstancedMesh(topGeo, new MeshPhysicalMaterial({ roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1 }), CAPSULE_COUNT);
		const botMesh = new InstancedMesh(botGeo, new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.08, transparent: true, opacity: 0.6, clearcoat: 1 }), CAPSULE_COUNT);
		const dummy = new Object3D();
		const color = new Color();
		const step = CAPSULE_R * 2.05;
		const cols = Math.floor((inner.w - 0.04) / step);
		const rows = Math.floor((inner.d - 0.04) / step);
		this._capsules = [];
		let i = 0;
		for (let layer = 0; i < CAPSULE_COUNT; layer++) {
			const off = layer % 2 ? step / 2 : 0;
			for (let r = 0; r < rows && i < CAPSULE_COUNT; r++) {
				for (let c = 0; c < cols && i < CAPSULE_COUNT; c++) {
					// The top layer thins out into a natural mound, not a flat slab.
					if (layer >= 2 && rnd() < 0.35 + (layer - 2) * 0.25) continue;
					const x = -inner.w / 2 + 0.04 + CAPSULE_R + c * step + off + (rnd() - 0.5) * 0.02;
					const z = -inner.d / 2 + 0.04 + CAPSULE_R + r * step + off * 0.5 + (rnd() - 0.5) * 0.02;
					if (Math.abs(x) > inner.w / 2 - CAPSULE_R || Math.abs(z) > inner.d / 2 - CAPSULE_R) continue;
					const y = GLOBE_Y + 0.03 + CAPSULE_R + layer * CAPSULE_R * 1.7 + rnd() * 0.012;
					const rot = { x: (rnd() - 0.5) * 2.2, y: rnd() * Math.PI * 2, z: (rnd() - 0.5) * 2.2 };
					this._capsules.push({ x, y, z, rot, phase: rnd() * Math.PI * 2 });
					color.setHex(CAPSULE_COLORS[Math.floor(rnd() * CAPSULE_COLORS.length)]);
					topMesh.setColorAt(i, color);
					i++;
				}
			}
			if (layer > 8) break;
		}
		topMesh.count = botMesh.count = this._capsules.length;
		this._capsuleMeshes = [topMesh, botMesh];
		this._dummy = dummy;
		this._writeCapsules(0);
		topMesh.instanceColor.needsUpdate = true;
		g.add(topMesh, botMesh);

		// Glass last, double-sided, no depth write, so the pile reads through it.
		const glass = new Mesh(
			new BoxGeometry(W - 0.07, GLOBE_H, D - 0.07),
			new MeshPhysicalMaterial({
				color: 0xffffff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.13,
				clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, depthWrite: false, side: DoubleSide,
			}),
		);
		glass.position.y = GLOBE_Y + GLOBE_H / 2;
		glass.renderOrder = 2;
		g.add(glass);
	}

	_writeCapsules(shake) {
		const [topMesh, botMesh] = this._capsuleMeshes;
		const d = this._dummy;
		for (let i = 0; i < this._capsules.length; i++) {
			const c = this._capsules[i];
			const j = shake ? Math.sin(this._t * 38 + c.phase) * shake : 0;
			d.position.set(c.x + j * 0.6, c.y + Math.abs(j), c.z - j * 0.4);
			d.rotation.set(c.rot.x + j * 4, c.rot.y, c.rot.z - j * 4);
			d.updateMatrix();
			topMesh.setMatrixAt(i, d.matrix);
			botMesh.setMatrixAt(i, d.matrix);
		}
		topMesh.instanceMatrix.needsUpdate = true;
		botMesh.instanceMatrix.needsUpdate = true;
	}

	// The marquee: a rounded header box, a printed front sign, and a ring of
	// chasing bulbs (one instanced mesh whose per-bulb colour is the chase).
	_buildMarquee(g, cabinet, chrome) {
		const head = new Mesh(new RoundedBoxGeometry(W + 0.06, MARQUEE_H, D + 0.04, 4, 0.06), cabinet);
		head.position.y = MARQUEE_Y + MARQUEE_H / 2;
		head.castShadow = true;
		g.add(head);
		const lip = new Mesh(new BoxGeometry(W + 0.08, 0.025, D + 0.06), chrome);
		lip.position.y = MARQUEE_Y + 0.0125;
		g.add(lip);

		const signTex = canvasTexture(512, 144, (ctx, w, h) => {
			const grd = ctx.createLinearGradient(0, 0, 0, h);
			grd.addColorStop(0, '#fff4d6');
			grd.addColorStop(1, '#ffd98a');
			ctx.fillStyle = grd;
			roundRect(ctx, 0, 0, w, h, 18);
			ctx.fill();
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.font = '900 72px system-ui, sans-serif';
			ctx.lineWidth = 10;
			ctx.strokeStyle = '#7a0a22';
			ctx.strokeText('CARD GACHA', w / 2, h * 0.42);
			ctx.fillStyle = '#e8203f';
			ctx.fillText('CARD GACHA', w / 2, h * 0.42);
			ctx.font = '700 22px system-ui, sans-serif';
			ctx.fillStyle = '#7a0a22';
			ctx.fillText('REAL GRADED CARDS  ·  COLLECTOR CRYPT', w / 2, h * 0.82);
		});
		const signW = W - 0.12;
		const signH = signW * (144 / 512);
		const sign = new Mesh(new PlaneGeometry(signW, signH), new MeshBasicMaterial({ map: signTex, toneMapped: false }));
		sign.position.set(0, MARQUEE_Y + MARQUEE_H / 2, D / 2 + 0.021);
		g.add(sign);

		// Bulbs around the sign's border.
		const bulbs = new InstancedMesh(new SphereGeometry(0.016, 10, 8), new MeshBasicMaterial({ toneMapped: false }), BULB_COUNT);
		const d = new Object3D();
		const perim = 2 * (signW + signH);
		const bw = signW / 2 + 0.03;
		const bh = signH / 2 + 0.025;
		for (let i = 0; i < BULB_COUNT; i++) {
			let u = (i / BULB_COUNT) * perim * 1.04;
			let x;
			let y;
			const sw = (bw * 2);
			const sh = (bh * 2);
			if (u < sw) { x = -bw + u; y = bh; } else if ((u -= sw) < sh) { x = bw; y = bh - u; } else if ((u -= sh) < sw) { x = bw - u; y = -bh; } else { u -= sw; x = -bw; y = -bh + Math.min(u, sh); }
			d.position.set(x, MARQUEE_Y + MARQUEE_H / 2 + y, D / 2 + 0.03);
			d.updateMatrix();
			bulbs.setMatrixAt(i, d.matrix);
			bulbs.setColorAt(i, new Color(0xfff1c2));
		}
		bulbs.instanceMatrix.needsUpdate = true;
		g.add(bulbs);
		this._bulbs = bulbs;
		this._bulbOn = new Color(0xfff1c2).multiplyScalar(1.6);
		this._bulbOff = new Color(0x5a3a22);
		this._bulbAlt = new Color(0xff5c7a).multiplyScalar(1.4);
	}

	// Rarity burst: a cloud of additive sparks that blooms out of the chute.
	_buildBurst(g) {
		const N = 90;
		const pos = new Float32Array(N * 3);
		const vel = [];
		const rnd = mulberry32(0xb0b);
		for (let i = 0; i < N; i++) {
			const a = rnd() * Math.PI * 2;
			const up = 0.6 + rnd() * 1.4;
			const sp = 0.6 + rnd() * 1.2;
			vel.push({ x: Math.cos(a) * sp, y: up, z: Math.abs(Math.sin(a)) * sp + 0.3 });
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
		const mat = new PointsMaterial({ size: 0.07, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
		const pts = new Points(geo, mat);
		pts.visible = false;
		pts.frustumCulled = false;
		g.add(pts);
		this._burstPts = pts;
		this._burstVel = vel;
	}

	_buildPrompt() {
		this.btn = el('button', { class: 'ps-action ga-action', type: 'button', hidden: true, 'aria-label': 'Open the card gacha machine (E)', onclick: () => this.interact() });
		this.btn.append(el('span', { text: 'Pull a card' }), el('kbd', { class: 'ga-key', text: 'E' }));
		document.body.appendChild(this.btn);
	}

	// ── live data ──────────────────────────────────────────────────────────

	async _refreshMachines() {
		try {
			const { machines } = await gachaApi('machines', { signal: this._ac.signal });
			if (this._disposed) return;
			this._lcdError = false;
			const featured = pickFeatured(machines);
			const changed = featured?.code !== this._machine?.code;
			this._machine = featured;
			this._redraw(this._lcdTex, (ctx, w, h) => this._drawLcd(ctx, w, h));
			if (changed) this._liveClock.winners = WINNERS_EVERY_S;
		} catch {
			if (this._disposed) return;
			this._lcdError = !this._machine;
			this._redraw(this._lcdTex, (ctx, w, h) => this._drawLcd(ctx, w, h));
		}
	}

	async _refreshWinners() {
		if (!this._machine) return;
		try {
			const { winners } = await gachaApi('winners', { query: { code: this._machine.code }, signal: this._ac.signal });
			if (this._disposed) return;
			const latest = (winners || []).find((w) => w.image) || null;
			if (latest) this.showCard(latest);
		} catch {
			// The window keeps showing whatever it last had; the next tick retries.
		}
	}

	/** Put a card in the front display window (the latest pull, or the player's own). */
	showCard(card) {
		if (!card || this._disposed) return;
		const key = card.address || card.image;
		if (key && key === this._lastWinner) return;
		this._lastWinner = key;
		this._redraw(this._slabLabelTex, (ctx, w, h) => this._drawSlabLabel(ctx, w, h, card));
		this._redraw(this._captionTex, (ctx, w, h) => this._drawCaption(ctx, w, h, card));
		const src = cardImageUrl(card.image, 256);
		if (!src) return;
		this._loader.load(src, (tex) => {
			if (this._disposed) { tex.dispose(); return; }
			tex.colorSpace = SRGBColorSpace;
			tex.anisotropy = 4;
			const old = this._cardMat.map;
			this._cardMat.map = tex;
			this._cardMat.needsUpdate = true;
			old?.dispose?.();
		}, undefined, () => { /* art unavailable: keep the current face */ });
	}

	_redraw(tex, draw) {
		const c = tex.image;
		draw(c.getContext('2d'), c.width, c.height);
		tex.needsUpdate = true;
	}

	// ── animation hooks for the UI ───────────────────────────────────────

	/** Turn the crank and rattle the pile: the player just paid. */
	playCrank() {
		this._crank.t = 0;
		this._jiggle = 1;
	}

	/** Drop a capsule into the chute and burst in the rarity's colour. */
	playReveal(card) {
		const tier = TIER_STYLE[card?.tier] || TIER_STYLE.common;
		this._prize.userData.topMat.color.set(tier.color);
		this._prize.visible = true;
		this._drop.t = 0;
		this._burstPts.material.color.set(tier.color);
		this._burst.t = 0;
		if (card) {
			this._lastWinner = null;
			this.showCard(card);
		}
	}

	// ── frame ──────────────────────────────────────────────────────────────

	tick(dt) {
		if (this._disposed) return;
		this._t += dt;
		const p = this.getPlayer?.();
		const near = !!(p && gachaInRange(p.x, p.z));
		if (near !== this._near) {
			this._near = near;
			this.btn.hidden = !near || !!this._ui;
		}

		// Live data only while the machine is within sight of the player.
		const dist = p ? Math.hypot(p.x - this._spot.x, p.z - this._spot.z) : Infinity;
		if (dist < LIVE_RADIUS) {
			this._liveClock.machines += dt;
			this._liveClock.winners += dt;
			if (this._liveClock.machines >= MACHINES_EVERY_S) { this._liveClock.machines = 0; this._refreshMachines(); }
			if (this._machine && this._liveClock.winners >= WINNERS_EVERY_S) { this._liveClock.winners = 0; this._refreshWinners(); }
		}
		if (dist > 90) return; // nothing below is visible from this far out

		// Ground ring and halo breathe; brighter when the player is in range.
		const pulse = 0.5 + 0.5 * Math.sin(this._t * 1.8);
		this._marker.material.opacity = near ? 0.4 + pulse * 0.25 : 0.14 + pulse * 0.08;
		this._halo.material.opacity = 0.75 + pulse * 0.25;

		// Chasing marquee: every third bulb lit, marching; alternate colour
		// sweep while a pull is in flight.
		const busy = this._crank.t >= 0 || this._drop.t >= 0;
		const step = this._reduced ? 0 : Math.floor(this._t * (busy ? 18 : 6));
		for (let i = 0; i < BULB_COUNT; i++) {
			const on = this._reduced ? true : (i + step) % 3 === 0;
			this._bulbs.setColorAt(i, on ? (busy && i % 2 ? this._bulbAlt : this._bulbOn) : this._bulbOff);
		}
		this._bulbs.instanceColor.needsUpdate = true;
		this._slotLight.material.color.setHex(Math.sin(this._t * 4) > 0 || this._reduced ? 0x35ff9a : 0x0c4a2c);

		// Crank: one full ease-in-out turn.
		if (this._crank.t >= 0) {
			this._crank.t += dt;
			const k = Math.min(1, this._crank.t / this._crank.dur);
			const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
			this._crankGroup.rotation.z = -e * Math.PI * 2;
			if (k >= 1) { this._crank.t = -1; this._crankGroup.rotation.z = 0; }
		}
		if (this._jiggle > 0) {
			this._jiggle = Math.max(0, this._jiggle - dt * 0.8);
			this._writeCapsules(this._reduced ? 0 : this._jiggle * 0.012);
		}

		// Capsule drop: falls behind the flap, swings it open, rolls out.
		if (this._drop.t >= 0) {
			this._drop.t += dt;
			const k = Math.min(1, this._drop.t / this._drop.dur);
			const c = this._chuteFront;
			// Phase 1 slides it from inside the cabinet up against the flap
			// (hidden by the recess); phase 2 pushes the flap and rolls it out.
			const pushIn = Math.min(1, k / 0.35);
			const out = Math.max(0, (k - 0.35) / 0.65);
			this._prize.position.set(c.x, c.y - out * 0.12 + Math.sin(out * Math.PI) * 0.06, c.z - 0.2 + pushIn * 0.14 + out * 0.32);
			this._prize.rotation.set(out * 5, 0, out * 2);
			this._flap.rotation.x = -Math.sin(Math.min(1, out * 1.6) * Math.PI) * 1.1;
			if (k >= 1) {
				this._drop.t = -1;
				this._flap.rotation.x = 0;
				this._prizeHold = 2.5;
			}
		} else if (this._prizeHold > 0) {
			this._prizeHold -= dt;
			this._prize.rotation.y += dt * 2;
			if (this._prizeHold <= 0) this._prize.visible = false;
		}

		// Spark burst.
		if (this._burst.t >= 0) {
			this._burst.t += dt;
			const k = this._burst.t / this._burst.dur;
			const pts = this._burstPts;
			pts.visible = true;
			const arr = pts.geometry.attributes.position.array;
			const c = this._chuteFront;
			const tt = this._burst.t;
			for (let i = 0; i < this._burstVel.length; i++) {
				const v = this._burstVel[i];
				arr[i * 3] = c.x + v.x * tt;
				arr[i * 3 + 1] = c.y + 0.1 + v.y * tt - 1.6 * tt * tt;
				arr[i * 3 + 2] = c.z + v.z * tt;
			}
			pts.geometry.attributes.position.needsUpdate = true;
			pts.material.opacity = Math.max(0, 1 - k);
			if (k >= 1) { this._burst.t = -1; pts.visible = false; }
		}
	}

	// ── interaction ────────────────────────────────────────────────────────

	// SYNCHRONOUS: the E-key chain in coincommunities.js evaluates every
	// system's interact() as `!a.interact() && !b.interact() && …`; a Promise
	// is always truthy and would swallow the press. The lazy import runs in
	// the fire-and-forget helper.
	interact() {
		if (!this._near) return false;
		if (!this._ui && !this._opening) this._open();
		else this._ui?.focus?.();
		return true;
	}

	async _open() {
		this._opening = true;
		this.btn.hidden = true;
		try {
			const { openGacha } = await import('./gacha-ui.js');
			if (this._disposed) return;
			this._ui = openGacha({
				station: this,
				onClose: () => { this._ui = null; this.btn.hidden = !this._near; },
			});
		} catch {
			// The chunk failed to load (offline, new deploy): restore the prompt
			// so the next press retries instead of leaving a dead machine.
			this.btn.hidden = !this._near;
		} finally {
			this._opening = false;
		}
	}

	dispose() {
		this._disposed = true;
		this._ac.abort();
		this._ui?.close?.();
		this._ui = null;
		if (this._group) {
			this.scene.remove(this._group);
			this._group.traverse((n) => {
				if (n.isMesh || n.isPoints) {
					n.geometry?.dispose?.();
					const ms = Array.isArray(n.material) ? n.material : [n.material];
					ms.forEach((m) => { m?.map?.dispose?.(); m?.dispose?.(); });
				}
			});
			this._group = null;
		}
		this.btn?.remove();
	}
}

/** Collider footprint for the physics world (cabinet + plinth). */
export function gachaCollider() {
	const s = GACHA[0];
	return { position: { x: s.x, y: 1.15, z: s.z }, halfExtents: { x: W / 2 + 0.07, y: 1.15, z: D / 2 + 0.07 }, rotationY: s.yaw };
}
