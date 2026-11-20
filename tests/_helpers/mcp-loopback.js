// A real node:http server in the test process that serves the real hosted MCP
// handlers the connector probe drives: /api/mcp-grok, /api/mcp-studio, /api/mcp
// and the protected-resource metadata route (api/wk.js) an OAuth challenge
// points at, mapped the way vercel.json maps it. /api/hang accepts a request
// and never answers (the timeout path); any other path is a 404.
//
// Callers mock api/_lib/db.js onto PGlite BEFORE calling this, so the
// handlers' own writes (session analytics, client census) stay in memory.

import { createServer } from 'node:http';

// /.well-known/oauth-protected-resource(/api/<name>) -> /api/wk?name=...&path=$1
const WK_RE = /^\/\.well-known\/oauth-protected-resource(\/api\/[a-z0-9-]+)$/;

/**
 * Start the server and point PUBLIC_APP_ORIGIN at it, so the challenge and the
 * metadata document name the loopback origin.
 * @param {{ extraRoutes?: Record<string, Function> }} [opts] more path -> handler pairs
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function startMcpLoopback({ extraRoutes = {} } = {}) {
	/** @type {Map<string, Function>} */
	const routes = new Map();
	const server = createServer(async (req, res) => {
		const url = new URL(req.url, 'http://internal');
		const wk = WK_RE.exec(url.pathname);
		if (wk) {
			req.query = { name: 'oauth-protected-resource', path: wk[1] };
			return routes.get('wk')(req, res);
		}
		if (url.pathname === '/api/hang') return;
		req.query = Object.fromEntries(url.searchParams);
		const handler = routes.get(url.pathname);
		if (!handler) {
			res.statusCode = 404;
			return res.end('not found');
		}
		return handler(req, res);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	process.env.PUBLIC_APP_ORIGIN = origin;

	routes.set('/api/mcp-grok', (await import('../../api/mcp-grok.js')).default);
	routes.set('/api/mcp-studio', (await import('../../api/mcp-studio.js')).default);
	routes.set('/api/mcp', (await import('../../api/mcp.js')).default);
	routes.set('wk', (await import('../../api/wk.js')).default);
	for (const [path, handler] of Object.entries(extraRoutes)) routes.set(path, handler);

	return {
		origin,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}
