// "View in your space": device-aware AR routing for a single model.
//
// Pure and dependency-free, so it runs identically in a browser, in a Node
// server, and inside the MCP server in this package. Given a GLB URL and a
// User-Agent it decides how that model should reach someone's room:
//
//   iOS      → Apple AR Quick Look (a USDZ generated from the GLB in-page by
//              model-viewer's three.js USDZExporter: a real conversion, no
//              server-side USD tooling anywhere).
//   Android  → Google Scene Viewer through an ARCore intent:// URL, with a
//              browser fallback so a device without ARCore lands on the viewer
//              instead of an error screen.
//   desktop  → the interactive WebGL viewer.
//
// Ported from the three.ws AR lane (Apache-2.0), with the origin and the viewer
// path made configurable so it can front your own pages.

/** Where the hosted launch page and viewer live by default. */
export const DEFAULT_ORIGIN = 'https://three.ws';

export class ArUrlError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'ArUrlError';
		this.code = code;
	}
}

/**
 * Accept a model URL an AR viewer will actually open: https, pointing at a
 * .glb/.gltf file. Query strings are fine. Anything else throws a coded error
 * the boundary turns into a clean message: device AR intents must never be
 * handed a non-https URL.
 *
 * @param {unknown} glbUrl
 * @returns {string} the normalized URL
 */
export function assertArAssetUrl(glbUrl) {
	let u;
	try {
		u = new URL(String(glbUrl));
	} catch {
		throw new ArUrlError('invalid_url', 'Provide a valid https URL to a .glb model.');
	}
	if (u.protocol !== 'https:') throw new ArUrlError('not_https', 'The model URL must be https.');
	if (!/\.(glb|gltf)$/i.test(u.pathname)) {
		throw new ArUrlError('not_glb', 'The model URL must point at a .glb or .gltf file.');
	}
	return u.toString();
}

/** Classify the AR target from a User-Agent string. */
export function detectArTarget(userAgent) {
	const ua = String(userAgent || '');
	// iPadOS 13+ reports a Mac UA; server-side we only have the string, so match
	// the explicit iOS device tokens.
	if (/\b(iphone|ipad|ipod)\b/i.test(ua)) return 'ios';
	if (/\bandroid\b/i.test(ua)) return 'android';
	return 'desktop';
}

/**
 * The Android Scene Viewer ARCore intent URL for a GLB.
 * @param {string} glbUrl
 * @param {{title?: string, fallbackUrl?: string}} [opts]
 */
export function buildSceneViewerUrl(glbUrl, { title = '', fallbackUrl = '' } = {}) {
	const params = new URLSearchParams({ file: glbUrl, mode: 'ar_preferred' });
	if (title) params.set('title', title);
	const fallback = fallbackUrl ? `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};` : '';
	return (
		`intent://arvr.google.com/scene-viewer/1.2?${params.toString()}`
		+ '#Intent;scheme=https;package=com.google.ar.core;'
		+ `action=android.intent.action.VIEW;${fallback}end;`
	);
}

/** The interactive WebGL viewer URL for a GLB. */
export function buildViewerUrl(origin, glbUrl, title = '') {
	const base = String(origin || DEFAULT_ORIGIN).replace(/\/$/, '');
	const t = title ? `&title=${encodeURIComponent(title)}` : '';
	return `${base}/viewer?src=${encodeURIComponent(glbUrl)}${t}`;
}

/**
 * The hosted, device-branching AR launch URL. Open it on any phone and it routes
 * itself: Quick Look on iOS, Scene Viewer on Android, the viewer on desktop.
 *
 * @param {string} origin
 * @param {string} glbUrl
 * @param {string} [title]
 * @param {{live?: boolean, endpoint?: string}} [opts] `live` marks a rigged avatar.
 */
export function buildArLaunchUrl(origin, glbUrl, title = '', { live = false, endpoint } = {}) {
	const base = endpoint || `${String(origin || DEFAULT_ORIGIN).replace(/\/$/, '')}/api/ar`;
	const t = title ? `&title=${encodeURIComponent(title)}` : '';
	const k = live ? '&kind=avatar' : '';
	return `${base}?src=${encodeURIComponent(glbUrl)}${t}${k}`;
}

/**
 * Resolve every link for one model at once. `target` tells a caller which one the
 * current device will actually use.
 *
 * @param {object} p
 * @param {string} p.glbUrl
 * @param {string} [p.userAgent]
 * @param {string} [p.origin]
 * @param {string} [p.title]
 * @param {boolean} [p.live]  A rigged avatar rather than a static prop.
 * @returns {{target:'ios'|'android'|'desktop', action:'redirect'|'page', asset:string,
 *   viewerUrl:string, sceneViewerUrl:string, launchUrl:string, live:boolean}}
 */
export function planArLaunch({ glbUrl, userAgent, origin = DEFAULT_ORIGIN, title = '', live = false } = {}) {
	const asset = assertArAssetUrl(glbUrl);
	const target = detectArTarget(userAgent);
	const viewerUrl = buildViewerUrl(origin, asset, title);
	const sceneViewerUrl = buildSceneViewerUrl(asset, { title, fallbackUrl: viewerUrl });
	const launchUrl = buildArLaunchUrl(origin, asset, title, { live });
	// A live avatar always gets the launch page: a straight Scene Viewer redirect
	// would place a frozen body and hide the animated path entirely.
	const action = target === 'android' && !live ? 'redirect' : 'page';
	return { target, action, asset, viewerUrl, sceneViewerUrl, launchUrl, live };
}
