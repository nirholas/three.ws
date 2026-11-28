/**
 * The two OAuth discovery documents and the registration endpoint describe one
 * contract from three sides, and a client that follows the documented path
 * touches all three: the 401 from any MCP server carries
 * `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`,
 * the client reads `scopes_supported` from that document, and it registers for
 * exactly those scopes at /api/oauth/register.
 *
 * So a scope the registration endpoint grants but the protected-resource
 * document omits is a scope no discovery-driven client ever asks for. That is
 * how the whole agent-wallet MCP server (wallet:read / wallet:write /
 * services:write) became unreachable through the documented flow while the
 * registration endpoint happily granted those scopes to anyone who knew to name
 * them. These assertions pin the surfaces to the shared array so the next scope
 * added on one side cannot silently skip the other.
 */
import { describe, it, expect } from 'vitest';

process.env.PUBLIC_APP_ORIGIN ||= 'https://three.ws';

const {
	REGISTERABLE_SCOPES,
	AUTH_HINT_SCOPES,
	SUPPORTED_SCOPES,
	filterRegisterableScope,
} = await import('../../api/_lib/oauth-scopes.js');
const { default: wkHandler } = await import('../../api/wk.js');

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) {
			this.headers[String(name).toLowerCase()] = value;
		},
		end(body) {
			this.body = body ?? null;
		},
	};
}

async function fetchWellKnown(name) {
	const res = makeRes();
	const req = { method: 'GET', url: `/api/wk?name=${name}`, headers: {}, query: { name } };
	await wkHandler(req, res);
	return { res, doc: JSON.parse(res.body) };
}

