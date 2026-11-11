// Dev parity for page URLs that production answers with an api/ handler.
//
// In production, server/index.mjs runs the vercel.json phase-1 route table
// before the static filesystem. A good share of public, crawlable URLs end in a
// serverless handler there, not in an HTML file:
//
//   /sitemap.xml, /sitemap/<type>.xml       -> api/sitemap.js, api/sitemap/[type].js
//   /agents/:id, /avatars/:id (crawler UA)  -> api/agent-detail-og.js, api/avatar-detail-og.js
//   /w/:id                                  -> api/widgets/page.js
//   /markets/news/<month>/<id>-<slug>       -> api/news/story-page.js
//
// Vite dev runs no functions, so each of those used to fall through to the SPA
// shell, and a dev crawl (`npm run audit:seo -- --base http://localhost:3123`)
// graded a page no crawler is ever served. This middleware resolves every
// non-/api request against the same table with the production resolver
// (server/route-resolve.mjs, the one implementation server/index.mjs uses) and,
// when the winning rule rewrites to an api/ handler, runs that handler.
//
// With DATABASE_URL in the dev server's environment the local handler runs
// in-process, so a change is checked against the real database before it
// ships. Without it the request is forwarded, user agent included, to the
// upstream origin, which answers what production answers today.
//
// Handlers are loaded with Node's own import(), not Vite's SSR loader: modules
// the SSR runner evaluates in this config see an empty process.env, so the
// database client could never find its connection string there. A module
// generation rides on the import URL of the handler and, through a resolve
// hook, of every local module it imports, so an edit to a shared helper is
// picked up on the next request too (vite.config.js starts a new generation
// whenever a source file changes).
// Runbook: docs/ops/bing-and-indexnow.md.

import { statSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRouteTable, resolvePhase1, resolveApiHandler } from './route-resolve.mjs';

// Requests Vite itself must answer: its internal ids, source modules and
// static assets. Only extensionless paths and .xml can be a handler page.
const VITE_OWNED = /^\/(?:@|src\/|node_modules\/|__)/;
const STATIC_EXT = /\.(?!xml$)[a-z0-9]{1,8}$/i;

/**
 * The api/ handler production would run for a page request, or null when the
 * request is not a handler page (an /api call, a static file, an SPA route).
 *
 * @param {{phase1Routes: any[]}} table  loadRouteTable() result
 * @param {string} apiRoot               absolute path to api/
 * @param {{url: string, headers: Record<string, any>}} req
 * @returns {{file: string, query: Record<string, any>, headers: Record<string, string>, url: string} | null}
 */
export function devHandlerRoute(table, apiRoot, req) {
	const url = new URL(req.url || '/', 'http://dev.local');
	const p = url.pathname;
	if (p.startsWith('/api/') || VITE_OWNED.test(p) || STATIC_EXT.test(p)) return null;
	const r = resolvePhase1(table.phase1Routes, req, url);
	if (r.terminal || !r.matched || !r.path.startsWith('/api/')) return null;
	const route = resolveApiHandler(apiRoot, r.path);
	if (!route) return null;
	const query = {};
	for (const key of new Set(url.searchParams.keys())) {
		const all = url.searchParams.getAll(key);
		query[key] = all.length > 1 ? all : all[0];
	}
	Object.assign(query, r.extraQuery, route.params);
	// Production keeps the original pathname and merges the rewrite query into
	// req.url (server/index.mjs), so handlers that parse req.url read the same.
	let reqUrl = req.url || '/';
	if (Object.keys(r.extraQuery).length > 0) {
		const merged = new URLSearchParams(url.search);
		for (const [k, v] of Object.entries(r.extraQuery)) merged.set(k, v);
		reqUrl = `${p}?${merged.toString()}`;
	}
	return { file: route.file, query, headers: r.headers, url: reqUrl };
}

/**
 * The in-place URL for a slashless path production rewrites to its directory
 * index (vercel.json `/agents` -> `/agents/index.html`), else null. Production
 * answers that path with a 200; Vite's static server would answer it with a
 * 301 to the slashed path, so the dev server hands Vite the slashed URL itself.
 *
 * @param {{phase1Routes: object[]}} table
 * @param {{url?: string, headers?: object}} req
 * @returns {string | null}
 */
export function devDirectoryIndexUrl(table, req) {
	const url = new URL(req.url || '/', 'http://dev.local');
	const p = url.pathname;
	if (p.endsWith('/') || p.startsWith('/api/') || VITE_OWNED.test(p) || STATIC_EXT.test(p)) return null;
	const r = resolvePhase1(table.phase1Routes, req, url);
	if (r.terminal || !r.matched || r.path !== `${p}/index.html`) return null;
	return `${p}/${url.search}`;
}

/**
 * The vercel.json route table, re-read whenever the file changes.
 *
 * @param {string} configPath
 */
