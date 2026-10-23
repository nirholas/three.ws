// Configuration for an AR Studio instance.
//
// Everything the studio talks to is a URL, and every URL is overridable: that
// is the whole point of this package. Drop it on your site and it pulls models
// from three.ws by default; point `assets` at your own manifest (or pass your
// own source objects) and it pulls from you instead, with no other change.
//
// Three layers, later wins:
//   1. DEFAULTS below.
//   2. The options object passed to createArStudio() / the <ar-studio> element.
//   3. URL parameters on the hosting page, when `allowUrlOverride` is on:
//      ?assets=<https manifest url>   swap the catalogue
//      ?src=<glb>&title=<name>        deep-link models into the scene (repeatable)
//      ?room=<code>                   join a shared room
//      ?forge=<prompt>                start a generation on load
//
// URL overrides are untrusted input. `assets` is accepted only as an https URL
// and every model source it yields is re-validated by normalizeGlbUrl() before
// it can reach the loader, so a hostile link can add a catalogue but can never
// smuggle a `javascript:` or `data:` model into the scene.

/** The public three.ws surfaces this package uses by default. All keyless, all CORS-open. */
export const THREE_WS = {
	origin: 'https://three.ws',
	/** CC0 prop library (Poly Haven), served first-party with open CORS. */
	objectsManifest: 'https://three.ws/cdn/objects/library/manifest.json',
	/** The free, keyless 3D Studio MCP endpoint: the ChatGPT 3D Studio pipeline. */
	studioMcp: 'https://three.ws/api/mcp-studio',
	/** Pre-baked animation clips used to idle any humanoid rig. */
	animationManifest: 'https://three.ws/animations/manifest.json',
	/** Curated CC0 HDRIs for image-based lighting. */
	hdri: {
		studio: 'https://three.ws/hdri/studio.hdr',
		outdoor: 'https://three.ws/hdri/outdoor.hdr',
		sunset: 'https://three.ws/hdri/sunset.hdr',
	},
	/** Device-aware "View in your space" launcher (iOS Quick Look / Android Scene Viewer). */
	arLaunch: 'https://three.ws/api/ar',
	/** Colyseus host behind shared rooms. */
	roomServer: 'wss://three-ws-multiplayer-93741856042.us-central1.run.app',
};

export const DEFAULTS = {
	/** Catalogue(s) the "Add" tray offers. See src/sources/index.js for the accepted shapes. */
	assets: 'three.ws',
	/** Honour ?assets= / ?src= / ?room= / ?forge= on the hosting page's URL. */
	allowUrlOverride: true,
	/** Text-to-3D generation from inside the camera view. */
	generate: {
		enabled: true,
		endpoint: THREE_WS.studioMcp,
		/** 'model' (forge_free) or 'avatar' (text_to_avatar: rigged, walks and idles). */
		kind: 'model',
		tier: 'standard',
		/** Give up on a single generation after this long. */
		timeoutMs: 300000,
		pollMs: 3000,
	},
	/** Live collaborative rooms. Set `enabled: false` to hide the Share-live control. */
	rooms: {
		enabled: true,
		server: THREE_WS.roomServer,
	},
	/** Idle animation for humanoid models with no baked clips. */
	animations: {
		enabled: true,
		manifestUrl: THREE_WS.animationManifest,
		clip: 'idle',
	},
	/** Image-based lighting. `preset` picks from `urls`; null disables the HDRI fetch. */
	lighting: {
		preset: 'studio',
		urls: THREE_WS.hdri,
	},
	/** "View in your space" hand-off for a single model (native AR viewers). */
	arLaunchUrl: THREE_WS.arLaunch,
	/** Chrome. `backHref: null` hides the back button entirely. */
	branding: {
		title: 'AR Studio',
		backHref: null,
		backLabel: 'Back',
		accent: '#8b7cf8',
	},
	/** Base URL that share links + QR codes point at. Defaults to the page itself. */
	shareBaseUrl: '',
	/** localStorage key for the persisted scene. Change it to run two studios on one origin. */
	persistKey: 'ar-studio:scene:v1',
	/** Cap on simultaneous placements. Keeps low-end phones interactive. */
	maxPlacements: 20,
	/** Restore the last scene on load. */
	persist: true,
	/** Analytics/telemetry hook: called with (event, detail) for every notable action. */
	onEvent: null,
};

function isPlainObject(v) {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge `patch` onto `base` without mutating either. Arrays and class instances replace. */
export function mergeConfig(base, patch) {
	if (!isPlainObject(patch)) return base;
	const out = { ...base };
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) continue;
		out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? mergeConfig(base[k], v) : v;
	}
	return out;
}

/** Accept an https URL (or a same-origin relative path) from untrusted input. */
export function safeUrl(raw) {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	if (s.startsWith('/') && !s.startsWith('//')) return s;
	try {
		const u = new URL(s);
		return u.protocol === 'https:' ? u.href : null;
	} catch {
		return null;
	}
}

/**
 * Resolve the effective config: defaults ← options ← URL parameters.
 *
 * @param {object} [options]
 * @param {URLSearchParams|string} [search] Page query string (defaults to location.search).
 * @returns {object} config, plus `urlModels` / `urlRoom` / `urlPrompt` read from the URL.
 */
export function resolveConfig(options = {}, search) {
	const cfg = mergeConfig(DEFAULTS, options);
	const params = search instanceof URLSearchParams
		? search
		: new URLSearchParams(
			typeof search === 'string'
				? search
				: (typeof location !== 'undefined' ? location.search : ''),
		);

	const urlModels = [];
	let urlRoom = '';
	let urlPrompt = '';

	if (cfg.allowUrlOverride) {
		const assets = params.get('assets') || params.get('source');
		const assetsUrl = assets ? safeUrl(assets) : null;
		if (assetsUrl) cfg.assets = assetsUrl;

		const srcs = params.getAll('src');
		const titles = params.getAll('title');
		for (let i = 0; i < srcs.length && urlModels.length < cfg.maxPlacements; i++) {
			const src = safeUrl(srcs[i]);
			if (src) urlModels.push({ src, title: String(titles[i] || '').slice(0, 120) });
		}
		urlRoom = String(params.get('room') || '').trim();
		urlPrompt = String(params.get('forge') || params.get('prompt') || '').trim();
	}

	if (!cfg.shareBaseUrl && typeof location !== 'undefined') {
		cfg.shareBaseUrl = `${location.origin}${location.pathname}`;
	}

	return { ...cfg, urlModels, urlRoom, urlPrompt };
}