describe('OAuth discovery scope parity', () => {
	it('serves the protected-resource document with the registerable scopes', async () => {
		const { res, doc } = await fetchWellKnown('oauth-protected-resource');
		expect(res.statusCode).toBe(200);
		expect(doc.scopes_supported).toEqual([...REGISTERABLE_SCOPES]);
	});

	it('publishes every scope the registration endpoint would keep', async () => {
		const { doc } = await fetchWellKnown('oauth-protected-resource');
		// Ask for everything the metadata advertises; registration must keep it
		// all, or a compliant client is being told to request scopes it loses.
		const kept = filterRegisterableScope(doc.scopes_supported.join(' '));
		expect(kept.split(' ')).toEqual(doc.scopes_supported);
	});

	it('reaches the agent-wallet scopes through the documented flow', async () => {
		const { doc } = await fetchWellKnown('oauth-protected-resource');
		for (const scope of ['wallet:read', 'wallet:write', 'services:write']) {
			expect(doc.scopes_supported).toContain(scope);
		}
	});

	it('serves authorization-server metadata covering the resource scopes', async () => {
		const { res, doc } = await fetchWellKnown('oauth-authorization-server');
		expect(res.statusCode).toBe(200);
		expect(doc.scopes_supported).toEqual([...SUPPORTED_SCOPES]);
		const { doc: resourceDoc } = await fetchWellKnown('oauth-protected-resource');
		for (const scope of resourceDoc.scopes_supported) {
			expect(doc.scopes_supported).toContain(scope);
		}
	});

	it('keeps the auth-hints scopes out of the protected-resource document', async () => {
		// These gate paid x402 endpoints for first-party principals, not the MCP
		// resource, and registration drops them. Advertising them to MCP clients
		// would promise a scope every registration silently strips.
		const { doc } = await fetchWellKnown('oauth-protected-resource');
		for (const scope of AUTH_HINT_SCOPES) {
			expect(doc.scopes_supported).not.toContain(scope);
			expect(filterRegisterableScope(scope)).toBe('avatars:read');
		}
	});

	// The free studio (/api/mcp-studio) makes and reads 3D models; its dispatcher
	// has no wallet, payment or home tool. A discovery-driven client (Cursor,
	// Grok Bot) asks for every scope the studio's own document lists, so listing
	// the platform set put wallet:trade and wallet:launch on the consent screen
	// of a 3D plugin. Its document and its 401 name only what it uses.
	it('advertises only identity and avatar scopes for the free studio', async () => {
		const res = makeRes();
		const req = {
			method: 'GET',
			url: '/api/wk?name=oauth-protected-resource&path=/api/mcp-studio',
			headers: {},
			query: { name: 'oauth-protected-resource', path: '/api/mcp-studio' },
		};
		await wkHandler(req, res);
		const doc = JSON.parse(res.body);
		expect(doc.resource).toBe('https://three.ws/api/mcp-studio');
		expect(doc.scopes_supported).toEqual(['avatars:read', 'avatars:write', 'profile', 'offline_access']);
		for (const scope of doc.scopes_supported) expect(REGISTERABLE_SCOPES).toContain(scope);
		expect(filterRegisterableScope(doc.scopes_supported.join(' ')).split(' ')).toEqual(doc.scopes_supported);
	});

	it('names the narrow studio scope in the studio 401 challenge', async () => {
		const { bearerChallenge } = await import('../../api/_mcp/auth.js');
		expect(bearerChallenge('https://three.ws/api/mcp-studio')).toContain(
			'scope="avatars:read avatars:write profile offline_access"',
		);
	});

	// Docker's MCP gateway (the MCP Toolkit in Docker Desktop) never reads
	// scopes_supported: it takes the scope list from a non-standard `scopes`
	// field in the protected-resource document, else from the `scope` parameter
	// of the 401 challenge (mcp-gateway-oauth-helpers, discovery.go and
	// FindRequiredScopes). With neither present it registers with no scope, the
	// registration endpoint stores the avatars:read default, and the user gets a
	// one-permission consent screen and a read-only token. The MCP authorization
	// spec (2025-11-25) says a server SHOULD name the scope in the challenge, so
	// every hosted server names exactly the set its own document advertises.
	function challengeScopes(header) {
		const match = /(?:^|[\s,])scope="([^"]*)"/.exec(header);
		return match ? match[1].split(/\s+/).filter(Boolean) : [];
	}

	it('names the advertised scope set in every hosted server 401 challenge', async () => {
		const { bearerChallenge } = await import('../../api/_mcp/auth.js');
		for (const path of ['/mcp', '/api/mcp', '/api/mcp-agent', '/api/mcp-3d', '/api/mcp-studio']) {
			const resource = `https://three.ws${path}`;
			const res = makeRes();
			const req = {
				method: 'GET',
				url: `/api/wk?name=oauth-protected-resource&path=${path}`,
				headers: {},
				query: { name: 'oauth-protected-resource', path },
			};
			await wkHandler(req, res);
			const advertised = JSON.parse(res.body).scopes_supported;
			expect(challengeScopes(bearerChallenge(resource)), path).toEqual(advertised);
		}
	});

	it('keeps the full registerable set on every other hosted server', async () => {
		const res = makeRes();
		const req = {
			method: 'GET',
			url: '/api/wk?name=oauth-protected-resource&path=/api/mcp-agent',
			headers: {},
			query: { name: 'oauth-protected-resource', path: '/api/mcp-agent' },
		};
		await wkHandler(req, res);
		expect(JSON.parse(res.body).scopes_supported).toEqual([...REGISTERABLE_SCOPES]);
	});

	it('points the protected-resource document at the MCP resource', async () => {
		const { doc } = await fetchWellKnown('oauth-protected-resource');
		expect(doc.resource).toBe('https://three.ws/api/mcp');
		expect(doc.authorization_servers).toContain('https://three.ws');
		const { doc: asDoc } = await fetchWellKnown('oauth-authorization-server');
		// The issuer named by the resource must be the issuer the AS claims,
		// or the client walks the chain into a document it will reject.
		expect(doc.authorization_servers).toContain(asDoc.issuer);
	});
});
