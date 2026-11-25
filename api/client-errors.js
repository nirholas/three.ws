// @ts-check
// Ingest endpoint for first-party client-side error reports sent by
// public/error-reporter.js (loaded on every page). Each accepted event is
// logged as one structured "[client-error]" line so browser errors from real
// users are searchable in the Vercel function logs (and any attached log
// drain), and JS errors are forwarded to Sentry when SENTRY_DSN is set.
//
// The client batches, dedupes, and hard-caps per page; this side re-validates
// and re-truncates everything anyway — the payload is attacker-controllable
// public input, so nothing from it is trusted or echoed back.

import { cors, json, method, readJson, readBody, wrap, error, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { captureException } from './_lib/sentry.js';
import { sendOpsAlert } from './_lib/alerts.js';

const MAX_EVENTS_PER_BATCH = 25;
const EVENT_TYPES = new Set(['error', 'unhandledrejection', 'resource', 'manual', 'csp']);
const LIMITS = { message: 500, stack: 4000, url: 500, name: 100, tag: 20 };

function str(value, max) {
	if (typeof value !== 'string' || !value) return undefined;
	return value.length > max ? `${value.slice(0, max)}…` : value;
}

function int(value) {
	return Number.isFinite(value) ? Math.trunc(value) : undefined;
}

// Reports whose page lives on a local dev / sandbox / private-LAN origin are
// tooling noise — failed Vite HMR sockets, headless-audit rejections, localhost
// favicon/glb 404s — and they are indistinguishable from real incidents once
// they hit the prod function logs. The client reporter (public/error-reporter.js)
// already refuses to send from these origins, but a stale dev server serving an
// older bundle, or a headless audit run, can still POST here. Drop them at the
// boundary so prod logs, Sentry, and ops paging only ever see real-user faults.
function isDevOriginPage(page) {
	if (!page) return false;
	let host;
	try {
		host = new URL(page).hostname;
	} catch {
		return false;
	}
	return (
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '0.0.0.0' ||
		host === '[::1]' ||
		host === '::1' ||
		host.endsWith('.local') ||
		host.endsWith('.app.github.dev') || // GitHub Codespaces forwarded ports
		host.endsWith('.gitpod.io') ||
		host.endsWith('.csb.app') ||
		/^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host) // private LAN
	);
}

// Bridge globals that mobile in-app browsers and browser extensions inject into
// every page they wrap (Twitter/X, Chrome iOS, Firefox iOS, the Bing app, …).
// Our code never references any of them, so a "Can't find variable: currentInset"
// is the injected bridge script failing in the page context — not a three.ws
// fault. Documented webview/extension globals only, matched as whole words.
const INJECTED_GLOBALS =
	/\b(currentInset|gCrWeb|__gCrWeb|__firefox__|_AutofillCallbackHandler|instantSearchSDKJSBridgeClearHighlight|webkitStorageInfo|bannerNight|ceCurrentVideo|isHighlightingEnabled|zaloJSV2|MyAppGetLinkProperties)\b/;

// "Read property `prop` of null/undefined" in both WebKit and Chromium phrasings.
// Capture group 1 (WebKit) or 2 (Chromium) is the dereferenced property name.
const PROP_ACCESS_TYPEERROR =
	/(?:undefined|null) is not an object \(evaluating '[^']*\.([A-Za-z_$][\w$]*)'\)|cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([A-Za-z_$][\w$]*)'\)/i;

// Errors that originate outside our code and are never actionable from a deploy.
// Dropping them at the boundary keeps the prod error logs, Sentry, and ops paging
// focused on genuine first-party faults. Clients running a freshly-cached
// error-reporter.js already filter these locally; this is the server-side
// backstop for the long tail of clients holding an older cached reporter.
// Crawlers and headless renderers that announce themselves. Real crawler UAs
// carry a "(compatible; Name/x.y; +url)" token or a headless marker; matching
// those instead of a bare "bot" keeps phones like "CUBOT KINGKONG" reporting.
const CRAWLER_UA =
	/\(compatible;[^)]*(?:bot|spider|crawler|slurp)\b|\bHeadlessChrome\/|\b(?:Baiduspider|Bytespider|bingbot|Googlebot|YandexBot|Applebot|PetalBot|DuckDuckBot|GPTBot|ClaudeBot|AhrefsBot|SemrushBot)\b|\bChrome-Lighthouse\b/i;

