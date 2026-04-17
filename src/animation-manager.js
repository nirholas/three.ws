import { AnimationMixer, LoopRepeat, LoopOnce } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/**
 * Manages loading external animation clips (e.g. from Mixamo) and applying
 * them to any skinned model with crossfade transitions.
 *
 * Usage:
 *   const mgr = new AnimationManager();
 *   mgr.attach(skinnedModel);
 *   await mgr.loadAnimation('idle', '/animations/idle.glb');
 *   mgr.play('idle');
 *   mgr.crossfadeTo('walking', 0.4);
 */

const DEFAULT_CROSSFADE = 0.35; // seconds

export class AnimationManager {
	constructor() {
		/** @type {THREE.Object3D|null} */
		this.model = null;
		/** @type {AnimationMixer|null} */
		this.mixer = null;
		/** @type {Map<string, THREE.AnimationClip>} */
		this.clips = new Map();
		/** @type {Map<string, THREE.AnimationAction>} */
		this.actions = new Map();
		/** @type {string|null} */
		this.currentName = null;
		/** @type {THREE.AnimationAction|null} */
		this.currentAction = null;
		/** @type {GLTFLoader} */
		this.loader = new GLTFLoader();
		/** @type {FBXLoader} */
		this.fbxLoader = new FBXLoader();
		/** @type {Function|null} */
		this.onChange = null;
		/** @type {Map<string, object>} - Cache of loaded GLTF objects by URL */
		this._gltfCache = new Map();

		this._animationDefs = [];
	}

	/**
	 * Attach the manager to a loaded model. Creates a new mixer.
	 * Call this every time a new model is loaded.
	 * @param {THREE.Object3D} model
	 */
	attach(model) {
		this.detach();
		this.model = model;
		this.mixer = new AnimationMixer(model);
		this.actions.clear();
		this.currentAction = null;
		this.currentName = null;

		// Re-create actions for any clips that were already loaded
		for (const [name, clip] of this.clips) {
			const retargetedClip = this._retargetClip(clip, name);
			const action = this.mixer.clipAction(retargetedClip);
			action.enabled = true;
			this.actions.set(name, action);
		}
	}

	/**
	 * Detach from current model, stop all actions, dispose mixer.
	 */
	detach() {
		if (this.mixer) {
			this.mixer.stopAllAction();
			this.mixer.uncacheRoot(this.mixer.getRoot());
			this.mixer = null;
		}
		this.model = null;
		this.actions.clear();
		this.currentAction = null;
		this.currentName = null;
	}

	/**
	 * Register animation definitions to be loaded lazily or eagerly.
	 * @param {Array<{name: string, url: string, loop?: boolean}>} defs
	 */
	setAnimationDefs(defs) {
		this._animationDefs = defs;
	}

	/**
	 * Get registered animation definitions.
	 * @returns {Array<{name: string, url: string, loop?: boolean}>}
	 */
	getAnimationDefs() {
		return this._animationDefs;
	}

	/**
	 * Load an animation clip from a GLB/glTF file and register it.
	 * If a model is attached, also creates the action.
	 * @param {string} name - Friendly name (e.g. "idle", "walking")
	 * @param {string} url - URL of the GLB/glTF containing the animation
	 * @param {object} [options]
	 * @param {boolean} [options.loop=true] - Whether to loop the animation
	 * @param {string} [options.clipName] - Name of a specific clip inside a multi-animation GLB
	 * @returns {Promise<THREE.AnimationClip>}
	 */
	async loadAnimation(name, url, options = {}) {
		// Return cached clip if already loaded
		if (this.clips.has(name)) {
			return this.clips.get(name);
		}

		// Check if we already loaded this URL
		let animations;
		if (this._gltfCache.has(url)) {
			animations = this._gltfCache.get(url);
		} else {
			const isFbx = url.toLowerCase().endsWith('.fbx');
			const loaded = await new Promise((resolve, reject) => {
				(isFbx ? this.fbxLoader : this.loader).load(url, resolve, undefined, reject);
			});
			// FBX: loaded is the scene object with .animations; GLTF: loaded.animations
			animations = loaded.animations || [];
			this._gltfCache.set(url, animations);
		}

		// Find the right clip: by clipName if specified, otherwise first clip
		let clip;
		if (options.clipName) {
			clip = animations.find((a) => a.name === options.clipName);
			if (!clip) {
				console.warn(`[AnimationManager] Clip "${options.clipName}" not found in ${url}, using first clip`);
				clip = animations[0];
			}
		} else {
			clip = animations[0];
		}

		if (!clip) {
			throw new Error(`No animation found in ${url}`);
		}

		clip = clip.clone();
		clip.name = name;
		this.clips.set(name, clip);

		// If we have a model attached, create the action immediately
		if (this.model && this.mixer) {
			const retargetedClip = this._retargetClip(clip, name);
			const action = this.mixer.clipAction(retargetedClip);
			action.enabled = true;
			action.setLoop(options.loop === false ? LoopOnce : LoopRepeat);
			if (options.loop === false) {
				action.clampWhenFinished = true;
			}
			this.actions.set(name, action);
		}

		return clip;
	}

	/**
	 * Load all registered animation definitions.
	 * Loads in parallel, non-blocking. Failed loads are logged but don't throw.
	 * @returns {Promise<void>}
	 */
	async loadAll() {
		const promises = this._animationDefs.map(async (def) => {
			try {
				await this.loadAnimation(def.name, def.url, {
					loop: def.loop !== false,
					clipName: def.clipName,
				});
			} catch (e) {
				console.warn(`[AnimationManager] Failed to load "${def.name}" from ${def.url}:`, e);
			}
		});
		await Promise.all(promises);
	}

