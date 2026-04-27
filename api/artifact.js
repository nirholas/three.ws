// GET /api/artifact?agent=<agentId>  — self-contained HTML for Claude.ai artifacts
// GET /api/artifact?model=<glbUrl>   — viewer-only (no agent overlay)
//
// Returns text/html, not JSON. res.end(html) is intentional here — the "no res.end"
// rule in CLAUDE.md applies to JSON responses; HTML documents are returned raw.

import { sql } from './_lib/db.js';
import { error, wrap } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { env } from './_lib/env.js';

const AGENT_ID_RE = /^[a-z0-9_-]{3,64}$/i;

// Whitelisted origins for ?model= URLs (must be https, must match one of these)
const ALLOWED_MODEL_ORIGINS = [
	/^https:\/\/[^/]+\.r2\.cloudflarestorage\.com$/,
	/^https:\/\/[^/]+\.amazonaws\.com$/,
	/^https:\/\/[^/]+\.cloudfront\.net$/,
	/^https:\/\/storage\.googleapis\.com$/,
	/^https:\/\/[^/]+\.blob\.core\.windows\.net$/,
	/^https:\/\/3dagent\.vercel\.app$/,
	/^https:\/\/[^/]+\.vercel\.app$/,
];

const CSP = [
	"default-src 'self' https://three.ws/",
	"script-src 'self' 'unsafe-inline' https://three.ws/",
	'img-src * data: blob:',
	'connect-src *',
	"style-src 'self' 'unsafe-inline'",
	'frame-ancestors *',
].join('; ');

function validateModelUrl(raw) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:') return null;
	const origin = url.origin;
	if (!ALLOWED_MODEL_ORIGINS.some((pat) => pat.test(origin))) return null;
	return url.toString();
}

function buildHtml({ title, element, appOrigin }) {
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
    <style>html,body{margin:0;height:100%;background:#080814;}agent-3d{display:block;width:100%;height:100%}</style>
  </head>
  <body>
    ${element}
    <script src="${appOrigin}/dist-lib/agent-3d.umd.cjs"></script>
  </body>
</html>`;
}

export default wrap(async (req, res) => {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.setHeader('allow', 'GET, HEAD');
		return error(res, 405, 'method_not_allowed', 'method not allowed');
	}

	const ip = clientIp(req);
	const rl = await limits.widgetRead(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const params = new URL(req.url, 'http://x').searchParams;
	const agentId = params.get('agent');
	const modelUrl = params.get('model');
	const theme = params.get('theme') === 'light' ? 'light' : 'dark';
	const idle = params.get('idle') || '';
	const bg = params.get('bg') || '';

	const appOrigin = env.APP_ORIGIN;

	let html;

	if (agentId !== null) {
		if (!AGENT_ID_RE.test(agentId)) {
			return error(
				res,
				400,
				'invalid_request',
				'agent id must be 3–64 alphanumeric/hyphen/underscore chars',
			);
		}

		const [row] = await sql`
			SELECT id, name FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
		`;
		if (!row) return error(res, 404, 'not_found', 'agent not found');

		const attrs = [
			`agent="${escAttr(row.id)}"`,
			'eager',
			theme === 'light' ? 'theme="light"' : '',
			idle ? `idle="${escAttr(idle)}"` : '',
			bg ? `bg="${escAttr(bg)}"` : '',
		]
			.filter(Boolean)
			.join(' ');

		html = buildHtml({
			title: `${row.name} — three.ws`,
			element: `<agent-3d ${attrs}></agent-3d>`,
			appOrigin,
		});
	} else if (modelUrl !== null) {
		const safeUrl = validateModelUrl(modelUrl);
		if (!safeUrl) {
			return error(
				res,
				400,
				'invalid_request',
				'model must be an https URL from a whitelisted origin',
			);
		}

		const attrs = [
			`src="${escAttr(safeUrl)}"`,
			theme === 'light' ? 'theme="light"' : '',
			bg ? `bg="${escAttr(bg)}"` : '',
		]
			.filter(Boolean)
			.join(' ');

		html = buildHtml({
			title: 'three.ws Viewer',
			element: `<agent-3d ${attrs}></agent-3d>`,
			appOrigin,
		});
	} else {
		return error(res, 400, 'invalid_request', 'provide ?agent=<id> or ?model=<url>');
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('content-security-policy', CSP);
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=3600');
	res.setHeader('x-frame-options', 'ALLOWALL');
	res.end(html);
});

function escAttr(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
