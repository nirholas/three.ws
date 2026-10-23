// AR Studio: a live, multi-model AR scene through the device camera.
//
// Every other web-AR drop-in places exactly one model and hands off to a native
// viewer. This one keeps the whole scene in your page: place any number of
// models, arrange them by hand, generate new ones from a prompt without leaving
// the camera, share the arrangement as a link or a QR code, and build in the
// same room as someone else in real time.
//
// Rendering ladder, best first: every device gets the richest path it can:
//
//   1. WebXR immersive-ar (Android Chrome, headsets): a hit-test reticle that
//      stays armed for the whole session, one XRAnchor per placed model,
//      real-world lighting estimation, and depth occlusion so a model hides
//      behind your couch instead of painting over it.
//   2. Camera passthrough (iOS Safari, and anywhere else with a camera):
//      transparent WebGL over the live feed, gyro world-lock, and room-light
//      matching sampled from the actual video frames.
//   3. Preview (desktop, no camera): the same scene on a grid floor with
//      drag-look and a QR hand-off to a phone.
//
// The scene persists to localStorage and round-trips through the URL, so an
// arrangement composed on a laptop reopens exactly on a phone.
//
// Ported and generalized from the three.ws AR Studio (Apache-2.0).

import {
	AnimationMixer, Box3, CanvasTexture, Color, DirectionalLight, Fog, GridHelper, Group,
	HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry,
	Raycaster, RingGeometry, Scene, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js';

import { resolveConfig } from '../config.js';
import { createLogger } from '../log.js';
import { renderQRToSVG } from '../qr.js';
import { createForgeClient } from '../forge/client.js';
import { resolveSources } from '../sources/index.js';
import { rememberRecent } from '../sources/recents.js';
import { buildArLaunchUrl } from '../ar-launch.js';

import { applyCinematicDefaults, detectQualityTier, loadEnvironment } from './render.js';
import { buildUI, el } from './ui.js';
import { EstimatedLighting } from './estimated-lighting.js';
import { MultiPlaceSession } from './multi-place.js';
import { createLoadQueue } from './load-queue.js';
import { sharedGLTFLoader } from './loaders.js';
import { mountIdle } from './idle.js';
import { captureComposite, shareOrDownload, shareUrlOrCopy } from './capture.js';
import {
	arCapability, isQuickLookReady, placeInYourSpace, prepareNativeAr, releaseQuickLook,
} from './native-ar.js';
import { deriveVerticalFovDeg, DEFAULT_DIAG_FOV_DEG } from './camera-fov.js';
import { clampPitch, isFiniteReading, resolveLockYaw, screenPitchDeg } from './sensor-fusion.js';
import {
	createPinchState, pinchEnd, pinchMove, pinchStart, touchDist,
	PINCH_SCALE_MAX, PINCH_SCALE_MIN,
} from './pinch.js';
import {
	deserializeScene, fitTransform, MAX_PLACEMENTS, normalizeGlbUrl, roomLightFromPixels,
	sceneFromHashParam, serializeScene, SPAWN_DISTANCE_M, spawnPointInFront,
	studioSceneUrl, studioShareUrl, touchAngle, twistDelta,
} from './scene-math.js';
import {
	generateRoomCode, localToShared, normalizeRoomCode, roomKeyForCode, roomShareUrl, sharedToLocal,
} from './coords.js';
import { StudioNet } from './net.js';

const log = createLogger('ar-studio');

const EYE_HEIGHT_M = 1.55;
const PITCH_MIN = -1.25;
const PITCH_MAX = 1.35;
const HEMI_BASE = 1.0;
const SUN_BASE = 1.15;
const LIST_SLICE = 60;

/** One live studio. Prefer `createArStudio()` over constructing this directly. */
export class ArStudio {
	/**
	 * @param {HTMLElement} host  Where the studio mounts.
	 * @param {object} [options]  See src/config.js for every field.
	 */
	constructor(host, options = {}) {
		if (!host) throw new Error('ar-studio: a host element is required');
		this.host = host;
		this.config = resolveConfig(options);
		this.clientId = readClientId(this.config.persistKey);
		this.sources = resolveSources(this.config.assets, this.config);
		this._listeners = new Map();
		this._destroyed = false;

		this.ui = buildUI(host, this.config);
		if (this.config.fullscreen ?? (host === document.body)) this.ui.root.classList.add('is-fullscreen');

		this._initScene();
		this._initState();
		this._wireUI();
		this._boot();
	}

	// ── Events ────────────────────────────────────────────────────────────────

	/**
	 * Subscribe to a studio event. Returns an unsubscribe function.
	 * Events: `add` `remove` `select` `clear` `generate` `generate-error`
	 * `camera` `xr` `room` `share`.
	 */
	on(event, fn) {
		if (!this._listeners.has(event)) this._listeners.set(event, new Set());
		this._listeners.get(event).add(fn);
		return () => this.off(event, fn);
	}

	off(event, fn) {
		this._listeners.get(event)?.delete(fn);
	}

	_emit(event, detail = {}) {
		for (const fn of this._listeners.get(event) || []) {
			try { fn(detail); } catch (err) { log.warn(`${event} listener error`, err); }
		}
		try { this.config.onEvent?.(event, detail); } catch (err) { log.warn('onEvent error', err); }
		try {
			this.ui.root.dispatchEvent(new CustomEvent(`ar-studio:${event}`, { detail, bubbles: true }));
		} catch { /* no CustomEvent in this host */ }
	}

	// ── Scene ─────────────────────────────────────────────────────────────────

	_initScene() {
		this.renderer = new WebGLRenderer({
			canvas: this.ui.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true,
		});
		this.renderer.setClearColor(0x000000, 0);
		this.qualityTier = detectQualityTier();
		applyCinematicDefaults(this.renderer, { tier: this.qualityTier });

		this.scene = new Scene();
		this.camera = new PerspectiveCamera(58, 1, 0.02, 200);
		this.camera.position.set(0, EYE_HEIGHT_M, 0);
		this.cameraYaw = 0;
		// Tilted down enough that the floor, and anything standing on it, is in
		// frame before the viewer touches anything.
		this.cameraPitch = -0.24;

		const preset = this.qualityTier === 'mobile' ? null : (this.config.lighting?.preset ?? 'studio');
		loadEnvironment(this.renderer, this.scene, preset, { urls: this.config.lighting?.urls })
			.catch((err) => log.warn('environment map failed', err));

		this.hemi = new HemisphereLight(0xffffff, 0x444455, HEMI_BASE);
		this.sun = new DirectionalLight(0xffffff, SUN_BASE);
		this.sun.position.set(2.5, 6, 3);
		this.scene.add(this.hemi, this.sun);

		// Preview-mode floor: a calm grid that hides the moment the camera feed
		// becomes the ground truth. The invisible ray plane is the drag target in
		// both modes. Distance fog fades the far lines out instead of letting them
		// collapse into a moire band along the horizon, which is what a flat grid
		// viewed at a shallow angle does otherwise. It starts well beyond any
		// placement, so it never touches a model.
		this.grid = new GridHelper(24, 48, 0x3a3f52, 0x23273a);
		this.grid.position.y = 0.001;
		this.grid.material.transparent = true;
		this.grid.material.opacity = 0.75;
		this._fog = new Fog(0x06070a, 5, 17);
		this.scene.fog = this._fog;
		this.scene.add(this.grid);
		this.rayPlane = new Mesh(new PlaneGeometry(80, 80), new MeshBasicMaterial({ visible: false, side: 2 }));
		this.rayPlane.rotation.x = -Math.PI / 2;
		this.scene.add(this.rayPlane);

		this.selRing = new Mesh(
			new RingGeometry(0.3, 0.34, 48).rotateX(-Math.PI / 2),
			new MeshBasicMaterial({ color: 0x8b7cf8, transparent: true, opacity: 0.85, depthTest: false }),
		);
		if (this.config.branding?.accent) {
			try { this.selRing.material.color.set(this.config.branding.accent); } catch { /* keep default */ }
		}
		this.selRing.renderOrder = 998;
		this.selRing.visible = false;
		this.scene.add(this.selRing);

		this.shadowTex = makeShadowTexture();
		this.reducedMotion = prefersReducedMotion();
		this._applyCameraLook();
	}

	_initState() {
		/** @type {Array<object>} */
		this.placements = [];
		this.selected = null;
		this.arActive = false;
		this.mediaStream = null;
		this.arTransitioning = false;
		this.xrSession = null;
		this.estimatedLight = null;
		/** 'webxr' | 'quicklook' | 'sceneviewer' | 'none', resolved at boot. */
		this.arMode = 'none';
		/** True while the device's own AR viewer has the stage we stood down for. */
		this._cameraYielded = false;
		this._cameraWasOn = false;
		this._onArReturn = null;
		this._nativeArBusy = false;
		/** The hand-off the AR sheet's button will fire, once it is prepared. */
		this._arHandoff = null;
		this._arTarget = null;
		/** Bumped on every sheet open and target change so a slow, stale
		 *  conversion can never enable the button for the wrong model. */
		this._arToken = 0;
		this._arWarmTimer = null;
		/** Set when a conversion failed and the sheet's button is a retry. */
		this._arRetry = null;
		/** USDZ cache keys this studio created, so destroy() frees only its own. */
		this._arKeys = new Set();
		this.arTrackW = 0;
		this.arTrackH = 0;

		this._statusTimer = null;
		this._armed = null;
		this._templates = new Map();
		this._templatesReady = new Map();
		this._trayCache = new Map();
		this._trayTab = this.sources[0]?.id || 'link';
		this._loadQueue = createLoadQueue({ run: (src) => sharedGLTFLoader().loadAsync(src), maxActive: 3 });
		this._maxPlacements = Math.min(Number(this.config.maxPlacements) || MAX_PLACEMENTS, MAX_PLACEMENTS);

		this.net = null;
		this.roomCode = '';
		this._netModels = new Map();
		this._presence = { count: 1, names: [] };
		this._roomSynced = false;
		this._roomHeartbeat = null;

		this.forge = this.config.generate?.enabled === false ? null : createForgeClient({
			endpoint: this.config.generate.endpoint,
			kind: this.config.generate.kind,
			tier: this.config.generate.tier,
			timeoutMs: this.config.generate.timeoutMs,
			pollMs: this.config.generate.pollMs,
			headers: this.config.generate.headers,
		});
		this._forgeSeq = 0;
		this._forgeBusy = false;

		this.gyroBase = null;
		this._devAlpha = 0;
		this._devBeta = 90;
		this._devGamma = 0;
		this._absoluteOrientation = false;
		this._raycaster = new Raycaster();
		this._ndc = new Vector2();
		this._pointer = null;
		this._userLooked = false;
		this._pinch = createPinchState();
		this._pinchEndedAt = -Infinity;
		this._twist = null;
		this._rafId = null;
		this._prevT = 0;
		this._lightTimer = null;
		this._roomTint = new Color();
		this._lightProbe = makeLightProbe();
		this._recentKey = `${this.config.persistKey}:recent`;
		this.config.recentKey = this._recentKey;
	}

	// ── Wiring ────────────────────────────────────────────────────────────────

	_wireUI() {
		const u = this.ui;
		const bind = (node, type, fn, opts) => {
			if (!node) return;
			node.addEventListener(type, fn, opts);
		};

		bind(u.cameraBtn, 'click', () => {
			if (this.arTransitioning || this.xrSession) return;
			if (this.arActive) {
				this._stopCamera();
				this._setStatus('Camera off: preview mode.');
			} else {
				this._startCamera();
			}
		});
		if (!navigator.mediaDevices?.getUserMedia && u.cameraBtn) {
			u.cameraBtn.disabled = true;
			u.cameraBtn.setAttribute('aria-disabled', 'true');
			u.cameraBtn.title = 'This browser cannot open a camera';
		}

		bind(u.xrBtn, 'click', () => this._enterAR());
		bind(u.addBtn, 'click', () => (u.tray.hidden ? this._openTray() : this._closeTray()));
		bind(u.trayClose, 'click', () => this._closeTray());
		bind(u.tray, 'click', (e) => { if (e.target === u.tray) this._closeTray(); });
		bind(u.emptyAdd, 'click', () => this._openTray());
		bind(u.emptyCamera, 'click', () => this._startCamera());
		bind(u.emptyForge, 'click', () => u.forgeInput?.focus());

		bind(u.forgeForm, 'submit', (e) => {
			e.preventDefault();
			this._startForge(u.forgeInput?.value);
		});

		bind(u.clearBtn, 'click', () => this._clearWithUndo());
		bind(u.photoBtn, 'click', () => this._capturePhoto());
		bind(u.qrBtn, 'click', () => this._openQr());
		bind(u.qrClose, 'click', () => this._closeQr());
		bind(u.qrModal, 'click', (e) => { if (e.target === u.qrModal) this._closeQr(); });

		bind(u.arClose, 'click', () => this._closeArSheet());
		bind(u.arModal, 'click', (e) => { if (e.target === u.arModal) this._closeArSheet(); });
		bind(u.arGo, 'click', () => this._onArGo());
		bind(u.arXr, 'click', () => { this._closeArSheet(); this._toggleXR(); });
		bind(u.arQr, 'click', () => { this._closeArSheet(); this._openQr(); });
		bind(u.arPicker, 'click', (e) => {
			const chip = e.target.closest('[data-ar-id]');
			if (!chip) return;
			const next = this.placements.find((pl) => pl.id === chip.dataset.arId);
			if (next) this._showArTarget(next);
		});

		bind(u.selbar, 'click', (e) => this._onSelbarClick(e));

		bind(u.roomBtn, 'click', () => this._openRoomModal());
		bind(u.roomClose, 'click', () => this._closeRoomModal());
		bind(u.roomModal, 'click', (e) => { if (e.target === u.roomModal) this._closeRoomModal(); });
		bind(u.roomCreate, 'click', () => this._createRoomFromUI());
		bind(u.roomJoinForm, 'submit', (e) => {
			e.preventDefault();
			this._joinRoomFromUI();
		});
		bind(u.roomCopy, 'click', () => this._copyRoomInvite());
		bind(u.roomLeave, 'click', () => {
			this._leaveRoom();
			this._renderRoomModal();
		});

		// Canvas gestures
		const c = u.canvas;
		bind(c, 'pointerdown', (e) => this._onPointerDown(e));
		bind(c, 'pointermove', (e) => this._onPointerMove(e));
		bind(c, 'pointerup', (e) => this._onPointerUp(e));
		bind(c, 'pointercancel', () => { this._pointer = null; });
		bind(c, 'touchstart', (e) => this._onTouchStart(e), { passive: true });
		bind(c, 'touchmove', (e) => this._onTouchMove(e), { passive: true });
		bind(c, 'touchend', () => this._onTouchEnd(), { passive: true });

		this._onKeyDown = this._onKeyDown.bind(this);
		document.addEventListener('keydown', this._onKeyDown);

		this._onOrientationAbsolute = (e) => { this._absoluteOrientation = true; this._onDeviceOrientation(e); };
		this._onOrientation = (e) => { if (!this._absoluteOrientation) this._onDeviceOrientation(e); };
		window.addEventListener('deviceorientationabsolute', this._onOrientationAbsolute, true);
		window.addEventListener('deviceorientation', this._onOrientation, true);

		this._onResize = () => this._resize();
		window.addEventListener('resize', this._onResize);
		this._onPageHide = () => {
			this._stopCamera();
			this.xrSession?.end();
			this.net?.destroy();
		};
		window.addEventListener('pagehide', this._onPageHide);

		// The host element can resize without the window doing so (a flex layout,
		// a drawer opening), and a stale drawing buffer looks like a broken canvas.
		if (typeof ResizeObserver !== 'undefined') {
			this._ro = new ResizeObserver(() => this._resize());
			this._ro.observe(u.root);
		}

		this._wireTrayTabs();
	}

	_boot() {
		this._resize();
		this._updateCount();
		this._updateRoomButton();
		this._startLoop();

		// One AR button, labelled for what this device will actually do. An iPhone
		// has no WebXR, but it has ARKit through Quick Look, and offering it the
		// camera-passthrough approximation instead would be strictly worse: the
		// native viewer gets real plane detection, real scale and real occlusion.
		arCapability().then((cap) => {
			this.arMode = cap;
			const btn = this.ui.xrBtn;
			if (!btn || cap === 'none') return;
			btn.hidden = false;
			const label = btn.querySelector('.ars-ar-label');
			if (cap === 'webxr') {
				if (label) label.textContent = 'Immersive AR';
				btn.setAttribute('aria-label', 'Enter immersive augmented reality and place models on real surfaces');
			} else {
				if (label) label.textContent = 'Place in your space';
				btn.setAttribute('aria-label', 'Open this in your device AR viewer and place it in your real space');
			}
		});
		// Desktop leads with the QR hand-off; a phone is already the target device.
		const coarse = window.matchMedia?.('(pointer: coarse)').matches;
		if (!coarse && this.ui.qrBtn) this.ui.qrBtn.hidden = false;

		const bootRoom = normalizeRoomCode(this.config.urlRoom || '');
		this._restoreScene({ skipLocal: !!bootRoom }).then(() => {
			if (bootRoom) this._joinRoom(bootRoom);
			if (this.config.urlPrompt && this.config.urlPrompt.length >= 3 && this.ui.forgeInput) {
				this.ui.forgeInput.value = this.config.urlPrompt;
				this._startForge(this.config.urlPrompt);
			}
		});
	}

	// ── Status + counters ─────────────────────────────────────────────────────

	_setStatus(message, { warn = false, sticky = false, actionLabel = '', onAction = null } = {}) {
		const node = this.ui.status;
		if (!node) return;
		clearTimeout(this._statusTimer);
		node.textContent = '';
		if (!message) {
			node.hidden = true;
			return;
		}
		node.hidden = false;
		node.classList.toggle('is-warn', warn);
		node.appendChild(el('span', { text: message }));
		if (actionLabel && onAction) {
			node.appendChild(el('button', {
				type: 'button', class: 'ars-status-action', text: actionLabel,
				onclick: () => { this._setStatus(null); onAction(); },
			}));
		}
		if (!sticky) this._statusTimer = setTimeout(() => { node.hidden = true; }, 5200);
	}

	_updateCount() {
		const n = this.placements.length;
		const { count, clearBtn, empty, photoBtn } = this.ui;
		if (count) {
			if (this.net && this.net.status === 'online' && this._presence.count > 1) {
				count.textContent = `${this._presence.count} here · ${n} ${n === 1 ? 'model' : 'models'}`;
				count.hidden = false;
			} else {
				count.textContent = n === 1 ? '1 model' : `${n} models`;
				count.hidden = n === 0;
			}
		}
		if (clearBtn) clearBtn.hidden = n === 0;
		if (empty) empty.hidden = n > 0;
		if (photoBtn) photoBtn.disabled = n === 0;
	}

	// ── Placements ────────────────────────────────────────────────────────────

	// A placement's LOGICAL scale: the size the user chose, independent of the
	// spawn-in animation. While a model eases in, group.scale is a fraction of the
	// target, and persisting that would clamp it to the minimum on the next load.
	_logicalScale(p) {
		if (p.spawnT < 1) return p.group.userData._targetScale ?? 1;
		return p.group.scale.x;
	}

	_saveScene() {
		if (this.config.persist === false) return;
		try {
			localStorage.setItem(this.config.persistKey, serializeScene(
				this.placements.filter((p) => this._isMine(p)).map((p) => ({
					src: p.src,
					title: p.title,
					x: p.group.position.x,
					z: p.group.position.z,
					yaw: p.yaw,
					scale: this._logicalScale(p),
				})),
			));
		} catch {
			// Storage full or blocked: the live scene is unaffected.
		}
	}

	_select(p) {
		this.selected = p;
		const { selbar, selName } = this.ui;
		if (!selbar) return;
		if (!p) {
			selbar.hidden = true;
			this.selRing.visible = false;
			this._emit('select', { placement: null });
			return;
		}
		selbar.hidden = false;
		if (selName) selName.textContent = p.title || 'Model';
		this.selRing.visible = !this.xrSession;
		this._positionSelRing();
		this._warmQuickLook();
		this._emit('select', { placement: publicPlacement(p, this) });
	}

	_positionSelRing() {
		const p = this.selected;
		if (!p) return;
		this.selRing.position.set(p.group.position.x, p.group.position.y + 0.006, p.group.position.z);
		const r = Math.max(0.24, p.baseRadius * p.group.scale.x * 1.15);
		this.selRing.scale.setScalar(r / 0.34);
	}

	// One load per GLB source no matter how many copies are placed.
	_loadTemplate(src) {
		let tpl = this._templates.get(src);
		if (!tpl) {
			tpl = this._loadQueue.request(src).then((gltf) => {
				let skinned = false;
				gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
				const box = new Box3().setFromObject(gltf.scene);
				const fit = fitTransform({
					min: { x: box.min.x, y: box.min.y, z: box.min.z },
					max: { x: box.max.x, y: box.max.y, z: box.max.z },
				}, { skinned });
				const radius = Math.max((box.max.x - box.min.x) * fit.scale, (box.max.z - box.min.z) * fit.scale) / 2;
				const height = (box.max.y - box.min.y) * fit.scale;
				return {
					gltf, skinned, fit,
					radius: Number.isFinite(radius) ? radius : 0.3,
					height: Number.isFinite(height) ? height : 0.75,
				};
			});
			this._templates.set(src, tpl);
			tpl.then((t) => this._templatesReady.set(src, t))
				.catch(() => this._templates.delete(src)); // a failed load stays retryable
		}
		return tpl;
	}

	// Cloned per placement so ten copies of one crate are ten independent models.
	// SkeletonUtils handles skinned characters; a plain .clone() breaks bone binding.
	_instantiate(tpl, src) {
		const inner = cloneSkinnedScene(tpl.gltf.scene);
		inner.scale.setScalar(tpl.fit.scale);
		inner.position.y = tpl.fit.yOffset;
		const group = new Group();
		group.add(inner);
		let mixer = null;
		if (tpl.gltf.animations?.length) {
			mixer = new AnimationMixer(inner);
			mixer.clipAction(tpl.gltf.animations[0]).play();
		}
		// A humanoid with no baked clip gets the universal idle retargeted onto its
		// own rig: never a bind-pose statue. Best-effort and async: props and
		// undriveable rigs resolve null and stay static.
		let idlePromise = null;
		if (!mixer && tpl.skinned && this.config.animations?.enabled !== false) {
			idlePromise = mountIdle(inner, {
				manifestUrl: this.config.animations?.manifestUrl,
				clip: this.config.animations?.clip,
				sourceUrl: src,
			}).catch(() => null);
		}
		return { group, mixer, idlePromise };
	}

	_makeShadow(radius) {
		if (!this.shadowTex) return null;
		const d = Math.max(0.4, radius * 2.4);
		const mesh = new Mesh(
			new PlaneGeometry(d, d).rotateX(-Math.PI / 2),
			new MeshBasicMaterial({ map: this.shadowTex, transparent: true, opacity: 0.85, depthWrite: false }),
		);
		mesh.renderOrder = 1;
		return mesh;
	}

	// Spread same-spot spawns into a small ring so "add, add, add" reads as a
	// line-up instead of a z-fighting pile.
	_nudgeSpawn(pt) {
		let { x, z } = pt;
		for (let attempt = 0; attempt < 8; attempt++) {
			const clash = this.placements.some((p) => Math.hypot(p.group.position.x - x, p.group.position.z - z) < 0.45);
			if (!clash) break;
			const a = attempt * 2.399963; // golden angle
			x = pt.x + Math.cos(a) * 0.55 * (1 + attempt * 0.18);
			z = pt.z + Math.sin(a) * 0.55 * (1 + attempt * 0.18);
		}
		return { x, z };
	}

	async _addModel({ src, title = '', poster = '' } = {}, {
		x = null, z = null, yaw = null, scale = null, announce = true, persist = true,
		remote = false, netId = null, ownerId = null,
	} = {}) {
		const url = normalizeGlbUrl(src);
		if (!url) {
			this._setStatus('That link is not a loadable https GLB.', { warn: true });
			return null;
		}
		if (this.placements.length >= this._maxPlacements) {
			this._setStatus(`Scene is full (${this._maxPlacements} models). Remove one to add more.`, { warn: true });
			return null;
		}
		if (announce) this._setStatus(`Loading ${title || 'model'}…`, { sticky: true });

		let tpl;
		try {
			tpl = await this._loadTemplate(url);
		} catch (err) {
			log.warn('model load failed', url, err);
			this._setStatus(`Couldn't load ${title || 'that model'}: the file may be gone or blocked by CORS.`, {
				warn: true, actionLabel: 'Retry', onAction: () => this._addModel({ src: url, title }),
			});
			return null;
		}

		const { group, mixer, idlePromise } = this._instantiate(tpl, url);
		let px = x;
		let pz = z;
		if (px === null || pz === null) {
			// Tall models land further back so they do not fill the frame the moment
			// they appear.
			const dist = Math.max(SPAWN_DISTANCE_M, (tpl.height || 0) * 1.15);
			const fwd = this.camera.getWorldDirection(new Vector3());
			const spot = this._nudgeSpawn(spawnPointInFront(this.camera.position, fwd, dist));
			px = spot.x;
			pz = spot.z;
		}
		group.position.set(px, 0, pz);
		const yawV = yaw ?? Math.atan2(this.camera.position.x - px, this.camera.position.z - pz);
		group.rotation.y = yawV;
		if (scale) group.scale.setScalar(Math.min(PINCH_SCALE_MAX, Math.max(PINCH_SCALE_MIN, scale)));
		this.scene.add(group);

		const shadow = this._makeShadow(tpl.radius);
		if (shadow) {
			shadow.position.set(px, 0.004, pz);
			shadow.scale.setScalar(group.scale.x);
			shadow.visible = !this.xrSession; // the XR session draws its own anchored shadows
			this.scene.add(shadow);
		}

		const placement = {
			id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
			src: url,
			title: String(title || '').slice(0, 160),
			poster,
			group,
			shadow,
			mixer,
			idle: null,
			yaw: yawV,
			baseRadius: tpl.radius,
			height: tpl.height || 0,
			spawnT: this.reducedMotion ? 1 : 0,
			netId: netId || null,
			ownerId: remote ? ownerId : null,
			remote,
			_lastNetSend: 0,
		};
		idlePromise?.then((mgr) => {
			if (!mgr) return;
			// Removed before the clip arrived: release the manager rather than leak it.
			if (this.placements.includes(placement)) placement.idle = mgr;
			else mgr.detach();
		});
		group.userData._targetScale = group.scale.x;
		if (!this.reducedMotion) group.scale.setScalar(0.001);

		this.placements.push(placement);
		if (placement.netId) this._netModels.set(placement.netId, placement);
		if (!remote) this._armed = { src: url, title: placement.title };
		this._updateCount();
		if (!remote) this._select(placement);
		if (persist) this._saveScene();

		// Broadcast a locally-added model to the shared room exactly once.
		if (!remote && this.net && this.net.status === 'online') {
			const wireId = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);
			placement.netId = wireId;
			placement.ownerId = this.clientId;
			this._netModels.set(wireId, placement);
			this.net.spawn(this._placementWire(placement, wireId));
		}

		if (announce) {
			this._setStatus(remote
				? `${title || 'A model'} was added by someone in the room.`
				: 'Placed. Drag to move, pinch to resize, twist to rotate.');
		}
		if (!remote) this._framePreview();
		this._emit('add', { placement: publicPlacement(placement, this), remote });
		return placement;
	}

	_removePlacement(p, { persist = true, broadcast = true } = {}) {
		const i = this.placements.indexOf(p);
		if (i === -1) return;
		this.placements.splice(i, 1);
		if (p.netId) {
			this._netModels.delete(p.netId);
			if (broadcast && this.net?.status === 'online' && this._isMine(p)) this.net.remove(p.netId);
		}
		p.idle?.detach();
		p.idle = null;
		this.xrSession?.release(p.group);
		this.scene.remove(p.group);
		if (p.shadow) {
			this.scene.remove(p.shadow);
			p.shadow.geometry?.dispose();
			p.shadow.material?.dispose();
		}
		// Geometry and materials belong to the shared template: other copies still
		// use them, so only the per-placement shadow above is disposed.
		if (this.selected === p) this._select(this.placements[this.placements.length - 1] ?? null);
		releaseQuickLook(this._arCacheKey(p));
		this._arKeys.delete(this._arCacheKey(p));
		// The sheet may be listing a model that no longer exists.
		if (this.ui.arModal && !this.ui.arModal.hidden) {
			this._showArTarget(this._arTarget === p ? this._arDefaultTarget() : this._arTarget);
		}
		this._updateCount();
		if (persist) this._saveScene();
		this._emit('remove', { src: p.src, title: p.title });
	}

	_clearWithUndo() {
		if (!this.placements.length) return;
		const items = this.getScene();
		for (const p of [...this.placements]) this._removePlacement(p, { persist: false });
		this._saveScene();
		this._emit('clear', { items });
		this._setStatus('Scene cleared.', {
			actionLabel: 'Undo',
			onAction: async () => {
				for (const it of items) {
					await this._addModel({ src: it.src, title: it.title }, {
						x: it.x, z: it.z, yaw: it.yaw, scale: it.scale, announce: false,
					});
				}
			},
		});
	}

	_onSelbarClick(e) {
		const btn = e.target.closest('[data-act]');
		const p = this.selected;
		if (!btn || !p) return;
		const act = btn.dataset.act;
		if ((act === 'rotate' || act === 'remove') && !this._isMine(p)) {
			this._setStatus('That model belongs to someone else in the room.', { warn: true });
			return;
		}
		if (act === 'rotate') {
			p.yaw += Math.PI / 4;
			p.group.rotation.y = p.yaw;
			p._lastNetSend = 0;
			this._netBroadcastTransform(p);
			this._saveScene();
		} else if (act === 'duplicate') {
			this._addModel({ src: p.src, title: p.title }, { yaw: p.yaw, scale: this._logicalScale(p) });
		} else if (act === 'remove') {
			this._removePlacement(p);
			this._setStatus('Removed.', {
				actionLabel: 'Undo',
				onAction: () => this._addModel({ src: p.src, title: p.title }, {
					x: p.group.position.x, z: p.group.position.z, yaw: p.yaw, scale: this._logicalScale(p),
				}),
			});
		}
	}

	// ── Restore + deep links ──────────────────────────────────────────────────

	async _restoreScene({ skipLocal = false } = {}) {
		// A `#s=` hash is a full shared arrangement: it opens like a document,
		// replacing the working scene rather than merging into it.
		const hashParams = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
		const shared = skipLocal ? [] : sceneFromHashParam(hashParams.get('s'));

		let items = shared;
		if (!items.length && !skipLocal && this.config.persist !== false) {
			try { items = deserializeScene(localStorage.getItem(this.config.persistKey)); } catch { items = []; }
		}
		for (const it of items) {
			await this._addModel({ src: it.src, title: it.title }, {
				x: it.x, z: it.z, yaw: it.yaw, scale: it.scale, announce: false, persist: false,
			});
		}
		// Deep-linked models land in front of the camera, skipping any already
		// restored at an arranged spot.
		const have = new Set(this.placements.map((p) => p.src));
		for (const it of this.config.urlModels || []) {
			if (have.has(it.src)) continue;
			await this._addModel(it, { announce: false });
		}
		if (this.placements.length) {
			this._select(this.placements[this.placements.length - 1]);
			if (shared.length) this._setStatus('Shared scene loaded, exactly as arranged. Clear to start fresh.');
			else this._setStatus(this.config.urlModels?.length ? 'Models loaded: turn on the camera to see them in your space.' : 'Your scene is back.');
		}
		this._saveScene();
	}

	// ── Camera passthrough ────────────────────────────────────────────────────

	_applyCameraFov() {
		const track = this.mediaStream?.getVideoTracks?.()[0];
		if (track) {
			const s = track.getSettings?.() ?? {};
			if (Number.isFinite(s.width) && s.width > 0) this.arTrackW = s.width;
			if (Number.isFinite(s.height) && s.height > 0) this.arTrackH = s.height;
		}
		if (!this.arActive || !(this.arTrackW > 0) || !(this.arTrackH > 0)) return;
		const { width, height } = this._viewportSize();
		this.camera.fov = deriveVerticalFovDeg({
			trackWidth: this.arTrackW,
			trackHeight: this.arTrackH,
			viewWidth: width,
			viewHeight: height,
			diagFovDeg: DEFAULT_DIAG_FOV_DEG,
		});
		this.camera.updateProjectionMatrix();
	}

	// Passthrough has no lighting-estimation API, so the room is read from the
	// video itself: mean brightness drives intensity, mean colour drives a gentle
	// white balance. A model in a dim bedroom stops glowing like a studio shot.
	_sampleCameraLight() {
		const probe = this._lightProbe;
		const video = this.ui.video;
		if (!this.arActive || !probe?.ctx || !video?.videoWidth) return;
		let data;
		try {
			probe.ctx.drawImage(video, 0, 0, 16, 16);
			data = probe.ctx.getImageData(0, 0, 16, 16).data;
		} catch {
			return; // frame not readable yet
		}
		const { intensity, tint } = roomLightFromPixels(data);
		this.hemi.intensity += (intensity * HEMI_BASE - this.hemi.intensity) * 0.4;
		this.sun.intensity += (intensity * SUN_BASE - this.sun.intensity) * 0.4;
		this._roomTint.setRGB(tint.r, tint.g, tint.b);
		this.hemi.color.lerp(this._roomTint, 0.4);
		this.sun.color.lerp(this._roomTint, 0.4);
	}

	_startLightMatching() {
		if (this._lightTimer || !this._lightProbe) return;
		this._lightTimer = setInterval(() => this._sampleCameraLight(), 2000);
		this._sampleCameraLight();
	}

	_stopLightMatching() {
		clearInterval(this._lightTimer);
		this._lightTimer = null;
		this.hemi.intensity = HEMI_BASE;
		this.sun.intensity = SUN_BASE;
		this.hemi.color.setHex(0xffffff);
		this.sun.color.setHex(0xffffff);
	}

	async _startCamera() {
		if (this.arTransitioning || this.arActive || this.xrSession) return;
		if (!navigator.mediaDevices?.getUserMedia) {
			this._setStatus('This browser cannot open the camera: the 3D preview still works.', { warn: true });
			return;
		}
		this.arTransitioning = true;
		try {
			this._setStatus('Starting camera…', { sticky: true });
			try {
				this.mediaStream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: { ideal: 'environment' } },
					audio: false,
				});
			} catch (err) {
				if (err?.name === 'NotAllowedError') {
					this._setStatus('Camera permission is blocked. Allow it in your browser settings, then try again.', {
						warn: true, sticky: true, actionLabel: 'Try again', onAction: () => this._startCamera(),
					});
				} else {
					this._setStatus(`The camera did not start (${err?.message ?? err}).`, {
						warn: true, actionLabel: 'Try again', onAction: () => this._startCamera(),
					});
				}
				return;
			}
			const { video, root, cameraBtn } = this.ui;
			if (video) video.srcObject = this.mediaStream;
			this.arActive = true;
			root.classList.add('is-ar');
			cameraBtn?.classList.add('is-active');
			cameraBtn?.setAttribute('aria-pressed', 'true');
			this.grid.visible = false;
			this.scene.fog = null;
			this._userLooked = true;
			video?.play?.().catch(() => { /* autoplay policy: the srcObject still renders */ });
			this._applyCameraFov();
			this._startLightMatching();
			await this._startGyro();
			// Be honest about what this view is. Passthrough is a phone's gyroscope
			// over a camera feed: it turns with you, but it has no plane detection
			// and no positional tracking, so walking around does not hold a model
			// to a spot on the real floor. Reading that as broken tracking is
			// exactly the wrong conclusion to leave someone with when the device
			// has a real AR viewer one tap away.
			if (this.arMode === 'quicklook' || this.arMode === 'sceneviewer') {
				this._setStatus('Camera on. This preview turns with your phone; to lock a model to your real floor, place it in AR.', {
					actionLabel: 'Place in AR', onAction: () => this._openArSheet(),
				});
			} else {
				this._setStatus('Camera on: your models are in the room. Look around.');
			}
			this._emit('camera', { active: true });
		} finally {
			this.arTransitioning = false;
		}
	}

	_stopCamera() {
		if (this.mediaStream) {
			this.mediaStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
			this.mediaStream = null;
		}
		const { video, root, cameraBtn } = this.ui;
		if (video) video.srcObject = null;
		const was = this.arActive;
		this.arActive = false;
		this._stopLightMatching();
		root?.classList.remove('is-ar');
		cameraBtn?.classList.remove('is-active');
		cameraBtn?.setAttribute('aria-pressed', 'false');
		this.grid.visible = !this.xrSession;
		if (!this.xrSession) this.scene.fog = this._fog;
		this.camera.fov = 58;
		this.camera.updateProjectionMatrix();
		this.gyroBase = null;
		this._userLooked = false;
		this.arTrackW = 0;
		this.arTrackH = 0;
		if (was) this._emit('camera', { active: false });
		this._framePreview();
	}

	/**
	 * Hand the rear camera to the device's own AR viewer, and take it back after.
	 *
	 * The camera is a single-client resource on a phone. Leave the page's
	 * `getUserMedia` stream running and Quick Look starts ARKit against a camera
	 * another process is already holding: the model appears, and then world
	 * tracking and plane detection never converge, so it drifts with the phone
	 * instead of settling on the floor. It looks exactly like a broken anchor and
	 * it is not one. The immersive WebXR path has always released the camera for
	 * the same reason; the native hand-off has to as well.
	 *
	 * Synchronous on purpose: it runs in the same tick as the tap that opens the
	 * viewer, and an `await` in front of it costs the user gesture Safari needs.
	 */
	_yieldCameraToNativeAr() {
		if (this._cameraYielded) return;
		this._cameraYielded = true;
		this._cameraWasOn = this.arActive;
		this._stopCamera();
		// Nothing on this page is visible under the AR viewer, and a WebGL loop
		// still running at 60fps behind it is competing with ARKit for the same
		// GPU and the same thermal budget on a device that is about to do plane
		// detection. Stop drawing until the person comes back.
		this._stopLoop();
		// Quick Look presents over the page rather than navigating away, so the
		// return is a visibility change, not a load. `focus` is the backstop for
		// the iOS versions that never mark the page hidden underneath it.
		this._onArReturn = () => {
			if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
			this._reclaimCameraAfterNativeAr();
		};
		document.addEventListener('visibilitychange', this._onArReturn);
		window.addEventListener('focus', this._onArReturn);
	}

	/** Restart the passthrough the person had running before AR took the camera. */
	_reclaimCameraAfterNativeAr() {
		if (!this._cameraYielded) return;
		this._cameraYielded = false;
		if (this._onArReturn) {
			document.removeEventListener('visibilitychange', this._onArReturn);
			window.removeEventListener('focus', this._onArReturn);
			this._onArReturn = null;
		}
		if (this._destroyed || this.xrSession) return;
		this._startLoop();
		if (this.arActive || !this._cameraWasOn) return;
		this._cameraWasOn = false;
		// Permission is already granted for this page, so this normally resolves
		// without a prompt. When a browser insists on a fresh gesture, _startCamera
		// puts a "Try again" action in the status line rather than failing silently.
		this._startCamera().catch((err) => log.warn('camera did not come back after AR', err));
	}

	_screenAngle() {
		try {
			const a = screen.orientation?.angle;
			if (Number.isFinite(a)) return a;
		} catch { /* older browsers */ }
		return Number(window.orientation) || 0;
	}

	_onDeviceOrientation(e) {
		if (isFiniteReading(e.alpha, e.beta)) {
			this._devAlpha = e.alpha;
			this._devBeta = e.beta;
			if (Number.isFinite(e.gamma)) this._devGamma = e.gamma;
		}
		if (!this.arActive || !this.gyroBase) return;
		const b = screenPitchDeg(this._devBeta, this._devGamma, this._screenAngle());
		const nextYaw = resolveLockYaw({
			useAbsolute: false,
			prevYaw: this.cameraYaw,
			alpha: this._devAlpha,
			baseAlpha: this.gyroBase.alpha,
			baseYaw: this.gyroBase.yaw,
			compassHeading: null,
		});
		const nextPitch = clampPitch(this.gyroBase.pitch - (b - this.gyroBase.beta) * (Math.PI / 180), PITCH_MIN, PITCH_MAX);
		if (Number.isFinite(nextYaw)) this.cameraYaw = nextYaw;
		if (Number.isFinite(nextPitch)) this.cameraPitch = nextPitch;
	}

	async _startGyro() {
		// iOS 13+ gates DeviceOrientationEvent behind a user-gesture permission; the
		// camera tap we are inside satisfies it.
		try {
			if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
				const state = await DeviceOrientationEvent.requestPermission();
				if (state !== 'granted') {
					this._setStatus('Motion access is off: drag to look around instead.', { warn: true });
					return;
				}
			}
		} catch {
			return; // declined prompt: drag-look still works
		}
		this.gyroBase = {
			alpha: this._devAlpha,
			beta: screenPitchDeg(this._devBeta, this._devGamma, this._screenAngle()),
			yaw: this.cameraYaw,
			pitch: this.cameraPitch,
		};
	}
	// ── Pointer + touch gestures (XR has its own) ─────────────────────────────

	_viewportSize() {
		const r = this.ui.root.getBoundingClientRect();
		return {
			width: Math.max(1, Math.round(r.width || window.innerWidth)),
			height: Math.max(1, Math.round(r.height || window.innerHeight)),
			left: r.left,
			top: r.top,
		};
	}

	_setNdc(clientX, clientY) {
		const v = this._viewportSize();
		this._ndc.set(((clientX - v.left) / v.width) * 2 - 1, -((clientY - v.top) / v.height) * 2 + 1);
	}

	_placementAt(clientX, clientY) {
		if (!this.placements.length) return null;
		this._setNdc(clientX, clientY);
		this._raycaster.setFromCamera(this._ndc, this.camera);
		const hits = this._raycaster.intersectObjects(this.placements.map((p) => p.group), true);
		if (!hits.length) return null;
		let obj = hits[0].object;
		while (obj) {
			const found = this.placements.find((p) => p.group === obj);
			if (found) return found;
			obj = obj.parent;
		}
		return null;
	}

	_floorPointAt(clientX, clientY) {
		this._setNdc(clientX, clientY);
		this._raycaster.setFromCamera(this._ndc, this.camera);
		const hits = this._raycaster.intersectObject(this.rayPlane);
		return hits.length ? hits[0].point : null;
	}

	_onPointerDown(e) {
		if (this.xrSession) return;
		if (this._pinch.active || performance.now() - this._pinchEndedAt < 350) return;
		this._pointer = {
			x: e.clientX,
			y: e.clientY,
			placement: this._placementAt(e.clientX, e.clientY),
			lookYaw: this.cameraYaw,
			lookPitch: this.cameraPitch,
			moved: false,
		};
	}

	_onPointerMove(e) {
		const down = this._pointer;
		if (!down || this.xrSession || this._pinch.active) return;
		const dx = e.clientX - down.x;
		const dy = e.clientY - down.y;
		if (Math.hypot(dx, dy) > 6) down.moved = true;
		if (!down.moved) return;

		if (down.placement && this._isMine(down.placement)) {
			// Drag a model along the floor.
			const pt = this._floorPointAt(e.clientX, e.clientY);
			if (!pt) return;
			const p = down.placement;
			p.group.position.x = pt.x;
			p.group.position.z = pt.z;
			p.shadow?.position.set(pt.x, 0.004, pt.z);
			if (this.selected === p) this._positionSelRing();
			this._netBroadcastTransform(p);
		} else if (!down.placement && !(this.arActive && this.gyroBase)) {
			// Drag-look, but only when the gyro is not already steering the view.
			this._userLooked = true;
			this.cameraYaw = down.lookYaw + dx * 0.0042;
			this.cameraPitch = clampPitch(down.lookPitch + dy * 0.0032, PITCH_MIN, PITCH_MAX);
		}
	}

	_onPointerUp(e) {
		const down = this._pointer;
		if (!down || this.xrSession) return;
		const wasTap = !down.moved
			&& Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 8
			&& !this._pinch.active
			&& performance.now() - this._pinchEndedAt >= 350;
		if (wasTap) {
			this._select(down.placement); // null deselects
		} else if (down.placement && down.moved && this._isMine(down.placement)) {
			down.placement._lastNetSend = 0; // force the settle broadcast through
			this._netBroadcastTransform(down.placement);
			this._saveScene();
			this._setStatus(null);
		}
		this._pointer = null;
	}

	/** Two fingers: pinch resizes, twist rotates: on the selected (or last) model. */
	_gestureTarget() {
		const t = this.selected ?? this.placements[this.placements.length - 1] ?? null;
		return t && this._isMine(t) ? t : null;
	}

	_onTouchStart(e) {
		if (this.xrSession || e.touches.length !== 2) return;
		const target = this._gestureTarget();
		if (!target) return;
		this._pointer = null; // the pair owns the gesture: no drag, no tap
		pinchStart(this._pinch, touchDist(e.touches), target.group.scale.x);
		this._twist = { startAngle: touchAngle(e.touches), baseYaw: target.yaw, placement: target };
	}

	_onTouchMove(e) {
		if (this.xrSession || e.touches.length !== 2) return;
		const target = this._twist?.placement;
		if (!target) return;
		const s = pinchMove(this._pinch, touchDist(e.touches));
		if (s != null) {
			target.group.scale.setScalar(s);
			target.group.userData._targetScale = s;
			target.shadow?.scale.setScalar(s);
			if (this.selected === target) this._positionSelRing();
		}
		target.yaw = this._twist.baseYaw + twistDelta(this._twist.startAngle, touchAngle(e.touches));
		target.group.rotation.y = target.yaw;
		this._netBroadcastTransform(target);
	}

	_onTouchEnd() {
		this._warmQuickLook();
		const s = pinchEnd(this._pinch);
		const target = this._twist?.placement;
		if (s != null) {
			this._pinchEndedAt = performance.now();
			this._saveScene();
		}
		if (target) {
			target._lastNetSend = 0;
			this._netBroadcastTransform(target);
		}
		this._twist = null;
	}

	// ── Keyboard ──────────────────────────────────────────────────────────────
	// Arrows nudge the selected model camera-relative (Shift for fine), R rotates,
	// D duplicates, Delete removes, Escape closes whatever is open. The mouse
	// never has to leave the scene.

	_onKeyDown(e) {
		if (this._destroyed) return;
		if (!this.ui.root.isConnected) return;
		if (e.target.closest?.('input, textarea, select')) {
			if (e.key === 'Escape') e.target.blur();
			return;
		}
		if (e.key === 'Escape') {
			if (!this.ui.tray.hidden) this._closeTray();
			else if (!this.ui.roomModal.hidden) this._closeRoomModal();
			else if (!this.ui.arModal.hidden) this._closeArSheet();
			else if (!this.ui.qrModal.hidden) this._closeQr();
			else this._select(null);
			return;
		}
		if (!this.ui.tray.hidden || !this.ui.qrModal.hidden || !this.ui.arModal.hidden
			|| !this.ui.roomModal.hidden || this.xrSession) return;
		const p = this.selected;
		if (!p) return;
		const editable = this._isMine(p);

		if (e.key.startsWith('Arrow')) {
			if (!editable) return;
			e.preventDefault();
			const step = e.shiftKey ? 0.02 : 0.1;
			const fwd = this.camera.getWorldDirection(new Vector3());
			fwd.y = 0;
			if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
			fwd.normalize();
			const right = new Vector3(-fwd.z, 0, fwd.x);
			const move = e.key === 'ArrowUp' ? fwd
				: e.key === 'ArrowDown' ? fwd.negate()
					: e.key === 'ArrowLeft' ? right.negate()
						: right;
			p.group.position.addScaledVector(move, step);
			p.shadow?.position.set(p.group.position.x, 0.004, p.group.position.z);
			this._positionSelRing();
			this._netBroadcastTransform(p);
			this._saveScene();
		} else if (e.key === 'r' || e.key === 'R') {
			if (!editable) return;
			p.yaw += Math.PI / 4;
			p.group.rotation.y = p.yaw;
			p._lastNetSend = 0;
			this._netBroadcastTransform(p);
			this._saveScene();
		} else if (e.key === 'd' || e.key === 'D') {
			e.preventDefault();
			this._addModel({ src: p.src, title: p.title }, { yaw: p.yaw, scale: this._logicalScale(p) });
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			if (!editable) return;
			e.preventDefault();
			this._removePlacement(p);
			this._setStatus('Removed.', {
				actionLabel: 'Undo',
				onAction: () => this._addModel({ src: p.src, title: p.title }, {
					x: p.group.position.x, z: p.group.position.z, yaw: p.yaw, scale: this._logicalScale(p),
				}),
			});
		}
	}

	// ── Model tray ────────────────────────────────────────────────────────────

	_wireTrayTabs() {
		const strip = this.ui.trayTabs;
		if (!strip) return;
		for (const [i, source] of this.sources.entries()) {
			const btn = el('button', {
				type: 'button',
				class: 'ars-tab',
				role: 'tab',
				id: `ars-tab-${i}-${source.id}`,
				'aria-selected': String(i === 0),
				tabindex: i === 0 ? '0' : '-1',
				'data-tab': source.id,
				text: source.label || source.id,
			});
			btn.addEventListener('click', () => this._setTrayTab(source.id));
			strip.appendChild(btn);
		}
		// A role="tablist" owes the keyboard the arrow-key contract.
		strip.addEventListener('keydown', (e) => {
			const tabs = [...strip.querySelectorAll('.ars-tab')];
			const i = tabs.indexOf(document.activeElement);
			if (i === -1) return;
			const last = tabs.length - 1;
			const next = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
				: e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1)
					: e.key === 'Home' ? 0
						: e.key === 'End' ? last
							: -1;
			if (next === -1) return;
			e.preventDefault();
			this._setTrayTab(tabs[next].dataset.tab);
			tabs[next].focus();
		});
	}

	_openTray(tab = this._trayTab) {
		const { tray, addBtn, trayClose } = this.ui;
		if (!tray) return;
		this._lastFocus = document.activeElement;
		tray.hidden = false;
		addBtn?.setAttribute('aria-expanded', 'true');
		this._setTrayTab(tab);
		trayClose?.focus?.();
	}

	_closeTray() {
		const { tray, addBtn } = this.ui;
		if (!tray || tray.hidden) return;
		const hadFocus = tray.contains(document.activeElement);
		tray.hidden = true;
		addBtn?.setAttribute('aria-expanded', 'false');
		if (hadFocus) this._restoreFocus(addBtn);
	}

	// Closing a dialog must hand the keyboard back to whatever opened it; dropping
	// focus on <body> strands a keyboard user at the top of the document.
	_restoreFocus(fallback) {
		const target = this._lastFocus && document.contains(this._lastFocus) && !this._lastFocus.hidden
			? this._lastFocus
			: fallback;
		target?.focus?.();
		this._lastFocus = null;
	}

	_setTrayTab(tab) {
		this._trayTab = tab;
		const tabs = [...(this.ui.trayTabs?.querySelectorAll('.ars-tab') || [])];
		for (const b of tabs) {
			const on = b.dataset.tab === tab;
			b.classList.toggle('is-active', on);
			b.setAttribute('aria-selected', String(on));
			b.tabIndex = on ? 0 : -1;
			if (on) {
				this.ui.trayBody?.setAttribute('aria-labelledby', b.id);
				b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
			}
		}
		this._renderTray();
	}

	async _renderTray() {
		const body = this.ui.trayBody;
		if (!body) return;
		const tab = this._trayTab;
		const source = this.sources.find((s) => s.id === tab);
		if (!source) return;
		if (source.kind === 'link' || source.id === 'link') {
			this._renderLinkTab(body);
			return;
		}

		body.textContent = '';
		body.appendChild(el('div', { class: 'ars-tray-loading' }, [
			el('span', { class: 'ars-spinner', 'aria-hidden': 'true' }), 'Loading models…',
		]));

		let items;
		try {
			// `live` sources (recents) change as you work, so they are never cached.
			if (!source.live && this._trayCache.has(tab)) items = this._trayCache.get(tab);
			else {
				items = await source.list();
				if (!source.live) this._trayCache.set(tab, items);
			}
		} catch (err) {
			log.warn('source failed', tab, err);
			if (this._trayTab !== tab) return;
			body.textContent = '';
			body.appendChild(el('div', { class: 'ars-tray-empty' }, [
				el('p', { text: `Couldn't load ${source.label || 'these models'} right now.` }),
				el('button', {
					type: 'button', class: 'ars-btn', text: 'Retry',
					onclick: () => { this._trayCache.delete(tab); this._renderTray(); },
				}),
			]));
			return;
		}
		if (this._trayTab !== tab) return;

		if (!items.length) {
			body.textContent = '';
			body.appendChild(el('div', { class: 'ars-tray-empty' }, [
				el('p', { text: source.emptyCopy || 'Nothing here yet.' }),
				this.forge
					? el('button', {
						type: 'button', class: 'ars-btn ars-btn-primary', text: 'Generate a model',
						onclick: () => { this._closeTray(); this.ui.forgeInput?.focus(); },
					})
					: null,
			]));
			return;
		}
		this._renderList(body, source, items);
	}

	_renderList(body, source, items) {
		body.textContent = '';
		const searchable = source.searchable ?? items.length > 24;
		let shown = LIST_SLICE;
		let search = null;

		if (searchable) {
			search = el('input', {
				class: 'ars-search', type: 'search', autocomplete: 'off',
				placeholder: `Search ${items.length} models…`,
				'aria-label': `Search ${source.label || 'models'}`,
			});
			body.appendChild(search);
		}
		if (source.hint) body.appendChild(el('p', { class: 'ars-hint', text: source.hint }));

		const list = el('ul', { class: 'ars-item-list' });
		const more = el('div', { class: 'ars-more' });
		body.appendChild(list);
		body.appendChild(more);

		const paint = () => {
			const q = (search?.value || '').trim().toLowerCase();
			const matches = q ? items.filter((o) => (o.keywords || o.title || '').toLowerCase().includes(q)) : items;
			list.textContent = '';
			for (const item of matches.slice(0, shown)) list.appendChild(this._trayItem(item));
			more.textContent = '';
			if (matches.length > shown) {
				const left = matches.length - shown;
				more.appendChild(el('button', {
					type: 'button', class: 'ars-btn',
					text: `Show ${Math.min(LIST_SLICE, left)} more (${left} left)`,
					onclick: () => { shown += LIST_SLICE; paint(); },
				}));
			} else if (!matches.length) {
				more.appendChild(el('p', { class: 'ars-hint', text: 'Nothing matches that search.' }));
			}
		};
		search?.addEventListener('input', () => { shown = LIST_SLICE; paint(); });
		paint();
	}

	_trayItem(item) {
		const label = item.title || 'Model';
		const thumb = el('span', { class: 'ars-item-thumb' });
		if (item.poster) {
			const img = el('img', { src: item.poster, alt: '', loading: 'lazy', decoding: 'async' });
			// A thumbnail that 404s would otherwise leave a broken-image glyph in the
			// grid, which makes the whole tray look broken.
			img.addEventListener('error', () => {
				thumb.textContent = '';
				thumb.appendChild(el('span', { class: 'ars-item-cube', 'aria-hidden': 'true', text: '◆' }));
			}, { once: true });
			thumb.appendChild(img);
		} else {
			thumb.appendChild(el('span', { class: 'ars-item-cube', 'aria-hidden': 'true', text: '◆' }));
		}
		const btn = el('button', {
			type: 'button', class: 'ars-item-add',
			title: item.title || '',
			'aria-label': `Add ${label} to your space`,
			onclick: () => {
				this._closeTray();
				this._addModel({ src: item.src, title: label, poster: item.poster });
			},
		}, [
			thumb,
			el('span', { class: 'ars-item-title', text: label }),
			el('span', { class: 'ars-item-cta', text: 'Add' }),
		]);
		return el('li', { class: 'ars-item' }, [btn]);
	}

	_renderLinkTab(body) {
		body.textContent = '';
		const input = el('input', {
			class: 'ars-search', type: 'url', inputmode: 'url', required: true,
			placeholder: 'https://example.com/model.glb', 'aria-label': 'GLB model URL',
		});
		const form = el('form', {}, [
			el('label', { class: 'ars-hint', for: '', text: 'Paste a link to any .glb model' }),
			el('div', { class: 'ars-link-row' }, [input, el('button', { type: 'submit', class: 'ars-btn ars-btn-primary', text: 'Add' })]),
			el('p', { class: 'ars-hint', text: 'Any https .glb works, as long as the host allows cross-origin requests.' }),
		]);
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const url = normalizeGlbUrl(input.value);
			if (!url) {
				this._setStatus('That link is not a loadable https GLB.', { warn: true });
				input.focus();
				return;
			}
			this._closeTray();
			this._addModel({ src: url, title: filenameLabel(url) });
		});
		body.appendChild(form);
	}

	// ── Generation ────────────────────────────────────────────────────────────

	_forgeChip(state, label = '', elapsedS = null) {
		const chip = this.ui.chip;
		if (!chip) return;
		chip.dataset.state = state;
		chip.hidden = state === 'idle';
		const text = chip.querySelector('.ars-chip-label');
		const time = chip.querySelector('.ars-chip-elapsed');
		if (text) text.textContent = label;
		if (time) time.textContent = elapsedS == null ? '' : `${Math.round(elapsedS)}s`;
	}

	async _startForge(rawPrompt) {
		const prompt = String(rawPrompt || '').trim();
		if (!this.forge || prompt.length < 3 || this._forgeBusy) return null;
		this._forgeBusy = true;
		const seq = ++this._forgeSeq;
		if (this.ui.forgeGo) this.ui.forgeGo.disabled = true;
		const started = Date.now();
		this._forgeChip('working', 'Sending your prompt…', 0);
		const ticker = setInterval(() => {
			if (this.ui.chip?.dataset.state === 'working') {
				const label = this.ui.chip.querySelector('.ars-chip-label')?.textContent || '';
				this._forgeChip('working', label, (Date.now() - started) / 1000);
			}
		}, 1000);

		try {
			const model = await this.forge.generate(prompt, {
				onProgress: (s) => {
					if (seq !== this._forgeSeq) return;
					this._forgeChip('working', s.message, s.elapsedMs / 1000);
				},
			});
			if (seq !== this._forgeSeq) return null;
			rememberRecent({ src: model.src, title: model.prompt, poster: model.poster }, this._recentKey);
			this._trayCache.delete('recent');
			this._forgeChip('idle');
			if (this.ui.forgeInput) this.ui.forgeInput.value = '';
			await this._addModel({ src: model.src, title: model.title, poster: model.poster }, { announce: false });
			this._setStatus('Generated and placed. Pinch to resize, drag to move.');
			this._emit('generate', { model });
			return model;
		} catch (err) {
			if (seq === this._forgeSeq) {
				this._forgeChip('error', err?.message || 'Generation failed.');
				setTimeout(() => {
					if (this.ui.chip?.dataset.state === 'error') this._forgeChip('idle');
				}, 6500);
			}
			this._emit('generate-error', { error: err, prompt });
			return null;
		} finally {
			clearInterval(ticker);
			if (seq === this._forgeSeq) {
				this._forgeBusy = false;
				if (this.ui.forgeGo) this.ui.forgeGo.disabled = false;
			}
		}
	}

	// ── Entering AR ───────────────────────────────────────────────────────────

	/**
	 * Take this device into AR by its best available path. WebXR keeps the whole
	 * scene in the page; everything else hands one model to the platform's own AR
	 * viewer, which is the only way to get real ARKit / ARCore placement there.
	 */
	_enterAR() {
		// Immersive AR keeps the whole arrangement in the page, so a device that
		// has it goes straight in: an extra sheet in front of a one-tap experience
		// is friction, not polish. Everywhere else the hand-off is not instant and
		// not obvious, and the sheet is what makes it both.
		if (this.arMode === 'webxr') return this._toggleXR();
		this._openArSheet();
		return Promise.resolve();
	}

	// ── The AR hand-off sheet ─────────────────────────────────────────────────

	/**
	 * Cache identity for one placement's USDZ. The scale is in the key because it
	 * is baked into the export: someone who pinches a chair to half size and taps
	 * AR must get the half-size chair, not the cached full-size one.
	 */
	_arCacheKey(p) {
		return `${p.src}|${p.group.scale.x.toFixed(3)}`;
	}

	/**
	 * The USDZ bytes for one placement.
	 *
	 * Exported from the copy already standing in the scene, so there is no second
	 * download and Quick Look receives the pose and the size on screen. A model
	 * the exporter chokes on falls back to a clean conversion of the original
	 * file rather than failing the tap.
	 */
	async _targetUsdz(p) {
		const { objectToUsdzBlob, glbUrlToUsdzBlob } = await import('./usdz.js');
		try {
			return await objectToUsdzBlob(p.group);
		} catch (err) {
			log.warn('live-scene USDZ export failed, refetching the source', err);
			return glbUrlToUsdzBlob(p.src);
		}
	}

	/**
	 * A picture of the model the sheet is about to send, rendered from the model
	 * itself.
	 *
	 * A catalogue poster would be easier, but half the ways a model reaches this
	 * studio (a pasted URL, a generation still warming its thumbnail) have no
	 * poster at all, and a 200px empty box with a placeholder glyph in it is the
	 * kind of detail that makes a product feel unfinished. This renders the real
	 * thing, at the size and in the pose it is standing in the scene, off-screen
	 * into a render target so the live canvas never flickers.
	 *
	 * Best-effort by design: a context loss or a stubbed WebGL implementation
	 * returns null and the sheet falls back to its glyph.
	 *
	 * @param {object} p     The placement to portray
	 * @param {number} [size] Square edge, in device pixels
	 * @returns {string|null} a data: URL
	 */
	_renderArPreview(p, size = 384) {
		// An immersive session owns the renderer and its frame buffer; borrowing it
		// for a thumbnail mid-session is not worth a dropped XR frame.
		if (this.xrSession) return null;
		let target = null;
		try {
			const model = cloneSkinnedScene(p.group);
			model.position.set(0, 0, 0);
			model.rotation.set(0, 0, 0);
			model.updateMatrixWorld(true);

			const box = new Box3().setFromObject(model);
			if (box.isEmpty()) return null;
			const center = box.getCenter(new Vector3());
			const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.01);

			const scene = new Scene();
			scene.add(model);
			// Lit brighter than the room is: this is a product shot of the model,
			// not a preview of the scene's lighting, and dark props read as a
			// silhouette at anything subtler.
			scene.add(new HemisphereLight(0xffffff, 0x3a3a48, 3.4));
			const key = new DirectionalLight(0xffffff, 3.6);
			key.position.set(1.4, 2.2, 1.8);
			const fill = new DirectionalLight(0xdfe4ff, 1.5);
			fill.position.set(-1.6, 0.9, -1.2);
			scene.add(key, fill);

			const fov = 32;
			const cam = new PerspectiveCamera(fov, 1, radius / 100, radius * 100);
			// Three-quarter view from slightly above: the angle a product shot uses,
			// and the one that reads as a solid object rather than a flat card.
			const dist = (radius / Math.sin((fov * Math.PI) / 360)) * 1.06;
			cam.position.set(center.x + dist * 0.62, center.y + dist * 0.42, center.z + dist * 0.66);
			cam.lookAt(center);

			target = new WebGLRenderTarget(size, size, { depthBuffer: true });
			const prevTarget = this.renderer.getRenderTarget();
			this.renderer.setRenderTarget(target);
			this.renderer.clear();
			this.renderer.render(scene, cam);
			const pixels = new Uint8Array(size * size * 4);
			this.renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
			this.renderer.setRenderTarget(prevTarget);

			const canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			const ctx = canvas.getContext('2d');
			const image = ctx.createImageData(size, size);
			// WebGL reads bottom-up; a canvas is top-down.
			const stride = size * 4;
			for (let row = 0; row < size; row++) {
				image.data.set(pixels.subarray((size - 1 - row) * stride, (size - row) * stride), row * stride);
			}
			ctx.putImageData(image, 0, 0);
			return canvas.toDataURL('image/png');
		} catch (err) {
			log.warn('AR preview render failed', err);
			return null;
		} finally {
			target?.dispose();
		}
	}

	/** Which model the AR button would send right now. */
	_arDefaultTarget() {
		return this.selected || this.placements[this.placements.length - 1] || null;
	}

	/**
	 * Convert the likely AR target ahead of the tap, so the tap is instant.
	 *
	 * This is the whole reason Quick Look works here rather than appearing to do
	 * nothing: Safari opens `rel="ar"` only while the page holds user activation,
	 * and a conversion started inside the tap handler outlives it. Warming is
	 * debounced because a pinch changes the cache key on every frame.
	 */
	_warmQuickLook() {
		if (this._destroyed || this.arMode !== 'quicklook') return;
		clearTimeout(this._arWarmTimer);
		this._arWarmTimer = setTimeout(() => {
			if (this._destroyed) return;
			const target = this._arDefaultTarget();
			if (!target) return;
			const key = this._arCacheKey(target);
			if (isQuickLookReady(key)) return;
			this._arKeys.add(key);
			prepareNativeAr(
				{ src: target.src, title: target.title, key, build: () => this._targetUsdz(target) },
			).catch((err) => {
				// A warm-up failure is not the user's problem yet: the sheet retries
				// the same conversion in front of them, with a real error and a
				// retry button, if they ever ask for it.
				log.warn('AR warm-up failed', err);
			});
		}, 900);
	}

	/**
	 * Open the sheet that hands one model to the device's AR viewer.
	 * @param {object} [placement] Defaults to the selected model, then the last one.
	 */
	_openArSheet(placement) {
		const u = this.ui;
		if (!u.arModal) return;
		this._lastFocus = document.activeElement;
		u.arModal.hidden = false;
		this._showArTarget(placement || this._arDefaultTarget());
		// aria-modal is a promise that focus is inside the dialog.
		(u.arGo.hidden || u.arGo.disabled ? u.arClose : u.arGo)?.focus?.();
		this._emit('ar-sheet', { open: true });
	}

	_closeArSheet() {
		const { arModal, xrBtn } = this.ui;
		if (!arModal || arModal.hidden) return;
		const hadFocus = arModal.contains(document.activeElement);
		arModal.hidden = true;
		this._arToken++; // abandon any conversion still in flight for this sheet
		if (hadFocus) this._restoreFocus(xrBtn);
		this._emit('ar-sheet', { open: false });
	}

	_setArStatus(message, { state = '' } = {}) {
		const node = this.ui.arStatus;
		if (!node) return;
		node.textContent = '';
		node.classList.toggle('is-error', state === 'error');
		node.classList.toggle('is-ready', state === 'ready');
		if (!message) return;
		if (state === 'busy') node.appendChild(el('span', { class: 'ars-spinner', 'aria-hidden': 'true' }));
		node.appendChild(el('span', { text: message }));
	}

	/** Render the sheet for one target and start preparing it. */
	_showArTarget(target) {
		const u = this.ui;
		if (!u.arModal || u.arModal.hidden) return;
		this._arToken++;
		this._arHandoff = null;
		this._arTarget = target || null;

		const goLabel = u.arGo.querySelector('.ars-ar-go-label');
		this._arRetry = null;
		u.arXr.hidden = this.arMode !== 'webxr';
		u.arQr.hidden = true;
		u.arPicker.hidden = true;
		u.arPicker.textContent = '';

		if (!target) {
			u.arThumb.textContent = '🪄';
			u.arName.textContent = 'Nothing to place yet';
			u.arHint.textContent = 'Add a model to the scene and it can stand on your real floor at its real size.';
			this._setArStatus(null);
			u.arGo.hidden = false;
			u.arGo.disabled = false;
			u.arGo.removeAttribute('aria-busy');
			if (goLabel) goLabel.textContent = 'Browse models';
			// The hexagon means "place this"; there is nothing to place yet.
			u.arGo.querySelector('.ars-ar-go-icon').hidden = true;
			return;
		}

		u.arThumb.textContent = '◆';
		const preview = this._renderArPreview(target) || target.poster;
		if (preview) {
			const img = el('img', { src: preview, alt: '' });
			// A poster that 404s would leave a broken-image glyph in the sheet.
			img.addEventListener('error', () => { u.arThumb.textContent = '◆'; }, { once: true });
			u.arThumb.textContent = '';
			u.arThumb.appendChild(img);
		}
		u.arName.textContent = target.title || 'Model';

		if (this.placements.length > 1) {
			u.arPicker.hidden = false;
			for (const p of this.placements) {
				u.arPicker.appendChild(el('button', {
					type: 'button', class: 'ars-ar-chip', 'data-ar-id': p.id,
					'aria-pressed': p === target ? 'true' : 'false',
					text: p.title || 'Model',
				}));
			}
		}

		if (this.arMode === 'none') {
			u.arHint.textContent = 'AR needs a phone. Open this scene on your iPhone or Android and the model stands on your real floor.';
			this._setArStatus(null);
			u.arGo.hidden = true;
			u.arQr.hidden = false;
			return;
		}

		u.arHint.textContent = 'Point your device at a flat surface, then drag to place it. It arrives at real size.';
		u.arGo.hidden = false;
		u.arGo.querySelector('.ars-ar-go-icon').hidden = false;
		if (goLabel) goLabel.textContent = 'Place in your space';
		this._prepareArTarget(target);
	}

	/**
	 * Get the hand-off ready before the person taps for it.
	 *
	 * Scene Viewer needs nothing prepared, so it enables straight away. Quick
	 * Look needs a USDZ, which is why the button says so while it converts
	 * instead of sitting there looking broken for two seconds.
	 */
	async _prepareArTarget(target) {
		const u = this.ui;
		const token = this._arToken;
		const key = this._arCacheKey(target);
		const warm = this.arMode !== 'quicklook' || isQuickLookReady(key);

		if (!warm) {
			u.arGo.disabled = true;
			u.arGo.setAttribute('aria-busy', 'true');
			this._setArStatus('Preparing it for AR…', { state: 'busy' });
		}
		this._arKeys.add(key);
		try {
			const handoff = await prepareNativeAr({
				src: target.src, title: target.title, key, build: () => this._targetUsdz(target),
			}, { fallbackUrl: this.config.shareBaseUrl });
			if (token !== this._arToken || this._destroyed) return;
			this._arHandoff = handoff;
			u.arGo.disabled = false;
			u.arGo.removeAttribute('aria-busy');
			this._setArStatus(warm ? null : 'Ready.', { state: 'ready' });
			// Put the thumb back on the button that is now armed, but never steal
			// focus from a control the person moved to while they waited.
			const idle = document.activeElement === document.body || document.activeElement === u.arModal;
			if (!warm && idle) u.arGo.focus?.();
		} catch (err) {
			if (token !== this._arToken || this._destroyed) return;
			log.warn('AR preparation failed', err);
			u.arGo.disabled = true;
			u.arGo.removeAttribute('aria-busy');
			this._setArStatus(`Could not prepare this model for AR (${err?.message || err}).`, { state: 'error' });
			// The primary button stays the primary action: it just becomes the
			// retry, rather than leaving a dead button and a second one to hunt for.
			this._arRetry = target;
			u.arGo.disabled = false;
			u.arGo.querySelector('.ars-ar-go-label').textContent = 'Try again';
			u.arGo.querySelector('.ars-ar-go-icon').hidden = true;
			this._emit('native-ar-error', { error: err, src: target.src });
		}
	}

	/**
	 * The tap that opens AR.
	 *
	 * Everything expensive already happened, so this is deliberately synchronous
	 * from the click through to the anchor activation: put an `await` in front of
	 * `open()` and iOS drops the user gesture and silently refuses to open Quick
	 * Look.
	 */
	_onArGo() {
		if (!this._arTarget) {
			this._closeArSheet();
			this._openTray();
			return;
		}
		if (this._arRetry) {
			this._showArTarget(this._arRetry);
			return;
		}
		const handoff = this._arHandoff;
		if (!handoff) return;
		const { src, title } = this._arTarget;
		this._yieldCameraToNativeAr();
		try {
			handoff.open();
		} catch (err) {
			log.warn('native AR failed to open', err);
			this._setArStatus(`Could not open AR (${err?.message || err}).`, { state: 'error' });
			this._emit('native-ar-error', { error: err, src });
			return;
		}
		this._emit('native-ar', { src, title, viewer: handoff.viewer });
		this._closeArSheet();
		this._setStatus('Point at the floor, then drag to place it.');
	}

	/**
	 * Open one model in the device's native AR viewer. On iOS the GLB is
	 * converted to USDZ on the device first, which is why this reports progress:
	 * a couple of silent seconds after a tap reads as a dead button.
	 *
	 * @param {object} [placement] Defaults to the selected model, then the last one.
	 */
	async _placeNative(placement) {
		const target = placement || this.selected || this.placements[this.placements.length - 1];
		if (!target) {
			this._setStatus('Add a model first, then place it in your space.', { warn: true });
			return null;
		}
		if (this._nativeArBusy) return null;
		this._nativeArBusy = true;
		const btn = this.ui.xrBtn;
		btn?.setAttribute('aria-busy', 'true');

		this._arKeys.add(this._arCacheKey(target));
		const STAGES = {
			download: 'Fetching the model…',
			parse: 'Reading the model…',
			convert: 'Preparing it for AR…',
			open: 'Opening AR…',
		};
		this._setStatus(STAGES.download, { sticky: true });
		if (this.arMode === 'quicklook' || this.arMode === 'sceneviewer') this._yieldCameraToNativeAr();
		try {
			const opened = await placeInYourSpace(
				{
					src: target.src,
					title: target.title,
					key: this._arCacheKey(target),
					build: () => this._targetUsdz(target),
				},
				{
					onProgress: (stage) => this._setStatus(STAGES[stage] || 'Preparing AR…', { sticky: true }),
					fallbackUrl: this.config.shareBaseUrl,
				},
			);
			if (opened === 'none') {
				this._setStatus('This device has no AR viewer. Open this scene on a phone instead.', {
					warn: true, actionLabel: 'Show QR', onAction: () => this._openQr(),
				});
			} else {
				this._setStatus('Point at the floor, then drag to place it.');
			}
			this._emit('native-ar', { src: target.src, title: target.title, viewer: opened });
			return opened;
		} catch (err) {
			log.warn('native AR failed', err);
			this._setStatus(`Could not open AR for this model (${err?.message || err}).`, {
				warn: true, actionLabel: 'Try again', onAction: () => this._placeNative(target),
			});
			this._emit('native-ar-error', { error: err, src: target.src });
			return null;
		} finally {
			this._nativeArBusy = false;
			btn?.removeAttribute('aria-busy');
		}
	}

	// ── WebXR immersive session ───────────────────────────────────────────────

	async _toggleXR() {
		if (this.xrSession) {
			this.xrSession.end();
			return;
		}
		if (this.arTransitioning) return;
		this.arTransitioning = true;
		try {
			if (this.arActive) this._stopCamera(); // the immersive session owns the rear camera
			const session = new MultiPlaceSession({
				renderer: this.renderer,
				scene: this.scene,
				camera: this.camera,
				domOverlayRoot: this.ui.hud,
				getArmedContent: () => this._armedContent(),
				onPlaced: (group) => {
					const p = this.placements.find((x) => x.group === group);
					if (p) {
						p.yaw = 0;
						this._select(null); // the ring is a fallback-mode affordance
					}
					this._saveScene();
					this._setStatus(`Placed ${this.xrSession?.placedCount ?? ''}: tap another spot to add one more.`);
				},
				getScaleTarget: () => this.placements[this.placements.length - 1]?.group ?? null,
				onScale: (s, { final }) => { if (final) this._saveScene(); },
				onHit: (has) => this.ui.root.classList.toggle('xr-has-floor', has),
				onTracking: (ok) => {
					if (!ok) this._setStatus('Tracking lost: move to a brighter spot with more texture.', { warn: true, sticky: true });
					else this._setStatus(null);
				},
				onFrame: (dt) => {
					for (const p of this.placements) {
						p.mixer?.update(dt);
						p.idle?.update(dt);
					}
				},
				onEnd: () => this._onXREnd(),
			});
			this._stopLoop();
			await session.start();
			this.xrSession = session;
			// Real-world lighting and reflections: created after start() so the
			// addon's sessionstart listener requests the light probe.
			this.estimatedLight = new EstimatedLighting({
				renderer: this.renderer,
				scene: this.scene,
				baseLights: [this.hemi, this.sun],
				onChange: (on) => {
					if (on) this._setStatus('Lit by your room: reflections and shadows match the real light.');
				},
			});
			this.estimatedLight.start();
			this.ui.root.classList.add('is-xr');
			this.grid.visible = false;
			this.scene.fog = null;
			this.selRing.visible = false;
			for (const p of this.placements) if (p.shadow) p.shadow.visible = false;
			this.ui.xrBtn?.classList.add('is-active');
			this.ui.xrBtn?.setAttribute('aria-pressed', 'true');
			this._setStatus('Point at the floor, then tap to place. Every tap adds another model.');
			this._emit('xr', { active: true });
		} catch (err) {
			log.warn('XR session failed', err);
			this.estimatedLight?.dispose();
			this.estimatedLight = null;
			this._startLoop();
			this._setStatus('Could not start immersive AR on this device. Camera mode still works.', { warn: true });
		} finally {
			this.arTransitioning = false;
		}
	}

	/** What the next reticle tap places. An XR select cannot await, so only an
	 *  already-resolved template is placeable. */
	_armedContent() {
		const src = this._armed?.src ?? this.placements[this.placements.length - 1]?.src;
		if (!src) {
			this._setStatus('Pick a model first: Add or generate one, then tap the floor.', { warn: true });
			return null;
		}
		const tpl = this._templatesReady.get(src);
		if (!tpl) {
			this._loadTemplate(src);
			this._setStatus('Model is still loading: one moment, then tap again.', { sticky: true });
			return null;
		}
		const { group, mixer, idlePromise } = this._instantiate(tpl, src);
		const placement = {
			id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
			src,
			title: this._armed?.title || '',
			poster: '',
			group,
			shadow: null,
			mixer,
			idle: null,
			yaw: 0,
			baseRadius: tpl.radius,
			height: tpl.height || 0,
			spawnT: 1,
			netId: null,
			ownerId: null,
			remote: false,
			_lastNetSend: 0,
		};
		idlePromise?.then((mgr) => {
			if (!mgr) return;
			if (this.placements.includes(placement)) placement.idle = mgr;
			else mgr.detach();
		});
		this.placements.push(placement);
		this._updateCount();
		this._emit('add', { placement: publicPlacement(placement, this), remote: false });
		return group;
	}

	_onXREnd() {
		this.xrSession = null;
		this.estimatedLight?.dispose();
		this.estimatedLight = null;
		this.ui.root.classList.remove('is-xr', 'xr-has-floor');
		this.ui.xrBtn?.classList.remove('is-active');
		this.ui.xrBtn?.setAttribute('aria-pressed', 'false');
		// Ground anything the session placed mid-air back onto the floor plane so
		// the fallback layout stays coherent, then resume our own loop.
		for (const p of this.placements) {
			p.group.position.y = 0;
			if (p.shadow) {
				p.shadow.visible = true;
				p.shadow.position.set(p.group.position.x, 0.004, p.group.position.z);
			}
		}
		this.grid.visible = !this.arActive;
		if (!this.arActive) this.scene.fog = this._fog;
		this._saveScene();
		this._startLoop();
		this._setStatus('Back to the studio view.');
		this._emit('xr', { active: false });
	}

	// ── Photo + QR ────────────────────────────────────────────────────────────

	async _capturePhoto() {
		this.renderer.render(this.scene, this.camera); // fresh pixels under preserveDrawingBuffer
		const blob = await captureComposite({ canvas: this.ui.canvas, video: this.ui.video, isAR: this.arActive });
		if (!blob) {
			this._setStatus('Could not capture the frame.', { warn: true });
			return;
		}
		try {
			const how = await shareOrDownload(blob, {
				filename: 'ar-studio.png',
				title: this.config.branding?.title || 'AR Studio',
			});
			this._setStatus(how === 'shared' ? 'Shared.' : 'Saved to your downloads.');
		} catch (err) {
			if (err?.name !== 'AbortError') this._setStatus('Could not share that photo.', { warn: true });
		}
	}

	_openQr() {
		const { qrModal, qrBox, qrLink } = this.ui;
		if (!qrModal) return;
		this._lastFocus = document.activeElement;
		const url = this.shareUrl();
		if (qrBox) {
			try {
				qrBox.innerHTML = renderQRToSVG(url, { scale: 6, margin: 2, dark: '#0b0b0b', light: '#ffffff' });
			} catch {
				// The arrangement hash can outgrow the encoder; a models-only QR still
				// beats a wall of text, and the full link below keeps the arrangement.
				try {
					qrBox.innerHTML = renderQRToSVG(studioShareUrl(this.config.shareBaseUrl, this.getScene()), {
						scale: 6, margin: 2, dark: '#0b0b0b', light: '#ffffff',
					});
				} catch {
					qrBox.textContent = url;
				}
			}
		}
		if (qrLink) {
			qrLink.href = url;
			qrLink.textContent = url.length > 72 ? `${url.slice(0, 69)}…` : url;
		}
		qrModal.hidden = false;
		// aria-modal is a promise that focus is inside the dialog.
		this.ui.qrClose?.focus?.();
		this._emit('share', { url });
	}

	_closeQr() {
		const { qrModal, qrBtn } = this.ui;
		if (!qrModal || qrModal.hidden) return;
		const hadFocus = qrModal.contains(document.activeElement);
		qrModal.hidden = true;
		if (hadFocus) this._restoreFocus(qrBtn);
	}

	// ── Shared rooms ──────────────────────────────────────────────────────────

	// A model I control: single-player models (no ownerId) and my own room models.
	// Other people's room models stay visible and live but are not mine to edit
	// the server owner-gates too, so this is the local half of the same rule.
	_isMine(p) {
		return !p.ownerId || p.ownerId === this.clientId;
	}

	_placementShared(p) {
		return localToShared({
			x: p.group.position.x,
			z: p.group.position.z,
			yaw: p.yaw,
			scale: this._logicalScale(p),
			height: p.height || 0,
		});
	}

	_placementWire(p, wireId) {
		return { id: wireId, src: p.src, title: p.title, ...this._placementShared(p) };
	}

	// Throttled to ~12 Hz so a drag does not flood the socket.
	_netBroadcastTransform(p) {
		if (!this.net || this.net.status !== 'online' || !p.netId || !this._isMine(p)) return;
		const now = Date.now();
		if (now - (p._lastNetSend || 0) < 80) return;
		p._lastNetSend = now;
		const s = this._placementShared(p);
		this.net.update(p.netId, { relEast: s.relEast, relNorth: s.relNorth, yawDeg: s.yawDeg, scale: s.scale });
	}

	_applySharedTransform(p, m) {
		const l = sharedToLocal(m);
		p.group.position.set(l.x, 0, l.z);
		p.yaw = l.yaw;
		p.group.rotation.y = l.yaw;
		p.group.scale.setScalar(l.scale);
		p.group.userData._targetScale = l.scale;
		p.spawnT = 1; // an update is not a spawn: no scale-in pop
		if (p.shadow) {
			p.shadow.position.set(l.x, 0.004, l.z);
			p.shadow.scale.setScalar(l.scale);
		}
		if (this.selected === p) this._positionSelRing();
	}

	// Reconcile the room's full model list against local placements: add what
	// appeared, drop remote ones that left, refresh other people's transforms. My
	// own live models are authored locally and never overwritten by their echo.
	_reconcileRemoteModels(models) {
		const serverIds = new Set(models.map((m) => m.id));
		for (const p of [...this.placements]) {
			if (p.remote && p.netId && !serverIds.has(p.netId)) {
				this._removePlacement(p, { persist: false, broadcast: false });
			}
		}
		let fresh = 0;
		for (const m of models) {
			const existing = this._netModels.get(m.id);
			if (existing) {
				if (!this._isMine(existing)) this._applySharedTransform(existing, m);
				continue;
			}
			const local = sharedToLocal(m);
			const mine = !!m.mine || m.ownerId === this.clientId;
			if (!mine) fresh++;
			this._addModel({ src: m.src, title: m.title }, {
				x: local.x, z: local.z, yaw: local.yaw, scale: local.scale,
				remote: true, netId: m.id, ownerId: mine ? this.clientId : m.ownerId,
				announce: false, persist: false,
			});
		}
		this._updateCount();
		// After the join burst settles, a new model from someone else is live
		// activity worth surfacing: but never during the initial sync.
		if (this._roomSynced && fresh > 0) {
			this._setStatus(fresh === 1 ? 'Someone added a model to the room.' : `${fresh} models were added to the room.`);
		}
		this._roomSynced = true;
	}

	_applyRemoteModelChange(m) {
		const p = this._netModels.get(m.id);
		if (!p) return;
		if (m.removed) {
			if (p.remote) this._removePlacement(p, { persist: false, broadcast: false });
			return;
		}
		if (!this._isMine(p)) this._applySharedTransform(p, m);
	}

	_wireNet(net) {
		net.on('status', ({ status }) => {
			if (status === 'online') {
				this._setStatus(`Shared room ${this.roomCode} is live: edits sync to everyone here.`);
				this.ui.root.classList.add('is-room');
			} else if (status === 'connecting') {
				this._setStatus(`Joining room ${this.roomCode}…`, { sticky: true });
			} else if (status === 'unavailable' || status === 'failed') {
				this._setStatus('Shared rooms are offline right now: you can still build solo.', { warn: true });
				this._leaveRoom({ silent: true });
			} else if (status === 'offline') {
				this._setStatus('Reconnecting to the room…', { sticky: true });
			}
			this._updateRoomButton();
			this._emit('room', { status, code: this.roomCode });
		});
		net.on('models', (models) => this._reconcileRemoteModels(models));
		net.on('model', (m) => this._applyRemoteModelChange(m));
		net.on('presence', (p) => {
			const prev = this._presence.count;
			this._presence = p;
			this._updateCount();
			if (!this.ui.roomModal.hidden) this._renderRoomModal();
			if (prev > 0 && p.count > prev) {
				this._setStatus(p.count === 2 ? "Someone joined: you're building together now." : 'Someone else joined the room.');
			} else if (prev > 1 && p.count < prev && p.count >= 1) {
				this._setStatus(p.count === 1 ? "You're on your own in the room now." : 'Someone left the room.');
			}
		});
		net.on('reject', (msg) => {
			const why = msg?.reason === 'room_full' ? 'the room is full'
				: msg?.reason === 'owner_full' ? 'you have the maximum models in this room'
					: 'the room declined it';
			this._setStatus(`Couldn't share that model: ${why}.`, { warn: true });
		});
	}

	// Push every model I already have into a freshly created room, so a solo scene
	// becomes the shared starting point instead of vanishing.
	_seedRoom() {
		if (!this.net || this.net.status !== 'online') return;
		for (const p of this.placements) {
			if (p.netId) continue;
			const wireId = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);
			p.netId = wireId;
			p.ownerId = this.clientId;
			p.remote = false;
			this._netModels.set(wireId, p);
			this.net.spawn(this._placementWire(p, wireId));
		}
	}

	// seed=true is right for CREATE (I am the first one there). JOIN never seeds:
	// entering a room means entering ITS scene, so my solo models stay local and
	// cannot duplicate the server's authoritative copies on a rejoin.
	async _joinRoom(code, { seed = false } = {}) {
		const norm = normalizeRoomCode(code);
		if (!norm) {
			this._setStatus('That room code looks off: check the 6 characters and try again.', { warn: true });
			return;
		}
		this._leaveRoom({ silent: true });
		this._roomSynced = false;
		this.roomCode = norm;
		const net = new StudioNet({
			roomKey: roomKeyForCode(norm),
			clientId: this.clientId,
			name: '',
			url: this.config.rooms?.server || '',
		});
		this.net = net;
		this._wireNet(net);
		await net.connect();
		// A failed connect fires status 'failed' synchronously and the handler nulls
		// `this.net`, so re-check identity rather than dereferencing a dead field.
		if (this.net === net && net.status === 'online') {
			if (seed) this._seedRoom();
			this._roomHeartbeat = setInterval(() => this.net?.heartbeat(), 15000);
			try {
				const url = new URL(location.href);
				url.searchParams.set('room', norm);
				history.replaceState(null, '', url);
			} catch { /* history is unavailable in some embeds */ }
		}
		this._updateRoomButton();
	}

	_createRoom() {
		return this._joinRoom(generateRoomCode(), { seed: true });
	}

	_leaveRoom({ silent = false } = {}) {
		if (this._roomHeartbeat) {
			clearInterval(this._roomHeartbeat);
			this._roomHeartbeat = null;
		}
		if (this.net) {
			try { this.net.destroy(); } catch { /* already destroyed */ }
			this.net = null;
		}
		// Remote models leave with the room; my own stay as a local scene.
		for (const p of [...this.placements]) {
			if (p.remote && !this._isMine(p)) this._removePlacement(p, { persist: false, broadcast: false });
			else { p.netId = null; p.remote = false; }
		}
		this._netModels.clear();
		this.roomCode = '';
		this._presence = { count: 1, names: [] };
		this.ui.root.classList.remove('is-room');
		try {
			const url = new URL(location.href);
			url.searchParams.delete('room');
			history.replaceState(null, '', url);
		} catch { /* history unavailable */ }
		this._updateCount();
		this._updateRoomButton();
		if (!silent) this._setStatus('Left the shared room. Your models are still here.');
	}

	_updateRoomButton() {
		const btn = this.ui.roomBtn;
		if (!btn) return;
		const live = !!this.net && (this.net.status === 'online' || this.net.status === 'connecting');
		btn.classList.toggle('is-active', live);
		// Two labels rather than one rewritten string, so a host that translated the
		// idle label does not lose it the first time the room state changes.
		const idle = btn.querySelector('.ars-room-label');
		const code = btn.querySelector('.ars-room-code-label');
		if (idle) idle.hidden = live;
		if (code) {
			code.hidden = !live;
			code.textContent = live ? (this.roomCode || 'Room') : '';
		}
		if (!this.ui.roomModal.hidden) this._renderRoomModal();
	}

	_renderRoomModal() {
		const online = !!this.net && this.net.status === 'online';
		const { roomIdle, roomLive, roomCode, roomPresence, roomQr } = this.ui;
		if (roomIdle) roomIdle.hidden = online;
		if (roomLive) roomLive.hidden = !online;
		if (!online) return;
		if (roomCode) roomCode.textContent = this.roomCode;
		if (roomPresence) {
			roomPresence.textContent = this._presence.count > 1
				? `${this._presence.count} people are building here.`
				: 'You are the only one here yet: share the code to invite someone.';
		}
		if (roomQr) {
			const url = roomShareUrl(this.config.shareBaseUrl, this.roomCode);
			try {
				roomQr.innerHTML = renderQRToSVG(url, { scale: 5, margin: 2, dark: '#0b0b0b', light: '#ffffff' });
			} catch {
				roomQr.textContent = url;
			}
		}
	}

	_openRoomModal() {
		const m = this.ui.roomModal;
		if (!m) return;
		this._lastFocus = document.activeElement;
		m.hidden = false;
		this._renderRoomModal();
		(this.net?.status === 'online' ? this.ui.roomCopy : this.ui.roomCreate)?.focus?.();
	}

	_closeRoomModal() {
		const m = this.ui.roomModal;
		if (!m || m.hidden) return;
		const hadFocus = m.contains(document.activeElement);
		m.hidden = true;
		if (hadFocus) this._restoreFocus(this.ui.roomBtn);
	}

	async _createRoomFromUI() {
		await this._createRoom();
		this._renderRoomModal();
		// One-tap invite: put the join link on the clipboard immediately, still
		// inside this click's user activation, so hosting is create → paste.
		if (this.net?.status === 'online' && navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(roomShareUrl(this.config.shareBaseUrl, this.roomCode));
				this._setStatus(`Room ${this.roomCode} is live: invite link copied. Paste it to a friend.`);
			} catch { /* clipboard blocked: the Copy button is still there */ }
		}
	}

	async _joinRoomFromUI() {
		const input = this.ui.roomJoinInput;
		const code = normalizeRoomCode(input?.value);
		if (!code) {
			this._setStatus('That room code looks off: check the 6 characters.', { warn: true });
			input?.focus?.();
			return;
		}
		await this._joinRoom(code);
		this._renderRoomModal();
	}

	async _copyRoomInvite() {
		const url = roomShareUrl(this.config.shareBaseUrl, this.roomCode);
		const btn = this.ui.roomCopy;
		try {
			const how = await shareUrlOrCopy(url, {
				title: 'Build with me in AR',
				text: `Join my AR Studio room: ${this.roomCode}`,
			});
			if (btn) {
				const old = btn.textContent;
				btn.textContent = how === 'shared' ? 'Shared ✓' : 'Link copied ✓';
				setTimeout(() => { btn.textContent = old; }, 1600);
			}
		} catch (err) {
			if (err?.name !== 'AbortError') window.prompt('Copy this invite link:', url);
		}
	}

	// ── Render loop ───────────────────────────────────────────────────────────

	// Desktop preview has no gyro and no real room to look at, so a model dropped
	// on the floor lands below the eyeline and reads as "nothing happened". Tilt
	// the view down to actually frame what is in the scene: but only until the
	// viewer takes the camera themselves, after which their aim is the truth.
	_framePreview() {
		if (this.arActive || this.xrSession || this._userLooked || !this.placements.length) return;
		let sx = 0;
		let sz = 0;
		let sh = 0;
		for (const p of this.placements) {
			sx += p.group.position.x;
			sz += p.group.position.z;
			sh += (p.height || 0.4) * (p.group.userData._targetScale ?? 1);
		}
		const n = this.placements.length;
		const cx = sx / n;
		const cz = sz / n;
		const centre = (sh / n) * 0.5;
		const dist = Math.hypot(cx - this.camera.position.x, cz - this.camera.position.z);
		if (!(dist > 0.05)) return;
		this.cameraYaw = Math.atan2(cx - this.camera.position.x, -(cz - this.camera.position.z));
		this.cameraPitch = clampPitch(-Math.atan2(this.camera.position.y - centre, dist), PITCH_MIN, PITCH_MAX);
	}

	_applyCameraLook() {
		this.camera.rotation.set(0, 0, 0);
		this.camera.rotateY(this.cameraYaw);
		this.camera.rotateX(this.cameraPitch);
	}

	_tick(t) {
		this._rafId = requestAnimationFrame((next) => this._tick(next));
		const dt = this._prevT ? Math.min(0.1, (t - this._prevT) / 1000) : 0.016;
		this._prevT = t;

		for (const p of this.placements) {
			p.mixer?.update(dt);
			p.idle?.update(dt);
			if (p.spawnT < 1) {
				p.spawnT = Math.min(1, p.spawnT + dt * 3.2);
				const e = 1 - (1 - p.spawnT) ** 3; // ease-out cubic
				const target = p.group.userData._targetScale ?? 1;
				p.group.scale.setScalar(Math.max(0.001, target * e));
				p.shadow?.scale.setScalar(Math.max(0.001, target * e));
			}
		}
		if (this.selected) this._positionSelRing();
		this._applyCameraLook();
		this.renderer.render(this.scene, this.camera);
	}

	_startLoop() {
		if (this._rafId === null) {
			this._prevT = 0;
			this._rafId = requestAnimationFrame((t) => this._tick(t));
		}
	}

	_stopLoop() {
		if (this._rafId !== null) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
	}

	_resize() {
		const { width, height } = this._viewportSize();
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this._applyCameraFov();
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Add a model to the scene.
	 * @param {{src: string, title?: string, poster?: string}} model
	 * @param {object} [opts] `x` `z` `yaw` `scale` `announce` `persist`
	 * @returns {Promise<object|null>} the placement, or null when it could not load
	 */
	addModel(model, opts) {
		return this._addModel(model, opts);
	}

	/** Remove every model. Returns what was removed, so a host can offer its own undo. */
	clear() {
		const items = this.getScene();
		for (const p of [...this.placements]) this._removePlacement(p, { persist: false });
		this._saveScene();
		this._emit('clear', { items });
		return items;
	}

	/** The current arrangement as plain data: `[{ src, title, x, z, yaw, scale }]`. */
	getScene() {
		return this.placements.map((p) => ({
			src: p.src,
			title: p.title,
			x: p.group.position.x,
			z: p.group.position.z,
			yaw: p.yaw,
			scale: this._logicalScale(p),
		}));
	}

	/** Replace the scene with an arrangement in the shape `getScene()` returns. */
	async setScene(items) {
		this.clear();
		for (const it of Array.isArray(items) ? items : []) {
			await this._addModel({ src: it.src, title: it.title }, {
				x: it.x, z: it.z, yaw: it.yaw, scale: it.scale, announce: false, persist: false,
			});
		}
		this._saveScene();
	}

	/** A link that reopens this exact arrangement, models and transforms included. */
	shareUrl() {
		return studioSceneUrl(this.config.shareBaseUrl, this.getScene());
	}

	/** Generate a model from a prompt and drop it into the scene. */
	generate(prompt) {
		return this._startForge(prompt);
	}

	/** Hand one model to the device's own AR viewer (Quick Look / Scene Viewer). */
	viewInYourSpace(src, title = '') {
		const url = normalizeGlbUrl(src);
		if (!url) return '';
		const launch = buildArLaunchUrl(this.config.origin, url, title, { endpoint: this.config.arLaunchUrl });
		window.open(launch, '_blank', 'noopener');
		return launch;
	}

	/** Turn the camera passthrough on. Call it from a user gesture (iOS requires one). */
	startCamera() { return this._startCamera(); }

	/** Turn the camera passthrough off. */
	stopCamera() { this._stopCamera(); }

	/** Enter or leave the immersive WebXR session. */
	toggleImmersive() { return this._toggleXR(); }

	/**
	 * Take this device into AR by its best path: the immersive session where
	 * WebXR exists, otherwise the platform's own AR viewer.
	 */
	enterAR() { return this._enterAR(); }

	/**
	 * Open one model in the device's native AR viewer (Quick Look on iOS, Scene
	 * Viewer on Android). Defaults to the selected model.
	 * @param {object} [placement]
	 */
	placeInYourSpace(placement) { return this._placeNative(placement); }

	/**
	 * Open the AR hand-off sheet: the screen that prepares one model and then
	 * opens the device's own AR viewer from a single tap.
	 * @param {object} [placement] Defaults to the selected model, then the last one.
	 */
	openArSheet(placement) { this._openArSheet(placement); }

	/** Close the AR hand-off sheet. */
	closeArSheet() { this._closeArSheet(); }

	/** Open a shared room (a new one when `code` is omitted). Returns the code. */
	async openRoom(code) {
		if (code) await this._joinRoom(code);
		else await this._createRoom();
		return this.roomCode;
	}

	/** Leave the shared room, keeping your own models. */
	leaveRoom() { this._leaveRoom(); }

	/** Tear the studio down: camera, socket, listeners, GPU context, DOM. */
	destroy() {
		if (this._destroyed) return;
		this._destroyed = true;
		this._stopLoop();
		this._stopCamera();
		this.xrSession?.end();
		this.net?.destroy();
		if (this._roomHeartbeat) clearInterval(this._roomHeartbeat);
		clearTimeout(this._statusTimer);
		clearTimeout(this._arWarmTimer);
		// Only this studio's own conversions: a second studio on the page may be
		// sharing the cache and still needs its entries.
		for (const key of this._arKeys) releaseQuickLook(key);
		this._arKeys.clear();
		clearInterval(this._lightTimer);
		document.removeEventListener('keydown', this._onKeyDown);
		window.removeEventListener('deviceorientationabsolute', this._onOrientationAbsolute, true);
		window.removeEventListener('deviceorientation', this._onOrientation, true);
		window.removeEventListener('resize', this._onResize);
		window.removeEventListener('pagehide', this._onPageHide);
		if (this._onArReturn) {
			document.removeEventListener('visibilitychange', this._onArReturn);
			window.removeEventListener('focus', this._onArReturn);
			this._onArReturn = null;
		}
		this._ro?.disconnect();
		for (const p of [...this.placements]) this._removePlacement(p, { persist: false, broadcast: false });
		this.shadowTex?.dispose();
		this.selRing.geometry.dispose();
		this.selRing.material.dispose();
		this.renderer.dispose();
		this.ui.root.remove();
		this._listeners.clear();
	}
}

