// The avatars on /crawl: one shared WebGL canvas, every agent drawn over its
// live browser frame.
//
// The page lays out its screens in normal DOM (the featured screen and the tile
// wall). This module keeps a single full-viewport canvas pinned on top of them
// and, every frame, draws each attached screen's avatar into that screen's
// rectangle with setViewport/setScissor and an orthographic camera measured in
// the screen's own CSS pixels. One WebGL context serves any number of screens,
// so the wall never runs into the browser's context limit.
//
// Motion is per crawler, not per screen: when an agent walks to a link, its
// featured view and its tile both walk the same normalized path, so switching
// the featured agent never makes an avatar jump.

import {
	Box3,
	CanvasTexture,
	DirectionalLight,
	Group,
	HemisphereLight,
	Mesh,
	MeshBasicMaterial,
	OrthographicCamera,
	PMREMGenerator,
	PlaneGeometry,
	Scene,
	Vector3,
	WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js';
import { getMeshoptDecoder } from '../viewer/internal.js';
import { AnimationManager } from '../animation-manager.js';
import { resolveDevR2Url } from '../shared/dev-r2-proxy.js';

const FALLBACK_AVATAR = '/avatars/default.glb';
const MANIFEST_URL = '/animations/manifest.json';
const CLIP_IDLE = 'idle';
const CLIP_WALK = 'av-walk-feminine';

// Frames are 1200x750 browser viewports; normalized x is stretched by this to
// measure distance in the same units as normalized y.
const FRAME_ASPECT = 1200 / 750;
const AVATAR_FRACTION = 0.24; // avatar height as a share of its screen's height
const WALK_SPEED = 2.4; // avatar heights per second
const NOMINAL_CLIP_SPEED = 1.5; // the walk clip's natural pace in heights/s
const HOP_SECONDS = 0.7;
const LAND_SECONDS = 0.38;
const GONE_TIMEOUT_MS = 9000; // land on our own if the next page never arrives

const UP = new Vector3(0, 1, 0);

const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── shared loaders ──────────────────────────────────────────────────────────
const templates = new Map(); // url -> Promise<Object3D>
function loadTemplate(url) {
	let p = templates.get(url);
	if (!p) {
		const loader = new GLTFLoader();
		p = getMeshoptDecoder()
			.then((d) => loader.setMeshoptDecoder(d))
			.then(() => loader.loadAsync(resolveDevR2Url(url)))
			.then((gltf) => gltf.scene);
		templates.set(url, p);
		p.catch(() => { if (templates.get(url) === p) templates.delete(url); });
	}
	return p;
}

let clipDefsPromise = null;
function clipDefs() {
	if (!clipDefsPromise) {
		clipDefsPromise = fetch(MANIFEST_URL, { cache: 'force-cache' })
			.then((r) => {
				if (!r.ok) throw new Error(`animation manifest ${r.status}`);
				return r.json();
			})
			.then((all) => all.filter((d) => d.name === CLIP_IDLE || d.name === CLIP_WALK));
		clipDefsPromise.catch(() => { clipDefsPromise = null; });
	}
	return clipDefsPromise;
}

// A soft contact shadow so the avatar reads as standing on the page.
let shadowTexture = null;
function contactShadow() {
	if (!shadowTexture) {
		// A circle that is fully clear well inside the canvas edge; the plane
		// stretches it into an ellipse, so no edge of the texture ever shows.
		const c = document.createElement('canvas');
		c.width = 64;
		c.height = 64;
		const g = c.getContext('2d');
		const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
		grad.addColorStop(0, 'rgba(0,0,0,0.42)');
		grad.addColorStop(0.55, 'rgba(0,0,0,0.16)');
		grad.addColorStop(1, 'rgba(0,0,0,0)');
		g.fillStyle = grad;
		g.fillRect(0, 0, 64, 64);
		shadowTexture = new CanvasTexture(c);
	}
	const mesh = new Mesh(
		new PlaneGeometry(0.9, 0.22),
		new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
	);
	mesh.position.set(0, 0.01, -0.5);
	mesh.renderOrder = -1;
	return mesh;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
function shortestAngle(a) {
	let d = a % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	return d;
}

// ── motion: one per crawler, shared by every screen that shows it ──────────
class Motion {
	constructor() {
		this.x = 0.12;
		this.y = 0.93;
		this.yaw = 0;
		this.targetYaw = 0;
		this.mode = 'idle'; // idle | walk | hop | gone | land
		this.scale = 1;
		this.lift = 0; // hop height in avatar heights
		this.speed = 1;
		this.queue = [];
		this.action = null;
		this.goneAt = 0;
	}

	enqueue(action) {
		// A crawler that fell behind (tab in the background, slow network) skips
		// stale walks rather than replaying a backlog.
		if (this.queue.length > 3) this.queue.splice(0, this.queue.length - 2);
		this.queue.push(action);
	}

	tick(dt, now) {
		if (!this.action && this.queue.length) this.start(this.queue.shift());
		const a = this.action;
		if (a) {
			a.t = Math.min(1, a.t + dt / a.dur);
			if (a.type === 'walk') {
				const k = easeInOut(a.t);
				this.x = a.from.x + (a.to.x - a.from.x) * k;
				this.y = a.from.y + (a.to.y - a.from.y) * k;
			} else if (a.type === 'hop') {
				this.lift = Math.sin(Math.PI * Math.min(1, a.t * 1.25)) * 0.5;
				this.scale = a.t < 0.6 ? 1 : 1 - (a.t - 0.6) / 0.4;
			} else if (a.type === 'land') {
				// Pop in with a little overshoot.
				const t = a.t;
				this.scale = t < 0.7 ? (t / 0.7) * 1.12 : 1.12 - ((t - 0.7) / 0.3) * 0.12;
				this.lift = 0;
			}
			if (a.t >= 1) this.finish(a, now);
		}
		if (this.mode === 'gone' && now - this.goneAt > GONE_TIMEOUT_MS && !this.queue.length) {
			this.enqueue({ type: 'land' });
		}
		this.yaw += shortestAngle(this.targetYaw - this.yaw) * (1 - Math.exp(-dt * 9));
	}

	start(a) {
		if (a.type === 'walk') {
			if (this.mode === 'gone') this.scale = 1;
			const dx = (a.to.x - this.x) * FRAME_ASPECT;
			const dy = a.to.y - this.y;
			const dist = Math.hypot(dx, dy) / AVATAR_FRACTION; // in avatar heights
			if (dist < 0.05) { this.face(a.face); return; }
			a.from = { x: this.x, y: this.y };
			a.dur = reducedMotion ? 0.25 : clamp(dist / WALK_SPEED, 0.7, 3);
			a.t = 0;
			this.speed = clamp(dist / a.dur / NOMINAL_CLIP_SPEED, 0.75, 1.8);
			this.mode = 'walk';
			// Screen-down is toward the viewer (+z), so forward = (dx, dy).
			this.targetYaw = Math.atan2(dx, dy);
		} else if (a.type === 'hop') {
			if (this.mode === 'gone') return;
			a.dur = reducedMotion ? 0.15 : HOP_SECONDS;
			a.t = 0;
			this.mode = 'hop';
		} else if (a.type === 'land') {
			if (this.mode !== 'gone') { this.face(a.face); return; }
			if (a.at) { this.x = a.at.x; this.y = a.at.y; }
			a.dur = reducedMotion ? 0.1 : LAND_SECONDS;
			a.t = 0;
			this.scale = 0;
			this.mode = 'land';
			this.face(a.face);
		} else if (a.type === 'face') {
			this.face(a.face);
			return;
		}
		this.action = a;
	}

	finish(a, now) {
		this.action = null;
		if (a.type === 'walk') {
			this.mode = 'idle';
			this.face(a.face);
		} else if (a.type === 'hop') {
			this.mode = 'gone';
			this.scale = 0;
			this.lift = 0;
			this.goneAt = now;
		} else if (a.type === 'land') {
			this.mode = 'idle';
			this.scale = 1;
		}
	}

	// 'link-right' / 'link-left': looking along the page at the link beside it.
	// 'page': turned three-quarters toward the text it is reading.
	// 'viewer' (default): facing out of the screen.
	face(dir) {
		if (dir === 'link-right') this.targetYaw = Math.PI * 0.42;
		else if (dir === 'link-left') this.targetYaw = -Math.PI * 0.42;
		else if (dir === 'page') this.targetYaw = (this.x < 0.5 ? 1 : -1) * Math.PI * 0.22;
		else if (dir) this.targetYaw = 0;
	}
}

// ── one screen's view of one crawler ───────────────────────────────────────
class View {
	constructor(stage, el, crawlerId, opts) {
		this.stage = stage;
		this.el = el;
		this.crawlerId = crawlerId;
		this.onPlace = opts.onPlace || null;
		this.scene = new Scene();
		this.scene.environment = stage.envTexture;
		this.scene.add(new HemisphereLight(0xffffff, 0x445066, 1.4));
		const key = new DirectionalLight(0xffffff, 2.2);
		key.position.set(0.6, 1, 1.2);
		this.scene.add(key);
		this.camera = new OrthographicCamera(0, 1, 0, -1, -2000, 2000);
		this.camera.position.set(0, 0, 1000);
		this.rig = new Group(); // positioned in screen pixels, scaled to avatar height
		this.pivot = new Group(); // yaw + a slight forward tilt to show some depth
		this.rig.add(this.pivot);
		this.shadow = contactShadow();
		this.rig.add(this.shadow);
		this.rig.visible = false;
		this.scene.add(this.rig);
		this.anim = null;
		this.clipsOk = false;
		this.mode = null;
		this.disposed = false;
		this.build(opts.avatarUrl);
	}

	async build(avatarUrl) {
		let template;
		try {
			template = await loadTemplate(avatarUrl || FALLBACK_AVATAR);
		} catch {
			// The owner's avatar failed to load (deleted, CORS, corrupt): walk
			// the platform default rather than leave the screen empty.
			template = await loadTemplate(FALLBACK_AVATAR).catch(() => null);
		}
		if (!template || this.disposed) return;

		const body = cloneSkinnedScene(template);
		const box = new Box3().setFromObject(body);
		const height = Math.max(0.01, box.max.y - box.min.y);
		const center = box.getCenter(new Vector3());
		body.position.set(-center.x, -box.min.y, -center.z);
		const holder = new Group();
		holder.add(body);
		holder.scale.setScalar(1 / height);
		this.pivot.add(holder);
		this.rig.visible = true;

		this.anim = new AnimationManager();
		this.anim.attach(body, { avatarUrl: avatarUrl || FALLBACK_AVATAR });
		try {
			this.anim.setAnimationDefs(await clipDefs());
			this.clipsOk = this.anim.supportsCanonicalClips();
			if (this.clipsOk) {
				await this.anim.loadAll();
				if (this.disposed) return;
				await this.anim.crossfadeTo(CLIP_IDLE, 0);
				this.mode = 'idle';
			}
		} catch {
			// Clips unavailable: the avatar still glides and hops in its rest pose.
			this.clipsOk = false;
		}
	}

	syncClip(motion) {
		if (!this.clipsOk || !this.anim) return;
		const want = motion.mode === 'walk' ? 'walk' : 'idle';
		if (want !== this.mode) {
			this.mode = want;
			this.anim.crossfadeTo(want === 'walk' ? CLIP_WALK : CLIP_IDLE, 0.22);
		}
		this.anim.setSpeed?.(want === 'walk' ? motion.speed : 1);
	}

	dispose() {
		this.disposed = true;
		this.anim?.dispose?.();
		this.scene.clear();
	}
}

// ── the stage ───────────────────────────────────────────────────────────────
export function createStage({ canvas, clipTop = () => 0 }) {
	let renderer;
	try {
		renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
	} catch {
		return null; // no WebGL: the page still works, just without bodies
	}
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setClearColor(0x000000, 0);
	renderer.autoClear = false;
	const pmrem = new PMREMGenerator(renderer);
	const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	pmrem.dispose();

	const stage = { envTexture };
	const motions = new Map(); // crawlerId -> Motion
	const avatars = new Map(); // crawlerId -> avatarUrl
	const views = new Set();
	let raf = 0;
	let last = performance.now();

	function resize() {
		renderer.setSize(window.innerWidth, window.innerHeight, false);
	}
	resize();
	window.addEventListener('resize', resize);

	function motion(id) {
		let m = motions.get(id);
		if (!m) { m = new Motion(); motions.set(id, m); }
		return m;
	}

	function frame(now) {
		raf = 0;
		const dt = Math.min(0.1, (now - last) / 1000);
		last = now;
		for (const m of motions.values()) m.tick(dt, now);

		const W = window.innerWidth;
		const H = window.innerHeight;
		const top = clipTop();
		renderer.setScissorTest(false);
		renderer.clear();
		renderer.setScissorTest(true);

		for (const v of views) {
			const m = motions.get(v.crawlerId);
			if (!m || !v.rig.visible) continue;
			const r = v.el.getBoundingClientRect();
			const left = Math.max(0, r.left);
			const right = Math.min(W, r.right);
			const ctop = Math.max(top, r.top);
			const cbottom = Math.min(H, r.bottom);
			if (r.width < 8 || right <= left || cbottom <= ctop) continue;

			v.syncClip(m);
			v.anim?.update(dt);

			const h = r.height;
			const avatarH = clamp(h * AVATAR_FRACTION, 34, 190);
			const px = m.x * r.width;
			const py = m.y * h - m.lift * avatarH;
			v.rig.position.set(px, -py, 0);
			v.rig.scale.setScalar(avatarH * Math.max(0.001, m.scale));
			v.pivot.quaternion.setFromAxisAngle(UP, m.yaw);
			v.pivot.rotateX(0.12);
			v.shadow.visible = m.lift < 0.05; // the shadow stays on the floor

			v.camera.right = r.width;
			v.camera.bottom = -h;
			v.camera.updateProjectionMatrix();
			renderer.setViewport(r.left, H - r.bottom, r.width, h);
			renderer.setScissor(left, H - cbottom, right - left, cbottom - ctop);
			if (m.scale > 0.01) renderer.render(v.scene, v.camera);
			v.onPlace?.(px, py - avatarH * m.scale, m);
		}
		if (views.size && !document.hidden) raf = requestAnimationFrame(frame);
	}

	function wake() {
		if (!raf && views.size && !document.hidden) {
			last = performance.now();
			raf = requestAnimationFrame(frame);
		}
	}
	document.addEventListener('visibilitychange', wake);

	return {
		// Remember which body a crawler wears; views created after this use it.
		setAvatar(id, url) { avatars.set(id, url || null); },

		// Draw crawler `id` inside element `el` until the returned detach() runs.
		attach(el, id, opts = {}) {
			motion(id);
			const v = new View(stage, el, id, { ...opts, avatarUrl: avatars.get(id) });
			views.add(v);
			wake();
			return () => { views.delete(v); v.dispose(); };
		},

		walk(id, to, face) { motion(id).enqueue({ type: 'walk', to, face }); },
		hop(id) { motion(id).enqueue({ type: 'hop' }); },
		land(id, face, at) { motion(id).enqueue({ type: 'land', face, at }); },
		face(id, face) { motion(id).enqueue({ type: 'face', face }); },
		isGone(id) { const m = motions.get(id); return Boolean(m && (m.mode === 'gone' || m.mode === 'hop')); },
		forget(id) { motions.delete(id); },
	};
}
