// AR hand-off rules shared by every "View in your space" surface in the
// browser: the Forge result panel (src/forge-ar.js and its Studio copy), the
// /ar/view landing page (src/ar-view.js) and AR Forge (public/ar-forge.html
// reaches the same page through /api/ar).
//
// Pure and dependency-free so each rule is pinned by tests
// (tests/forge-ar-links.test.js). The platform facts behind the numbers:
//   - Google Scene Viewer (developers.google.com/ar/develop/scene-viewer):
//     glTF 2.0 with PNG/JPG textures, 10 MB recommended, 15 MB is a hard
//     validator error, 2048 px maximum texture, 1 unit = 1 metre. It loads the
//     file itself from an https URL, so it can never read a blob: URL and has
//     no EXT_meshopt_compression decoder.
//   - Chrome for Android refuses to hand an intent:// URL to another app when
//     it was reached without a user gesture or by redirect from a typed URL
//     (developer.chrome.com/docs/android/intents). A scanned QR code counts as
//     typed, so Android must land on a page with a button, never a redirect.
//   - Apple Quick Look needs Safari's rel="ar" support. In-app browsers
//     (Instagram, Facebook, TikTok and similar WebViews) and the Google app on
//     iOS do not offer it.

export const SITE_ORIGIN = 'https://three.ws';

/** Scene Viewer's recommended model size. Above it, loading is slow on mobile data. */
export const AR_RECOMMENDED_BYTES = 10 * 1024 * 1024;
/** Scene Viewer's validator rejects a binary above this size outright. */
export const SCENE_VIEWER_MAX_BYTES = 15 * 1024 * 1024;

/**
 * The size the largest side of a model is shown at when it first appears in
 * AR, in metres. Forge lanes normalise every mesh into a unit cube (TRELLIS
 * spans about -0.5..0.5 on its longest axis), so 1 m is what the files already
 * say. It reads as "a chair, a lamp, a small table": big enough to inspect from
 * a step away. Every viewer lets the user pinch to resize from there.
 */
export const AR_DEFAULT_LONGEST_SIDE_M = 1;
/** Below this longest side a model was authored in the wrong unit (a 2 cm "car"). */
export const AR_MIN_SANE_SIDE_M = 0.05;
/** Above this longest side it would not fit in a room (a centimetre-unit file read as metres). */
export const AR_MAX_SANE_SIDE_M = 5;

// In-app browsers that ship their own WebView. Tokens are the documented or
// long-stable markers each app appends to the system UA.
const IN_APP_BROWSERS = [
	['Instagram', /\bInstagram\b/i],
	['Facebook', /\bFBAN\/|\bFBAV\/|\bFB_IAB\b|\bFBIOS\b/i],
	['Messenger', /\bMessenger\b|\bFBAN\/Messenger/i],
	['TikTok', /\bmusical_ly\b|\bBytedanceWebview\b|\bTikTok\b/i],
	['Snapchat', /\bSnapchat\b/i],
	['LinkedIn', /\bLinkedInApp\b/i],
	['X', /\bTwitter\b/i],
	['LINE', /\bLine\/\d/i],
	['WeChat', /\bMicroMessenger\b/i],
	['Telegram', /\bTelegram\b/i],
	['Discord', /\bDiscord\b/i],
	['Pinterest', /\bPinterest\b/i],
];

/**
 * Classify the device a page is running on for AR purposes.
 *
 * @param {{ userAgent?: string, maxTouchPoints?: number, platform?: string }} env
 * @returns {{ os: 'ios'|'android'|'desktop', inApp: string|null, iosMajor: number|null, androidMajor: number|null }}
 *   inApp names the app whose WebView this is ("Instagram", "Android WebView",
 *   "Google app") or is null in a real browser.
 */
