// /api/mcp-grok with and without a credential (x-grok order 029).
//
// One URL a person pastes into Grok Bot once: anonymously it serves the free
// 3D studio, and once the connector holds an OAuth 2.1 token or a connector API
// key it also lists the account's agent tools from the core server. It never
// lists a value-moving tool, whatever the credential's scopes, and it never
// lists a widget template, since Grok renders none. These tests drive the real
// HTTP handler with real minted tokens and a real-shaped api_keys row; only the
// database and the rate limiter are replaced.

import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

// A connector key as POST /api/keys {preset:"connector"} stores it.
const CONNECTOR_KEY = 'sk_live_fixture_grok_connector_0123456789abcdef';
const CONNECTOR_KEY_HASH = createHash('sha256').update(CONNECTOR_KEY).digest('hex');
const CONNECTOR_ROW = {
	id: '6f1d2c3b-0000-4000-8000-00000000c0de',
	user_id: '9a8b7c6d-0000-4000-8000-0000000000aa',
	scope: 'avatars:read avatars:write agents:read agents:write memory:read memory:write connector',
	expires_at: null,
	revoked_at: null,
};

const queries = [];
vi.mock('../api/_lib/db.js', () => {
	// Tagged-template queries, plus the plain sql(text, params) form the avatar
	// listing uses.
	const sql = (strings, ...values) => {
		if (!Array.isArray(strings)) {
			queries.push(String(strings));
			return Promise.resolve([]);
		}
		const text = strings.join('?');
		queries.push(text);
		if (/from api_keys where token_hash/.test(text)) return Promise.resolve(values.includes(CONNECTOR_KEY_HASH) ? [CONNECTOR_ROW] : []);
		return Promise.resolve([]);
	};
	return {
		sql,
		isDbUnavailableError: () => false,
		isDbCapacityError: () => false,
		isStoragePressured: () => false,
	};
});

vi.mock('../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const real = await importOriginal();
	const pass = async () => ({ success: true, limit: 1, remaining: 1, reset: Date.now() + 1000 });
	return {
		...real,
		limits: {
			...real.limits,
			studioIp: pass,
			studioGenBurst: pass,
			studioGenHourly: pass,
			studioGenPoolHourly: pass,
			studioGenerateGlobal: pass,
			mcpUser: pass,
			agentDelegate: pass,
		},
	};
});

const { default: grokHandler } = await import('../api/mcp-grok.js');
const { default: studioHandler } = await import('../api/mcp-studio.js');
const { default: wkHandler } = await import('../api/wk.js');
const { mintAccessToken } = await import('../api/_lib/auth.js');
const { POLICY } = await import('@three-ws/mcp-policy');
const { TOOLS: CORE_TOOLS } = await import('../api/_mcp/catalog.js');
const { dispatch: coreDispatch } = await import('../api/_mcp/dispatch.js');
const { toolCatalogFor } = await import('../api/_mcp-studio/dispatch.js');
const { GROK_ACCOUNT_TOOLS, movesValue } = await import('../api/_mcp-studio/account-tools.js');
const { parseWwwAuthenticate } = await import('../scripts/mcp-client-probe.mjs');

const ORIGIN = 'https://three.ws';
const USER = '9a8b7c6d-0000-4000-8000-0000000000bb';
// Every scope an OAuth client can be granted, spend included: the surface must
// still refuse to list or run a value-moving tool.
const EVERY_SCOPE = 'avatars:read avatars:write avatars:delete agents:read agents:write memory:read memory:write wallet:read wallet:write services:write profile';
const CONNECTOR_SCOPE = 'avatars:read avatars:write agents:read agents:write memory:read memory:write';
// Every hosted server id the policy table knows, so "value-moving" means
// value-moving anywhere, not only on the core server.
const SERVER_IDS = Object.keys(POLICY);

function rpc(method, params = {}, id = 1) {
	return { jsonrpc: '2.0', id, method, params };
}

// A minimal node-style req/res pair for driving the real HTTP handler.
function httpPair(body, { headers = {}, url = '/api/mcp-grok' } = {}) {
	const payload = Buffer.from(JSON.stringify(body));
	const req = {
		method: 'POST',
		url,
		headers: {
			host: 'three.ws',
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'x-forwarded-for': '203.0.113.29',
			...headers,
		},
		socket: { remoteAddress: '203.0.113.29' },
		async *[Symbol.asyncIterator]() {
			yield payload;
		},
		on(event, cb) {
			if (event === 'data') cb(payload);
			if (event === 'end') cb();
			return this;
		},
	};
	const out = { headers: {}, body: '', status: 200 };
	const res = {
		statusCode: 200,
		headersSent: false,
		setHeader(k, v) {
			out.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return out.headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete out.headers[k.toLowerCase()];
		},
		end(chunk) {
			if (chunk) out.body += chunk;
			out.status = this.statusCode;
			this.headersSent = true;
		},
		write(chunk) {
			out.body += chunk;
		},
	};
	return { req, res, out };
}

