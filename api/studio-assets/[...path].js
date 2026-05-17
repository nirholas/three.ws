// GET /api/studio-assets/<path> — three.ws-origin proxy for the studio's
// VRM trait library. Mirrors the upstream loot-assets CDN under our domain
// so the studio iframe and the user's browser never hit a vendor origin.
//
// JSON manifests are rewritten on the fly so embedded `assetsLocation` and
// any absolute upstream URLs route back through this proxy. Binary assets
// (VRM, FBX, PNG, GLB, KTX2, etc.) stream through unchanged.
//
// Cache for 1 day at the edge / 7 days in the browser. The upstream content
// is immutable per path so long TTLs are safe.

import { cors, error, wrap } from '../_lib/http.js';

const UPSTREAM_BASE = 'https://m3-org.github.io/loot-assets/';
const PROXY_PREFIX = '/api/studio-assets/';

const TEXT_TYPES = new Set([
	'application/json',
	'application/manifest+json',
	'text/json',
	'text/plain',
]);

// Whitelist of upstream prefixes we're willing to mirror. Anything else gets
// a 404 — prevents this endpoint from being abused as an open proxy.
const ALLOWED_PREFIXES = [
	'anata/',
	'0N1/',
	'tubbycats/',
	'animations/',
	'loot/',
];

function isAllowed(path) {
	return ALLOWED_PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p));
}

function joinPath(parts) {
	if (Array.isArray(parts)) return parts.join('/');
	return String(parts || '');
}

// Rewrite any absolute upstream URL inside a JSON manifest to a path under
// this proxy. Also rewrites the `assetsLocation` field so that downstream
// asset resolution stays on three.ws origin.
function rewriteJson(text, origin) {
	const upstreamPattern = /https?:\/\/m3-org\.github\.io\/loot-assets\//g;
	return text.replace(upstreamPattern, `${origin}${PROXY_PREFIX}`);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		return error(res, 405, 'method_not_allowed', `method ${req.method} not allowed`);
	}

	const rawPath = joinPath(req.query?.path);
	const path = decodeURIComponent(rawPath).replace(/^\/+/, '');

	if (!path || path.includes('..') || !isAllowed(path)) {
		return error(res, 404, 'not_found', 'asset not in studio mirror whitelist');
	}

	const upstreamUrl = UPSTREAM_BASE + path;
	let upstream;
	try {
		upstream = await fetch(upstreamUrl, { method: req.method, redirect: 'follow' });
	} catch (err) {
		return error(res, 502, 'upstream_unreachable', `mirror fetch failed: ${err?.message}`);
	}

	if (!upstream.ok) {
		return error(res, upstream.status, 'upstream_error', `mirror returned ${upstream.status}`);
	}

	const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
	const baseType = contentType.split(';')[0].trim().toLowerCase();
	const isText = TEXT_TYPES.has(baseType);

	res.setHeader('content-type', contentType);
	res.setHeader('cache-control', 'public, max-age=604800, s-maxage=86400, stale-while-revalidate=86400');
	res.setHeader('access-control-allow-origin', '*');

	if (req.method === 'HEAD') {
		const len = upstream.headers.get('content-length');
		if (len) res.setHeader('content-length', len);
		res.statusCode = 200;
		return res.end();
	}

	if (isText) {
		const text = await upstream.text();
		const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
		const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
		const origin = host ? `${proto}://${host}` : '';
		const rewritten = origin ? rewriteJson(text, origin) : text;
		res.statusCode = 200;
		return res.end(rewritten);
	}

	const buf = Buffer.from(await upstream.arrayBuffer());
	res.statusCode = 200;
	res.end(buf);
});
