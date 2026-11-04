/**
 * The trade room in 3D: the leader's avatar on a lit pedestal, a trade board
 * behind them, a ticker tape ring overhead, and the people watching standing
 * around the floor. Every pixel is driven by the page controller with real
 * data (trades, spectator count); this module owns rendering only.
 *
 * Budget: the device profile (src/club-perf.js detectProfile) picks pixel
 * ratio, shadows, spectator figures and burst particles. A frame watchdog
 * steps the tier down on sustained slow frames; if even the low tier cannot
 * hold the budget, `onFallback('slow')` hands the page back to its list view
 * and the page says why. The shared frame governor caps the loop at 60fps
 * (30 in power saver or when the window is unfocused).
 */

import {
	AdditiveBlending,
	AmbientLight,
	BufferAttribute,
	BufferGeometry,
	CanvasTexture,
	CapsuleGeometry,
	CircleGeometry,
	Color,
	CylinderGeometry,
	DirectionalLight,
	Fog,
	Group,
	HemisphereLight,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	PerspectiveCamera,
	PlaneGeometry,
	Points,
	PointsMaterial,
	RepeatWrapping,
	RingGeometry,
	Scene,
	SphereGeometry,
	SRGBColorSpace,
	Timer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { AVATAR_DEFAULT, buildAvatar, getAllEmoteDefs, newAnim, releaseAvatar } from '../game/avatar-rig.js';
import { detectProfile, createFrameWatchdog, watchdogFrameSec } from '../club-perf.js';
import {
	createFrameGovernor, trackWindowFocus, getPowerSaver, FPS_ACTIVE, FPS_IDLE, FPS_SAVER,
} from '../shared/frame-governor.js';
import { createRenderer } from '../webgl-support.js';
import { coinLabel, reactionFor, signedPct, solAmount, spectatorSeats, tickerText, toneOf } from './model.js';

/** Spectator figures and burst particles per device tier. */
export const TIER_BUDGET = {
	high: { pixelRatio: 2, shadows: true, spectators: 24, particles: 90 },
	medium: { pixelRatio: 1.5, shadows: false, spectators: 16, particles: 60 },
	low: { pixelRatio: 1, shadows: false, spectators: 8, particles: 30 },
};

const TONE_COLOR = { buy: 0x60a5fa, win: 0x34d399, loss: 0xf87171, flat: 0x94a3b8 };
const TONE_CSS = { buy: '#60a5fa', win: '#34d399', loss: '#f87171', flat: '#94a3b8' };
const REACTION_CLIPS = new Set(['point', 'nod', 'celebrate', 'av-cheering', 'shrug', 'defeated']);

// Seconds of sustained slow frames on the low tier before the room gives up on 3D.
const GIVE_UP_AFTER_SEC = 5;
const GIVE_UP_FRAME_SEC = 1 / 20;

// Spectators read as an audience: a little smaller than the leader on the pedestal.
const SPECTATOR_SCALE = 0.82;
const SPECTATOR_RING_R = 2.35;
const BOARD_W = 5.6;
const TAPE_W = BOARD_W + 0.16;
const TAPE_H = 0.3;
const TAPE_PX_H = 64;
const BOARD_H = 2.8;
const BOARD_Y = 2.0;

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
	let s = String(text);
	if (ctx.measureText(s).width <= maxWidth) return s;
	while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
	return `${s}…`;
}

/** A simple standing figure (body + head) for the spectator crowd. */
function spectatorGeometry() {
	const body = new CapsuleGeometry(0.2, 0.62, 4, 10);
	body.translate(0, 0.52, 0);
	const head = new SphereGeometry(0.16, 12, 10);
	head.translate(0, 1.18, 0);
	const merged = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()]);
	body.dispose();
	head.dispose();
	return merged;
}

export class TradeRoomScene {
	/**
	 * @param {HTMLElement} host element the canvas mounts into
	 * @param {{ reducedMotion?: boolean, onFallback?: (reason: string) => void, onAvatar?: (info: object) => void }} [opts]
	 */
	constructor(host, opts = {}) {
		this.host = host;
		this.opts = opts;
		this.reducedMotion = !!opts.reducedMotion;
		this.tier = detectProfile();
		this.maxTier = this.tier;
		this.budget = TIER_BUDGET[this.tier];
		this.disposed = false;
		this.leaderName = '';
		this.trades = [];
		this.spectatorCount = 0;
		this.bursts = [];
		this._slowOnLow = 0;
		this.leaderReady = false;
		this._raf = 0;
		this._visible = true;
	}

