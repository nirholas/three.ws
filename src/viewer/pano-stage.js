// PanoController: owns one user 360 photo and everything derived from it.
//
// The viewer (`src/viewer.js`) and the splat page (`src/splat-viewer.js`) each
// own a three.js scene and a renderer. This class is the part they share: load a
// File or https URL, keep the decoded texture, build the lighting environment on
// demand, and write lighting, backdrop, blur and rotation onto whichever scene is
// live. The two switches are independent: "use as lighting" feeds
// `scene.environment`, "show as background" feeds `scene.background`.

import { buildPanoLighting, loadPanoTexture } from './environment.js';
import {
	PANO_DEFAULTS,
	PanoError,
	PANO_MESSAGES,
	isMobileDevice,
	normalizeSetting,
	panoStorageKey,
} from './pano-photo.js';

const BRIGHTEN_KEYS = new Set(['brighten', 'brightenStrength']);

function storage() {
	try {
		return globalThis.localStorage || null;
	} catch {
		return null;
	}
}

export class PanoController extends EventTarget {
	/**
	 * @param {object} options
	 * @param {() => ({ renderer: object, pmrem?: object } | null)} options.getTarget  the live renderer
	 * @param {() => void} options.onApply  called after anything that changes what the scene should show
	 * @param {{ lighting?: boolean, ground?: boolean }} [options.features]  controls this host supports
	 * @param {string} [options.pathname]  keys the remembered URL, one per page
	 */
	constructor({ getTarget, onApply, features = {}, pathname = globalThis.location?.pathname || '/' }) {
		super();
		this.getTarget = getTarget;
		this.onApply = onApply;
		this.features = { lighting: true, ground: false, ...features };
		this.storageKey = panoStorageKey(pathname);
		this.settings = { ...PANO_DEFAULTS };
		/** @type {'empty'|'loading'|'ready'|'error'} */
		this.status = 'empty';
		this.progress = 0;
		this.error = null;
		this.image = null;
		this._env = null;
		this._envKey = '';
		this._abort = null;
		this._raf = 0;
		this._disposed = false;
	}

	get active() {
		return Boolean(this.image);
	}

	_emit() {
		this.dispatchEvent(new CustomEvent('change'));
	}

	_setStatus(status, extra = {}) {
		this.status = status;
		this.error = extra.error ?? null;
		if ('progress' in extra) this.progress = extra.progress;
		this._emit();
	}

	/** Load a user File or an https URL, replacing the current photo on success. */
	async load(source, { quiet = false } = {}) {
		if (this._disposed) return false;
		this._abort?.abort();
		const abort = new AbortController();
		this._abort = abort;
		this._setStatus('loading', { progress: 0 });
		const target = this.getTarget();
		let image;
		try {
			image = await loadPanoTexture(source, {
				maxTextureSize: target?.renderer?.capabilities?.maxTextureSize || 4096,
				mobile: isMobileDevice(),
				signal: abort.signal,
				onProgress: ({ loaded, total }) => {
					this.progress = total ? loaded / total : 0;
					this.loadedBytes = loaded;
					this._emit();
				},
			});
		} catch (err) {
			if (err?.name === 'AbortError' || this._abort !== abort) return false;
			if (quiet) {
				this._forget();
				this._setStatus(this.image ? 'ready' : 'empty');
				return false;
			}
			const message = err instanceof PanoError ? err.message : PANO_MESSAGES.unreadable;
			this._setStatus('error', { error: { code: err?.code || 'unreadable', message } });
			return false;
		}
		if (this._disposed || this._abort !== abort) {
			image.dispose();
			return false;
		}
		this._releaseGpu();
		this.image?.dispose();
		this.image = image;
		this._remember(source);
		this._setStatus('ready', { progress: 1 });
		this.onApply?.();
		return true;
	}

	/** Remove the photo and return the host to its own environment. */
	clear() {
		this._abort?.abort();
		this._abort = null;
		this._releaseGpu();
		this.image?.dispose();
		this.image = null;
		this._forget();
		this._setStatus('empty', { progress: 0 });
		this.onApply?.();
	}

	/** Dismiss an error and return to whichever state was underneath. */
	dismissError() {
		if (this.status !== 'error') return;
		this._setStatus(this.image ? 'ready' : 'empty');
	}

	/** Reload the URL remembered for this page, if any. A stale link fails quietly. */
	restore() {
		const url = this.savedUrl();
		return url ? this.load(url, { quiet: true }) : Promise.resolve(false);
	}

	/** The remembered URL for this page, or null. A local file is never remembered. */
	savedUrl() {
		try {
			const raw = storage()?.getItem(this.storageKey);
			if (!raw) return null;
			const { url } = JSON.parse(raw);
			return typeof url === 'string' && url.startsWith('https://') ? url : null;
		} catch {
			return null;
		}
	}

	_remember(source) {
		if (typeof source !== 'string') {
			this._forget();
			return;
		}
		try {
			storage()?.setItem(this.storageKey, JSON.stringify({ url: source }));
		} catch {
			// storage blocked: the photo still works for this visit
		}
	}

	_forget() {
		try {
			storage()?.removeItem(this.storageKey);
		} catch {
			// storage blocked
		}
	}

	/** Change one setting; the scene updates on the next animation frame. */
	set(key, value) {
		const next = normalizeSetting(key, value);
		if (next === undefined || this.settings[key] === next) return;
		this.settings[key] = next;
		if (BRIGHTEN_KEYS.has(key) || key === 'lighting') this._envKey = '';
		this._emit();
		if (this._raf || this._disposed) return;
		this._raf = requestAnimationFrame(() => {
			this._raf = 0;
			if (!this._disposed) this.onApply?.();
		});
	}

	/** PMREM environment for lighting, or null when lighting is off or no photo is loaded. */
	getLightingEnvironment() {
		if (!this.image || !this.features.lighting || !this.settings.lighting) return null;
		const target = this.getTarget();
		if (!target?.pmrem) return null;
		const { brighten, brightenStrength } = this.settings;
		const key = `${brighten}:${brightenStrength}`;
		if (this._env && this._envKey === key) return this._env;
		const previous = this._env;
		this._env = buildPanoLighting(target.renderer, target.pmrem, this.image, {
			brighten,
			strength: brightenStrength,
		});
		this._envKey = key;
		previous?.dispose();
		return this._env;
	}

	/** Equirect texture for the backdrop, or null when the backdrop switch is off. */
	getBackgroundTexture() {
		if (!this.image || !this.settings.background) return null;
		return this.image.texture;
	}

	/** Write rotation, blur and intensity onto a scene (`on` false resets them). */
	applyToScene(scene, on = this.active) {
		if (!scene) return;
		const radians = on ? (this.settings.rotation * Math.PI) / 180 : 0;
		scene.backgroundRotation?.set(0, radians, 0);
		scene.environmentRotation?.set(0, radians, 0);
		if ('backgroundBlurriness' in scene) scene.backgroundBlurriness = on ? this.settings.blur : 0;
		if ('backgroundIntensity' in scene) scene.backgroundIntensity = on ? this.settings.backgroundIntensity : 1;
	}

	_releaseGpu() {
		this._env?.dispose();
		this._env = null;
		this._envKey = '';
	}

	/** The GPU context was lost or replaced: drop GPU objects without disposing dead handles. */
	invalidateGpu() {
		this._env = null;
		this._envKey = '';
	}

	dispose() {
		this._disposed = true;
		this._abort?.abort();
		if (this._raf) cancelAnimationFrame(this._raf);
		this._releaseGpu();
		this.image?.dispose();
		this.image = null;
	}
}
