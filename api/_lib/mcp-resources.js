// The OAuth-protected hosted MCP servers, each its own RFC 8707 resource.
//
// Every hosted server used to share one resource identifier, `/api/mcp`, and
// every 401 pointed at the root protected-resource metadata that names it. An
// MCP SDK client (the reference client every cloud connector builds on, Grok
// Bot's included) checks that the metadata's `resource` covers the URL it is
// connecting to before it sends anyone to sign in. `/api/mcp` does not cover
// `/api/mcp-3d`, so OAuth died on the client with "Protected resource
// https://three.ws/api/mcp does not match expected https://three.ws/api/mcp-3d"
// for four of the five protected servers, and the user never reached consent.
//
// Now each server names itself: its 401 points at RFC 9728 path-inserted
// metadata (/.well-known/oauth-protected-resource/api/mcp-3d) whose `resource`
// is the server's own URL, the authorization server mints a token whose `aud`
// is that URL, and the server accepts it. Tokens minted for the platform
// resource (`/api/mcp`, what `npx three-ws setup` and every existing grant
// hold) stay valid on every server, so nothing already connected breaks.

import { env } from './env.js';

// Paths, not URLs: the origin is env.APP_ORIGIN at call time. Keep in step
// with the servers in public/.well-known/mcp.json whose auth names OAuth or a
// bearer (tests/mcp-resources.test.js fails when they drift).
export const OAUTH_MCP_PATHS = Object.freeze(['/api/mcp', '/api/mcp-3d', '/api/mcp-agent', '/api/mcp-bazaar', '/api/ibm-mcp']);

const PLATFORM_PATH = '/api/mcp';
const PRM_ROOT = '/.well-known/oauth-protected-resource';

function trimPath(p) {
	const s = String(p || '').split('?')[0].split('#')[0];
	return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

// The hosted path a request path or resource URL names, or null.
export function hostedMcpPath(pathOrUrl) {
	if (!pathOrUrl) return null;
	let path = String(pathOrUrl);
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
		let u;
		try {
			u = new URL(path);
		} catch {
			return null;
		}
		if (u.origin !== env.APP_ORIGIN) return null;
		path = u.pathname;
	}
	path = trimPath(path);
	return OAUTH_MCP_PATHS.includes(path) ? path : null;
}

// The resource identifier a server answers for: its own URL when it is a
// hosted MCP server, the platform resource otherwise.
export function mcpResourceFor(pathOrUrl) {
	const path = hostedMcpPath(pathOrUrl);
	return `${env.APP_ORIGIN}${path || PLATFORM_PATH}`;
}

// Where an OAuth client reads that resource's metadata. The platform resource
// keeps the root document every existing connector already knows; the others
// use RFC 9728 §3.1 path insertion.
export function protectedResourceMetadataUrl(resource) {
	const path = hostedMcpPath(resource);
	if (!path || path === PLATFORM_PATH) return `${env.APP_ORIGIN}${PRM_ROOT}`;
	return `${env.APP_ORIGIN}${PRM_ROOT}${path}`;
}

// RFC 8707 §2: the canonical form of a requested resource, or null when it
// names something this authorization server does not issue tokens for. An
// absent resource means the platform resource.
export function canonicalMcpResource(requested) {
	if (requested === undefined || requested === null || requested === '') return env.MCP_RESOURCE;
	const path = hostedMcpPath(requested);
	if (!path || !/^[a-z][a-z0-9+.-]*:\/\//i.test(String(requested))) return null;
	return `${env.APP_ORIGIN}${path}`;
}

// Audiences a server accepts: its own resource, plus the platform resource
// every pre-existing token carries.
export function acceptedAudiences(resource) {
	const own = mcpResourceFor(resource);
	return own === env.MCP_RESOURCE ? [env.MCP_RESOURCE] : [own, env.MCP_RESOURCE];
}

// Every audience any hosted server accepts. Introspection and other
// platform-wide verifiers use it so a per-server token is still recognised.
export function allMcpAudiences() {
	return OAUTH_MCP_PATHS.map((p) => `${env.APP_ORIGIN}${p}`);
}
