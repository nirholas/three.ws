// Dev parity for the sitemap routes. Production rewrites /sitemap.xml to
// api/sitemap.js and /sitemap/<type>.xml to api/sitemap/[type].js (vercel.json).
// Vite dev runs no functions, so without this both paths fell through to the
// SPA and a local `npm run audit:seo -- --base http://localhost:3123` had no
// URL set to crawl.
//
// With DATABASE_URL in the dev server's environment the local handlers run
// in-process, so a sitemap change is checked against the real database before
// it ships. Without it the request is forwarded to the upstream origin, which
// serves what production serves today.
//
// The handlers are loaded with Node's own import(), not Vite's SSR loader:
// modules the SSR runner evaluates in this config see an empty process.env, so
// the database client could never find its connection string there. The file's
// mtime rides on the import URL so an edit is picked up on the next request.
// Runbook: docs/ops/bing-and-indexnow.md.

import { statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SITEMAP_INDEX = /^\/sitemap\.xml$/;
const SITEMAP_CHILD = /^\/sitemap\/([a-z]+(?:-[0-9]+)?)\.xml$/;

/**
 * Which sitemap a request path names: `{ kind: 'index' }`, `{ kind: 'child',
 * type }`, or null for any other path.
 *
 * @param {string} pathname
 */
export function sitemapRoute(pathname) {
	if (SITEMAP_INDEX.test(pathname)) return { kind: 'index' };
	const m = pathname.match(SITEMAP_CHILD);
	return m ? { kind: 'child', type: m[1] } : null;
}

/**
 * A loader that imports a repo-relative module natively, re-importing it after
 * the file changes.
 *
 * @param {string} root  repository root
 */
export function nativeModuleLoader(root) {
	return (id) => {
		const file = path.join(root, id);
		const v = Math.floor(statSync(file).mtimeMs);
		return import(`${pathToFileURL(file).href}?v=${v}`);
	};
}

/**
 * Connect middleware for the Vite dev server.
 *
 * @param {object} o
 * @param {(id: string) => Promise<any>} o.load  module loader (nativeModuleLoader)
 * @param {string} o.upstream                    origin to forward to without a database
 * @param {() => boolean} [o.hasDatabase]
 * @param {typeof fetch} [o.fetchImpl]
 */
export function devSitemapMiddleware({ load, upstream, hasDatabase = () => Boolean(process.env.DATABASE_URL), fetchImpl = fetch }) {
	return async (req, res, next) => {
		const [pathname, search = ''] = String(req.url || '').split('?');
		const route = sitemapRoute(pathname);
		if (!route || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
		try {
			if (hasDatabase()) {
				const mod = await load(route.kind === 'index' ? '/api/sitemap.js' : '/api/sitemap/[type].js');
				req.query = route.kind === 'child' ? { type: route.type } : {};
				await mod.default(req, res);
				return;
			}
			const r = await fetchImpl(`${upstream}${pathname}${search ? `?${search}` : ''}`, {
				headers: { accept: 'application/xml' },
				signal: AbortSignal.timeout(60_000),
			});
			res.statusCode = r.status;
			res.setHeader('content-type', r.headers.get('content-type') || 'application/xml; charset=utf-8');
			res.end(req.method === 'HEAD' ? undefined : Buffer.from(await r.arrayBuffer()));
		} catch (err) {
			res.statusCode = 502;
			res.setHeader('content-type', 'text/plain; charset=utf-8');
			res.end(`sitemap unavailable in dev: ${err?.message || err}`);
		}
	};
}
