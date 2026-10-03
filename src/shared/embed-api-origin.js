// Where an <agent-3d> embed sends its API calls.
//
// The element runs on pages we do not own. A site-absolute path like
// `/api/agents/:id` resolves against the HOST page's origin, so on example.com it
// asks example.com for an agent, gets a 404, and the embed silently falls back to
// a default body named "Agent". Every request the element makes must instead go
// to the three.ws origin it was loaded from, which this module derives once from
// the script's own URL and hands to every caller.
//
// Resolution order (first match wins):
//   1. the `api-base` attribute, for self-hosted backends and local development;
//   2. the origin serving the element's script (three.ws for the CDN embed);
//   3. https://three.ws when that script came from a public npm CDN (unpkg,
//      jsDelivr, ...), which serves files but none of the API;
//   4. the page's own origin, which is only right when the page IS three.ws.

export const DEFAULT_API_ORIGIN = 'https://three.ws';

// Package CDNs that mirror the npm build. They serve the bundle, never /api/*.
const PACKAGE_CDN_HOSTS = new Set([
	'unpkg.com',
	'cdn.jsdelivr.net',
	'fastly.jsdelivr.net',
	'gcore.jsdelivr.net',
	'esm.sh',
	'esm.run',
	'cdn.skypack.dev',
	'ga.jspm.io',
	'jspm.dev',
]);

function parseURL(value, base) {
	try {
		return base ? new URL(value, base) : new URL(value);
	} catch {
		return null;
	}
}

/**
 * The API origin implied by the URL the element's script was loaded from.
 * Returns '' when the URL carries no usable http(s) origin (blob:, data:, a
 * bundler's virtual module), so the caller falls through to the page origin.
 *
 * @param {string} scriptUrl  usually `import.meta.url`
 * @returns {string}
 */
export function apiOriginFromScriptURL(scriptUrl) {
	const url = parseURL(String(scriptUrl || ''));
	if (!url || !/^https?:$/.test(url.protocol)) return '';
	if (PACKAGE_CDN_HOSTS.has(url.hostname.toLowerCase())) return DEFAULT_API_ORIGIN;
	return url.origin;
}

/**
 * Resolve the base URL every API request of one element is built on, without a
 * trailing slash, so callers can write `${base}/api/...`.
 *
 * @param {{ attr?: string|null, scriptOrigin?: string, pageOrigin?: string }} opts
 * @returns {string}
 */
export function resolveApiBase({ attr, scriptOrigin = '', pageOrigin = '' } = {}) {
	const raw = typeof attr === 'string' ? attr.trim() : '';
	if (raw) {
		const url = parseURL(raw, pageOrigin || undefined);
		if (url && /^https?:$/.test(url.protocol)) {
			return (url.origin + url.pathname).replace(/\/+$/, '');
		}
	}
	return scriptOrigin || pageOrigin || '';
}

/**
 * True when `base` is the page's own origin, i.e. three.ws embedding itself.
 * Only then do the visitor's three.ws cookies belong to the request; anywhere
 * else they are third-party and a credentialed request would also be refused by
 * every public endpoint, which answers anonymous reads with a wildcard origin.
 *
 * @param {string} base
 * @param {string} pageOrigin
 */
export function isPageOrigin(base, pageOrigin) {
	if (!base) return true; // relative URLs resolve against the page
	const url = parseURL(base, pageOrigin || undefined);
	return !!url && url.origin === pageOrigin;
}

/**
 * The fetch `credentials` mode for a request to `base` from `pageOrigin`.
 * @returns {'include'|'omit'}
 */
export function credentialsFor(base, pageOrigin) {
	return isPageOrigin(base, pageOrigin) ? 'include' : 'omit';
}

/**
 * Join an API base and a site-absolute path. An empty base keeps the path
 * relative, which is the same-origin behaviour three.ws's own pages rely on.
 *
 * @param {string} base
 * @param {string} path  must start with '/'
 */
export function apiURL(base, path) {
	return `${base || ''}${path}`;
}