export function detectArDevice(env = {}) {
	const ua = String(env.userAgent || '');
	const touch = Number(env.maxTouchPoints) || 0;
	let os = 'desktop';
	if (/\b(iPhone|iPad|iPod)\b/i.test(ua)) os = 'ios';
	// iPadOS 13+ reports a desktop Mac UA. A Mac has no touch screen, so a
	// "Macintosh" UA with touch points is an iPad.
	else if (/\bMacintosh\b/.test(ua) && touch > 1) os = 'ios';
	else if (/\bAndroid\b/i.test(ua)) os = 'android';

	let iosMajor = null;
	if (os === 'ios') {
		const m = ua.match(/\bOS (\d+)[_.]\d+/) || ua.match(/\bVersion\/(\d+)\./);
		iosMajor = m ? Number(m[1]) : null;
	}
	let androidMajor = null;
	if (os === 'android') {
		const m = ua.match(/\bAndroid (\d+)/i);
		androidMajor = m ? Number(m[1]) : null;
	}

	let inApp = null;
	for (const [name, re] of IN_APP_BROWSERS) {
		if (re.test(ua)) {
			inApp = name;
			break;
		}
	}
	if (!inApp && os === 'ios' && /\bGSA\/\d/.test(ua)) inApp = 'Google app';
	// "; wv)" is the Android System WebView marker any embedding app inherits.
	if (!inApp && os === 'android' && /;\s*wv\)/.test(ua)) inApp = 'Android WebView';
	return { os, inApp, iosMajor, androidMajor };
}

/**
 * Pick the URL a phone's AR viewer should load for a model the page is showing.
 *
 * Forge tools repoint the Download link at an in-memory blob: copy after a
 * local edit (optimize, materials, rig preview, refine). That copy exists only
 * in this browser tab, so a QR code or a Scene Viewer intent built from it
 * opens nothing on another device. The candidates are tried in order and the
 * first public https GLB wins.
 *
 * A Forge `.web.glb` is the meshopt-compressed display copy; Scene Viewer
 * cannot decode it, so its full `.glb` sibling (always written beside it under
 * /cdn/forge/) is used instead.
 *
 * @param {Array<string|null|undefined>} candidates  hrefs, most specific first
 * @param {string} [base]  origin relative paths resolve against
 * @returns {{ url: string|null, reason: 'ok'|'local'|'missing'|'unsupported' }}
 *   reason 'local' means the only model on offer is a browser-only copy.
 */
export function resolveArSource(candidates, base = SITE_ORIGIN) {
	let sawLocal = false;
	let sawAny = false;
	for (const raw of candidates || []) {
		if (!raw) continue;
		sawAny = true;
		const s = String(raw).trim();
		if (/^(blob|data):/i.test(s)) {
			sawLocal = true;
			continue;
		}
		let u;
		try {
			u = new URL(s, base);
		} catch {
			continue;
		}
		if (u.protocol !== 'https:') continue;
		if (!/\.(glb|gltf)$/i.test(u.pathname)) continue;
		if (/^\/cdn\/forge\//.test(u.pathname) && /\.web\.glb$/i.test(u.pathname)) {
			u.pathname = u.pathname.replace(/\.web\.glb$/i, '.glb');
		}
		u.hash = '';
		return { url: u.toString(), reason: 'ok' };
	}
	if (sawLocal) return { url: null, reason: 'local' };
	return { url: null, reason: sawAny ? 'unsupported' : 'missing' };
}

/**
 * The /ar/view URL for a public GLB: the one landing page that works on every
 * phone (a tap-to-launch button, so Android's intent is never blocked, and a
 * real on-device USDZ for iPhone). Kept short for QR density: the title is
 * optional and capped.
 */
export function arViewUrl(glbUrl, { title = '', origin = SITE_ORIGIN } = {}) {
	const params = new URLSearchParams({ src: glbUrl });
	const t = String(title || '').trim().slice(0, 80);
	if (t) params.set('title', t);
	return `${String(origin).replace(/\/$/, '')}/ar/view?${params.toString()}`;
}

/**
 * How heavy a model is for phone AR.
 *   'ok'     at or under Scene Viewer's 10 MB recommendation
 *   'heavy'  works everywhere but loads slowly on mobile data
 *   'over'   above Scene Viewer's 15 MB hard limit: Android's Scene Viewer
 *            refuses it, WebXR (Chrome) and iPhone Quick Look still work
 *   'unknown' when the size could not be read
 */
