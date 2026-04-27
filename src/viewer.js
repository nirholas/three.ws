import {
	AxesHelper,
	Box3,
	Cache,
	Color,
	GridHelper,
	LoaderUtils,
	PMREMGenerator,
	PerspectiveCamera,
	PointsMaterial,
	Scene,
	SkeletonHelper,
	Vector3,
	WebGLRenderer,
	LinearToneMapping,
	ACESFilmicToneMapping,
} from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { GUI } from 'dat.gui';

import { environments } from './environments.js';
import { createModelInfo } from './model-info.js';
import { buildAnnotations, renderAnnotationCanvas } from './annotations.js';
import {
	DEFAULT_CAMERA,
	Preset,
	MANAGER,
	getDecoders,
	traverseMaterials,
} from './viewer/internal.js';
import { addLights, removeLights } from './viewer/lights.js';
import { getCubeMapTexture } from './viewer/environment.js';
import { takeScreenshot } from './viewer/screenshot.js';
import { setClips, playAllClips } from './viewer/animation.js';
import { AnimationManager } from './animation-manager.js';

Cache.enabled = true;

export class Viewer {
	constructor(el, options) {
		this.el = el;
		this.options = options;

		this.lights = [];
		this.content = null;
		this.mixer = null;
		this.clips = [];
		this.gui = null;

		// External animation system (Mixamo-style)
		this.animationManager = new AnimationManager();
		this._animPanelEl = null;

		this.state = {
			environment:
				options.preset === Preset.ASSET_GENERATOR
					? environments.find((e) => e.id === 'footprint-court').name
					: environments[1].name,
			background: false,
			playbackSpeed: 1.0,
			actionStates: {},
			camera: DEFAULT_CAMERA,
			wireframe: false,
			skeleton: false,
			grid: false,
			autoRotate: false,

			// Lights
			punctualLights: true,
			exposure: 0.0,
			toneMapping: LinearToneMapping,
			ambientIntensity: 0.3,
			ambientColor: '#FFFFFF',
			directIntensity: 0.8 * Math.PI, // TODO(#116)
			directColor: '#FFFFFF',
			bgColor: '#000000',
			transparentBg: false,

			pointSize: 1.0,

			// Info overlay
			showInfo: true,
			showLabels: false,

			// Avatar follow mode
			followMode: 'mouse',
		};

		this.prevTime = 0;

		this.stats = new Stats();
		this.stats.dom.height = '48px';
		[].forEach.call(this.stats.dom.children, (child) => (child.style.display = ''));

		this.backgroundColor = new Color(this.state.bgColor);

		this.scene = new Scene();
		this.scene.background = this.backgroundColor;

		const fov = options.preset === Preset.ASSET_GENERATOR ? (0.8 * 180) / Math.PI : 60;
		const aspect = el.clientWidth / el.clientHeight;
		this.defaultCamera = new PerspectiveCamera(fov, aspect, 0.01, 1000);
		this.activeCamera = this.defaultCamera;
		this.scene.add(this.defaultCamera);

		this.renderer = window.renderer = new WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setClearColor(0x000000, 1);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(el.clientWidth, el.clientHeight);

		this.pmremGenerator = new PMREMGenerator(this.renderer);
		this.pmremGenerator.compileEquirectangularShader();

		this.neutralEnvironment = this.pmremGenerator.fromScene(new RoomEnvironment()).texture;

		this.controls = new OrbitControls(this.defaultCamera, this.renderer.domElement);
		this.controls.screenSpacePanning = true;
		this._onControlsChange = () => this.invalidate();
		this.controls.addEventListener('change', this._onControlsChange);

		this.el.appendChild(this.renderer.domElement);

		this.cameraCtrl = null;
		this.cameraFolder = null;
		this.animFolder = null;
		this.animCtrls = [];
		this.morphFolder = null;
		this.morphCtrls = [];
		this.skeletonHelpers = [];
		this.gridHelper = null;
		this.axesHelper = null;
		this.modelInfo = null;
		this.annotationEls = [];
		this._tempVec = new Vector3();

		this.addAxesHelper();
		this.addGUI();
		if (options.kiosk) this.gui.close();

		this.animate = this.animate.bind(this);
		this._rafId = null;
		this._visible = true;
		this._tabVisible = !document.hidden;
		this._disposed = false;
		this._loadedEnvironment = null;
		this._guiWrap = null;
		this._needsRender = true;
		this._animating = false;

		this._onVisibilityChange = () => {
			const wasHidden = !this._tabVisible;
			this._tabVisible = !document.hidden;
			if (wasHidden && this._tabVisible) this._needsRender = true;
			this._updateRenderLoop();
		};
		document.addEventListener('visibilitychange', this._onVisibilityChange);

		if (typeof IntersectionObserver !== 'undefined') {
			this._intersectionObserver = new IntersectionObserver(
				(entries) => {
					const wasHidden = !this._visible;
					this._visible = entries[entries.length - 1].isIntersecting;
					if (wasHidden && this._visible) this._needsRender = true;
					this._updateRenderLoop();
				},
				{ threshold: 0 },
			);
			this._intersectionObserver.observe(this.el);
		}

		this._onResize = this.resize.bind(this);
		this._onKeyDown = (e) => {
			if (this.isInputFocused()) return;
			if (e.key === 'p' || e.key === 'P') {
				this.takeScreenshot();
			} else if (e.code === 'Space') {
				e.preventDefault();
				this.toggleAnimationPlayback();
			} else if (e.key === 'f' || e.key === 'F') {
				this.frameContent();
			}
		};

		this._onDblClick = () => this.frameContent({ animate: true });

		this._updateRenderLoop();
		window.addEventListener('resize', this._onResize, false);
		window.addEventListener('keydown', this._onKeyDown);
		this.renderer.domElement.addEventListener('dblclick', this._onDblClick);
	}

