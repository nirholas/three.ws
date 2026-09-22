// The servers the CLI can wire up, read live from the platform:
//   hosted Streamable HTTP servers  <- {origin}/.well-known/mcp.json
//   stdio @three-ws/*-mcp packages  <- {origin}/mcp-catalog.json (servers[])
// Nothing here is a hardcoded server list; a server added to the directory
// shows up in `three-ws setup` the next time anyone runs it.

import { requestJson } from './http.js';

// Offered pre-selected. The two keyless servers are always offered too, since
// they work with no account at all.
export const DEFAULT_PATHS = ['/api/mcp', '/api/mcp-agent', '/api/mcp-3d'];

/**
 * The config key a server gets in every client: /api/mcp -> three-ws,
 * /api/mcp-agent -> three-ws-agent, /api/pump-fun-mcp -> three-ws-pump-fun.
 */
export function slugForPath(pathname) {
	const rest = String(pathname)
		.replace(/^\/api\//, '')
		.split('-')
		.filter((part) => part && part !== 'mcp')
		.join('-');
	return rest ? `three-ws-${rest}` : 'three-ws';
}

export function authRequired(authText) {
	return !/^none\b/i.test(String(authText || '').trim());
}

/** Normalize the live directory into the CLI's server records, rebased onto `origin`. */
export function hostedServers(directory, origin) {
	const list = Array.isArray(directory?.servers) ? directory.servers : [];
	return list
		.filter((s) => s?.endpoint && (s.transport || 'streamable-http') === 'streamable-http')
		.map((s) => {
			const pathname = new URL(s.endpoint).pathname;
			const needsAuth = authRequired(s.auth);
			return {
				slug: slugForPath(pathname),
				name: s.name,
				path: pathname,
				url: `${origin}${pathname}`,
				description: s.description || '',
				auth: needsAuth ? 'required' : 'none',
				defaultSelected: DEFAULT_PATHS.includes(pathname) || !needsAuth,
			};
		});
}

/** The stdio packages from the catalog, each run with `npx -y <package>`. */
export function stdioPackages(catalog) {
	const list = Array.isArray(catalog?.servers) ? catalog.servers : [];
	return list
		.filter((s) => s.transport === 'stdio' && /^npx\s+-y\s+@three-ws\/[\w.-]+$/.test(s.endpoint || ''))
		.map((s) => {
			const pkg = s.endpoint.split(/\s+/).pop();
			return {
				slug: `three-ws-${pkg.split('/').pop().replace(/-mcp$/, '')}`,
				name: pkg,
				package: pkg,
				tools: Number(s.tools) || 0,
				auth: s.auth === 'none' ? 'none' : 'key',
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadDirectory(origin) {
	return requestJson(`${origin}/.well-known/mcp.json`);
}

export async function loadCatalog(origin) {
	return requestJson(`${origin}/mcp-catalog.json`, { timeoutMs: 45_000 });
}

/** True when a client config entry points at one of this origin's servers. */
export function isThreeWsEntry(name, entry, origin) {
	if (/^three-ws(-|$)/.test(name)) return true;
	const blob = JSON.stringify(entry || {});
	if (blob.includes(new URL(origin).host) || blob.includes('@three-ws/')) return true;
	return blob.includes('three-ws') && blob.includes('"proxy"');
}