	/** Build the renderer and the room. Throws WebGLUnavailableError when 3D cannot start. */
	init() {
		const renderer = createRenderer({ antialias: this.tier !== 'low', alpha: false, powerPreference: 'high-performance' }, { fallback: this.host });
		this.renderer = renderer;
		renderer.outputColorSpace = SRGBColorSpace;
		renderer.setClearColor(0x07080d, 1);
		this._applyTier();
		renderer.domElement.className = 'tr-canvas';
		renderer.domElement.setAttribute('aria-hidden', 'true');
		this.host.appendChild(renderer.domElement);

		const scene = new Scene();
		scene.fog = new Fog(0x07080d, 9, 22);
		this.scene = scene;

		const camera = new PerspectiveCamera(42, 1, 0.1, 60);
		camera.position.set(0, 1.95, 5.3);
		this.camera = camera;

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 1.3, 0);
		controls.enableDamping = true;
		controls.dampingFactor = 0.08;
		controls.enablePan = false;
		controls.minDistance = 3.2;
		controls.maxDistance = 8.5;
		controls.minPolarAngle = Math.PI * 0.28;
		controls.maxPolarAngle = Math.PI * 0.49;
		controls.minAzimuthAngle = -Math.PI * 0.42;
		controls.maxAzimuthAngle = Math.PI * 0.42;
		controls.autoRotate = !this.reducedMotion;
		controls.autoRotateSpeed = 0.35;
		controls.addEventListener('start', () => { controls.autoRotate = false; });
		this.controls = controls;

		this._buildLights();
		this._buildFloor();
		this._buildBoard();
		this._buildTape();
		this._buildCrowd();
		this._buildBursts();

		this.rig = new Group();
		scene.add(this.rig);
		this.anim = newAnim();

		this.timer = new Timer();
		this.governor = createFrameGovernor();
		this.focus = trackWindowFocus();
		this.watchdog = createFrameWatchdog({
			initialTier: this.tier,
			maxTier: this.maxTier,
			onDowngrade: (t) => this._setTier(t),
			onUpgrade: (t) => this._setTier(t),
		});