	invalidate() {
		if (this._disposed) return;
		this._needsRender = true;
		this._updateRenderLoop();
	}

	// Per-agent scene preferences (background, environment, exposure, etc.)
	// persisted to localStorage. Call attachScenePrefs(agentId) once per
	// session — it restores the saved values into state and starts auto-saving
	// future tweaks.
	attachScenePrefs(agentId) {
		if (!agentId || typeof window === 'undefined') return;
		this._prefsKey = `3dagent:scene:${agentId}`;

		try {
			const raw = localStorage.getItem(this._prefsKey);
			if (raw) {
				const saved = JSON.parse(raw);
				const KEYS = [
					'background',
					'transparentBg',
					'bgColor',
					'autoRotate',
					'exposure',
					'environment',
				];
				let touched = false;
				for (const key of KEYS) {
					if (saved[key] !== undefined && saved[key] !== this.state[key]) {
						this.state[key] = saved[key];
						touched = true;
					}
				}
				if (touched) {
					this.backgroundColor.set(this.state.bgColor);
					this.updateLights();
					this.updateEnvironment();
					this.updateDisplay();
					this.updateBackground();
					this.updateGUI?.();
				}
			}
		} catch {
			/* ignore corrupt prefs */
		}

		const save = () => {
			if (!this._prefsKey) return;
			try {
				const snapshot = {
					background: this.state.background,
					transparentBg: this.state.transparentBg,
					bgColor: this.state.bgColor,
					autoRotate: this.state.autoRotate,
					exposure: this.state.exposure,
					environment: this.state.environment,
				};
				localStorage.setItem(this._prefsKey, JSON.stringify(snapshot));
			} catch {
				/* quota or disabled storage */
			}
		};
		// Debounce to avoid hammering localStorage while users drag a slider.
		let timer = null;
		this._scenePrefsSave = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(save, 250);
		};
	}

	// Public hook — controllers (dat.gui, drawer UI) call this after a state
	// change so we persist the latest value.
	notifyScenePrefChange() {
		if (this._scenePrefsSave) this._scenePrefsSave();
	}

	// Spacebar handler: pause/resume the active animation, or play the first
	// available one if nothing is currently selected.
	toggleAnimationPlayback() {
		const a = this.animationManager;
		if (!a) return;
		if (a.currentAction) {
			a.currentAction.paused = !a.currentAction.paused;
			this.invalidate();
			this._recomputeAnimating();
			this._updateRenderLoop();
			return;
		}
		const defs = a.getAnimationDefs?.() || [];
		const first = defs.find((d) => a.isLoaded?.(d.name));
		if (first) {
			a.play(first.name);
			this.invalidate();
			this._recomputeAnimating();
			this._updateRenderLoop();
		}
	}

	// Frame the loaded model with a flattering 3/4 angle. Optionally animates
	// the camera over a short duration ("F" key snaps; double-click animates).
	frameContent({ animate = false, durationMs = 600 } = {}) {
		if (!this.content || !this.defaultCamera || !this.controls) return;
		const box = new Box3().setFromObject(this.content);
		const size = box.getSize(new Vector3()).length();
		if (!isFinite(size) || size === 0) return;
		const center = box.getCenter(new Vector3());

		const target = center.clone();
		const pos = center.clone();
		pos.x += size / 2.0;
		pos.y += size / 5.0;
		pos.z += size / 2.0;

		if (animate) {
			this._tweenCamera(pos, target, durationMs);
		} else {
			this.defaultCamera.position.copy(pos);
			this.controls.target.copy(target);
			this.controls.update();
			this.invalidate();
		}
	}

	// Smooth ease-out camera tween. Both position and OrbitControls.target
	// are interpolated together so the framing stays correct mid-flight.
	_tweenCamera(toPos, toTarget, durationMs = 600) {
		if (this._cameraTweenRaf) cancelAnimationFrame(this._cameraTweenRaf);
		const fromPos = this.defaultCamera.position.clone();
		const fromTarget = this.controls.target.clone();
		const start = performance.now();
		const ease = (t) => 1 - Math.pow(1 - t, 3); // cubic ease-out
		const step = (now) => {
			const t = Math.min(1, (now - start) / durationMs);
			const k = ease(t);
			this.defaultCamera.position.lerpVectors(fromPos, toPos, k);
			this.controls.target.lerpVectors(fromTarget, toTarget, k);
			this.controls.update();
			this.invalidate();
			if (t < 1 && !this._disposed) {
				this._cameraTweenRaf = requestAnimationFrame(step);
			} else {
				this._cameraTweenRaf = null;
			}
		};
		this._cameraTweenRaf = requestAnimationFrame(step);
	}

	_recomputeAnimating() {
		let animating = false;
		if (this.state && this.state.autoRotate) animating = true;
		if (!animating && this.mixer && this.state) {
			for (const key in this.state.actionStates) {
				if (this.state.actionStates[key]) {
					animating = true;
					break;
				}
			}
		}
		// External animation manager also drives the render loop
		if (!animating && this.animationManager.currentAction) {
			animating = true;
		}
		this._animating = animating;
	}

	_updateRenderLoop() {
		if (this._disposed) return;
		const canRun = this._visible && this._tabVisible;
		const shouldRun = canRun && (this._needsRender || this._animating);
		if (shouldRun && this._rafId === null) {
			this.prevTime = performance.now();
			this._rafId = requestAnimationFrame(this.animate);
		} else if (!canRun && this._rafId !== null) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
	}

	animate(time) {
		const dt = (time - this.prevTime) / 1000;
		this.prevTime = time;

		this._recomputeAnimating();

		this.controls.update();
		this.stats.update();
		if (this.mixer) this.mixer.update(dt);
		this.animationManager.update(dt);

		// Extension point for the AgentAvatar empathy tick and any other per-frame hooks
		if (this._afterAnimateHooks) {
			for (let i = 0; i < this._afterAnimateHooks.length; i++) {
				this._afterAnimateHooks[i](dt);
			}
		}

		this.render();
		this._needsRender = false;

		if (this._animating && this._visible && this._tabVisible && !this._disposed) {
			this._rafId = requestAnimationFrame(this.animate);
		} else {
			this._rafId = null;
		}
	}

	isInputFocused() {
		const el = document.activeElement;
		return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
	}

	render() {
		this.renderer.render(this.scene, this.activeCamera);
		if (this.state.grid) {
			this.axesCamera.position.copy(this.defaultCamera.position);
			this.axesCamera.lookAt(this.axesScene.position);
			this.axesRenderer.render(this.axesScene, this.axesCamera);
		}
		this.projectAnnotations();
	}

	takeScreenshot() {
		takeScreenshot(this);
	}

	resize() {
		const { clientHeight, clientWidth } = this.el;

		this.defaultCamera.aspect = clientWidth / clientHeight;
		this.defaultCamera.updateProjectionMatrix();
		this.renderer.setSize(clientWidth, clientHeight);

		this.axesCamera.aspect = this.axesDiv.clientWidth / this.axesDiv.clientHeight;
		this.axesCamera.updateProjectionMatrix();
		this.axesRenderer.setSize(this.axesDiv.clientWidth, this.axesDiv.clientHeight);

		this.invalidate();
	}

	load(url, rootPath, assetMap) {
		const baseURL = LoaderUtils.extractUrlBase(url);

		// Load.
		return new Promise((resolve, reject) => {
			// Intercept and override relative URLs.
			MANAGER.setURLModifier((url, path) => {
				// URIs in a glTF file may be escaped, or not. Assume that assetMap is
				// from an un-escaped source, and decode all URIs before lookups.
				// See: https://github.com/nirholas/3d-agent/issues/146
				const normalizedURL =
					rootPath +
					decodeURI(url)
						.replace(baseURL, '')
						.replace(/^(\.?\/)/, '');

				if (assetMap.has(normalizedURL)) {
					const blob = assetMap.get(normalizedURL);
					const blobURL = URL.createObjectURL(blob);
					blobURLs.push(blobURL);
					return blobURL;
				}

				return (path || '') + url;
			});

			const blobURLs = [];

			getDecoders().then(({ dracoLoader, ktx2Loader, meshoptDecoder }) => {
				const loader = new GLTFLoader(MANAGER)
					.setCrossOrigin('anonymous')
					.setDRACOLoader(dracoLoader)
					.setKTX2Loader(ktx2Loader.detectSupport(this.renderer))
					.setMeshoptDecoder(meshoptDecoder);

				loader.load(
					url,
					(gltf) => {
						window.VIEWER.json = gltf;

						const scene = gltf.scene || gltf.scenes[0];
						const clips = gltf.animations || [];

						if (!scene) {
							// Valid, but not supported by this viewer.
							throw new Error(
								'This model contains no scene, and cannot be viewed here. However,' +
									' it may contain individual 3D resources.',
							);
						}

						this.setContent(scene, clips);

						blobURLs.forEach(URL.revokeObjectURL);

						// See: https://github.com/google/draco/issues/349
						// DRACOLoader.releaseDecoderModule();

						resolve(gltf);
					},
					undefined,
					reject,
				);
			}, reject);
		});
	}

	/**
	 * @param {THREE.Object3D} object
	 * @param {Array<THREE.AnimationClip} clips
	 */
	setContent(object, clips) {
		this.clear();

		object.updateMatrixWorld(); // nirholas/3d-agent#330

		const box = new Box3().setFromObject(object);
		const size = box.getSize(new Vector3()).length();
		const center = box.getCenter(new Vector3());

		this.controls.reset();

		object.position.x -= center.x;
		object.position.y -= center.y;
		object.position.z -= center.z;

		this.controls.maxDistance = size * 10;

		this.defaultCamera.near = size / 100;
		this.defaultCamera.far = size * 100;
		this.defaultCamera.updateProjectionMatrix();

		// Final framed camera (the position the user should end up at).
		const framedPos = new Vector3();
		if (this.options.cameraPosition) {
			framedPos.fromArray(this.options.cameraPosition);
		} else {
			framedPos.copy(center);
			framedPos.x += size / 2.0;
			framedPos.y += size / 5.0;
			framedPos.z += size / 2.0;
		}

		// In kiosk / embed modes (and on subsequent loads), snap straight to
		// the framed position. On the first interactive load we tween in from
		// a slightly wider angle so the reveal feels intentional.
		const skipReveal =
			this.options.kiosk ||
			this.options.cameraPosition ||
			this._hasRevealed === true;

		if (skipReveal) {
			this.defaultCamera.position.copy(framedPos);
			this.defaultCamera.lookAt(this.options.cameraPosition ? new Vector3() : center);
		} else {
			// Start ~40% wider and slightly higher, then ease into the framed pose.
			const startPos = new Vector3()
				.subVectors(framedPos, center)
				.multiplyScalar(1.4)
				.add(center);
			startPos.y += size / 8;
			this.defaultCamera.position.copy(startPos);
			this.defaultCamera.lookAt(center);
			this._pendingReveal = { framedPos: framedPos.clone(), target: center.clone() };
			this._hasRevealed = true;
		}

		this.setCamera(DEFAULT_CAMERA);

		this.axesCamera.position.copy(this.defaultCamera.position);
		this.axesCamera.lookAt(this.axesScene.position);
		this.axesCamera.near = size / 100;
		this.axesCamera.far = size * 100;
		this.axesCamera.updateProjectionMatrix();
		this.axesCorner.scale.set(size, size, size);

		this.controls.saveState();

		this.scene.add(object);
		this.content = object;

		this.state.punctualLights = true;

		this.content.traverse((node) => {
			if (node.isLight) {
				this.state.punctualLights = false;
			}
		});

		this.setClips(clips);

		// Attach external animation manager to the new content
		this.animationManager.attach(this.content);
		this._setupAnimationPanel();

		this.updateLights();
		this.updateGUI();
		this.updateEnvironment();
		this.updateDisplay();
		this.updateModelInfo(object, clips);
		this.updateAnnotations();

		window.VIEWER.scene = this.content;

		this.invalidate();

		// Smooth first-load camera reveal — runs after the scene is fully wired
		// so OrbitControls and damping pick it up cleanly.
		if (this._pendingReveal) {
			const { framedPos, target } = this._pendingReveal;
			this._pendingReveal = null;
			this._tweenCamera(framedPos, target, 1500);
		}
	}

	setClips(clips) {
		setClips(this, clips);
	}

	playAllClips() {
		playAllClips(this);
	}

	/**
	 * @param {string} name
	 */
	setCamera(name) {
		if (name === DEFAULT_CAMERA) {
			this.controls.enabled = true;
			this.activeCamera = this.defaultCamera;
		} else {
			this.controls.enabled = false;
			this.content.traverse((node) => {
				if (node.isCamera && node.name === name) {
					this.activeCamera = node;
				}
			});
		}
		this.invalidate();
	}

	updateLights() {
		const state = this.state;
		const lights = this.lights;

		if (state.punctualLights && !lights.length) {
			addLights(this);
		} else if (!state.punctualLights && lights.length) {
			removeLights(this);
		}

		this.renderer.toneMapping = Number(state.toneMapping);
		this.renderer.toneMappingExposure = Math.pow(2, state.exposure);

		if (lights.length === 2) {
			lights[0].intensity = state.ambientIntensity;
			lights[0].color.set(state.ambientColor);
			lights[1].intensity = state.directIntensity;
			lights[1].color.set(state.directColor);
		}

		this.invalidate();
	}

	updateEnvironment() {
		const environment = environments.filter(
			(entry) => entry.name === this.state.environment,
		)[0];

		getCubeMapTexture(this, environment).then(({ envMap }) => {
			if (this._disposed || !this.scene) return;
			this.scene.environment = envMap;
			this.scene.background = this.state.transparentBg
				? null
				: this.state.background
					? envMap
					: this.backgroundColor;
			this.invalidate();
		});
	}

	updateDisplay() {
		if (this.skeletonHelpers.length) {
			this.skeletonHelpers.forEach((helper) => this.scene.remove(helper));
		}

		traverseMaterials(this.content, (material) => {
			material.wireframe = this.state.wireframe;

			if (material instanceof PointsMaterial) {
				material.size = this.state.pointSize;
			}
		});

		this.content.traverse((node) => {
			if (node.geometry && node.skeleton && this.state.skeleton) {
				const helper = new SkeletonHelper(node.skeleton.bones[0].parent);
				helper.material.linewidth = 3;
				this.scene.add(helper);
				this.skeletonHelpers.push(helper);
			}
		});

		if (this.state.grid !== Boolean(this.gridHelper)) {
			if (this.state.grid) {
				this.gridHelper = new GridHelper();
				this.axesHelper = new AxesHelper();
				this.axesHelper.renderOrder = 999;
				this.axesHelper.onBeforeRender = (renderer) => renderer.clearDepth();
				this.scene.add(this.gridHelper);
				this.scene.add(this.axesHelper);
			} else {
				this.scene.remove(this.gridHelper);
				this.scene.remove(this.axesHelper);
				this.gridHelper = null;
				this.axesHelper = null;
				this.axesRenderer.clear();
			}
		}

		this.controls.autoRotate = this.state.autoRotate;

		this.invalidate();
	}

	updateBackground() {
		this.backgroundColor.set(this.state.bgColor);
		if (this.state.transparentBg) {
			this.scene.background = null;
			this.renderer.setClearColor(0x000000, 0);
		} else {
			this.scene.background = this.backgroundColor;
			this.renderer.setClearColor(0x000000, 1);
			this.updateEnvironment();
		}
		this.invalidate();
	}

	/**
	 * Public setter for the scene background color. Used by the widget runtime
	 * + Studio postMessage bridge to apply brand config without touching dat.gui.
	 * @param {string|number} color  CSS color string or hex int.
	 */
	setBackgroundColor(color) {
		this.state.bgColor =
			typeof color === 'string' ? color : '#' + color.toString(16).padStart(6, '0');
		this.state.transparentBg = false;
		this.updateBackground();
	}

	/**
	 * Adds AxesHelper.
	 *
	 * See: https://stackoverflow.com/q/16226693/1314762
	 */
	updateModelInfo(object, clips) {
		if (this.modelInfo) {
			this.modelInfo.remove();
			this.modelInfo = null;
		}
		if (this.state.showInfo && object) {
			this.modelInfo = createModelInfo(this.el, object, clips);
		}
	}

	updateAnnotations() {
		// Clear existing
		this.annotationEls.forEach((a) => a.el.remove());
		this.annotationEls = [];

		if (!this.state.showLabels || !this.content) return;

		const annotations = buildAnnotations(this.content);

		annotations.forEach((ann) => {
			const canvas = renderAnnotationCanvas(ann);
			const el = document.createElement('div');
			el.classList.add('annotation-label');
			el.appendChild(canvas);
			this.el.appendChild(el);
			this.annotationEls.push({ el, position: ann.position });
		});

		this.invalidate();
	}

	projectAnnotations() {
		if (this.annotationEls.length === 0) return;

		const width = this.el.clientWidth;
		const height = this.el.clientHeight;
		const halfW = width / 2;
		const halfH = height / 2;
		const tempVec = this._tempVec;

		this.annotationEls.forEach(({ el, position }) => {
			tempVec.copy(position);
			tempVec.project(this.activeCamera);

			// Behind camera check
			if (tempVec.z > 1) {
				el.style.display = 'none';
				return;
			}

			const x = tempVec.x * halfW + halfW;
			const y = -(tempVec.y * halfH) + halfH;

			el.style.display = '';
			el.style.left = x + 'px';
			el.style.top = y + 'px';
		});
	}

	addAxesHelper() {
		this.axesDiv = document.createElement('div');
		this.el.appendChild(this.axesDiv);
		this.axesDiv.classList.add('axes');

		const { clientWidth, clientHeight } = this.axesDiv;

		this.axesScene = new Scene();
		this.axesCamera = new PerspectiveCamera(50, clientWidth / clientHeight, 0.1, 10);
		this.axesScene.add(this.axesCamera);

		this.axesRenderer = new WebGLRenderer({ alpha: true });
		this.axesRenderer.setPixelRatio(window.devicePixelRatio);
		this.axesRenderer.setSize(this.axesDiv.clientWidth, this.axesDiv.clientHeight);

		this.axesCamera.up = this.defaultCamera.up;

		this.axesCorner = new AxesHelper(5);
		this.axesScene.add(this.axesCorner);
		this.axesDiv.appendChild(this.axesRenderer.domElement);
	}

	addGUI() {
		const isMobile = window.innerWidth <= 700;
		const gui = (this.gui = new GUI({
			autoPlace: false,
			width: isMobile ? 220 : 260,
			hideable: true,
		}));

		// Display controls.
		const dispFolder = gui.addFolder('Display');
		const envBackgroundCtrl = dispFolder.add(this.state, 'background');
		envBackgroundCtrl.onChange(() => {
			this.updateEnvironment();
			this.notifyScenePrefChange();
		});
		const autoRotateCtrl = dispFolder.add(this.state, 'autoRotate');
		autoRotateCtrl.onChange(() => {
			this.updateDisplay();
			this.notifyScenePrefChange();
		});
		const wireframeCtrl = dispFolder.add(this.state, 'wireframe');
		wireframeCtrl.onChange(() => this.updateDisplay());
		const skeletonCtrl = dispFolder.add(this.state, 'skeleton');
		skeletonCtrl.onChange(() => this.updateDisplay());
		const gridCtrl = dispFolder.add(this.state, 'grid');
		gridCtrl.onChange(() => this.updateDisplay());
		dispFolder.add(this.controls, 'screenSpacePanning');
		const pointSizeCtrl = dispFolder.add(this.state, 'pointSize', 1, 16);
		pointSizeCtrl.onChange(() => this.updateDisplay());
		const transparentCtrl = dispFolder.add(this.state, 'transparentBg').name('transparent bg');
		transparentCtrl.onChange(() => {
			this.updateBackground();
			this.notifyScenePrefChange();
		});
		const bgColorCtrl = dispFolder.addColor(this.state, 'bgColor');
		bgColorCtrl.onChange(() => {
			this.updateBackground();
			this.notifyScenePrefChange();
		});
		dispFolder
			.add({ screenshot: () => this.takeScreenshot() }, 'screenshot')
			.name('Screenshot [P]');
		const infoCtrl = dispFolder.add(this.state, 'showInfo').name('model info');
		infoCtrl.onChange(() => this.updateModelInfo(this.content, this.clips));
		const labelsCtrl = dispFolder.add(this.state, 'showLabels').name('mesh labels');
		labelsCtrl.onChange(() => this.updateAnnotations());

		// Lighting controls.
		const lightFolder = gui.addFolder('Lighting');
		const envMapCtrl = lightFolder.add(
			this.state,
			'environment',
			environments.map((env) => env.name),
		);
		envMapCtrl.onChange(() => {
			this.updateEnvironment();
			this.notifyScenePrefChange();
		});
		const exposureCtrl = lightFolder.add(this.state, 'exposure', -10, 10, 0.01);
		exposureCtrl.onChange(() => {
			this.updateLights();
			this.notifyScenePrefChange();
		});
		[
			lightFolder.add(this.state, 'toneMapping', {
				Linear: LinearToneMapping,
				'ACES Filmic': ACESFilmicToneMapping,
			}),
			lightFolder.add(this.state, 'punctualLights').listen(),
			lightFolder.add(this.state, 'ambientIntensity', 0, 2),
			lightFolder.addColor(this.state, 'ambientColor'),
			lightFolder.add(this.state, 'directIntensity', 0, 4), // TODO(#116)
			lightFolder.addColor(this.state, 'directColor'),
		].forEach((ctrl) => ctrl.onChange(() => this.updateLights()));

		// Animation controls.
		this.animFolder = gui.addFolder('Animation');
		this.animFolder.domElement.style.display = 'none';
		const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1);
		playbackSpeedCtrl.onChange((speed) => {
			if (this.mixer) this.mixer.timeScale = speed;
		});
		this.animFolder.add({ playAll: () => this.playAllClips() }, 'playAll');

		// Morph target controls.
		this.morphFolder = gui.addFolder('Morph Targets');
		this.morphFolder.domElement.style.display = 'none';

		// Camera controls.
		this.cameraFolder = gui.addFolder('Cameras');
		this.cameraFolder.domElement.style.display = 'none';

		// Agent controls.
		const agentFolder = gui.addFolder('Agent');
		agentFolder
			.add(this.state, 'followMode', {
				None: 'none',
				'Follow Mouse': 'mouse',
				'Follow Keystrokes': 'keystrokes',
			})
			.name('follow mode');

		// Stats.
		const perfFolder = gui.addFolder('Performance');
		const perfLi = document.createElement('li');
		this.stats.dom.style.position = 'static';
		perfLi.appendChild(this.stats.dom);
		perfLi.classList.add('gui-stats');
		perfFolder.__ul.appendChild(perfLi);

		const guiWrap = document.createElement('div');
		this.el.appendChild(guiWrap);
		guiWrap.classList.add('gui-wrap');
		guiWrap.classList.add('gui-wrap--hidden');
		guiWrap.appendChild(gui.domElement);
		this._guiWrap = guiWrap;

		// Toggle button — hides dat.GUI behind an "Advanced" control
		const toggle = document.createElement('button');
		toggle.className = 'gui-toggle';
		toggle.setAttribute('title', 'Toggle advanced controls');
		toggle.setAttribute('aria-label', 'Toggle advanced controls');
		toggle.innerHTML =
			'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
			'<circle cx="12" cy="12" r="3"></circle>' +
			'<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>' +
			'</svg>' +
			'<span class="gui-toggle__label">Controls</span>';
		toggle.addEventListener('click', () => {
			const shown = guiWrap.classList.toggle('gui-wrap--hidden');
			toggle.classList.toggle('gui-toggle--active', !shown);
		});
		this.el.appendChild(toggle);
		this._guiToggle = toggle;

		if (isMobile) {
			gui.close();
		} else {
			gui.open();
		}
	}

	updateGUI() {
		this.cameraFolder.domElement.style.display = 'none';

		this.morphCtrls.forEach((ctrl) => ctrl.remove());
		this.morphCtrls.length = 0;
		this.morphFolder.domElement.style.display = 'none';

		this.animCtrls.forEach((ctrl) => ctrl.remove());
		this.animCtrls.length = 0;
		this.animFolder.domElement.style.display = 'none';

		const cameraNames = [];
		const morphMeshes = [];
		this.content.traverse((node) => {
			if (node.geometry && node.morphTargetInfluences) {
				morphMeshes.push(node);
			}
			if (node.isCamera) {
				node.name = node.name || `VIEWER__camera_${cameraNames.length + 1}`;
				cameraNames.push(node.name);
			}
		});

		if (cameraNames.length) {
			this.cameraFolder.domElement.style.display = '';
			if (this.cameraCtrl) this.cameraCtrl.remove();
			const cameraOptions = [DEFAULT_CAMERA].concat(cameraNames);
			this.cameraCtrl = this.cameraFolder.add(this.state, 'camera', cameraOptions);
			this.cameraCtrl.onChange((name) => this.setCamera(name));
		}

		if (morphMeshes.length) {
			this.morphFolder.domElement.style.display = '';
			morphMeshes.forEach((mesh) => {
				if (mesh.morphTargetInfluences.length) {
					const nameCtrl = this.morphFolder.add(
						{ name: mesh.name || 'Untitled' },
						'name',
					);
					this.morphCtrls.push(nameCtrl);
				}
				for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
					const ctrl = this.morphFolder
						.add(mesh.morphTargetInfluences, i, 0, 1, 0.01)
						.listen();
					Object.keys(mesh.morphTargetDictionary).forEach((key) => {
						if (key && mesh.morphTargetDictionary[key] === i) ctrl.name(key);
					});
					this.morphCtrls.push(ctrl);
				}
			});
		}

		if (this.clips.length) {
			this.animFolder.domElement.style.display = '';
			const actionStates = (this.state.actionStates = {});
			this.clips.forEach((clip, clipIndex) => {
				clip.name = `${clipIndex + 1}. ${clip.name}`;

				// Autoplay the first clip.
				let action;
				if (clipIndex === 0) {
					actionStates[clip.name] = true;
					action = this.mixer.clipAction(clip);
					action.play();
				} else {
					actionStates[clip.name] = false;
				}

				// Play other clips when enabled.
				const ctrl = this.animFolder.add(actionStates, clip.name).listen();
				ctrl.onChange((playAnimation) => {
					action = action || this.mixer.clipAction(clip);
					action.setEffectiveTimeScale(1);
					playAnimation ? action.play() : action.stop();
					this.invalidate();
				});
				this.animCtrls.push(ctrl);
			});
		}
	}

	// ── External Animation Panel (Mixamo-style) ─────────────────────────────

	/**
	 * Register a list of external animation definitions (name + URL).
	 * @param {Array<{name: string, url: string, label?: string, icon?: string, loop?: boolean}>} defs
	 */
	setAnimationDefs(defs) {
		this.animationManager.setAnimationDefs(defs);
		if (this.content) this._setupAnimationPanel();
	}

	/**
	 * Create / rebuild the animation selector panel.
	 * @private
	 */
	_setupAnimationPanel() {
		// Remove existing panel
		if (this._animPanelEl) {
			this._animPanelEl.remove();
			this._animPanelEl = null;
		}

		const defs = this.animationManager.getAnimationDefs();
		if (defs.length === 0) return;

		// Check model has a skeleton (no point showing anim panel for static meshes)
		let hasSkeleton = false;
		this.content.traverse((node) => {
			if (node.isSkinnedMesh) hasSkeleton = true;
		});
		if (!hasSkeleton) return;

		// Create panel container
		const panel = document.createElement('div');
		panel.className = 'anim-panel';
		panel.innerHTML =
			'<div class="anim-panel__header">' +
			'<span class="anim-panel__title">Animations</span>' +
			'<button class="anim-panel__stop" title="Stop all">⏹</button>' +
			'</div>' +
			'<div class="anim-panel__grid"></div>';
		this.el.appendChild(panel);
		this._animPanelEl = panel;

		// Render buttons
		this._renderAnimButtons();

		// Load all animations in background. We deliberately do NOT auto-play
		// the first animation: external Mixamo-rigged FBX clips often retarget
		// imperfectly onto Ready Player Me / Avaturn avatars, which collapses
		// the rig and makes the model look "disappeared" on first load. Show
		// the authored pose instead and let the user pick an animation when
		// they want one.
		this.animationManager.loadAll().then(() => {
			this._renderAnimButtons();
		});

		// Stop button
		panel.querySelector('.anim-panel__stop').addEventListener('click', () => {
			this.animationManager.stopAll();
			this._renderAnimButtons();
			this.invalidate();
		});

		// Listen for changes from AnimationManager
		this.animationManager.onChange = () => {
			this._renderAnimButtons();
		};
	}

	/**
	 * Render / re-render animation buttons in the panel.
	 * @private
	 */
	_renderAnimButtons() {
		if (!this._animPanelEl) return;

		const grid = this._animPanelEl.querySelector('.anim-panel__grid');
		const defs = this.animationManager.getAnimationDefs();
		const activeName = this.animationManager.currentName;

		const ICONS = {
			idle: '🧍',
			breathing: '🧍',
			standing: '🧍',
			walking: '🚶',
			walk: '🚶',
			running: '🏃',
			run: '🏃',
			waving: '👋',
			wave: '👋',
			dancing: '💃',
			dance: '💃',
			sitting: '🪑',
			sit: '🪑',
			jumping: '🦘',
			jump: '🦘',
			talking: '🗣️',
			talk: '🗣️',
			clapping: '👏',
			clap: '👏',
			punching: '👊',
			punch: '👊',
			kicking: '🦵',
			kick: '🦵',
		};

		grid.innerHTML = defs
			.map((def, i) => {
				const loaded = this.animationManager.isLoaded(def.name);
				const isActive = activeName === def.name;
				const icon = def.icon || ICONS[def.name.toLowerCase()] || '▶';
				const label = def.label || def.name.charAt(0).toUpperCase() + def.name.slice(1);
				const keyHint = i < 9 ? i + 1 : '';
				return (
					'<button class="anim-btn' +
					(isActive ? ' anim-btn--active' : '') +
					(loaded ? '' : ' anim-btn--loading') +
					'" data-anim="' +
					def.name +
					'"' +
					' title="' +
					label +
					(keyHint ? ' — press ' + keyHint : '') +
					'"' +
					(loaded ? '' : ' disabled') +
					'>' +
					(keyHint ? '<span class="anim-btn__key">' + keyHint + '</span>' : '') +
					'<span class="anim-btn__icon">' +
					icon +
					'</span>' +
					'<span class="anim-btn__label">' +
					label +
					'</span>' +
					'</button>'
				);
			})
			.join('');

		// Bind click events
		grid.querySelectorAll('.anim-btn:not([disabled])').forEach((btn) => {
			btn.addEventListener('click', () => {
				const name = btn.dataset.anim;
				this.animationManager.crossfadeTo(name);
				this.invalidate();
				this._recomputeAnimating();
				this._updateRenderLoop();
			});
		});

		// Bind keyboard shortcuts (1-9) — only once. Stored on `this` so
		// dispose() can remove it; otherwise viewer recreations stack handlers.
		if (!this._onAnimHotkey) {
			this._onAnimHotkey = (e) => {
				if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
				if (e.metaKey || e.ctrlKey || e.altKey) return;
				const n = parseInt(e.key, 10);
				if (!n || n < 1 || n > 9) return;
				const currentDefs = this.animationManager.getAnimationDefs();
				const def = currentDefs[n - 1];
				if (!def || !this.animationManager.isLoaded(def.name)) return;
				this.animationManager.crossfadeTo(def.name);
				this.invalidate();
				this._recomputeAnimating();
				this._updateRenderLoop();
			};
			document.addEventListener('keydown', this._onAnimHotkey);
		}
	}

	clear() {
		if (!this.content) return;

		// Detach external animation manager
		this.animationManager.detach();
		if (this._animPanelEl) {
			this._animPanelEl.remove();
			this._animPanelEl = null;
		}

		if (this.modelInfo) {
			this.modelInfo.remove();
			this.modelInfo = null;
		}

		this.annotationEls.forEach((a) => a.el.remove());
		this.annotationEls = [];

		this.scene.remove(this.content);

		// dispose geometry
		this.content.traverse((node) => {
			if (!node.geometry) return;

			node.geometry.dispose();
		});

		// dispose textures
		traverseMaterials(this.content, (material) => {
			for (const key in material) {
				if (key !== 'envMap' && material[key] && material[key].isTexture) {
					material[key].dispose();
				}
			}
		});

		this.content = null;
		if (!this._disposed) this.invalidate();
	}

	dispose() {
		if (this._disposed) return;
		this._disposed = true;

		if (this._rafId !== null) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}

		document.removeEventListener('visibilitychange', this._onVisibilityChange);
		window.removeEventListener('resize', this._onResize, false);
		window.removeEventListener('keydown', this._onKeyDown);
		if (this._onDblClick && this.renderer?.domElement) {
			this.renderer.domElement.removeEventListener('dblclick', this._onDblClick);
		}
		if (this._cameraTweenRaf) cancelAnimationFrame(this._cameraTweenRaf);
		if (this._onAnimHotkey) {
			document.removeEventListener('keydown', this._onAnimHotkey);
			this._onAnimHotkey = null;
		}

		if (this._intersectionObserver) {
			this._intersectionObserver.disconnect();
			this._intersectionObserver = null;
		}

		this.clear();

		if (this.mixer) {
			this.mixer.stopAllAction();
			const root = this.mixer.getRoot();
			if (root) this.mixer.uncacheRoot(root);
			this.mixer = null;
		}
		this.clips = [];

		// Dispose external animation system
		this.animationManager.dispose();
		if (this._animPanelEl) {
			this._animPanelEl.remove();
			this._animPanelEl = null;
		}

		if (this.skeletonHelpers.length) {
			this.skeletonHelpers.forEach((helper) => {
				this.scene.remove(helper);
				helper.dispose?.();
			});
			this.skeletonHelpers.length = 0;
		}

		if (this.gridHelper) {
			this.scene.remove(this.gridHelper);
			this.gridHelper.geometry?.dispose();
			this.gridHelper.material?.dispose();
			this.gridHelper = null;
		}
		if (this.axesHelper) {
			this.scene.remove(this.axesHelper);
			this.axesHelper.geometry?.dispose();
			this.axesHelper.material?.dispose();
			this.axesHelper = null;
		}
		if (this.axesCorner) {
			this.axesScene?.remove(this.axesCorner);
			this.axesCorner.geometry?.dispose();
			this.axesCorner.material?.dispose();
			this.axesCorner = null;
		}

		this.lights.forEach((light) => light.parent?.remove(light));
		this.lights = [];

		if (this.annotationEls.length) {
			this.annotationEls.forEach((a) => a.el.remove());
			this.annotationEls = [];
		}
		if (this.modelInfo) {
			this.modelInfo.remove();
			this.modelInfo = null;
		}

		if (this.gui) {
			this.gui.destroy();
			this.gui = null;
		}
		if (this._guiWrap) {
			this._guiWrap.remove();
			this._guiWrap = null;
		}
		if (this._guiToggle) {
			this._guiToggle.remove();
			this._guiToggle = null;
		}

		if (this.stats?.dom) this.stats.dom.remove();

		if (this.controls) {
			if (this._onControlsChange) {
				this.controls.removeEventListener('change', this._onControlsChange);
				this._onControlsChange = null;
			}
			this.controls.dispose();
			this.controls = null;
		}

		if (this._loadedEnvironment) {
			this._loadedEnvironment.dispose();
			this._loadedEnvironment = null;
		}
		if (this.neutralEnvironment) {
			this.neutralEnvironment.dispose();
			this.neutralEnvironment = null;
		}
		if (this.scene) {
			this.scene.environment = null;
			this.scene.background = null;
		}

		if (this.pmremGenerator) {
			this.pmremGenerator.dispose();
			this.pmremGenerator = null;
		}

		if (this.axesRenderer) {
			this.axesRenderer.dispose();
			this.axesRenderer.forceContextLoss?.();
			this.axesRenderer.domElement?.remove();
			this.axesRenderer = null;
		}
		if (this.axesDiv) {
			this.axesDiv.remove();
			this.axesDiv = null;
		}
		this.axesScene = null;
		this.axesCamera = null;

		if (this.renderer) {
			this.renderer.dispose();
			this.renderer.forceContextLoss?.();
			this.renderer.domElement?.remove();
			if (window.renderer === this.renderer) window.renderer = null;
			this.renderer = null;
		}

		this.scene = null;
		this.content = null;
		this.activeCamera = null;
		this.defaultCamera = null;
		this._afterAnimateHooks = null;
	}
}
