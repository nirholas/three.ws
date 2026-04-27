/**
 * Three.js viewer for the homepage Act 2 — same trick as /app:
 * loads any GLB, fetches the project's animation manifest
 * (/animations/manifest.json), lazy-loads clips on first play, and
 * retargets them onto whatever skeleton is loaded.
 *
 * Public API (mounted on window):
 *   const v = new Act2Viewer(canvas);
 *   v.onClipsReady = (defs) => { /* build chips */ /* };
 *   await v.loadModel('/avatars/cz.glb');
 *   v.playClip('dance');
 */
import {
	WebGLRenderer,
	Scene,
	PerspectiveCamera,
	AnimationMixer,
	AnimationClip,
	Box3,
	Vector3,
	Clock,
	HemisphereLight,
	DirectionalLight,
	ACESFilmicToneMapping,
	SRGBColorSpace,
	PMREMGenerator,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const CROSSFADE = 0.35;

export class Act2Viewer {
	constructor(canvas) {
		this.canvas = canvas;
		this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
		this.renderer.toneMapping = ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.0;
		this.renderer.outputColorSpace = SRGBColorSpace;

		this.scene = new Scene();
		this.camera = new PerspectiveCamera(14, 1, 0.1, 100);
		this.camera.position.set(0, 1.0, 22);

		/* neutral environment (matches model-viewer's environment-image="neutral") */
		const pmrem = new PMREMGenerator(this.renderer);
		this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

		this.scene.add(new HemisphereLight(0xffffff, 0x444466, 0.8));
		const sun = new DirectionalLight(0xffffff, 1.2);
		sun.position.set(4, 8, 6);
		this.scene.add(sun);

		/** @type {Map<string, AnimationClip>} */
		this.clips = new Map();
		/** @type {THREE.AnimationAction|null} */
		this.currentAction = null;
		this.mixer = null;
		this.model = null;

		/** @type {Array<{name:string,url:string,label:string,icon:string,loop?:boolean}>} */
		this._manifest = [];
		this._manifestPromise = null;

		this._loader = new GLTFLoader();
		this._clock = new Clock();
		this._modelYaw = 0;

		/** Optional callback when the chip list changes (manifest + GLB-baked combined). */
		this.onClipsReady = null;

		this._resize();
		const ro = new ResizeObserver(() => this._resize());
		ro.observe(canvas);

		this._tick = this._tick.bind(this);
		requestAnimationFrame(this._tick);
	}

	_resize() {
		const dpr = Math.min(devicePixelRatio || 1, 2);
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		if (!w || !h) return;
		this.renderer.setPixelRatio(dpr);
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	}

	_tick() {
		const dt = this._clock.getDelta();
		if (this.mixer) this.mixer.update(dt);
		if (this.model) {
			this._modelYaw += dt * 0.18; /* slow auto-rotate, like model-viewer's auto-rotate */
			this.model.rotation.y = this._modelYaw;
		}
		this.renderer.render(this.scene, this.camera);
		requestAnimationFrame(this._tick);
	}

	async _loadManifest() {
		if (this._manifest.length) return this._manifest;
		if (this._manifestPromise) return this._manifestPromise;
		this._manifestPromise = fetch('/animations/manifest.json')
			.then((r) => r.json())
			.then((data) => {
				const arr = Array.isArray(data) ? data : data.animations || [];
				this._manifest = arr;
				return arr;
			})
			.catch(() => {
				this._manifest = [];
				return [];
			});
		return this._manifestPromise;
	}

	/** Returns combined: GLB-baked clips + project animation manifest, deduped by name. */
	listAvailableClips() {
		const out = [];
		const seen = new Set();
		/* manifest first (these are the "preset" controls /app shows) */
		for (const def of this._manifest) {
			if (!seen.has(def.name)) {
				out.push({ ...def, source: 'manifest' });
				seen.add(def.name);
			}
		}
		/* then GLB-baked names not already in manifest */
		for (const name of this.clips.keys()) {
			if (seen.has(name)) continue;
			seen.add(name);
			out.push({
				name,
				label: name,
				icon: '✨',
				loop: true,
				source: 'glb',
			});
		}
		return out;
	}

	async _fetchClip(url) {
		const r = await fetch(url);
		if (!r.ok) throw new Error('clip ' + url + ' ' + r.status);
		const json = await r.json();
		return AnimationClip.parse(json);
	}

	async loadModel(url) {
		/* swap out previous model */
		if (this.model) {
			if (this.mixer) this.mixer.stopAllAction();
			this.scene.remove(this.model);
			this.model = null;
			this.mixer = null;
			this.currentAction = null;
			this.clips.clear();
		}

		const gltf = await this._loader.loadAsync(url);
		this.model = gltf.scene;
		this.scene.add(this.model);

		/* center horizontally + plant feet on ground */
		const box = new Box3().setFromObject(this.model);
		const size = box.getSize(new Vector3());
		const center = box.getCenter(new Vector3());
		this.model.position.x -= center.x;
		this.model.position.z -= center.z;
		this.model.position.y -= box.min.y;

		/* fit camera to model height with a comfortable framing */
		const targetHeight = size.y;
		const dist = (targetHeight / 2) / Math.tan((this.camera.fov / 2) * (Math.PI / 180));
		this.camera.position.set(0, targetHeight * 0.55, dist * 1.2);
		this.camera.lookAt(0, targetHeight * 0.55, 0);

		this.mixer = new AnimationMixer(this.model);

		/* register baked-in clips */
		for (const clip of gltf.animations || []) {
			this.clips.set(clip.name, clip);
		}

		/* ensure manifest is fetched */
		await this._loadManifest();

		/* fire chip rebuild */
		if (typeof this.onClipsReady === 'function') {
			this.onClipsReady(this.listAvailableClips());
		}

		/* auto-play first idle if available */
		const startName = this._pickStartName();
		if (startName) await this.playClip(startName);

		return this.model;
	}

	_pickStartName() {
		/* prefer 'idle', then anything matching 'Idle*', then first manifest entry,
		   then first baked clip */
		const all = this.listAvailableClips();
		const idle = all.find((c) => c.name.toLowerCase() === 'idle');
		if (idle) return idle.name;
		const idleish = all.find((c) => c.name.toLowerCase().includes('idle'));
		if (idleish) return idleish.name;
		return all[0]?.name || null;
	}

	async playClip(name) {
		if (!this.mixer) return;
		let clip = this.clips.get(name);

		if (!clip) {
			/* lazy-load from manifest */
			const def = this._manifest.find((d) => d.name === name);
			if (!def) return;
			clip = await this._fetchClip(def.url);
			this.clips.set(name, clip);
		}

		const action = this.mixer.clipAction(clip);
		action.enabled = true;
		action.setLoop(undefined, Infinity); /* default loop */
		if (this.currentAction && this.currentAction !== action) {
			action.reset().fadeIn(CROSSFADE).play();
			this.currentAction.fadeOut(CROSSFADE);
		} else {
			action.reset().play();
		}
		this.currentAction = action;
	}

	setExposure(v) {
		this.renderer.toneMappingExposure = v;
	}

	zoom(distance) {
		const cur = this.camera.position.length();
		this.camera.position.normalize().multiplyScalar(distance);
		this.camera.lookAt(0, this.camera.position.y * 0.6, 0);
	}
}

/* expose on window so the inline home.html script can use it */
window.Act2Viewer = Act2Viewer;