export function arWeight(bytes) {
	const n = Number(bytes);
	if (!Number.isFinite(n) || n <= 0) return 'unknown';
	if (n > SCENE_VIEWER_MAX_BYTES) return 'over';
	if (n > AR_RECOMMENDED_BYTES) return 'heavy';
	return 'ok';
}

/** "18.4 MB" style label for a byte count. */
export function formatMegabytes(bytes) {
	const mb = Number(bytes) / (1024 * 1024);
	if (!Number.isFinite(mb) || mb <= 0) return '';
	return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

/**
 * The uniform scale that makes a model appear at a believable size in AR.
 * A model whose longest side is already room-sized keeps its authored size
 * (1, the glTF metre is honoured). One authored in the wrong unit (a 2 mm or a
 * 40 m longest side) is brought to AR_DEFAULT_LONGEST_SIDE_M.
 *
 * @param {{ x: number, y: number, z: number }} size  bounding-box size in metres
 */
export function arPlacementScale(size) {
	const longest = Math.max(Number(size?.x) || 0, Number(size?.y) || 0, Number(size?.z) || 0);
	if (!(longest > 0)) return 1;
	if (longest >= AR_MIN_SANE_SIDE_M && longest <= AR_MAX_SANE_SIDE_M) return 1;
	return AR_DEFAULT_LONGEST_SIDE_M / longest;
}

/** "1.0 × 0.6 × 0.5 m" (width × height × depth) for a size in metres after scaling. */
export function formatDimensions(size, scale = 1) {
	const f = (v) => {
		const m = (Number(v) || 0) * scale;
		return m >= 1 ? m.toFixed(1) : m.toFixed(2);
	};
	return `${f(size?.x)} × ${f(size?.y)} × ${f(size?.z)} m`;
}

/**
 * The single message a phone should see about AR, or null when it can just
 * launch. Copy says what to do next, never only what failed.
 *
 * @param {ReturnType<typeof detectArDevice>} device
 * @param {{ canActivateAR?: boolean|null, weight?: ReturnType<typeof arWeight> }} state
 *   canActivateAR null means the viewer has not decided yet.
 * @returns {{ kind: string, title: string, body: string } | null}
 */
export function arNotice(device, { canActivateAR = null, weight = 'unknown' } = {}) {
	if (device.inApp) {
		const browser = device.os === 'ios' ? 'Safari' : 'Chrome';
		return {
			kind: 'in-app',
			title: `AR doesn't open inside ${device.inApp}`,
			body: `Open this page in ${browser} to place the model in your room: use the menu (⋯) and choose "Open in ${browser}", or copy the link below.`,
		};
	}
	if (device.os === 'desktop') {
		return {
			kind: 'desktop',
			title: 'AR runs on your phone',
			body: 'Scan the code with your phone camera. It opens this model ready to place in your room.',
		};
	}
	if (device.os === 'ios' && device.iosMajor != null && device.iosMajor < 12) {
		return {
			kind: 'old-ios',
			title: 'This iPhone is too old for AR',
			body: 'Apple Quick Look needs iOS 12 or newer. You can still spin the model here, or open the link on a newer iPhone or iPad.',
		};
	}
	if (canActivateAR === false) {
		return device.os === 'android'
			? {
					kind: 'no-ar',
					title: "This phone can't open AR",
					body: 'Placing models needs Chrome with Google Play Services for AR (ARCore). Update Chrome and the Google app, or open the link on another phone. The 3D view above still works.',
				}
			: {
					kind: 'no-ar',
					title: "This browser can't open AR",
					body: 'Open this page in Safari on iPhone or iPad (iOS 12 or newer) to place the model in your room. The 3D view above still works.',
				};
	}
	if (weight === 'over' && device.os === 'android') {
		return {
			kind: 'heavy',
			title: 'Large model',
			body: "This file is over the 15 MB that Google's Scene Viewer accepts. Chrome's built-in AR still opens it; if AR does not start, use Wi-Fi and try Chrome, or download the GLB.",
		};
	}
	if (weight === 'over' || weight === 'heavy') {
		return {
			kind: 'heavy',
			title: 'Large model',
			body: 'This file is big, so it can take a while on mobile data. Wi-Fi helps.',
		};
	}
	return null;
}
