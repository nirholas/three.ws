// @ts-check
// First-party client-side error reporting. Captures uncaught exceptions,
// unhandled promise rejections, and failed resource loads on every page, then
// batches them to POST /api/client-errors where they land in the Vercel
// function logs (searchable as "[client-error]") and Sentry when configured.
//
// A tiny inline bootstrap (injected by the `client-error-reporter` plugin in
// vite.config.js) installs the window listeners synchronously at the top of
// <head> and queues raw events into window.__threeErrQ; this file loads
// deferred, drains that queue, and takes over the queue's push so nothing
// fired during page load is lost.
//
// Fails silent by design: a reporting pipeline must never become a source of
// errors itself, so every send is fire-and-forget and every handler is
// exception-proof.
(() => {
	'use strict';
	// Untyped view of window for our private globals (__threeErrQ, __threeErrCap)
	// shared with the inline bootstrap injected by vite.config.js.
	const win = /** @type {any} */ (window);
	if (win.__threeErrorReporter) return;
	win.__threeErrorReporter = true;

	// The reporter exists to surface *production* faults. In local dev and sandbox
	// previews (Codespaces, Gitpod, LAN) the Vite dev server proxies every /api/*
	// call straight to production, so a POST here would inject localhost noise —
	// failed Vite HMR sockets, headless-audit rejections — into the prod function
	// logs where it's indistinguishable from real incidents. Disable the whole
	// pipeline on those origins; the browser console already shows dev errors.
	const host = location.hostname;
	const IS_DEV_HOST =
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '0.0.0.0' ||
		host === '[::1]' ||
		host === '::1' ||
		host.endsWith('.local') ||
		host.endsWith('.app.github.dev') || // GitHub Codespaces forwarded ports
		host.endsWith('.gitpod.io') ||
		host.endsWith('.csb.app') ||
		/^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host); // private LAN
	if (IS_DEV_HOST) {
		// Keep the manual hook callable so app code that invokes it never throws.
		win.reportClientError = () => {};
		return;
	}

	const ENDPOINT = '/api/client-errors';
	const MAX_EVENTS_PER_PAGE = 25; // hard cap so an error loop can't flood the API
	const MAX_PER_SIGNATURE = 3; // identical errors beyond this only bump `count`
	const MAX_BATCH = 10; // flush early once this many events are queued
	const FLUSH_DELAY_MS = 3000;
	const LIMITS = { message: 500, stack: 4000, url: 500, name: 100 };

	// Browser-extension frames and well-known benign browser noise. The two
	// ResizeObserver messages are spec-mandated, thrown by the browser itself,
	// and not actionable — every error pipeline ignores them.
	const IGNORED_SOURCES = /^(chrome|moz|safari|safari-web)-extension:/;
	// Safari masks the URL of scripts it deems privacy-sensitive — content-blocker
	// and browser-extension injected scripts, and some blob:/eval contexts — behind
	// the synthetic `webkit-masked-url://hidden/` scheme. Our own same-origin modules
	// are served from normal https URLs and are never masked, so an error whose only
	// attributable frame is a masked URL comes from an injected third-party script,
	// not three.ws (e.g. a cashback/shopping extension's `onResponse` handler throwing
	// "undefined is not an object (evaluating 'response.cashbackReminder')"). Unfixable
	// from our deploy and pure log noise — drop it. Matched on the stack in shouldIgnore.
	const IGNORED_MASKED_URL = /webkit-masked-url:\/\//;
	const IGNORED_MESSAGES = [
		'ResizeObserver loop limit exceeded',
		'ResizeObserver loop completed with undelivered notifications.',
	];
	// WebGL-context failures — the typed signal our guarded renderer factory throws
	// (`webgl_unavailable`) and three.js's raw constructor throw. Either way the
	// device simply can't do WebGL; the surface shows a fallback, so it's noise.
	const IGNORED_WEBGL = /\bwebgl_unavailable\b|Error creating WebGL context/i;
	// Analytics/telemetry endpoints that privacy extensions (uBlock, Brave,
	// Ghostery…) routinely block. A blocked tracker is the client's choice, not
	// a site fault — the underlying SDKs degrade silently, so the only artifact
	// is a noisy "failed to load script" we don't want flooding the logs.
	const IGNORED_RESOURCE_SOURCES =
		/\/_vercel\/(insights|speed-insights)\/|\/ingest\/|\.i\.posthog\.com\//;
	// Exceptions thrown *inside* third-party CDN libraries we load but don't
	// control. model-viewer (served from jsdelivr, cdnjs or unpkg) throws internally
	// when the browser can't give it a WebGL context — context budget exhausted,
	// GPU blocklist, headless. It degrades to its poster on its own; the throw is
	// neither our bug nor fixable from here, so it only adds noise. Vercel's
	// insights script likewise throws in stripped-down in-app webviews (e.g.
	// "history.pushState is undefined" inside wallet browsers) — analytics
	// degrading on an exotic UA is not actionable.
	const IGNORED_THIRD_PARTY_CODE =
		/\/(?:ajax\/libs\/model-viewer\/|npm\/@google\/model-viewer@|@google\/model-viewer@)|\/_vercel\/(insights|speed-insights)\/script|\/ingest\/static\/|\.i\.posthog\.com\//;
	// WalletConnect's sign-client (loaded from esm.sh) raises an unhandled rejection
	// — "No matching key. session topic doesn't exist: <hex>" — when a relay event
	// arrives for a session the client has already torn down (the user disconnected,
	// the pairing expired, or a duplicate event replays). It is a benign internal
	// race in the SDK's own event queue, not a three.ws fault and not fixable from
	// app code; the wallet connection still works. Identify it by the SDK in the
	// stack or the distinctive message so it stops flooding [client-error].
	const IGNORED_WALLETCONNECT =
		/@walletconnect\/|\bNo matching key\b|session topic doesn't exist|Record was recently deleted/i;
	// Expiring signed URLs embedded in user-generated feed data: GitHub
	// private-user-images, S3/GCS presigned links, and anything carrying a
	// short-lived JWT/signature. The token lapses on a timer, so the asset 404s
	// through no fault of our code, and the UI already swaps in an onerror
	// fallback tile. These are guaranteed-transient and non-actionable.
	const IGNORED_EPHEMERAL_ASSETS =
		/private-user-images\.githubusercontent\.com|[?&](jwt|X-Amz-Signature|X-Goog-Signature|Expires|Signature)=/i;
	// Vite's HMR client (and React Fast Refresh) raise dev-only rejections such as
	// "WebSocket closed without opened" when the HMR socket can't connect. These
	// only ever occur off a dev build; on the off chance a preview surfaces one,
	// it is tooling noise, never a product fault.
	const IGNORED_DEV_TOOLING = /\/@vite\/client|\/@react-refresh|vite\/dist\/client/;
	// Bridge globals that mobile in-app browsers and browser extensions inject
	// into every page they wrap (Twitter/X, Chrome iOS, Firefox iOS, the Bing
	// app, …). Our code references none of them, so a "Can't find variable:
	// currentInset" is their injected script failing in the page context, not a
	// three.ws fault. Documented webview/extension globals only, whole-word.
	const INJECTED_GLOBALS =
		/\b(currentInset|gCrWeb|__gCrWeb|__firefox__|_AutofillCallbackHandler|instantSearchSDKJSBridgeClearHighlight|webkitStorageInfo|bannerNight|ceCurrentVideo|isHighlightingEnabled|zaloJSV2|MyAppGetLinkProperties)\b/;
	const INJECTED_GLOBAL_ERROR = /can't find variable:|is not defined/i;

	// A bare network-layer fetch failure carries no stack and no source — the
	// browser refuses to attribute it because the failure is in the network, not
	// in any one line of our code. Safari surfaces it as "Load failed", Chrome as
	// "Failed to fetch", Firefox as "NetworkError when attempting to fetch
	// resource". These reach the reporter when a transient GLB/asset fetch on the
	// viewer surface drops or its source URL (e.g. a superseded studio draft GLB)
	// is already gone — a condition the viewer's own LOAD_END error UI already
	// catches and recovers from (`_classifyLoadError` → "Network error…"). Without
	// a stack there is nothing to act on, so a stackless network rejection is
	// double-counted, transient noise. A genuine bug in our own fetch code rejects
	// with a stack (or a descriptive message) and still reports.
	const NETWORK_ERROR_MESSAGE = /^(load failed|failed to fetch|networkerror\b.*|the network connection was lost\.?|cancelled|load cancelled)$/i;
	// Property-access TypeErrors naming a symbol that exists NOWHERE in our code,
	// our bundled dependencies, or any third-party script we load at runtime — so
	// the throw comes from a script a browser extension or in-app wallet browser
	// injected directly into the page context. Those injected scripts run with a
	// page-origin (or anonymous/blob) stack, not a chrome-extension:// one, so they
	// slip past the extension-source filters above and surface as top-ranked
	// unhandledrejections that no three.ws deploy can fix.
	//   • `hideIndicator` — a loading-overlay teardown method from an injected
	//     extension overlay ("undefined is not an object (evaluating
	//     'e.hideIndicator')"). We define no such symbol anywhere; verified by an
	//     exhaustive grep of src/, public/, the lib bundle, node_modules, and every
	//     CDN script the pages load.
	// Whole-word match so a genuine first-party method is never swallowed.
	const INJECTED_OVERLAY_SYMBOL = /\bhideIndicator\b/;
	// Injected wallet-provider (window.ethereum / injected Solana) errors. An
	// injected EVM provider rejects window.ethereum.request(...) with EIP-1474
	// "Internal JSON-RPC error." when its upstream node errors, and rejects with a
	// user-cancellation string when the user dismisses the wallet popup — both as a
	// plain object (caught name "Object"), not an Error. None of these strings are
	// produced by any first-party three.ws code: the wallet extension owns the
	// transport. They reach us from pages that merely co-exist with a wallet
	// extension (e.g. /trending) and are unfixable from our deploy. Match the
	// canonical messages exactly so a genuine first-party error can never collide.
	const WALLET_RPC_NOISE =
		/^Internal JSON-RPC error\.?$/i.source +
		'|^User rejected( the)? request' +
		'|^User denied ' +
		'|^Already processing eth_requestAccounts' +
		'|^Request of type \'wallet_';
	const WALLET_RPC_NOISE_RE = new RegExp(WALLET_RPC_NOISE, 'i');
	// WebKit and Chromium phrasings for "read property `prop` of null/undefined".
	// Capture group 1 is the property name in both engines.
	const PROP_ACCESS_TYPEERROR =
		/(?:undefined|null) is not an object \(evaluating '[^']*\.([A-Za-z_$][\w$]*)'\)|cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([A-Za-z_$][\w$]*)'\)/i;

	const truncate = (value, max) => {
		if (typeof value !== 'string' || !value) return undefined;
		return value.length > max ? `${value.slice(0, max)}…` : value;
	};

	const signatures = new Map(); // signature → report (so repeats bump count)
	let totalAccepted = 0;
	let queue = [];
	let flushTimer = null;

	function normalize(raw) {
		if (!raw || typeof raw !== 'object') return null;
		if (raw.type === 'unhandledrejection') {
			const reason = raw.reason;
			const described = describeReason(reason);
			return {
				type: 'unhandledrejection',
				name: described.name,
				message: described.message,
				stack: described.stack,
			};
		}
		if (raw.type === 'error') {
			// Resource load failures (script/img/css 404s) arrive as plain Events
			// on the element, seen only because the bootstrap listens in the
			// capture phase. Uncaught JS errors arrive as ErrorEvents on window.
			const target = raw.target;
			if (target && target !== window && target.nodeName) {
				const url = target.src || target.href;
				if (!url || typeof url !== 'string') return null;
				// The element wires its own onerror handler (gallery posters swap to
				// a gradient tile, avatars fall back to an initial) — the app already
				// owns and recovers from this load failure, so reporting it again as
				// an uncaught resource error is double-counting transient, handled
				// noise. Genuinely unhandled resource 404s still surface.
				if (typeof target.onerror === 'function') return null;
				return {
					type: 'resource',
					tag: target.nodeName.toLowerCase(),
					message: `failed to load ${target.nodeName.toLowerCase()}`,
					source: url,
				};
			}
			if (typeof raw.message !== 'string') return null;
			return {
				type: 'error',
				name: raw.error && raw.error.name,
				message: raw.message,
				source: raw.filename,
				line: raw.lineno,
				col: raw.colno,
				stack: raw.error && raw.error.stack,
			};
		}
		return null;
	}

	function safeStringify(value) {
		try {
			const json = JSON.stringify(value);
			// A real Error (or any object whose useful fields are non-enumerable)
			// serializes to "{}" — a content-free report. Before giving up to
			// `String(value)` (which yields the diagnostically useless "[object
			// Object]"), dig the value's OWN property names — these include the
			// non-enumerable fields JSON.stringify skips, which is exactly where
			// cross-realm Errors, DOMExceptions, and framework error wrappers hide
			// `code`/`status`/`message`. That turns an opaque `[object Object]` into a
			// real signal like `{code:4001,reason:"user rejected"}`.
			if (json == null || json === '{}' || json === 'null') {
				const dug = describeOpaqueObject(value);
				return dug || String(value);
			}
			return json;
		} catch {
			return String(value);
		}
	}

	// Build a `{key:value, …}` summary from an object's own property names,
	// including the non-enumerable ones JSON.stringify ignores. Only primitive
	// values are inlined (a getter that throws, or a nested object/function, is
	// noted by type, never invoked deeply) so this stays exception-proof and
	// bounded. Returns '' when the object genuinely carries nothing useful, so the
	// caller can fall back to its own last resort.
	function describeOpaqueObject(value) {
		if (!value || typeof value !== 'object') return '';
		let names;
		try {
			names = Object.getOwnPropertyNames(value);
		} catch {
			return '';
		}
		const parts = [];
		for (const key of names) {
			if (key === 'stack' || parts.length >= 12) continue; // stack captured separately
			let v;
			try {
				v = value[key]; // may be a throwing getter — guarded
			} catch {
				continue;
			}
			const t = typeof v;
			if (v == null) parts.push(`${key}:${String(v)}`);
			else if (t === 'string') parts.push(`${key}:${v.length > 120 ? v.slice(0, 120) + '…' : v}`);
			else if (t === 'number' || t === 'boolean' || t === 'bigint') parts.push(`${key}:${String(v)}`);
			else if (t === 'object') parts.push(`${key}:[object]`);
			else if (t === 'function') parts.push(`${key}:[function]`);
		}
		if (!parts.length) return '';
		return `{${parts.join(', ')}}`;
	}

	// Extract a useful { name, message, stack } from a rejection reason of ANY
	// shape. A promise can reject with a real Error, an Error thrown across a
	// module/realm boundary (whose `instanceof Error` is false but which still
	// carries `message`/`stack`), a plain object, a DOMException, or a primitive.
	// The old code only special-cased `instanceof Error` and JSON-stringified the
	// rest — so a cross-realm Error or a bare `{}` produced `message: "{}"`, a
	// report with no diagnostic value. Dig out the message before stringifying.
	function describeReason(reason) {
		if (reason instanceof Error) {
			return { name: reason.name, message: reason.message, stack: reason.stack };
		}
		if (typeof reason === 'string') {
			return { name: undefined, message: reason, stack: undefined };
		}
		if (reason && typeof reason === 'object') {
			// Duck-typed / cross-realm errors and common wrapper shapes.
			const name =
				(typeof reason.name === 'string' && reason.name) ||
				(reason.constructor && reason.constructor.name) ||
				undefined;
			let message =
				(typeof reason.message === 'string' && reason.message) ||
				(typeof reason.reason === 'string' && reason.reason) ||
				(reason.error && typeof reason.error.message === 'string' && reason.error.message) ||
				safeStringify(reason);
			// `safeStringify` already digs non-enumerable props, but a genuinely empty
			// object still collapses to the useless "[object Object]". Replace it with a
			// marker that at least names the class and flags the empty shape — far more
			// actionable in [client-error] than a bare "[object Object]".
			if (message === '[object Object]') {
				message = `(${name || 'Object'} thrown with no diagnostic fields)`;
			}
			const stack = typeof reason.stack === 'string' ? reason.stack : undefined;
			return { name, message, stack };
		}
		// Primitive (number, boolean, null, undefined, symbol, bigint).
		return { name: undefined, message: String(reason), stack: undefined };
	}

	function shouldIgnore(report) {
		if (!report.message && !report.source) return true;
		if (report.source && IGNORED_SOURCES.test(report.source)) return true;
		if (report.stack && /\b(chrome|moz|safari|safari-web)-extension:\/\//.test(report.stack)) {
			return true;
		}
		// Safari-masked injected-script frames (extension/content-blocker/blob) — never
		// our same-origin code. Check both stack and source (a masked URL can surface
		// as either), so a cashback/shopping-extension throw stops flooding [client-error].
		if (
			IGNORED_MASKED_URL.test(report.stack || '') ||
			IGNORED_MASKED_URL.test(report.source || '')
		) {
			return true;
		}
		if (report.message && IGNORED_MESSAGES.includes(report.message)) return true;
		// WebGL could not start on this device — no GPU, a blocklisted driver, a
		// headless/automation UA, or (mobile Safari) the per-tab live-context budget
		// already spent. It is a device/browser capability limit, not a site fault:
		// the surface mounts its on-brand "3D unavailable" panel (see
		// src/webgl-support.js) and degrades gracefully. Match both the typed
		// `WebGLUnavailableError` signal the guarded factory throws AND three's raw
		// `Error creating WebGL context.` from any surface still on the bare
		// constructor, so neither floods the logs.
		if (
			IGNORED_WEBGL.test(report.message || '') ||
			report.name === 'WebGLUnavailableError'
		) {
			return true;
		}
		// Cross-origin "Script error." — the browser strips stack/file/line from an
		// exception thrown by a script served without CORS headers, so there is
		// nothing actionable in it. (Same-origin faults always carry a real message.)
		if (report.message && /^Script error\.?$/.test(report.message)) return true;
		// AbortError — a deliberate fetch/navigation cancellation (AbortController
		// or a superseded in-flight request), never a fault.
		if (
			report.name === 'AbortError' ||
			(report.message && /\bfetch is aborted\b|\bthe operation was aborted\b/i.test(report.message))
		) {
			return true;
		}
		// Injected wallet-provider RPC errors and user-cancellations — the wallet
		// extension's transport, never our code (see WALLET_RPC_NOISE_RE).
		if (
			(report.type === 'unhandledrejection' || report.type === 'error' || report.type === 'manual') &&
			report.message &&
			WALLET_RPC_NOISE_RE.test(report.message.trim())
		) {
			return true;
		}
		// A stackless network-layer fetch rejection (Load failed / Failed to fetch /
		// NetworkError) — a user network drop or an expired/deleted asset, not a
		// code fault. No stack means nothing actionable; the viewer surface already
		// shows its designed error state for handled model loads.
		if (
			(report.type === 'unhandledrejection' || report.type === 'manual') &&
			!report.stack &&
			!report.source &&
			report.message &&
			NETWORK_ERROR_MESSAGE.test(report.message.trim())
		) {
			return true;
		}
		// Property-access TypeErrors thrown by extension/wallet-injected page
		// scripts. The symbol `hideIndicator` belongs to no first-party or bundled
		// code, so any error evaluating `<x>.hideIndicator` is injected noise — drop
		// it regardless of stack. `colorSpace` IS a real three.js symbol we use, but
		// our own code only ever reads it off a guaranteed-non-null target (or via
		// `?.`); a stackless "reading 'colorSpace' of null" is therefore an
		// unattributable cross-realm/injected read (e.g. an extension wrapping the
		// page's canvas/ImageData), never our renderer — a genuine three-core fault
		// carries a first-party /assets/* stack and still reports.
		if (report.type === 'unhandledrejection' || report.type === 'error') {
			const m = report.message && PROP_ACCESS_TYPEERROR.exec(report.message);
			const prop = m && (m[1] || m[2]);
			if (prop) {
				if (INJECTED_OVERLAY_SYMBOL.test(prop)) return true;
				if (prop === 'colorSpace' && !report.stack) return true;
			}
		}
		// A promise rejected with a bare DOM Event rather than an Error — the reason
		// IS the event object, so it carries no message and no stack, serializing to
		// just `{"isTrusted":true}` with a constructor name of Event/ErrorEvent/
		// ProgressEvent/etc. This is what surfaces when an element or stream's onerror
		// is wired straight as a promise's reject callback (an <img>/<audio> failing to
		// load, an EventSource/WebSocket erroring): the element owns its own onerror
		// recovery and there is nothing in the event to act on. Guarded by "no stack"
		// and the isTrusted shape so a genuine error that merely happens to be named
		// with an Event suffix still reports.
		if (
			report.type === 'unhandledrejection' &&
			!report.stack &&
			/Event$/.test(report.name || '') &&
			(!report.message || /^\{"isTrusted":(?:true|false)\}$/.test(report.message.trim()))
		) {
			return true;
		}
		// A ReferenceError naming a known injected webview/extension bridge global.
		if (
			report.message &&
			INJECTED_GLOBAL_ERROR.test(report.message) &&
			INJECTED_GLOBALS.test(report.message)
		) {
			return true;
		}
		// Internal failures of a third-party CDN library (identified by the script
		// they originate from, via either the error's source or its stack) are not
		// actionable from our code.
		if (
			IGNORED_THIRD_PARTY_CODE.test(report.source || '') ||
			IGNORED_THIRD_PARTY_CODE.test(report.stack || '')
		) {
			return true;
		}
		// WalletConnect's internal session-key race (matched on message or stack).
		if (
			IGNORED_WALLETCONNECT.test(report.message || '') ||
			IGNORED_WALLETCONNECT.test(report.stack || '')
		) {
			return true;
		}
		// Dev-tooling rejections (Vite HMR / Fast Refresh) — never a product fault.
		if (
			IGNORED_DEV_TOOLING.test(report.source || '') ||
			IGNORED_DEV_TOOLING.test(report.stack || '')
		) {
			return true;
		}
		// A failed service-worker *registration* is a transient network/iOS-Safari
		// hiccup; VitePWA's autoUpdate re-registers on the next visit, so it
		// self-heals — noise, not an actionable fault. iOS Safari surfaces it two
		// ways: "Script …/sw.js load failed" and "Failed to register a
		// ServiceWorker … An unknown error occurred when fetching the script."
		if (
			report.message &&
			(/sw\.js\b[^]*load failed|load failed[^]*\bsw\.js\b/i.test(report.message) ||
				/failed to register a serviceworker/i.test(report.message) ||
				/error occurred when fetching the script/i.test(report.message))
		) {
			return true;
		}
		if (report.type === 'resource' && report.source) {
			// A cross-origin resource that fails to load is outside our control: the
			// Cloudflare Turnstile/CAPTCHA script Privy pulls from
			// challenges.cloudflare.com, a third-party embed, a wallet in-app webview
			// blocking an external host, or a user's network dropping a request to
			// someone else's CDN. We serve our own assets correctly but cannot fix a
			// third party's CDN or a user's blocker, so a cross-origin resource
			// failure is noise, not an actionable site fault. Every first-party asset
			// — including the /cdn proxy — is same-origin, so genuine 404s on our own
			// files (e.g. /three.svg) still report.
			if (isThirdPartyResource(report.source)) return true;
			// A <model-viewer> whose mesh fails to load (slow/aborted GLB fetch
			// under mobile memory or network pressure, a lost WebGL context) fires
			// a resource error but degrades to its poster on its own — the user
			// still sees the model's image. The object itself is served fine (the
			// gallery only lists rows with a stored GLB); this is a transient,
			// self-healing client condition, not a missing asset. Drop the noise.
			if (report.tag === 'model-viewer') return true;
			// Privacy-blocker-killed analytics — expected, not actionable.
			if (IGNORED_RESOURCE_SOURCES.test(report.source)) return true;
			// Expired signed URLs on third-party user-content — transient by design.
			if (IGNORED_EPHEMERAL_ASSETS.test(report.source)) return true;
			// An <img src=""> (or a src that resolves to the page itself) is an
			// element with no real source, not a missing asset. The browser still
			// fires a load error for it; classify it as benign rather than a 404.
			if (isCurrentPage(report.source)) return true;
		}
		return false;
	}

	// True when `url` is the current document URL ignoring the fragment — the
	// resolved value of an element whose src/href attribute is empty.
	function isCurrentPage(url) {
		const strip = (u) => String(u).split('#')[0];
		return strip(url) === strip(location.href);
	}

	// True when a resource URL points at a different origin than the page. Used to
	// drop cross-origin (third-party) resource-load failures we can't act on. An
	// unparseable URL is treated as third-party — it isn't one of our own assets.
	function isThirdPartyResource(url) {
		try {
			return new URL(url, location.href).origin !== location.origin;
		} catch {
			return true;
		}
	}

	function enqueue(report) {
		if (totalAccepted >= MAX_EVENTS_PER_PAGE || shouldIgnore(report)) return;
		const signature = [report.type, report.message, report.source, report.line].join('|');
		const seen = signatures.get(signature);
		if (seen) {
			seen.count += 1;
			if (seen.count > MAX_PER_SIGNATURE) return; // counted, not re-sent
		} else {
			report.count = 1;
			signatures.set(signature, report);
		}
		totalAccepted += 1;
		queue.push({
			type: report.type,
			name: truncate(report.name, LIMITS.name),
			message: truncate(report.message, LIMITS.message),
			source: truncate(report.source, LIMITS.url),
			line: Number.isFinite(report.line) ? report.line : undefined,
			col: Number.isFinite(report.col) ? report.col : undefined,
			stack: truncate(report.stack, LIMITS.stack),
			tag: report.tag,
			ts: Date.now(),
		});
		if (queue.length >= MAX_BATCH) {
			flush();
		} else if (!flushTimer) {
			flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
		}
	}

	function flush() {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (!queue.length) return;
		const payload = JSON.stringify({
			page: truncate(location.href, LIMITS.url),
			referrer: truncate(document.referrer, LIMITS.url) || undefined,
			viewport: { w: window.innerWidth, h: window.innerHeight },
			events: queue,
		});
		queue = [];
		try {
			// sendBeacon survives page unload and never blocks the main thread;
			// keepalive fetch is the fallback for browsers that reject the Blob.
			const blob = new Blob([payload], { type: 'application/json' });
			if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
		} catch {
			/* fall through to fetch */
		}
		try {
			fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: payload,
				keepalive: true,
			}).catch(() => {});
		} catch {
			/* reporting must never throw */
		}
	}

	function handleRaw(raw) {
		try {
			const report = normalize(raw);
			if (report) enqueue(report);
		} catch {
			/* never let the reporter become the error */
		}
	}

	// Drain events the inline bootstrap queued before this file loaded, then
	// take over its queue so the bootstrap's listeners feed us directly.
	const bootQueue = (win.__threeErrQ = win.__threeErrQ || []);
	const backlog = bootQueue.splice(0);
	bootQueue.push = (raw) => {
		handleRaw(raw);
		return 0;
	};
	backlog.forEach(handleRaw);

	// Standalone usage (a page that includes this file without the Vite-injected
	// bootstrap): install the listeners ourselves.
	if (!win.__threeErrCap) {
		win.__threeErrCap = 1;
		window.addEventListener('error', handleRaw, true);
		window.addEventListener('unhandledrejection', handleRaw);
	}

	// Manual reporting hook for app code: window.reportClientError(err, { ...context })
	win.reportClientError = (err, context) => {
		try {
			const described = describeReason(err);
			enqueue({
				type: 'manual',
				name: described.name,
				message: described.message,
				stack: described.stack,
				source: context && typeof context === 'object' ? safeStringify(context) : undefined,
			});
		} catch {
			/* never throw */
		}
	};

	// Ship whatever is still queued when the user leaves the page.
	addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flush();
	});
	addEventListener('pagehide', flush);
})();