		this._onResize = () => this._resize();
		this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(this._onResize) : null;
		this._ro?.observe(this.host);
		window.addEventListener('resize', this._onResize);
		this._onVisibility = () => {
			this._visible = !document.hidden;
			if (this._visible) this.governor.reset();
		};
		document.addEventListener('visibilitychange', this._onVisibility);
		this._resize();
		this._loop = this._loop.bind(this);
		this._raf = requestAnimationFrame(this._loop);
	}

	/**
	 * Stand the leader in the room. Resolves with what was actually shown so the
	 * page can be honest about a stand-in body.
	 * @param {{ modelUrl?: string|null, name?: string }} leader
	 * @returns {Promise<{ usedDefault: boolean, failed: boolean }>}
	 */
	async setLeader({ modelUrl = null, name = '' } = {}) {
		this.leaderName = name;
		this._drawBoard();
		const res = await buildAvatar(this.rig, modelUrl || AVATAR_DEFAULT, this.anim, { clips: 'locomotion' });
		if (this.disposed) return { usedDefault: !modelUrl, failed: false };
		this.anim.appendAnimationDefs(getAllEmoteDefs().filter((d) => REACTION_CLIPS.has(d.name)));
		// Warm the reaction clips so the first trade lands without a fetch stall.
		for (const n of REACTION_CLIPS) this.anim.ensureLoaded(n).catch(() => false);
		this.rig.position.set(0, 0.16, 0);
		// Only judge the frame budget once the body is standing: the GLB parse is a
		// one-off hitch, not a sign the device cannot run the room.
		this.leaderReady = true;
		return { usedDefault: !modelUrl || !!res.fallback, failed: !!(modelUrl && res.fallback) };
	}

	/** Replace the trade list the board and the tape render from (newest first). */
	setTrades(trades) {
		this.trades = trades || [];
		this._drawBoard();
		this._drawTape();
	}

	/** Show `n` spectators (the figure count is capped by the device tier). */
	setSpectators(n) {
		this.spectatorCount = Math.max(0, Number(n) || 0);
		this._layoutCrowd();
	}

	/** A trade just landed: the avatar reacts, the floor ring flashes, coins fly. */
	react(trade) {
		const tone = toneOf(trade);
		const color = new Color(TONE_COLOR[tone]);
		this.ringMat.color.copy(color);
		this.ringFlash = 1;
		if (!this.reducedMotion) this._burst(tone);
		const clip = reactionFor(trade);
		this.anim.playOnce(clip, { settleTo: 'idle' }).catch(() => this.anim.crossfadeTo('idle').catch(() => {}));
	}

	dispose() {
		this.disposed = true;
		cancelAnimationFrame(this._raf);
		this._ro?.disconnect();
		window.removeEventListener('resize', this._onResize);
		document.removeEventListener('visibilitychange', this._onVisibility);
		try { this.anim?.dispose(); } catch { /* already torn down */ }
		releaseAvatar(this.rig);
		this.controls?.dispose();
		this.scene?.traverse((o) => {
			o.geometry?.dispose?.();
			const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
			for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
		});
		this.renderer?.dispose();
		this.renderer?.domElement?.remove();
	}

	// ── build ──────────────────────────────────────────────────────────────

	_buildLights() {
		const { scene } = this;
		scene.add(new AmbientLight(0x9fb3ff, 0.35));
		scene.add(new HemisphereLight(0xbcd0ff, 0x120c1a, 0.7));
		const key = new DirectionalLight(0xffffff, 1.6);
		key.position.set(2.5, 5.5, 4);
		key.castShadow = this.budget.shadows;
		key.shadow.mapSize.set(1024, 1024);
		key.shadow.camera.left = -3; key.shadow.camera.right = 3;
		key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
		scene.add(key);
		this.keyLight = key;
		const rim = new DirectionalLight(0x8b5cf6, 0.9);
		rim.position.set(-3, 3, -4);
		scene.add(rim);
	}

	_buildFloor() {
		const floor = new Mesh(
			new CircleGeometry(12, 64),
			new MeshStandardMaterial({ color: 0x0d0f17, roughness: 0.85, metalness: 0.1 }),
		);
		floor.rotation.x = -Math.PI / 2;
		floor.receiveShadow = true;
		this.scene.add(floor);

		// Faint grid rings give the floor depth without a texture download.
		for (let i = 1; i <= 4; i++) {
			const r = i * 2.2;
			const ring = new Mesh(
				new RingGeometry(r, r + 0.012, 96),
				new MeshBasicMaterial({ color: 0x2a3150, transparent: true, opacity: 0.55 - i * 0.1 }),
			);
			ring.rotation.x = -Math.PI / 2;
			ring.position.y = 0.002;
			this.scene.add(ring);
		}

		const pedestal = new Mesh(
			new CylinderGeometry(1.05, 1.15, 0.16, 48),
			new MeshStandardMaterial({ color: 0x151827, roughness: 0.4, metalness: 0.6 }),
		);
		pedestal.position.y = 0.08;
		pedestal.receiveShadow = true;
		this.scene.add(pedestal);

		this.ringMat = new MeshBasicMaterial({ color: TONE_COLOR.buy, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false });
		const glow = new Mesh(new RingGeometry(1.08, 1.3, 64), this.ringMat);
		glow.rotation.x = -Math.PI / 2;
		glow.position.y = 0.17;
		this.scene.add(glow);
		this.ringFlash = 0;
	}

	_buildBoard() {
		const canvas = document.createElement('canvas');
		canvas.width = 1280;
		canvas.height = 640;
		this.boardCanvas = canvas;
		this.boardTex = new CanvasTexture(canvas);
		this.boardTex.colorSpace = SRGBColorSpace;
		const board = new Mesh(
			new PlaneGeometry(BOARD_W, BOARD_H),
			new MeshBasicMaterial({ map: this.boardTex, toneMapped: false }),
		);
		board.position.set(0, BOARD_Y, -3.4);
		this.scene.add(board);
		const frame = new Mesh(
			new PlaneGeometry(BOARD_W + 0.16, BOARD_H + 0.16),
			new MeshStandardMaterial({ color: 0x1c2135, roughness: 0.5, metalness: 0.7 }),
		);
		frame.position.set(0, BOARD_Y, -3.42);
		this.scene.add(frame);
		this._drawBoard();
	}

	_buildTape() {
		this.tapeCanvas = document.createElement('canvas');
		this.tapeCanvas.height = TAPE_PX_H;
		this.tapeMat = new MeshBasicMaterial({ toneMapped: false });
		// The shared ticker tape: an LED strip running across the top of the board.
		const tape = new Mesh(new PlaneGeometry(TAPE_W, TAPE_H), this.tapeMat);
		tape.position.set(0, BOARD_Y + BOARD_H / 2 + 0.08 + TAPE_H / 2, -3.41);
		this.scene.add(tape);
		this._drawTape();
	}

	_buildCrowd() {
		const geo = spectatorGeometry();
		const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.05 });
		const max = TIER_BUDGET.high.spectators;
		const crowd = new InstancedMesh(geo, mat, max);
		crowd.count = 0;
		crowd.castShadow = false;
		// Instances appear after the first render; a bounding sphere computed while
		// the crowd was empty would cull every figure that joins later.
		crowd.frustumCulled = false;
		this.crowd = crowd;
		this.crowdSeats = spectatorSeats(max, SPECTATOR_RING_R);
		this.crowdScale = new Float32Array(max);
		const palette = [0x5b6fb3, 0x7a64b8, 0x3f8f86, 0xa8843a, 0xa85586, 0x5f86b0];
		const c = new Color();
		for (let i = 0; i < max; i++) crowd.setColorAt(i, c.setHex(palette[i % palette.length]));
		this.scene.add(crowd);
	}

	_buildBursts() {
		this.burstPool = [];
		for (let b = 0; b < 3; b++) {
			const n = TIER_BUDGET.high.particles;
			const geo = new BufferGeometry();
			geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
			const mat = new PointsMaterial({ size: 0.07, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
			const pts = new Points(geo, mat);
			pts.frustumCulled = false;
			pts.visible = false;
			this.scene.add(pts);
			this.burstPool.push({ pts, vel: new Float32Array(n * 3), life: 0, n: 0 });
		}
	}

	// ── dynamic content ────────────────────────────────────────────────────

	_drawBoard() {
		const ctx = this.boardCanvas?.getContext('2d');
		if (!ctx) return;
		const W = this.boardCanvas.width;
		const H = this.boardCanvas.height;
		const grad = ctx.createLinearGradient(0, 0, 0, H);
		grad.addColorStop(0, '#0f1424');
		grad.addColorStop(1, '#090b14');
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, W, H);

		ctx.fillStyle = '#8b93b0';
		ctx.font = '600 30px Inter, system-ui, sans-serif';
		ctx.textBaseline = 'middle';
		ctx.fillText('LIVE TRADE ROOM', 48, 50);
		ctx.fillStyle = '#eef1f7';
		ctx.font = '700 52px Inter, system-ui, sans-serif';
		ctx.fillText(fitText(ctx, this.leaderName || 'Trader', W - 96), 48, 108);

		const rows = this.trades.slice(0, 6);
		if (!rows.length) {
			ctx.fillStyle = '#9aa3b4';
			ctx.font = '500 34px Inter, system-ui, sans-serif';
			ctx.fillText('No trades yet. The board fills the moment they trade.', 48, 330);
		}
		rows.forEach((t, i) => {
			const y = 180 + i * 72;
			const tone = toneOf(t);
			ctx.fillStyle = i === 0 ? 'rgba(124,156,255,0.12)' : 'rgba(255,255,255,0.03)';
			roundRect(ctx, 36, y, W - 72, 62, 12);
			ctx.fill();
			ctx.fillStyle = TONE_CSS[tone];
			roundRect(ctx, 52, y + 13, 92, 36, 8);
			ctx.fill();
			ctx.fillStyle = '#07080d';
			ctx.font = '800 22px Inter, system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(t.kind === 'buy' ? 'BUY' : 'SELL', 98, y + 32);
			ctx.textAlign = 'left';
			ctx.fillStyle = '#eef1f7';
			ctx.font = '700 32px Inter, system-ui, sans-serif';
			ctx.fillText(fitText(ctx, coinLabel(t), 360), 168, y + 32);
			ctx.fillStyle = '#b6bdd0';
			ctx.font = '500 28px "JetBrains Mono", ui-monospace, monospace';
			ctx.fillText(solAmount(t.size_sol), 560, y + 32);
			if (t.kind === 'sell') {
				ctx.fillStyle = TONE_CSS[tone];
				ctx.font = '700 30px "JetBrains Mono", ui-monospace, monospace';
				ctx.textAlign = 'right';
				ctx.fillText(signedPct(t.pnl_pct), W - 60, y + 32);
				ctx.textAlign = 'left';
			} else if (t.paper) {
				ctx.fillStyle = '#fbbf24';
				ctx.font = '600 24px Inter, system-ui, sans-serif';
				ctx.textAlign = 'right';
				ctx.fillText('PAPER', W - 60, y + 32);
				ctx.textAlign = 'left';
			}
		});
		if (this.boardTex) this.boardTex.needsUpdate = true;
	}

	_drawTape() {
		const canvas = this.tapeCanvas;
		if (!canvas) return;
		let ctx = canvas.getContext('2d');
		const font = '600 40px "JetBrains Mono", ui-monospace, monospace';
		const text = `${tickerText(this.trades, 8)}   •   `;
		ctx.font = font;
		// One exact copy of the text per tile, so the wrap has no seam.
		const w = Math.min(8192, Math.max(256, Math.ceil(ctx.measureText(text).width)));
		canvas.width = w;
		ctx = canvas.getContext('2d');
		ctx.fillStyle = 'rgba(10,12,22,0.86)';
		ctx.fillRect(0, 0, w, TAPE_PX_H);
		ctx.fillStyle = '#c7d2fe';
		ctx.font = font;
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 0, TAPE_PX_H / 2);
		const offset = this.tapeTex?.offset.x || 0;
		this.tapeTex?.dispose();
		const tex = new CanvasTexture(canvas);
		tex.colorSpace = SRGBColorSpace;
		tex.wrapS = RepeatWrapping;
		// Show the strip's width worth of tile so glyphs keep their true aspect.
		const tileMetres = (w / TAPE_PX_H) * TAPE_H;
		tex.repeat.set(TAPE_W / tileMetres, 1);
		tex.offset.x = offset;
		this.tapeTex = tex;
		this.tapeMat.map = tex;
		this.tapeMat.needsUpdate = true;
	}

	_layoutCrowd() {
		if (!this.crowd) return;
		const shown = Math.min(this.spectatorCount, this.budget.spectators);
		this._crowdTarget = shown;
		this.crowd.count = Math.max(this.crowd.count, shown);
	}

	_tickCrowd(dt) {
		const crowd = this.crowd;
		if (!crowd) return;
		const target = this._crowdTarget ?? 0;
		const m = new Matrix4();
		const o = new Object3D();
		let changed = false;
		let live = 0;
		for (let i = 0; i < crowd.count; i++) {
			const goal = i < target ? 1 : 0;
			const s = this.crowdScale[i];
			const next = this.reducedMotion ? goal : s + (goal - s) * Math.min(1, dt * 5);
			if (Math.abs(next - s) > 1e-3 || (goal === 1 && s !== 1 && this.reducedMotion)) changed = true;
			this.crowdScale[i] = Math.abs(next - goal) < 1e-3 ? goal : next;
			const seat = this.crowdSeats[i];
			o.position.set(seat.x, 0, seat.z);
			o.rotation.set(0, seat.ry, 0);
			const sc = Math.max(0.0001, this.crowdScale[i] * SPECTATOR_SCALE);
			o.scale.set(sc, sc, sc);
			o.updateMatrix();
			m.copy(o.matrix);
			crowd.setMatrixAt(i, m);
			if (this.crowdScale[i] > 0.001) live = i + 1;
		}
		if (changed || crowd.count !== Math.max(live, target)) {
			crowd.count = Math.max(live, target);
			crowd.instanceMatrix.needsUpdate = true;
		}
	}

	_burst(tone) {
		const slot = this.burstPool.find((b) => b.life <= 0) || this.burstPool[0];
		const n = this.budget.particles;
		const pos = slot.pts.geometry.getAttribute('position');
		for (let i = 0; i < n; i++) {
			const a = Math.random() * Math.PI * 2;
			const r = 0.2 + Math.random() * 0.5;
			pos.array[i * 3] = Math.cos(a) * r;
			pos.array[i * 3 + 1] = tone === 'loss' ? 2.6 : 0.4;
			pos.array[i * 3 + 2] = Math.sin(a) * r;
			const up = tone === 'loss' ? -0.4 - Math.random() * 0.6 : 2.2 + Math.random() * 1.8;
			slot.vel[i * 3] = Math.cos(a) * (0.4 + Math.random());
			slot.vel[i * 3 + 1] = up;
			slot.vel[i * 3 + 2] = Math.sin(a) * (0.4 + Math.random());
		}
		pos.needsUpdate = true;
		slot.pts.geometry.setDrawRange(0, n);
		slot.pts.material.color.setHex(TONE_COLOR[tone]);
		slot.pts.material.opacity = 1;
		slot.pts.visible = true;
		slot.life = 1.8;
		slot.n = n;
	}

	_tickBursts(dt) {
		for (const b of this.burstPool) {
			if (b.life <= 0) continue;
			b.life -= dt;
			const pos = b.pts.geometry.getAttribute('position');
			for (let i = 0; i < b.n; i++) {
				b.vel[i * 3 + 1] -= 3.2 * dt;
				pos.array[i * 3] += b.vel[i * 3] * dt;
				pos.array[i * 3 + 1] = Math.max(0.02, pos.array[i * 3 + 1] + b.vel[i * 3 + 1] * dt);
				pos.array[i * 3 + 2] += b.vel[i * 3 + 2] * dt;
			}
			pos.needsUpdate = true;
			b.pts.material.opacity = Math.max(0, Math.min(1, b.life / 0.8));
			if (b.life <= 0) b.pts.visible = false;
		}
	}

	// ── loop / budget ──────────────────────────────────────────────────────

	_applyTier() {
		this.budget = TIER_BUDGET[this.tier];
		const dpr = Math.min(window.devicePixelRatio || 1, this.budget.pixelRatio);
		this.renderer.setPixelRatio(dpr);
		this.renderer.shadowMap.enabled = this.budget.shadows;
		if (this.keyLight) this.keyLight.castShadow = this.budget.shadows;
	}

	_setTier(tier) {
		this.tier = tier;
		this._applyTier();
		this._layoutCrowd();
		this._resize();
	}

	_resize() {
		if (!this.renderer || !this.host) return;
		const w = Math.max(1, this.host.clientWidth);
		const h = Math.max(1, this.host.clientHeight);
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		// Pull back on narrow screens so the board and the crowd stay in frame.
		this.camera.fov = w / h < 0.9 ? 58 : 42;
		this.camera.updateProjectionMatrix();
	}

	_loop(now) {
		if (this.disposed) return;
		this._raf = requestAnimationFrame(this._loop);
		if (!this._visible) return;
		const cap = getPowerSaver() ? FPS_SAVER : this.focus.focused ? FPS_ACTIVE : FPS_IDLE;
		if (!this.governor.shouldRun(now, cap)) return;
		this.timer.update(now);
		const frameSec = this.timer.getDelta();
		const dt = Math.min(0.1, frameSec);

		this.watchdog.tick(watchdogFrameSec(frameSec));
		if (this.tier === 'low' && this.leaderReady) {
			this._slowOnLow = this.watchdog.getFrameAvg() > GIVE_UP_FRAME_SEC ? this._slowOnLow + dt : 0;
			if (this._slowOnLow > GIVE_UP_AFTER_SEC) {
				this.opts.onFallback?.('slow');
				return;
			}
		}

		this.anim.update(dt);
		// Sway between the azimuth limits instead of parking against one of them.
		if (this.controls.autoRotate) {
			const az = this.controls.getAzimuthalAngle();
			if (Math.abs(az) > this.controls.maxAzimuthAngle * 0.55 && Math.sign(az) === -Math.sign(this.controls.autoRotateSpeed)) {
				this.controls.autoRotateSpeed *= -1;
			}
		}
		this.controls.update();
		if (!this.reducedMotion) this.tapeTex.offset.x = (this.tapeTex.offset.x + dt * 0.018) % 1;
		if (this.ringFlash > 0) {
			this.ringFlash = Math.max(0, this.ringFlash - dt * 0.6);
			this.ringMat.opacity = 0.45 + this.ringFlash * 0.5;
		}
		this._tickCrowd(dt);
		this._tickBursts(dt);
		this.renderer.render(this.scene, this.camera);
	}
}
