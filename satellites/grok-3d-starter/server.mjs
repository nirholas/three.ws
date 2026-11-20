// The starter's server: Node's http module, no framework. It serves the page,
// reports key status, and streams chat turns over server-sent events. The xAI
// and three.ws keys stay here; the browser never sees either.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTurn } from './lib/chat.mjs';
import { loadConfig, missingKeys } from './lib/config.mjs';
import { rateLimited, setupRequired, toAppError } from './lib/errors.mjs';
import { createStatusChecker } from './lib/status.mjs';
import { clientAddress, createRateLimiter, readJsonBody, validateChatInput } from './lib/validate.mjs';
import { visitorId } from './lib/xai.mjs';
import { formatSSE } from './shared/sse.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.wasm': 'application/wasm',
	'.webmanifest': 'application/manifest+json',
};

// URL prefix -> directory. Only these trees are reachable; three.js is served
// from the installed package, limited to the module build and the addons.
const MOUNTS = [
	['/vendor/three/build/', join(ROOT, 'node_modules/three/build')],
	['/vendor/three/examples/jsm/', join(ROOT, 'node_modules/three/examples/jsm')],
	['/shared/', join(ROOT, 'shared')],
	['/', join(ROOT, 'public')],
];

function resolveStatic(pathname) {
	let decoded;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	if (decoded.includes('\0')) return null;
	for (const [prefix, dir] of MOUNTS) {
		if (!decoded.startsWith(prefix)) continue;
		const rel = decoded.slice(prefix.length) || 'index.html';
		const file = resolve(dir, rel);
		if (file !== dir && !file.startsWith(dir + sep)) return null;
		return { file, vendor: prefix.startsWith('/vendor/') };
	}
	return null;
}

// The page's import map is its only inline script; the CSP allows exactly
// that script by hash and nothing else inline.
async function importMapHash() {
	const html = await readFile(join(ROOT, 'public/index.html'), 'utf8');
	const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
	return match ? `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'` : '';
}

function securityHeaders(scriptHash) {
	return {
		'content-security-policy': [
			"default-src 'self'",
			`script-src 'self' 'wasm-unsafe-eval' ${scriptHash}`.trim(),
			"connect-src 'self' https: blob: data:",
			"img-src 'self' https: data: blob:",
			"style-src 'self'",
			"worker-src 'self' blob:",
			"object-src 'none'",
			"base-uri 'none'",
			"frame-ancestors 'none'",
			"form-action 'self'",
		].join('; '),
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'strict-origin-when-cross-origin',
		'permissions-policy': 'camera=(), microphone=(), geolocation=()',
	};
}

function sendJson(res, status, body, headers = {}) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
	res.end(payload);
}

function sendError(res, err) {
	const app = toAppError(err);
	sendJson(res, app.status, { error: app.toJSON() }, app.retryAfterSeconds ? { 'retry-after': String(app.retryAfterSeconds) } : {});
}

async function serveStatic(req, res, pathname, headers) {
	const target = resolveStatic(pathname);
	if (!target) return sendJson(res, 404, { error: { code: 'not_found', title: 'Not found', message: pathname } });
	try {
		const info = await stat(target.file);
		if (!info.isFile()) throw new Error('not a file');
		const body = await readFile(target.file);
		res.writeHead(200, {
			...headers,
			'content-type': TYPES[extname(target.file)] || 'application/octet-stream',
			'content-length': body.length,
			'cache-control': target.vendor ? 'public, max-age=86400' : 'no-cache',
		});
		res.end(req.method === 'HEAD' ? undefined : body);
	} catch {
		sendJson(res, 404, { error: { code: 'not_found', title: 'Not found', message: pathname } });
	}
}

async function handleChat(req, res, { config, limiter, fetchImpl, log }) {
	const address = clientAddress(req, config.trustProxy);
	const missing = missingKeys(config);
	if (missing.length) return sendError(res, setupRequired(missing));
	const gate = limiter.check(address);
	if (!gate.ok) return sendError(res, rateLimited(gate.retryAfterSeconds));

	let input;
	try {
		input = validateChatInput(await readJsonBody(req));
	} catch (err) {
		return sendError(res, err);
	}

	res.writeHead(200, {
		'content-type': 'text/event-stream; charset=utf-8',
		'cache-control': 'no-cache, no-transform',
		connection: 'keep-alive',
		'x-accel-buffering': 'no',
	});
	res.flushHeaders();

	const controller = new AbortController();
	let finished = false;
	res.on('close', () => {
		if (!finished) controller.abort(new Error('client closed the stream'));
	});
	// An SSE comment every 15s keeps proxies from closing a quiet stream while
	// a render runs. It carries no data; the page ignores comments.
	const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
	const emit = (event, data) => {
		if (!res.writableEnded) res.write(formatSSE(event, data));
	};

	const started = Date.now();
	try {
		await runTurn({ config, input, emit, signal: controller.signal, fetchImpl, safetyIdentifier: visitorId(address) });
		log(`turn ok in ${Math.round((Date.now() - started) / 1000)}s`);
	} catch (err) {
		if (controller.signal.aborted) {
			log('turn cancelled by the client');
		} else {
			const app = toAppError(err);
			log(`turn failed: ${app.code}${app.code === 'internal' ? ` ${err?.stack || err}` : ''}`);
			emit('error', app.toJSON());
		}
	} finally {
		finished = true;
		clearInterval(keepAlive);
		res.end();
	}
}

export async function createApp({ config = loadConfig(), fetchImpl = fetch, log = (line) => console.log(`[grok-3d-starter] ${line}`) } = {}) {
	const headers = securityHeaders(await importMapHash());
	const limiter = createRateLimiter({ limit: config.rateLimitPerMinute });
	const checker = createStatusChecker({ config, fetchImpl });

	return http.createServer(async (req, res) => {
		const url = new URL(req.url || '/', 'http://localhost');
		for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
		try {
			if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
			if (url.pathname === '/api/status' && req.method === 'GET') {
				if (url.searchParams.get('refresh') === '1') checker.forget();
				return sendJson(res, 200, await checker.status());
			}
			if (url.pathname === '/api/chat') {
				if (req.method !== 'POST') return sendJson(res, 405, { error: { code: 'method', title: 'Use POST', message: 'POST a JSON body to /api/chat.' } }, { allow: 'POST' });
				return await handleChat(req, res, { config, limiter, fetchImpl, log });
			}
			if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: { code: 'not_found', title: 'Not found', message: url.pathname } });
			if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: { code: 'method', title: 'Method not allowed', message: req.method } }, { allow: 'GET, HEAD' });
			return await serveStatic(req, res, url.pathname, headers);
		} catch (err) {
			log(`request failed: ${err?.stack || err}`);
			if (!res.headersSent) sendError(res, err);
			else res.end();
		}
	});
}

function loadDotEnv() {
	const file = join(ROOT, '.env');
	if (existsSync(file)) process.loadEnvFile(file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	loadDotEnv();
	const config = loadConfig();
	const server = await createApp({ config });
	server.listen(config.port, config.host, () => {
		const missing = missingKeys(config).map((m) => `${m.name} (${m.problem})`);
		console.log(`[grok-3d-starter] http://localhost:${config.port}  model ${config.model}`);
		if (missing.length) console.log(`[grok-3d-starter] setup needed: ${missing.join(', ')}. The page shows how to fix it.`);
	});
	const stop = () => server.close(() => process.exit(0));
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
}
