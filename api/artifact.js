// GET /api/artifact?agent=<agentId> — self-contained HTML for Claude.ai artifacts
// GET /api/artifact?model=<glbUrl>  — viewer-only, no agent persona
//
// Returns a single self-contained HTML document. Every byte the document
// needs (three.js + GLTFLoader + viewer + GLB) is inlined, because Claude.ai's
// artifact sandbox CSP blocks all external script and fetch to non-pyodide
// origins. See public/artifact/README.md and specs/CLAUDE_ARTIFACT.md.
//
// res.end(html) is intentional — the "no res.end" rule in CLAUDE.md applies
// to JSON responses; HTML documents are returned raw.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { sql } from './_lib/db.js';
import { error, wrap } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { getObjectBuffer } from './_lib/r2.js';

const AGENT_ID_RE = /^[a-z0-9_-]{3,64}$/i;

// Whitelisted origins for ?model= URLs (must be https). Server-side fetched,
// then inlined — Claude's sandbox can't reach these directly.
const ALLOWED_MODEL_ORIGINS = [
	/^https:\/\/[^/]+\.r2\.cloudflarestorage\.com$/,
	/^https:\/\/[^/]+\.amazonaws\.com$/,
	/^https:\/\/[^/]+\.cloudfront\.net$/,
	/^https:\/\/storage\.googleapis\.com$/,
	/^https:\/\/[^/]+\.blob\.core\.windows\.net$/,
	/^https:\/\/three\.ws$/,
	/^https:\/\/[^/]+\.vercel\.app$/,
];

// Hard cap on GLB size. Claude's artifact runtime tolerates several MB of
// inlined HTML; beyond ~6 MB raw (≈8 MB base64) responses become slow to paste
// and risk the artifact panel timing out before first paint.
const MAX_GLB_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

// Mirrors the actual CSP Claude.ai applies to artifact iframes (scraped at
// github.com/simonw/scrape-claude-artifacts). Setting the same response CSP
// means the document behaves identically when iframed directly from your own
// site — no surprises between standalone preview and live Claude rendering.
// `frame-ancestors *` is loosened so embedders other than Claude can still
// iframe the response.
const CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline'",
	"style-src 'unsafe-inline'",
	'img-src data: blob:',
	"connect-src 'self'",
	'font-src data:',
	"base-uri 'none'",
	"form-action 'none'",
	"object-src 'none'",
	'frame-ancestors *',
].join('; ');

// Read the prebuilt artifact viewer bundle once. `npm run build:artifact-viewer`
// regenerates it from scripts/artifact-viewer/src.js.
const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = pathResolve(__dirname, '../public/artifact-viewer.bundle.js');
let _bundle;
function getBundle() {
	if (_bundle === undefined) {
		try {
			_bundle = readFileSync(BUNDLE_PATH, 'utf8');
		} catch (err) {
			throw new Error(
				`artifact-viewer bundle missing at ${BUNDLE_PATH} — run "npm run build:artifact-viewer"`,
			);
		}
	}
	return _bundle;
}

function validateModelUrl(raw) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:') return null;
	if (!ALLOWED_MODEL_ORIGINS.some((pat) => pat.test(url.origin))) return null;
	return url.toString();
}

async function fetchExternalGlb(url) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
		if (!res.ok) throw new Error(`upstream ${res.status}`);
		const len = Number(res.headers.get('content-length') || 0);
		if (len && len > MAX_GLB_BYTES) {
			throw new Error(`model ${(len / 1024 / 1024).toFixed(1)} MB exceeds ${MAX_GLB_BYTES / 1024 / 1024} MB limit`);
		}
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.byteLength > MAX_GLB_BYTES) {
			throw new Error(`model ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB exceeds limit`);
		}
		return buf;
	} finally {
		clearTimeout(timer);
	}
}

function buildHtml({ title, config }) {
	const cfgJson = JSON.stringify(config)
		.replace(/</g, '\\u003c')
		.replace(/-->/g, '--\\>')
		.replace(/<\/script/gi, '<\\/script');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
<style>
html,body{margin:0;height:100%;background:${escAttr(config.bg ? '#' + config.bg : '#0a0e27')};font-family:system-ui,-apple-system,sans-serif}
#artifact-stage{position:absolute;inset:0;overflow:hidden}
</style>
</head>
<body>
<div id="artifact-stage"></div>
<script type="application/json" id="artifact-config">${cfgJson}</script>
<script>${getBundle()}</script>
</body>
</html>`;
}

async function loadAgentArtifactConfig(agentId, opts) {
	const [row] = await sql`
		SELECT
			a.id, a.name,
			av.storage_key
		FROM agent_identities a
		LEFT JOIN avatars av ON av.id = a.avatar_id AND av.deleted_at IS NULL
		WHERE a.id = ${agentId} AND a.deleted_at IS NULL
		LIMIT 1
	`;
	if (!row) return { error: { status: 404, code: 'not_found', msg: 'agent not found' } };
	if (!row.storage_key) {
		return { error: { status: 422, code: 'no_avatar', msg: 'agent has no avatar yet' } };
	}

	const buf = await getObjectBuffer(row.storage_key);
	if (buf.byteLength > MAX_GLB_BYTES) {
		return {
			error: {
				status: 413,
				code: 'too_large',
				msg: `agent avatar is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB — Claude artifact limit is ${MAX_GLB_BYTES / 1024 / 1024} MB`,
			},
		};
	}

	return {
		title: `${row.name} — three.ws`,
		config: {
			name: row.name,
			glb: buf.toString('base64'),
			theme: opts.theme,
			idle: opts.idle,
			bg: opts.bg,
		},
	};
}

async function loadModelArtifactConfig(modelUrl, opts) {
	const buf = await fetchExternalGlb(modelUrl);
	return {
		title: 'three.ws Viewer',
		config: {
			name: '',
			glb: buf.toString('base64'),
			theme: opts.theme,
			idle: opts.idle,
			bg: opts.bg,
		},
	};
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
	const idle = (params.get('idle') || '').slice(0, 64);
	const bg = (params.get('bg') || '').replace(/^#/, '').match(/^[0-9a-f]{6}$/i)?.[0] || '';

	if ((agentId === null) === (modelUrl === null)) {
		return error(res, 400, 'invalid_request', 'provide exactly one of ?agent=<id> or ?model=<url>');
	}

	const opts = { theme, idle, bg };
	let result;

	if (agentId !== null) {
		if (!AGENT_ID_RE.test(agentId)) {
			return error(res, 400, 'invalid_request', 'agent id must be 3–64 alphanumeric/hyphen/underscore chars');
		}
		result = await loadAgentArtifactConfig(agentId, opts);
	} else {
		const safeUrl = validateModelUrl(modelUrl);
		if (!safeUrl) {
			return error(res, 400, 'invalid_request', 'model must be an https URL from a whitelisted origin');
		}
		try {
			result = await loadModelArtifactConfig(safeUrl, opts);
		} catch (err) {
			return error(res, 502, 'upstream_error', err.message || 'model fetch failed');
		}
	}

	if (result.error) return error(res, result.error.status, result.error.code, result.error.msg);

	const html = buildHtml(result);

	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('content-security-policy', CSP);
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=3600');
	res.setHeader('x-frame-options', 'ALLOWALL');
	if (req.method === 'HEAD') {
		res.setHeader('content-length', Buffer.byteLength(html).toString());
		res.end();
		return;
	}
	res.end(html);
});

function escAttr(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escHtml(s) {
	return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