	/**
	 * Play a named animation immediately (no crossfade).
	 * @param {string} name
	 */
	play(name) {
		const action = this.actions.get(name);
		if (!action) {
			console.warn(`[AnimationManager] Animation "${name}" not loaded`);
			return;
		}

		if (this.currentAction && this.currentAction !== action) {
			this.currentAction.fadeOut(0.01);
		}

		action.reset().fadeIn(0.01).play();
		this.currentAction = action;
		this.currentName = name;

		if (this.onChange) this.onChange(name);
	}

	/**
	 * Crossfade from the current animation to a named animation.
	 * @param {string} name
	 * @param {number} [duration] - Crossfade duration in seconds
	 */
	crossfadeTo(name, duration = DEFAULT_CROSSFADE) {
		if (name === this.currentName) return;

		const nextAction = this.actions.get(name);
		if (!nextAction) {
			console.warn(`[AnimationManager] Animation "${name}" not loaded`);
			return;
		}

		nextAction.reset();
		nextAction.play();

		if (this.currentAction) {
			this.currentAction.crossFadeTo(nextAction, duration, true);
		} else {
			nextAction.fadeIn(duration);
		}

		this.currentAction = nextAction;
		this.currentName = name;

		if (this.onChange) this.onChange(name);
	}

	/**
	 * Stop all animations.
	 */
	stopAll() {
		if (this.mixer) {
			this.mixer.stopAllAction();
		}
		this.currentAction = null;
		this.currentName = null;
		if (this.onChange) this.onChange(null);
	}

	/**
	 * Update the mixer. Call this in the render loop.
	 * @param {number} deltaTime - Time since last frame in seconds
	 */
	update(deltaTime) {
		if (this.mixer) {
			this.mixer.update(deltaTime);
		}
	}

	/**
	 * Retarget an animation clip to match the current model's skeleton.
	 * Handles common naming convention mismatches between Mixamo exports.
	 * @param {THREE.AnimationClip} clip
	 * @param {string} name
	 * @returns {THREE.AnimationClip}
	 * @private
	 */
	_retargetClip(clip, name) {
		if (!this.model) return clip;

		// Collect bone names from the current model
		const modelBones = new Set();
		this.model.traverse((node) => {
			if (node.isBone) {
				modelBones.add(node.name);
			}
		});

		if (modelBones.size === 0) return clip;

		// Check if clip tracks already match model bones
		const clipBoneNames = new Set();
		for (const track of clip.tracks) {
			const boneName = track.name.split('.')[0];
			clipBoneNames.add(boneName);
		}

		// If most tracks already match, no retargeting needed
		let matchCount = 0;
		for (const boneName of clipBoneNames) {
			if (modelBones.has(boneName)) matchCount++;
		}
		if (matchCount / clipBoneNames.size > 0.5) return clip;

		// Build a name mapping for retargeting
		const nameMap = this._buildBoneNameMap(modelBones, clipBoneNames);
		if (!nameMap) return clip;

		// Clone the clip with remapped track names
		const newTracks = clip.tracks
			.map((track) => {
				const parts = track.name.split('.');
				const boneName = parts[0];
				const property = parts.slice(1).join('.');
				const mappedName = nameMap.get(boneName);
				if (!mappedName) return null;
				const newTrack = track.clone();
				newTrack.name = `${mappedName}.${property}`;
				return newTrack;
			})
			.filter(Boolean);

		const newClip = clip.clone();
		newClip.tracks = newTracks;
		return newClip;
	}

	/**
	 * Attempts to build a bone name mapping between two skeleton naming conventions.
	 * Supports: Mixamo → Mixamo, stripped prefixes, common standardizations.
	 * @param {Set<string>} modelBones
	 * @param {Set<string>} clipBones
	 * @returns {Map<string, string>|null}
	 * @private
	 */
	_buildBoneNameMap(modelBones, clipBones) {
		const map = new Map();

		// Strategy 1: Strip common prefixes (e.g., "mixamorig:" vs "mixamorig1:")
		const modelArr = [...modelBones];
		const clipArr = [...clipBones];

		const stripPrefix = (name) =>
			name.replace(/^mixamorig\d*[_:]?/i, '').replace(/^Armature[_/]?/i, '');

		const modelStripped = new Map(modelArr.map((n) => [stripPrefix(n), n]));

		let matches = 0;
		for (const clipBone of clipArr) {
			const stripped = stripPrefix(clipBone);
			if (modelStripped.has(stripped)) {
				map.set(clipBone, modelStripped.get(stripped));
				matches++;
			}
		}

		// If we matched at least 50% of bones, consider it a valid mapping
		if (matches / clipArr.length > 0.5) {
			return map;
		}

		// Strategy 2: Case-insensitive matching
		const modelLower = new Map(modelArr.map((n) => [n.toLowerCase(), n]));
		map.clear();
		matches = 0;

		for (const clipBone of clipArr) {
			if (modelLower.has(clipBone.toLowerCase())) {
				map.set(clipBone, modelLower.get(clipBone.toLowerCase()));
				matches++;
			}
		}

		if (matches / clipArr.length > 0.5) {
			return map;
		}

		return null;
	}

	/**
	 * Get the list of loaded animation names.
	 * @returns {string[]}
	 */
	getLoadedNames() {
		return [...this.clips.keys()];
	}

	/**
	 * Check if a specific animation is loaded.
	 * @param {string} name
	 * @returns {boolean}
	 */
	isLoaded(name) {
		return this.clips.has(name);
	}

	dispose() {
		this.detach();
		this.clips.clear();
		this._gltfCache.clear();
		this._animationDefs = [];
	}
}
