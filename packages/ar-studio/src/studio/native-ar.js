// Handing one model to the device's own AR viewer, from the browser.
//
// This is the path that actually puts an object on someone's floor at real
// size, with real tracking, real occlusion and real lighting: Apple's AR Quick
// Look on iOS and Google's Scene Viewer on Android. Both are native apps, so
// there is no feature-detectable API and UA branching is the correct answer
// here rather than a shortcut.
//
// The studio's own WebXR session is better still where it exists (it keeps the
// whole multi-model scene in-page), so `arCapability()` puts it first and these
// two are what everyone else gets instead of a camera-passthrough approximation.

/** Apple's AR Quick Look, available on iOS and iPadOS Safari. */
export function isIOS() {
	if (typeof navigator === 'undefined') return false;
	return /iphone|ipad|ipod/i.test(navigator.userAgent)
		|| (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function canUseQuickLook() {
	return isIOS();
}

export function isAndroid() {
	return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
}

export function canUseSceneViewer() {
	return isAndroid();
}

// Safari delivers the Quick Look banner-tap `message` event on the anchor that
// launched the session, so the anchor must stay in the DOM while the viewer is
// open. One live anchor at a time: replacing it drops the previous listener.
let _anchor = null;

/** The literal `message` payload Safari sends when the Quick Look banner is tapped. */
export const QUICK_LOOK_BANNER_TAPPED = '_apple_ar_quicklook_button_tapped';

/**
 * A filesystem-safe `<name>.usdz` for a model title.
 *
 * This is not cosmetic. See `openQuickLook`: the extension in this name is what
 * tells Safari the blob it is being handed is an AR asset.
 *
 * @param {string} [title]
 * @returns {string}
 */
export function usdzFilename(title) {
	const slug = String(title || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return `${slug || 'model'}.usdz`;
}

/**
 * Open a USDZ in Quick Look. Safari activates it when an `<a rel="ar">` is
 * clicked programmatically, which is why this builds an anchor rather than
 * navigating.
 *
 * THE `download` ATTRIBUTE IS LOAD-BEARING and the single least obvious line in
 * this package. Safari decides whether a URL is an AR asset by looking at its
 * file extension. A `blob:` URL has no path and therefore no extension, so
 * without a filename Safari does open Quick Look, but as a generic 3D file
 * preview: the viewer comes up in Object mode with AR unavailable, which reads
 * as "AR is broken" while everything else looks perfectly fine. `download`
 * supplies the name Safari sniffs, and Quick Look enters AR. This is exactly
 * what <model-viewer> does for its own generated USDZ, and why an app built on
 * model-viewer reaches ARKit while a hand-rolled anchor does not.
 *
 * @param {string} usdzUrl
 * @param {{onBannerTap?: () => void, name?: string}} [opts] `name` becomes the
 *   Quick Look filename; pass the model's title.
 */
export function openQuickLook(usdzUrl, { onBannerTap, name = '' } = {}) {
	if (_anchor) { _anchor.remove(); _anchor = null; }
	const a = document.createElement('a');
	// Attribute order mirrors model-viewer's: rel, then the child image, then
	// href. Safari is known to be picky about the anchor being complete before
	// it is activated.
	a.rel = 'ar';
	// iOS needs a child element for a programmatic click to open Quick Look.
	a.appendChild(document.createElement('img'));
	a.href = usdzUrl;
	if (/^blob:/i.test(usdzUrl)) a.setAttribute('download', usdzFilename(name));
	// Present but invisible.
	a.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;';
	a.setAttribute('aria-hidden', 'true');
	if (typeof onBannerTap === 'function') {
		a.addEventListener('message', (e) => {
			if (e.data === QUICK_LOOK_BANNER_TAPPED) onBannerTap();
		});
	}
	document.body.appendChild(a);
	_anchor = a;
	a.click();
}

/**
 * Open a GLB in Google Scene Viewer through an ARCore intent. Falls the browser
 * back to `fallbackUrl` (default: this page) when ARCore is missing.
 *
 * @param {string} glbUrl
 * @param {{title?: string, link?: string, fallbackUrl?: string}} [opts]
 */
export function openSceneViewer(glbUrl, { title = '', link = '', fallbackUrl = '' } = {}) {
	const params = new URLSearchParams({ file: glbUrl, mode: 'ar_preferred' });
	if (title) params.set('title', title);
	if (link) params.set('link', link);
	const fallback = encodeURIComponent(fallbackUrl || location.href);
	location.href = `intent://arvr.google.com/scene-viewer/1.2?${params.toString()}`
		+ '#Intent;scheme=https;package=com.google.ar.core;'
		+ 'action=android.intent.action.VIEW;'
		+ `S.browser_fallback_url=${fallback};end;`;
}

/**
 * The best AR path this device can actually deliver, best first.
 *
 * 'webxr'      immersive-ar: the whole scene stays in the page, anchored.
 * 'quicklook'  iOS/iPadOS: ARKit placement of ONE model, in Apple's viewer.
 * 'sceneviewer' Android without WebXR: ARCore placement of ONE model.
 * 'none'       desktop and locked-down webviews: hand off to a phone instead.
 *
 * Never throws: a blocked or missing API is simply not that capability.
 *
 * @returns {Promise<'webxr'|'quicklook'|'sceneviewer'|'none'>}
 */
export async function arCapability() {
	try {
		if (navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'))) return 'webxr';
	} catch {
		// A throwing support probe is just "not webxr".
	}
	if (canUseQuickLook()) return 'quicklook';
	if (canUseSceneViewer()) return 'sceneviewer';
	return 'none';
}

// ── The USDZ cache ────────────────────────────────────────────────────────
//
// Two taps on "Place in your space" must not pay for two conversions, and the
// studio pre-warms this entry the moment it knows which model the button will
// send, so the tap itself is usually instant.
//
// Bounded on purpose: each entry pins a USDZ blob in memory, and a phone that
// has browsed twenty models should not be holding twenty of them. Eviction
// revokes the object URL, which is the only way that memory ever comes back.

const MAX_CACHED_USDZ = 4;

/** @type {Map<string, {promise: Promise<string>, href: string}>} */
const _usdzCache = new Map();

function evictOldestUsdz() {
	while (_usdzCache.size > MAX_CACHED_USDZ) {
		const [key, entry] = _usdzCache.entries().next().value;
		_usdzCache.delete(key);
		if (entry.href) URL.revokeObjectURL(entry.href);
	}
}

/** Drop every cached USDZ and release the memory behind it. */
export function clearQuickLookCache() {
	for (const entry of _usdzCache.values()) {
		if (entry.href) URL.revokeObjectURL(entry.href);
	}
	_usdzCache.clear();
}

/** Drop one cached USDZ and release the memory behind it. */
export function releaseQuickLook(key) {
	const entry = _usdzCache.get(key);
	if (!entry) return false;
	_usdzCache.delete(key);
	if (entry.href) URL.revokeObjectURL(entry.href);
	return true;
}

/** Is a Quick Look asset for this key already converted and ready to open? */
export function isQuickLookReady(key) {
	return Boolean(key && _usdzCache.get(key)?.href);
}

/**
 * Convert once per key and hand back a `blob:` URL Quick Look can open.
 *
 * @param {string} key   Cache identity. Include anything that changes the bytes
 *                       (the source URL, and the scale when it is baked in).
 * @param {() => Promise<Blob>} build
 * @returns {Promise<string>}
 */
export async function cachedUsdzUrl(key, build) {
	const hit = _usdzCache.get(key);
	if (hit) {
		// Re-inserting makes the map least-recently-used rather than insertion
		// ordered, so the model someone keeps opening is not the one evicted.
		_usdzCache.delete(key);
		_usdzCache.set(key, hit);
		return hit.promise;
	}
	const entry = { href: '', promise: null };
	entry.promise = (async () => {
		const blob = await build();
		entry.href = URL.createObjectURL(blob);
		return entry.href;
	})();
	// A conversion that throws must not poison the key forever: the next tap
	// should be able to try again.
	entry.promise.catch(() => {
		if (_usdzCache.get(key) === entry) _usdzCache.delete(key);
	});
	_usdzCache.set(key, entry);
	evictOldestUsdz();
	return entry.promise;
}

/**
 * Everything the device's AR viewer needs, WITHOUT opening it yet.
 *
 * The split matters more than it looks. Safari only honours a `rel="ar"`
 * activation while the page still holds user activation, and converting a GLB
 * to USDZ takes seconds: do the conversion inside the tap handler and by the
 * time the anchor is clicked the gesture has expired and iOS silently declines
 * to open Quick Look, which reads as a dead button. So callers prepare first
 * (before the tap, or behind a progress UI) and call the returned `open()`
 * synchronously from a real tap.
 *
 * @param {object} model
 * @param {string} model.src        https URL of the .glb
 * @param {string} [model.title]    Name shown in the AR viewer's banner
 * @param {string} [model.usdz]     A ready-made USDZ, skipping conversion
 * @param {string} [model.key]      Cache identity; defaults to `src`
 * @param {() => Promise<Blob>} [model.build]  Produce the USDZ without refetching
 * @param {object} [opts]
 * @param {(stage: 'download'|'parse'|'convert') => void} [opts.onProgress]
 * @param {string} [opts.fallbackUrl]  Where Android lands without ARCore
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<null | {viewer:'quicklook'|'sceneviewer', href: string,
 *   open: (o?: {onBannerTap?: () => void}) => void}>} null when this device has
 *   no native AR viewer at all.
 */
export async function prepareNativeAr({ src = '', title = '', usdz = '', key = '', build } = {}, {
	onProgress, fallbackUrl = '', signal,
} = {}) {
	if (!src && !usdz && !build) throw new Error('ar-studio: nothing to place');

	if (canUseQuickLook()) {
		let href = usdz;
		if (!href) {
			const cacheKey = key || src;
			if (!cacheKey) throw new Error('ar-studio: a cache key or src is required');
			href = await cachedUsdzUrl(cacheKey, async () => {
				if (build) {
					onProgress?.('convert');
					return build();
				}
				// Imported here rather than at module scope so a page that never opens
				// native AR never downloads the exporter.
				const { glbUrlToUsdzBlob } = await import('./usdz.js');
				return glbUrlToUsdzBlob(src, { signal, onProgress });
			});
		}
		return {
			viewer: 'quicklook',
			href,
			open: (o) => openQuickLook(href, { name: title, ...o }),
		};
	}

	if (canUseSceneViewer()) {
		if (!src) throw new Error('ar-studio: Scene Viewer needs a GLB URL');
		return {
			viewer: 'sceneviewer',
			href: src,
			open: () => openSceneViewer(src, { title, fallbackUrl }),
		};
	}

	return null;
}

/**
 * Prepare and open ONE model in the device's native AR viewer, in one call.
 *
 * Convenient, and the right shape when the USDZ is already cached (the studio
 * pre-warms it). When it is not, prefer `prepareNativeAr()` and open from a
 * tap: see the note there about Safari and user activation.
 *
 * @param {object} model            See `prepareNativeAr`
 * @param {object} [opts]
 * @param {(stage: 'download'|'parse'|'convert'|'open') => void} [opts.onProgress]
 * @param {string} [opts.fallbackUrl]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<'quicklook'|'sceneviewer'|'none'>} which viewer opened
 */
export async function placeInYourSpace(model = {}, opts = {}) {
	const handoff = await prepareNativeAr(model, opts);
	if (!handoff) return 'none';
	opts.onProgress?.('open');
	handoff.open();
	return handoff.viewer;
}

// Quick Look renders its banner on one line and truncates long strings itself;
// clamp the fields so a runaway prompt-as-name cannot fill the URL.
const BANNER_FIELD_MAX = 80;

/**
 * Append Quick Look banner fields to a USDZ URL as fragment parameters. This is
 * the one piece of page-controlled UI Apple allows inside the sealed viewer.
 *
 * Deliberately string surgery rather than `new URL()`: the USDZ here is usually
 * a blob: object URL, which URL parsing mangles.
 *
 * @param {string} url
 * @param {{title?: string, subtitle?: string, callToAction?: string}} [fields]
 * @returns {string}
 */
export function withQuickLookBanner(url, { title, subtitle, callToAction } = {}) {
	if (typeof url !== 'string' || !url) return url;
	const params = [];
	const push = (key, value) => {
		const v = typeof value === 'string' ? value.trim().slice(0, BANNER_FIELD_MAX) : '';
		if (v) params.push(`${key}=${encodeURIComponent(v)}`);
	};
	// Quick Look renders the banner only when it has a button to render: a lone
	// title produces a banner with an empty action. Apple treats these as one
	// set, so this does too, and a caller that wants the banner passes the set.
	if (!callToAction || typeof callToAction !== 'string' || !callToAction.trim()) return url;
	push('checkoutTitle', title);
	push('checkoutSubtitle', subtitle);
	push('callToAction', callToAction);
	if (!params.length) return url;
	const joined = params.join('&');
	return url.includes('#') ? `${url}&${joined}` : `${url}#${joined}`;
}
