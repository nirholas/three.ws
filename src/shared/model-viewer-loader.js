// One loader for the <model-viewer> custom element.
//
// Five pickers used to inject the Google-hosted script with no `onerror`, so
// on a network that blocks ajax.googleapis.com (corporate proxies, some
// regions, aggressive blockers) the element never upgraded and every
// <model-viewer> sat as an inert empty box with no message. This module tries
// each CDN in turn, resolves once the element is defined, and rejects with a
// user-readable error when every host fails, so a caller can show a poster
// image or a "3D preview unavailable" state instead of nothing.
//
// The same version is served from three independent CDNs; any one of them is
// the whole library, so the first that loads wins and the rest are never hit.

const VERSION = '4.0.0';
const SOURCES = [
	`https://ajax.googleapis.com/ajax/libs/model-viewer/${VERSION}/model-viewer.min.js`,
	`https://cdn.jsdelivr.net/npm/@google/model-viewer@${VERSION}/dist/model-viewer.min.js`,
	`https://unpkg.com/@google/model-viewer@${VERSION}/dist/model-viewer.min.js`,
];
// A script that neither loads nor errors (a black-holed CDN) is treated as
// failed after this long, so the chain moves on instead of waiting forever.
const PER_SOURCE_TIMEOUT_MS = 12_000;

let _pending = null;
let _defineGuarded = false;

// The chain abandons a source after PER_SOURCE_TIMEOUT_MS, but removing a
// <script> does not cancel a fetch already in flight: a slow first CDN can
// still execute after a later one defined the element, and that second
// customElements.define('model-viewer', ...) throws an uncaught
// NotSupportedError ("the name model-viewer has already been used with this
// registry") onto the page console. Every source here serves the identical
// library, so the first definition wins and a duplicate is a no-op. Scoped to
// this one element name so a genuine double-define anywhere else still throws.
function guardDuplicateDefine() {
	if (_defineGuarded || typeof customElements === 'undefined') return;
	_defineGuarded = true;
	const nativeDefine = customElements.define;
	customElements.define = function (name, ctor, options) {
		if (name === 'model-viewer' && customElements.get(name)) return undefined;
		return nativeDefine.call(this, name, ctor, options);
	};
}

function loadScript(src) {
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.type = 'module';
		s.src = src;
		s.crossOrigin = 'anonymous';
		const timer = setTimeout(() => {
			s.remove();
			reject(new Error(`timed out loading ${src}`));
		}, PER_SOURCE_TIMEOUT_MS);
		s.onload = () => {
			clearTimeout(timer);
			resolve();
		};
		s.onerror = () => {
			clearTimeout(timer);
			s.remove();
			reject(new Error(`failed to load ${src}`));
		};
		document.head.appendChild(s);
	});
}

/**
 * Resolve once `customElements.get('model-viewer')` is defined. Safe to call
 * from many components at once: one load is shared. A failure is remembered
 * only for the duration of the attempt, so a later call (a retry button) tries
 * the chain again.
 *
 * @returns {Promise<void>}
 */
export function ensureModelViewer() {
	if (typeof customElements !== 'undefined' && customElements.get('model-viewer')) return Promise.resolve();
	if (_pending) return _pending;
	guardDuplicateDefine();
	_pending = (async () => {
		let lastErr;
		for (const src of SOURCES) {
			// An abandoned source can still land while the next one is being
			// picked; if it did, the chain is already done.
			if (customElements.get('model-viewer')) return;
			try {
				await loadScript(src);
				if (customElements.get('model-viewer')) return;
				await customElements.whenDefined('model-viewer');
				return;
			} catch (err) {
				lastErr = err;
			}
		}
		document.documentElement.dispatchEvent(new CustomEvent('model-viewer:unavailable', { bubbles: false }));
		throw Object.assign(new Error('The 3D viewer could not be loaded. Check your connection or ad blocker and try again.'), {
			code: 'model_viewer_unavailable',
			cause: lastErr,
		});
	})().finally(() => {
		_pending = null;
	});
	return _pending;
}

/**
 * Fire-and-forget variant for pickers that render <model-viewer> tags eagerly:
 * on failure every viewer in `root` gets a visible fallback (its `poster`
 * image if set, else a short caption) rather than staying blank.
 *
 * @param {ParentNode} [root=document]
 */
export function ensureModelViewerOrFallback(root = document) {
	return ensureModelViewer().catch((err) => {
		for (const mv of root.querySelectorAll('model-viewer')) {
			if (mv.dataset.mvFallback) continue;
			mv.dataset.mvFallback = '1';
			const poster = mv.getAttribute('poster');
			const box = document.createElement('div');
			box.className = 'mv-fallback';
			box.setAttribute('role', 'img');
			box.setAttribute('aria-label', mv.getAttribute('alt') || '3D preview unavailable');
			box.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:120px;font:500 12px/1.4 system-ui,sans-serif;color:#9aa4b2;text-align:center;padding:8px;box-sizing:border-box;';
			if (poster) {
				box.style.background = `center / cover no-repeat url("${poster}")`;
				box.textContent = '';
			} else {
				box.textContent = '3D preview unavailable';
			}
			mv.replaceWith(box);
		}
		console.warn('[model-viewer]', err?.message || err);
	});
}