export function liveRouteTable(configPath) {
	let mtime = -1;
	let table = null;
	return () => {
		const m = statSync(configPath).mtimeMs;
		if (m !== mtime) {
			table = loadRouteTable(configPath);
			mtime = m;
		}
		return table;
	};
}

// Resolve hook (runs on Node's loader thread): a local file imported by a
// module that carries ?devgen=N gets the same ?devgen=N, so one generation is
// one fresh copy of the handler's whole local import graph.
const GENERATION_HOOK = `
export async function resolve(specifier, context, next) {
	const r = await next(specifier, context);
	const m = context.parentURL && /[?&]devgen=(\\d+)/.exec(context.parentURL);
	if (!m || !r.url.startsWith('file:') || r.url.includes('/node_modules/')) return r;
	const u = new URL(r.url);
	u.searchParams.set('devgen', m[1]);
	return { ...r, url: u.href };
}
`;

// Seeded from the clock: Vite re-evaluates its config (and this module) on a
// restart, and a counter restarting at 0 would hand back URLs Node already
// cached from before the restart.
let generation = Date.now();
let hookRegistered = false;

/** Start a new module generation: the next importFresh loads every local module anew. */
export function bumpModuleGeneration() {
	generation += 1;
}

/**
 * Import an absolute module path natively, fresh for the current generation
 * and for the file's own last edit.
 *
 * @param {string} file
 */
export function importFresh(file) {
	if (!hookRegistered) {
		register(`data:text/javascript,${encodeURIComponent(GENERATION_HOOK)}`);
		hookRegistered = true;
	}
	const v = `${generation}${Math.floor(statSync(file).mtimeMs)}`;
	return import(`${pathToFileURL(file).href}?devgen=${v}`);
}

// The Vercel/Express response helpers handlers may call, on a bare Node
// response. Production gets them from Express.
function withResponseHelpers(res) {
	if (typeof res.status !== 'function') {
		res.status = (code) => {
			res.statusCode = code;
			return res;
		};
	}
	if (typeof res.json !== 'function') {
		res.json = (body) => {
			if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
			res.end(JSON.stringify(body));
			return res;
		};
	}
	if (typeof res.send !== 'function') {
		res.send = (body) => {
			if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body);
			res.end(body);
			return res;
		};
	}
	if (typeof res.redirect !== 'function') {
		res.redirect = (a, b) => {
			const [code, loc] = typeof a === 'number' ? [a, b] : [302, a];
			res.statusCode = code;
			res.setHeader('location', loc);
			res.end();
			return res;
		};
	}
	return res;
}

/**
 * Connect middleware for the Vite dev server.
 *
 * @param {object} o
 * @param {string} o.root                         repository root
 * @param {string} o.upstream                     origin to forward to without a database
 * @param {() => {phase1Routes: any[]}} [o.table] route table source (liveRouteTable)
 * @param {(file: string) => Promise<any>} [o.load]
 * @param {() => boolean} [o.hasDatabase]
 * @param {typeof fetch} [o.fetchImpl]
 */
export function devApiPagesMiddleware({
	root,
	upstream,
	table = liveRouteTable(path.join(root, 'vercel.json')),
	load = importFresh,
	hasDatabase = () => Boolean(process.env.DATABASE_URL),
	fetchImpl = fetch,
}) {
	const apiRoot = path.join(root, 'api');
	return async (req, res, next) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') return next();
		let route;
		try {
			const dirUrl = devDirectoryIndexUrl(table(), req);
			if (dirUrl) {
				req.url = dirUrl;
				return next();
			}
			route = devHandlerRoute(table(), apiRoot, req);
		} catch (err) {
			return next(err);
		}
		if (!route) return next();
		try {
			for (const [k, v] of Object.entries(route.headers)) res.setHeader(k, v);
			if (hasDatabase()) {
				const mod = await load(route.file);
				req.query = route.query;
				req.url = route.url;
				await mod.default(req, withResponseHelpers(res));
				return;
			}
			const r = await fetchImpl(`${upstream}${req.url}`, {
				// The cookie rides along so session-gated page routes (/oauth/authorize,
				// /oauth/consent) see the signed-in user, as they do in production.
				headers: {
					accept: req.headers.accept || '*/*',
					'user-agent': req.headers['user-agent'] || 'three.ws-dev',
					...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
				},
				redirect: 'manual',
				signal: AbortSignal.timeout(60_000),
			});
			res.statusCode = r.status;
			for (const h of ['content-type', 'location', 'cache-control']) {
				const v = r.headers.get(h);
				if (v) res.setHeader(h, v);
			}
			const cookies = r.headers.getSetCookie?.() || [];
			if (cookies.length) res.setHeader('set-cookie', cookies);
			res.end(req.method === 'HEAD' ? undefined : Buffer.from(await r.arrayBuffer()));
		} catch (err) {
			if (res.headersSent) return res.end();
			res.statusCode = 502;
			res.setHeader('content-type', 'text/plain; charset=utf-8');
			res.end(`${path.relative(root, route.file)} failed in dev: ${err?.message || err}`);
		}
	};
}