async function post(handler, body, opts) {
	const { req, res, out } = httpPair(body, opts);
	await handler(req, res);
	return { status: out.status, headers: out.headers, json: out.body ? JSON.parse(out.body) : null };
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });

async function oauthToken(scope, resource = `${ORIGIN}/api/mcp-grok`) {
	return mintAccessToken({ userId: USER, clientId: 'grok-bot-client', scope, resource });
}

async function listNames(headers = {}, opts = {}) {
	const r = await post(grokHandler, rpc('tools/list'), { headers, ...opts });
	expect(r.status).toBe(200);
	return r.json.result.tools;
}

function expectNoValueMoving(tools) {
	for (const t of tools) {
		expect(movesValue(t.name, CORE_TOOLS), `${t.name} moves value`).toBe(false);
		expect(String(CORE_TOOLS[t.name]?.scope || ''), `${t.name} scope`).not.toMatch(/wallet|payment|trade|launch/);
		for (const server of SERVER_IDS) expect(POLICY[server]?.[t.name]?.tier, `${t.name} tier on ${server}`).not.toBe('financial');
		expect(t.pricing, `${t.name} price`).toBeUndefined();
		expect(PRICED_ON_CORE.has(t.name), `${t.name} is priced on /api/mcp`).toBe(false);
	}
}

// What an anonymous caller is offered: the studio as the policy lists it.
const STUDIO_NAMES = (await post(grokHandler, rpc('tools/list'))).json.result.tools.map((t) => t.name).sort();

// Every tool the core server advertises a price for, read from its own
// tools/list with everything switched on.
const PRICED_ON_CORE = new Set(
	(
		await coreDispatch(
			rpc('tools/list'),
			{ userId: null, rateKey: 'test', scope: EVERY_SCOPE },
			{ headers: { 'x-three-tools': 'default,financial' } },
		)
	).result.tools
		.filter((t) => t.pricing)
		.map((t) => t.name),
);

describe('anonymous /api/mcp-grok', () => {
	it('lists the free studio and no account tool', async () => {
		const tools = await listNames();
		const names = tools.map((t) => t.name).sort();
		const catalog = toolCatalogFor('grok').map((t) => t.name);
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) expect(catalog).toContain(name);
		expect(names).toEqual(STUDIO_NAMES);
		for (const name of GROK_ACCOUNT_TOOLS) expect(names).not.toContain(name);
		expectNoValueMoving(tools);
	});

	it('lists no widget template and no ui:// resource, unlike /api/mcp-studio', async () => {
		const tools = await listNames();
		for (const t of tools) expect(Object.keys(t._meta || {}).filter((k) => k.startsWith('openai/')), t.name).toEqual([]);
		const resources = await post(grokHandler, rpc('resources/list'));
		expect(resources.json.result.resources).toEqual([]);
		const init = await post(grokHandler, rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }));
		expect(init.json.result.capabilities.resources).toBeUndefined();

		const studio = await post(studioHandler, rpc('tools/list'), { url: '/api/mcp-studio' });
		expect(studio.json.result.tools.some((t) => t._meta?.['openai/outputTemplate'])).toBe(true);
	});

	it('tells the model how to sign in, and answers an account tool with the sign-in route', async () => {
		const init = await post(grokHandler, rpc('initialize', {}));
		expect(init.json.result.instructions).toContain('?auth=oauth');
		const r = await post(grokHandler, rpc('tools/call', { name: 'list_my_avatars', arguments: {} }));
		expect(r.json.error.code).toBe(-32002);
		expect(r.json.error.data).toMatchObject({ reason: 'sign_in_required', oauth_url: `${ORIGIN}/api/mcp-grok?auth=oauth` });
	});
});

