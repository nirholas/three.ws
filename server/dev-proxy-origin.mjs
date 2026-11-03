// Same-site headers for the Vite dev proxy.
//
// `npm run dev` forwards /api (and the /oauth aliases) to DEV_API_PROXY, the
// production API by default. Same-site guarded endpoints (isSameSiteOrigin in
// api/_lib/auth.js) compare Origin, or Referer when Origin is absent, with the
// API's own origin. The browser sends the dev server's origin, so without this
// every guarded POST made from a dev page answered 403 "cross-site request
// blocked". http-proxy's changeOrigin only rewrites Host.
//
// Only a request that came from the dev server's own page is rewritten. Any
// other origin passes through untouched, so the upstream still refuses a real
// cross-site request exactly as it does in production.

function originOf(value) {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

/**
 * Headers to set on the proxied request so a dev-page request reads as
 * same-site to `upstream`. Returns only the headers that need changing.
 *
 * @param {{ host?: string, origin?: string, referer?: string }} headers incoming request headers
 * @param {string} upstream the proxy target, e.g. https://three.ws
 * @returns {{ origin?: string, referer?: string }}
 */
export function upstreamSameSiteHeaders(headers, upstream) {
	const out = {};
	const host = headers.host;
	const target = originOf(upstream);
	if (!host || !target) return out;
	const own = (value) => {
		const origin = originOf(value);
		return origin !== null && new URL(origin).host === host ? origin : null;
	};
	if (headers.origin && own(headers.origin)) out.origin = target;
	if (headers.referer) {
		const origin = own(headers.referer);
		if (origin) out.referer = target + headers.referer.slice(origin.length);
	}
	return out;
}

/** Wire upstreamSameSiteHeaders onto an http-proxy instance. */
export function presentDevRequestsAsSameSite(proxy, upstream) {
	proxy.on('proxyReq', (proxyReq, req) => {
		for (const [name, value] of Object.entries(upstreamSameSiteHeaders(req.headers || {}, upstream))) {
			proxyReq.setHeader(name, value);
		}
	});
}