// A resource-load failure reported from a crawler is the crawler's own
// resource policy (renderers routinely refuse images, fonts and preloads to
// save bandwidth), not a missing asset: on 2026-11-25 nearly every "failed to
// load" line came from bots while every asset they named served 200. JS errors
// still report, since a renderer that runs our code can hit a real bug, and so
// does a failure the client already confirmed is a real HTTP error (`status`).
export function isCrawlerResourceNoise(event, ua) {
	if (event.type !== 'resource' || Number.isFinite(event.status)) return false;
	return typeof ua === 'string' && CRAWLER_UA.test(ua);
}

export function isNonActionableNoise(event) {
	if (event.type !== 'error' && event.type !== 'unhandledrejection') return false;
	const msg = event.message || '';
	// Safari-masked injected-script frames. Safari rewrites the URL of scripts it
	// deems privacy-sensitive — content-blocker/extension-injected scripts, and some
	// blob:/eval contexts — to the synthetic `webkit-masked-url://hidden/` scheme.
	// Our own same-origin modules are served from normal https URLs and never masked,
	// so an error whose only frame is a masked URL comes from an injected third-party
	// script (e.g. a cashback/shopping extension's `onResponse` handler throwing
	// "undefined is not an object (evaluating 'response.cashbackReminder')") — unfixable
	// from our deploy. Mirrors public/error-reporter.js; catches clients still holding
	// an older cached reporter that lacks the client-side filter.
	if (/webkit-masked-url:\/\//.test(event.stack || '') || /webkit-masked-url:\/\//.test(event.source || '')) {
		return true;
	}
	// Cross-origin "Script error." — the browser strips every detail (stack,
	// file, line) from an exception thrown by a script served without CORS
	// headers, leaving nothing to act on.
	if (/^Script error\.?$/.test(msg)) return true;
	// AbortError — a deliberate fetch/navigation cancellation (AbortController
	// or a superseded in-flight request), not a failure.
	if (event.name === 'AbortError' || /\bfetch is aborted\b|\bthe operation was aborted\b/i.test(msg)) {
		return true;
	}
	// Injected wallet-provider (window.ethereum / injected Solana) RPC errors and
	// user-cancellations. An injected EVM provider rejects window.ethereum.request()
	// with EIP-1474 "Internal JSON-RPC error." when its upstream node errors, or with
	// a user-cancellation string when the popup is dismissed — both thrown as a plain
	// object (name "Object"), not an Error. No first-party three.ws code produces
	// these strings; the wallet extension owns the transport, so they are unfixable
	// from our deploy and only reach us from pages that co-exist with a wallet
	// extension (e.g. /trending). Matched exactly so a genuine fault never collides.
	// Mirrors public/error-reporter.js WALLET_RPC_NOISE_RE.
	if (
		/^Internal JSON-RPC error\.?$/i.test(msg) ||
		/^User rejected( the)? request/i.test(msg) ||
		/^User denied /i.test(msg) ||
		/^Already processing eth_requestAccounts/i.test(msg) ||
		/^Request of type 'wallet_/i.test(msg)
	) {
		return true;
	}
	// A ReferenceError naming a known injected bridge global — their script, not ours.
	if (/can't find variable:|is not defined/i.test(msg) && INJECTED_GLOBALS.test(msg)) return true;
	// Property-access TypeErrors from extension/wallet-injected page scripts. These
	// run in the page context (page-origin/anonymous stack), so they evade the
	// extension-source filters in the client reporter and reach us from clients
	// holding an older cached reporter. `hideIndicator` is a symbol no first-party
	// or bundled code defines — any "<x>.hideIndicator" throw is injected noise.
	// `colorSpace` is a real three.js symbol we use, but only ever off a non-null
	// target; a stackless "reading 'colorSpace' of null" is an unattributable
	// cross-realm/injected read, while a genuine three-core fault keeps its
	// first-party stack and still reports. Mirrors public/error-reporter.js.
	const prop = (() => {
		const m = PROP_ACCESS_TYPEERROR.exec(msg);
		return m ? m[1] || m[2] : null;
	})();
	if (prop) {
		if (/\bhideIndicator\b/.test(prop)) return true;
		if (prop === 'colorSpace' && !event.stack) return true;
	}
	return false;
}

// Map both CSP report wire formats onto our event shape:
//   report-uri:  { "csp-report": { "violated-directive", "blocked-uri", ... } }
//   report-to:   [ { type: "csp-violation", body: { effectiveDirective, blockedURL, ... } } ]
function cspToEvents(raw) {
	const reports = Array.isArray(raw) ? raw.map((r) => r?.body || r) : [raw?.['csp-report'] || raw];
	return reports.filter(Boolean).map((r) => ({
		type: 'csp',
		message: `CSP violation: ${r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || r.violatedDirective || 'unknown directive'}`,
		source: r['blocked-uri'] || r.blockedURL || r['document-uri'] || r.documentURL,
		line: r['line-number'] ?? r.lineNumber,
		col: r['column-number'] ?? r.columnNumber,
	}));
}

function sanitizeEvent(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const type = EVENT_TYPES.has(raw.type) ? raw.type : null;
	const message = str(raw.message, LIMITS.message);
	if (!type || !message) return null;
	return {
		type,
		name: str(raw.name, LIMITS.name),
		message,
		source: str(raw.source, LIMITS.url),
		line: int(raw.line),
		col: int(raw.col),
		stack: str(raw.stack, LIMITS.stack),
		tag: str(raw.tag, LIMITS.tag),
		ts: int(raw.ts),
		// HTTP status the client got when it re-checked a failed same-origin
		// resource (public/error-reporter.js verifyResource). Only a real error
		// status is ever sent, so anything outside 400-599 is discarded.
		status: int(raw.status) >= 400 && int(raw.status) <= 599 ? int(raw.status) : undefined,
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.clientErrorsIp(ip);
	if (!rl.success) return rateLimited(res, rl);

	// Browsers POST CSP violations (the `report-uri` directive in vercel.json's
	// CSP headers) with their own content types and shapes; normalize them into
	// the same event stream so blocked injections and broken third-party embeds
	// show up next to JS errors in the logs.
	const contentType = req.headers['content-type'] || '';
	const isCspReport =
		contentType.includes('application/csp-report') ||
		contentType.includes('application/reports+json');

	let body;
	try {
		if (isCspReport) {
			const raw = JSON.parse((await readBody(req, 64_000)).toString('utf8'));
			body = { events: cspToEvents(raw) };
		} else {
			body = await readJson(req, 64_000);
		}
	} catch (err) {
		return error(res, err.status || 400, 'validation_error', err.message || 'invalid body');
	}

	const rawEvents = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
	const events = rawEvents.map(sanitizeEvent).filter(Boolean);
	if (!events.length) return error(res, 400, 'validation_error', 'events array required');

	const page = str(body?.page, LIMITS.url);

	// Acknowledge dev/sandbox-origin batches without logging them. Returning 202
	// (not an error) keeps a stale client from retrying; the events simply never
	// pollute the prod logs / Sentry / ops channel.
	if (isDevOriginPage(page)) return json(res, 202, { received: 0, dropped: events.length });

	const context = {
		page,
		referrer: str(body?.referrer, LIMITS.url),
		viewport:
			body?.viewport && typeof body.viewport === 'object'
				? { w: int(body.viewport.w), h: int(body.viewport.h) }
				: undefined,
		ua: str(req.headers['user-agent'], 300),
		ip,
	};

	let dropped = 0;
	for (const event of events) {
		// Third-party / injected / cancellation noise never reaches the logs,
		// Sentry, or the ops channel — see isNonActionableNoise.
		if (isNonActionableNoise(event) || isCrawlerResourceNoise(event, context.ua)) {
			dropped++;
			continue;
		}
		// Resource load failures (a CDN blip, an offline mobile network, a
		// third-party embed like Cloudflare Turnstile being briefly unreachable)
		// and CSP reports (browser extensions trip these constantly) are client-side
		// telemetry, not server faults — nothing in our deploy is broken when they
		// fire. Log them at info so the error/warning dashboards stay actionable;
		// they remain searchable as "[client-error]" + type. Genuine JS faults keep
		// error severity. One line per event keeps Vercel log search precise.
		const telemetryOnly = event.type === 'resource' || event.type === 'csp';
		const line = JSON.stringify({ ...event, ...context });
		if (telemetryOnly) console.info('[client-error]', line);
		else console.error('[client-error]', line);

		// Real JS errors carry their original browser stack into Sentry and page the
		// ops channel (sendOpsAlert dedups per message per hour); telemetry does not.
		if (!telemetryOnly) {
			const synthetic = new Error(event.message);
			synthetic.name = event.name || `client.${event.type}`;
			if (event.stack) synthetic.stack = event.stack;
			captureException(synthetic, {
				origin: 'client',
				page: context.page,
				source: event.source,
				line: event.line,
				col: event.col,
				ua: context.ua,
			});
			sendOpsAlert(
				`client ${event.type} on ${context.page || 'unknown page'}`,
				`${event.name ? `${event.name}: ` : ''}${event.message}${event.source ? `\n${event.source}:${event.line ?? '?'}` : ''}`,
				{ signature: `client:${event.type}:${event.message}:${event.source}` },
			);
		}
	}

	return json(res, 202, { received: events.length - dropped, dropped });
});