// ── Module-private helpers ───────────────────────────────────────────────────

function prefersReducedMotion() {
	try {
		return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

function makeShadowTexture() {
	try {
		const size = 128;
		const cnv = document.createElement('canvas');
		cnv.width = size;
		cnv.height = size;
		const ctx = cnv.getContext('2d');
		const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		g.addColorStop(0, 'rgba(0,0,0,0.40)');
		g.addColorStop(0.55, 'rgba(0,0,0,0.18)');
		g.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, size, size);
		return new CanvasTexture(cnv);
	} catch {
		return null;
	}
}

function makeLightProbe() {
	try {
		const cnv = document.createElement('canvas');
		cnv.width = 16;
		cnv.height = 16;
		return { cnv, ctx: cnv.getContext('2d', { willReadFrequently: true }) };
	} catch {
		return null;
	}
}

/** A stable per-browser id. It decides who owns which model in a shared room. */
function readClientId(scope) {
	const key = `${scope || 'ar-studio'}:client`;
	try {
		let id = localStorage.getItem(key);
		if (!id) {
			id = crypto?.randomUUID?.() || `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
			localStorage.setItem(key, id);
		}
		return id;
	} catch {
		return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	}
}

/** A readable label from a model URL: `alarm_clock_01.glb` → `Alarm clock 01`. */
function filenameLabel(url) {
	const base = String(url).split('?')[0].split('/').pop() || 'Model';
	const stem = base.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' ').trim();
	return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : 'Linked model';
}

/** The shape a placement takes when it leaves the studio in an event. */
function publicPlacement(p, studio) {
	return {
		id: p.id,
		src: p.src,
		title: p.title,
		x: p.group.position.x,
		z: p.group.position.z,
		yaw: p.yaw,
		scale: studio._logicalScale(p),
		mine: studio._isMine(p),
	};
}