describe('signed-in /api/mcp-grok', () => {
	it('an OAuth token adds the account agent tools to the studio', async () => {
		const tools = await listNames(bearer(await oauthToken(CONNECTOR_SCOPE)));
		const names = tools.map((t) => t.name);
		for (const name of STUDIO_NAMES) expect(names).toContain(name);
		for (const name of ['create_agent', 'attach_avatar_to_agent', 'remember', 'recall', 'list_my_avatars', 'create_custom_skill']) {
			expect(names).toContain(name);
		}
		expect(new Set(names).size).toBe(names.length);
		expectNoValueMoving(tools);
	});

	it('a connector API key adds them too, capped to what the key may do', async () => {
		const tools = await listNames(bearer(CONNECTOR_KEY));
		const names = tools.map((t) => t.name);
		expect(names).toEqual(expect.arrayContaining(['create_agent', 'remember', 'recall', 'list_my_avatars']));
		expect(queries.some((q) => /from api_keys where token_hash/.test(q))).toBe(true);
		expectNoValueMoving(tools);
	});

	it('lists no value-moving tool even for a grant holding every scope with the financial tier switched on', async () => {
		const tools = await listNames({ ...bearer(await oauthToken(EVERY_SCOPE)), 'x-three-tools': 'default,financial' });
		expect(PRICED_ON_CORE.size).toBeGreaterThan(0);
		expectNoValueMoving(tools);
		const names = tools.map((t) => t.name);
		for (const name of ['agent_card_create', 'agent_card_quote', 'oracle_arm_watch', 'delete_avatar', 'forget', 'register_agent', 'home_call']) {
			expect(names).not.toContain(name);
		}
	});

	it('refuses to run a core wallet tool by name, whatever the grant', async () => {
		const r = await post(grokHandler, rpc('tools/call', { name: 'agent_card_create', arguments: { quote_id: 'q', confirm_spend: true } }), {
			headers: bearer(await oauthToken(EVERY_SCOPE)),
		});
		expect(r.json.error.code).toBe(-32602);
		expect(r.json.error.message).toContain('unknown tool');
	});

	it('lists only the account tools the grant can use', async () => {
		const names = (await listNames(bearer(await oauthToken('avatars:read')))).map((t) => t.name);
		expect(names).toContain('list_my_avatars');
		expect(names).not.toContain('create_agent');
		expect(names).not.toContain('remember');
	});

	it('refuses an account tool the grant cannot use, naming why', async () => {
		const r = await post(grokHandler, rpc('tools/call', { name: 'create_agent', arguments: { name: 'Scout' } }), {
			headers: bearer(await oauthToken('avatars:read')),
		});
		expect(r.json.error.code).toBe(-32002);
		expect(r.json.error.data.reason).toBe('tool_not_granted');
	});

	it('runs an account tool through the core dispatcher as the signed-in account', async () => {
		const r = await post(grokHandler, rpc('tools/call', { name: 'list_my_avatars', arguments: {} }), {
			headers: bearer(await oauthToken(CONNECTOR_SCOPE)),
		});
		expect(r.status).toBe(200);
		expect(r.json.error).toBeUndefined();
		expect(r.json.result.isError).toBeFalsy();
		expect(queries.some((q) => /avatars/i.test(q) && /owner_id/i.test(q))).toBe(true);
	});

	it('names the account in the instructions and keeps studio tools anonymous', async () => {
		const init = await post(grokHandler, rpc('initialize', {}), { headers: bearer(CONNECTOR_KEY) });
		expect(init.json.result.instructions).toContain('signed in to a three.ws account');
		expect(init.json.result.instructions).toContain('never move funds');
	});
});

describe('the OAuth door', () => {
	async function expectGrokChallenge(r) {
		expect(r.status).toBe(401);
		const parsed = parseWwwAuthenticate(r.headers['www-authenticate']);
		expect(parsed.params.resource).toBe(`${ORIGIN}/api/mcp-grok`);
		expect(parsed.params.resource_metadata).toBe(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp-grok`);
		// The document the challenge points at must pass the MCP SDK's own check.
		const md = httpPair(null, { url: '/api/wk?name=oauth-protected-resource&path=/api/mcp-grok' });
		md.req.method = 'GET';
		await wkHandler(md.req, md.res);
		const doc = JSON.parse(md.out.body);
		expect(doc.resource).toBe(`${ORIGIN}/api/mcp-grok`);
		expect(checkResourceAllowed({ requestedResource: `${ORIGIN}/api/mcp-grok?auth=oauth`, configuredResource: doc.resource })).toBe(true);
	}

	it('an invalid bearer is told to re-authenticate, never served anonymously', async () => {
		const r = await post(grokHandler, rpc('tools/list'), { headers: bearer('expired.or.forged') });
		await expectGrokChallenge(r);
	});

	it('?auth=oauth refuses an anonymous client so a connector set to OAuth 2.1 starts sign-in', async () => {
		const r = await post(grokHandler, rpc('initialize', {}), { url: '/api/mcp-grok?auth=oauth' });
		await expectGrokChallenge(r);
		const signedIn = await post(grokHandler, rpc('tools/list'), {
			url: '/api/mcp-grok?auth=oauth',
			headers: bearer(await oauthToken(CONNECTOR_SCOPE)),
		});
		expect(signedIn.status).toBe(200);
		expect(signedIn.json.result.tools.map((t) => t.name)).toContain('create_agent');
	});

	it('a token minted for another hosted server is refused here', async () => {
		const r = await post(grokHandler, rpc('tools/list'), { headers: bearer(await oauthToken(CONNECTOR_SCOPE, `${ORIGIN}/api/mcp-3d`)) });
		expect(r.status).toBe(401);
	});

	it('a platform token (what npx three-ws setup holds) works here', async () => {
		const names = (await listNames(bearer(await oauthToken(CONNECTOR_SCOPE, `${ORIGIN}/api/mcp`)))).map((t) => t.name);
		expect(names).toContain('create_agent');
	});
});
