// HTTP security headers that have to hold on every response, whichever server
// answers it.
//
// The route table (vercel.json) declares the headers. Two things it cannot do
// on its own live here:
//
//   1. Keep X-Frame-Options consistent with the CSP. The catch-all route sends
//      `X-Frame-Options: SAMEORIGIN` for scanners and for browsers too old to
//      read `frame-ancestors`, but 22 routes (widgets, embeds, /a/*) override
//      the CSP with `frame-ancestors *` because embedding them anywhere is the
//      product. Route headers can only add, never remove, so without this those
//      pages would carry a header that tells legacy browsers to refuse the very
//      embed the CSP allows. `reconcileFrameOptions` drops it there, and drops
//      the non-standard `ALLOWALL` value wherever a handler set it.
//
//   2. Give the Vite dev server the same headers production sends. It served
//      none at all, so a header regression could only be seen after a deploy.
//      `devSecurityHeadersMiddleware` applies the route table's security headers
//      through the server's own resolver, not a second copy of the rules.

import { resolvePhase1 } from './route-resolve.mjs';

/** The headers this module and scripts/audit-security-headers.mjs are about. */
export const SECURITY_HEADERS = [
	'strict-transport-security',
	'content-security-policy',
	'content-security-policy-report-only',
	'x-content-type-options',
	'x-frame-options',
	'x-xss-protection',
	'referrer-policy',
	'permissions-policy',
];

/** The `frame-ancestors` sources of a CSP value, or null when it sets none. */
export function frameAncestors(csp) {
	if (!csp) return null;
	for (const chunk of String(csp).split(';')) {
		const parts = chunk.trim().split(/\s+/).filter(Boolean);
		if (parts[0] && parts[0].toLowerCase() === 'frame-ancestors') return parts.slice(1);
	}
	return null;
}

/**
 * The X-Frame-Options value a response should carry given its CSP, or null to
 * send none. A policy that lets any origin frame the page gets no
 * X-Frame-Options: there is no standard value for "anyone", and a legacy
 * browser honouring SAMEORIGIN would break the embed. Everything else keeps
 * what it was given, except the invalid `ALLOWALL`, which browsers ignore and
 * scanners flag.
 */
export function frameOptionsFor(csp, current) {
	const sources = frameAncestors(csp);
	if (sources && sources.includes('*')) return null;
	if (current == null) return null;
	const value = String(current).trim();
	if (!value || value.toUpperCase() === 'ALLOWALL') return null;
	return value;
}

/** Apply `frameOptionsFor` to a Node response, just before its headers go out. */
export function reconcileFrameOptions(res) {
	const want = frameOptionsFor(res.getHeader('content-security-policy'), res.getHeader('x-frame-options'));
	if (want === null) res.removeHeader('x-frame-options');
	else res.setHeader('x-frame-options', want);
}

/**
 * Run `reconcileFrameOptions` on every response at the last moment, after the
 * route table, the static file server and any API handler have all set their
 * headers. Express and plain handlers both end in `writeHead`, and a response
 * that writes without calling it (implicit headers) still goes through it.
 */
export function frameOptionsMiddleware() {
	return (req, res, next) => {
		const writeHead = res.writeHead;
		res.writeHead = function patchedWriteHead(...args) {
			if (!res.headersSent) reconcileFrameOptions(res);
			return writeHead.apply(this, args);
		};
		next();
	};
}

/** The security subset of a route header bag, keyed lowercase. */
export function pickSecurityHeaders(bag) {
	const out = {};
	for (const [k, v] of Object.entries(bag || {})) {
		const key = k.toLowerCase();
		if (SECURITY_HEADERS.includes(key)) out[key] = v;
	}
	return out;
}

/**
 * Vite dev middleware: set the route table's security headers on every
 * response before Vite or a dev API handler writes it. Handlers can still
 * override a header, as they can in production. `getTable` returns the
 * compiled route table (server/dev-api-pages.mjs `liveRouteTable`), so an edit
 * to vercel.json applies on the next request.
 */
export function devSecurityHeadersMiddleware(getTable) {
	const reconcile = frameOptionsMiddleware();
	return (req, res, next) => {
		let url;
		try {
			url = new URL(req.url || '/', 'http://dev.local');
		} catch {
			next();
			return;
		}
		const { headers } = resolvePhase1(getTable().phase1Routes, req, url);
		for (const [k, v] of Object.entries(pickSecurityHeaders(headers))) res.setHeader(k, v);
		reconcile(req, res, next);
	};
}
