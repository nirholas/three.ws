/**
 * Every OAuth-protected hosted MCP server must be signable-into by a stock MCP
 * SDK client, which is what a cloud connector (Grok Bot, claude.ai) runs.
 *
 * The client follows the 401's `resource_metadata` pointer, reads the document
 * there, and refuses to start sign-in unless the document's `resource` covers
 * the URL it connected to (checkResourceAllowed in the SDK). All five servers
 * used to point at one root document naming `/api/mcp`, which does not cover
 * `/api/mcp-3d`, `/api/mcp-agent`, `/api/mcp-bazaar` or `/api/ibm-mcp`, so
 * `npm run probe:mcp-clients` found OAuth dead on four of five servers. These
 * tests run the same chain in-process: challenge, metadata, SDK check, and the
 * token the authorization server then mints for that resource.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import { loadRouteTable, resolvePhase1 } from '../../server/route-resolve.mjs';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

vi.mock('../../api/_lib/db.js', () => ({
	sql: async () => [],
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));

const { sendAuthChallenge, send401, handleSse, authenticateRequest } = await import('../../api/_mcp/auth.js');
const { default: wkHandler } = await import('../../api/wk.js');
const { mintAccessToken } = await import('../../api/_lib/auth.js');
const { OAUTH_MCP_PATHS, canonicalMcpResource, acceptedAudiences, protectedResourceMetadataUrl } = await import(
	'../../api/_lib/mcp-resources.js'
);
const { parseWwwAuthenticate } = await import('../../scripts/mcp-client-probe.mjs');

const ORIGIN = 'https://three.ws';
const MCP_CLIENT_HEADERS = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
// A captured, real-shaped accepts[] entry; the challenge under test is the
// WWW-Authenticate header, not the payment envelope.
const REQUIREMENTS_FIXTURE = [
	{
		scheme: 'exact',
		amount: '1000',
		network: 'eip155:8453',
		payTo: '0x4022de2d36c334e73c7a108805cea11c0564f402',
		asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
	},
];

function mkRes() {
	const headers = {};
	return {
		statusCode: 200,
		body: null,
		headers,
		setHeader(k, v) {
			headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b ?? null;
		},
	};
}

// The production route table (vercel.json, through the resolver the server
// itself runs), so a metadata URL with no rewrite behind it fails here exactly
// as it 404s in production.
const { phase1Routes } = loadRouteTable(resolve(import.meta.dirname, '../../vercel.json'));

async function fetchMetadata(url) {
	const u = new URL(url);
	const routed = resolvePhase1(phase1Routes, { headers: {} }, u);
	expect(routed.path, `metadata URL ${url} is not routed to api/wk`).toBe('/api/wk');
	const query = Object.fromEntries(u.searchParams);
	Object.assign(query, routed.extraQuery);
	expect(query.name).toBe('oauth-protected-resource');
	const res = mkRes();
	await wkHandler({ method: 'GET', url: `/api/wk?${new URLSearchParams(query)}`, headers: {}, query }, res);
	return { status: res.statusCode, doc: res.body ? JSON.parse(res.body) : null };
}

async function expectSignable(res, path) {
	expect(res.statusCode).toBe(401);
	const challenge = parseWwwAuthenticate(res.getHeader('www-authenticate'));
	expect(challenge.scheme).toBe('Bearer');
	const { status, doc } = await fetchMetadata(challenge.params.resource_metadata);
	expect(status).toBe(200);
	expect(doc.resource).toBe(`${ORIGIN}${path}`);
	expect(challenge.params.resource).toBe(doc.resource);
	expect(checkResourceAllowed({ requestedResource: `${ORIGIN}${path}`, configuredResource: doc.resource })).toBe(true);
	expect(doc.authorization_servers).toEqual([ORIGIN]);
}

describe('each hosted MCP server is its own OAuth resource', () => {
	for (const path of OAUTH_MCP_PATHS) {
		it(`${path}: an unauthenticated MCP client gets a challenge the SDK will sign into`, async () => {
			const res = mkRes();
			await sendAuthChallenge(res, {
				req: { headers: MCP_CLIENT_HEADERS, url: path },
				resourceUrl: `${ORIGIN}${path}`,
				resourcePath: path,
				requirements: REQUIREMENTS_FIXTURE,
			});
			await expectSignable(res, path);
		});

		it(`${path}: an invalid bearer gets the same re-auth challenge`, async () => {
			const res = mkRes();
			await handleSse({ method: 'GET', url: path, headers: { ...MCP_CLIENT_HEADERS, authorization: 'Bearer not.a.token' } }, res, {
				resourcePath: path,
			});
			await expectSignable(res, path);
		});

		it(`${path}: a 401 sent without a resourcePath still names the server it was reached on`, async () => {
			const res = mkRes();
			res.req = { url: path, headers: {} };
			send401(res, 'method not supported');
			await expectSignable(res, path);
		});
	}

	it('keeps the root metadata document on the platform resource every existing connector holds', async () => {
		const { status, doc } = await fetchMetadata(`${ORIGIN}/.well-known/oauth-protected-resource`);
		expect(status).toBe(200);
		expect(doc.resource).toBe(`${ORIGIN}/api/mcp`);
		expect(protectedResourceMetadataUrl(`${ORIGIN}/api/mcp`)).toBe(`${ORIGIN}/.well-known/oauth-protected-resource`);
	});

	it('answers 404 for metadata about a path that is not a hosted MCP server', async () => {
		const { status } = await fetchMetadata(`${ORIGIN}/.well-known/oauth-protected-resource/api/admin`);
		expect(status).toBe(404);
	});
});

describe('tokens are bound to the resource they were granted for', () => {
	const req = (path, token) => ({ method: 'POST', url: path, headers: { ...MCP_CLIENT_HEADERS, authorization: `Bearer ${token}` } });

	it('a token minted for /api/mcp-3d works there', async () => {
		const token = await mintAccessToken({ userId: 'u1', clientId: 'c1', scope: 'avatars:read', resource: `${ORIGIN}/api/mcp-3d` });
		const out = await authenticateRequest(req('/api/mcp-3d', token), mkRes(), { resourcePath: '/api/mcp-3d' });
		expect(out?.auth?.userId).toBe('u1');
	});

	it('a token minted for /api/mcp-3d is refused by the wallet server, with that server\'s challenge', async () => {
		const token = await mintAccessToken({ userId: 'u1', clientId: 'c1', scope: 'wallet:read', resource: `${ORIGIN}/api/mcp-3d` });
		const res = mkRes();
		const out = await authenticateRequest(req('/api/mcp-agent', token), res, { resourcePath: '/api/mcp-agent' });
		expect(out).toBeNull();
		await expectSignable(res, '/api/mcp-agent');
	});

	it('a platform token (what npx three-ws setup holds) still works on every hosted server', async () => {
		const token = await mintAccessToken({ userId: 'u2', clientId: 'c1', scope: 'avatars:read', resource: `${ORIGIN}/api/mcp` });
		for (const path of OAUTH_MCP_PATHS) {
			const out = await authenticateRequest(req(path, token), mkRes(), { resourcePath: path });
			expect(out?.auth?.userId, path).toBe('u2');
		}
	});

	it('the authorization server recognises exactly the hosted servers on this origin', () => {
		for (const path of OAUTH_MCP_PATHS) expect(canonicalMcpResource(`${ORIGIN}${path}/`)).toBe(`${ORIGIN}${path}`);
		expect(canonicalMcpResource(undefined)).toBe(`${ORIGIN}/api/mcp`);
		expect(canonicalMcpResource('https://evil.example/api/mcp-3d')).toBeNull();
		expect(canonicalMcpResource('/api/mcp-3d')).toBeNull();
		expect(canonicalMcpResource(`${ORIGIN}/api/mcp-studio`)).toBeNull();
		expect(acceptedAudiences(`${ORIGIN}/api/mcp-bazaar`)).toEqual([`${ORIGIN}/api/mcp-bazaar`, `${ORIGIN}/api/mcp`]);
	});
});

describe('the resource list tracks the published server directory', () => {
	const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../public/.well-known/mcp.json'), 'utf8'));

	it('covers every hosted server whose auth names OAuth', () => {
		const oauthPaths = manifest.servers.filter((s) => /oauth/i.test(s.auth)).map((s) => new URL(s.endpoint).pathname);
		for (const p of oauthPaths) expect(OAUTH_MCP_PATHS, p).toContain(p);
	});

	it('names no path the directory does not publish', () => {
		const published = new Set(manifest.servers.map((s) => new URL(s.endpoint).pathname));
		for (const p of OAUTH_MCP_PATHS) expect(published.has(p), p).toBe(true);
	});
});
