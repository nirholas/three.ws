// The servers the CLI can wire up, read live from the platform:
//   hosted Streamable HTTP servers  <- {origin}/.well-known/mcp.json
//   stdio @three-ws/*-mcp packages  <- {origin}/mcp-catalog.json (servers[])
// Nothing here is a hardcoded server list; a server added to the directory
// shows up in `three-ws setup` the next time anyone runs it.

import { requestJson } from './http.js';

// The unified endpoint mounts every tool of every hosted server behind one
// OAuth grant, so one client entry is all a person needs. When the directory
// lists it, it is the only server offered pre-selected: picking a legacy
// server as well would put the same tools in the client twice.
export const UNIFIED_PATH = '/mcp';

// Offered pre-selected against a directory that predates the unified endpoint.
// The keyless servers are always offered too, since they need no account.
export const DEFAULT_PATHS = ['/api/mcp', '/api/mcp-agent', '/api/mcp-3d'];

/**
 * The config key a server gets in every client: /mcp -> three-ws (the unified
 * endpoint), /api/mcp -> three-ws-main, /api/mcp-agent -> three-ws-agent,
 * /api/pump-fun-mcp -> three-ws-pump-fun.
 */
export function slugForPath(pathname) {
	if (pathname === UNIFIED_PATH) return 'three-ws';
	if (pathname === '/api/mcp') return 'three-ws-main';
	const rest = String(pathname)
		.replace(/^\/(api\/)?/, '')
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
	const streamable = list.filter((s) => s?.endpoint && (s.transport || 'streamable-http') === 'streamable-http');
	const hasUnified = streamable.some((s) => new URL(s.endpoint).pathname === UNIFIED_PATH);
	return streamable
		.map((s) => {
			const pathname = new URL(s.endpoint).pathname;
			const needsAuth = authRequired(s.auth);
			const defaultSelected = hasUnified ? pathname === UNIFIED_PATH : DEFAULT_PATHS.includes(pathname) || !needsAuth;
			return {
				slug: slugForPath(pathname),
				name: s.name,
				path: pathname,
				url: `${origin}${pathname}`,
				description: s.description || '',
				auth: needsAuth ? 'required' : 'none',
				unified: pathname === UNIFIED_PATH,
				defaultSelected,
			};
		})
		.sort((a, b) => Number(b.unified) - Number(a.unified));
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
