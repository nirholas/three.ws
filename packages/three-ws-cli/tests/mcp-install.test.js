// `three-ws mcp install | installed | uninstall`: connecting an agent to a
// third-party MCP server through /api/v1/agents/:id/mcp. fetch is stubbed at the
// network boundary; every request the CLI makes is asserted.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeStore } from '../src/store.js';
import { main } from '../src/cli.js';
import { findCatalogEntry } from '../src/commands/mcp.js';

const ORIGIN = 'https://three.ws';
const KEY = 'sk_live_cli_mcp_install_test_key_000000';
const AGENT = '11111111-2222-4333-8444-555555555555';
const CONN = '99999999-8888-4777-8666-555555555555';

const CATALOG = {
	servers: [
		{ id: 'deepwiki', name: 'DeepWiki', category: 'docs', runtime: 'hosted', auth: { type: 'none' }, docs: 'https://docs.devin.ai' },
		{ id: 'github', name: 'GitHub', category: 'developer', runtime: 'hosted', auth: { type: 'oauth', registration: 'platform', alt: 'bearer', tokenHelp: 'A fine-grained token.' }, docs: 'https://github.com' },
		{ id: 'filesystem', name: 'Filesystem', category: 'local', runtime: 'local', auth: { type: 'none' }, docs: 'https://example.invalid/fs' },
	],
};

function connection(over = {}) {
	return {
		id: CONN,
		name: 'deepwiki',
		label: 'DeepWiki',
		catalog_id: 'deepwiki',
		status: 'active',
		auth_type: 'none',
		tool_prefix: 'ext_deepwiki_',
		tools: [
			{ name: 'ask_question', tier: 'read', enabled: true },
			{ name: 'read_wiki_contents', tier: 'read', enabled: true },
		],
		tool_counts: { total: 2, enabled: 2, read: 2, write: 0, financial: 0 },
		last_error: null,
		...over,
	};
}

function tempEnv() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-mcp-install-'));
	return { home, platform: process.platform, cwd: home, vars: { THREE_WS_NO_BROWSER: '1' } };
}

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function run(argv, env) {
	let out = '';
	const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		out += String(chunk);
		return true;
	});
	const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	try {
		const code = await main(argv, env);
		return { code, out, json: argv.includes('--json') && out ? JSON.parse(out) : null };
	} finally {
		write.mockRestore();
		err.mockRestore();
	}
}

/** Route stubbed fetches by method and path so the order of calls does not matter. */
function router(routes) {
	return vi.fn(async (url, init = {}) => {
		const u = new URL(url);
		const key = `${init.method || 'GET'} ${u.pathname}`;
		const handler = routes[key];
		if (!handler) throw new Error(`unexpected request ${key}`);
		return handler(init);
	});
}

describe('findCatalogEntry', () => {
	it('matches by id, id without -mcp, and display name', () => {
		const servers = [{ id: 'linear-mcp', name: 'Linear' }, { id: 'deepwiki', name: 'DeepWiki' }];
		expect(findCatalogEntry(servers, 'linear')?.id).toBe('linear-mcp');
		expect(findCatalogEntry(servers, 'linear-mcp')?.id).toBe('linear-mcp');
		expect(findCatalogEntry(servers, 'DeepWiki')?.id).toBe('deepwiki');
		expect(findCatalogEntry(servers, 'nothing')).toBeNull();
	});
});

describe('three-ws mcp install', () => {
	let env;
	beforeEach(() => {
		env = tempEnv();
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
	});
	afterEach(() => vi.unstubAllGlobals());

	const base = `/api/v1/agents/${AGENT}/mcp`;
	const agents = () => reply(200, { agents: [{ id: AGENT, name: 'Nova' }] });

	it('connects a no-auth catalog server and reports the ext_ tool prefix', async () => {
		const fetchMock = router({
			'GET /api/mcp-connections/catalog': () => reply(200, CATALOG),
			'GET /api/agents': agents,
			[`POST ${base}`]: () => reply(201, { data: connection() }),
		});
		vi.stubGlobal('fetch', fetchMock);
		const { code, json } = await run(['mcp', 'install', 'deepwiki', '--agent', 'Nova', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST');
		expect(post[0]).toBe(`${ORIGIN}${base}`);
		expect(post[1].headers.authorization).toBe(`Bearer ${KEY}`);
		expect(JSON.parse(post[1].body)).toEqual({ catalog_id: 'deepwiki' });
		expect(json.connection).toMatchObject({ id: CONN, status: 'active', tool_prefix: 'ext_deepwiki_', enabled_tools: ['ask_question', 'read_wiki_contents'] });
		expect(json.authorization_url).toBeNull();
	});

	it('starts OAuth for a server that signs in and hands back the authorization URL', async () => {
		const authUrl = 'https://github.com/login/oauth/authorize?client_id=x&state=s';
		const fetchMock = router({
			'GET /api/mcp-connections/catalog': () => reply(200, CATALOG),
			'GET /api/agents': agents,
			[`POST ${base}`]: () => reply(201, { data: connection({ name: 'github', label: 'GitHub', status: 'pending_auth', auth_type: 'oauth', tools: [], tool_counts: { total: 0, enabled: 0, read: 0, write: 0, financial: 0 } }) }),
			[`POST ${base}/${CONN}/auth`]: (init) => {
				expect(JSON.parse(init.body)).toEqual({ return_to: '/mcp-integrations' });
				return reply(200, { data: { authorization_url: authUrl } });
			},
		});
		vi.stubGlobal('fetch', fetchMock);
		const { code, json } = await run(['mcp', 'install', 'github', '--agent', AGENT, '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(json.authorization_url).toBe(authUrl);
		expect(json.connection.status).toBe('pending_auth');
	});

	it('sends a pasted token as bearer_token', async () => {
		const fetchMock = router({
			'GET /api/mcp-connections/catalog': () => reply(200, CATALOG),
			'GET /api/agents': agents,
			[`POST ${base}`]: (init) => {
				expect(JSON.parse(init.body)).toEqual({ catalog_id: 'github', bearer_token: 'github_pat_synthetic_000' });
				return reply(201, { data: connection({ name: 'github', auth_type: 'bearer' }) });
			},
		});
		vi.stubGlobal('fetch', fetchMock);
		const { code } = await run(['mcp', 'install', 'github', '--agent', AGENT, '--token', 'github_pat_synthetic_000', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
	});

	it('sends a custom https URL as server_url and leaves it for review', async () => {
		const fetchMock = router({
			'GET /api/agents': agents,
			[`POST ${base}`]: (init) => {
				expect(JSON.parse(init.body)).toEqual({ server_url: 'https://mcp.example.com/mcp', label: 'Example' });
				return reply(201, { data: connection({ catalog_id: null, status: 'pending_review', tools: [{ name: 'search', tier: 'read', enabled: false }], tool_counts: { total: 1, enabled: 0, read: 1, write: 0, financial: 0 } }) });
			},
		});
		vi.stubGlobal('fetch', fetchMock);
		const { code, out } = await run(['mcp', 'install', 'https://mcp.example.com/mcp', '--agent', AGENT, '--label', 'Example', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(out).toContain('pending review');
		expect(out).toContain(`/mcp-integrations?agent=${AGENT}`);
	});

	it('refuses an unknown name with suggestions and makes no write', async () => {
		const fetchMock = router({ 'GET /api/mcp-connections/catalog': () => reply(200, CATALOG) });
		vi.stubGlobal('fetch', fetchMock);
		const { code, json } = await run(['mcp', 'install', 'deep', '--agent', AGENT, '--json', '--origin', ORIGIN], env);
		expect(code).toBe(2);
		expect(json.message).toContain('deepwiki');
		expect(fetchMock.mock.calls.every(([, i]) => !i?.method || i.method === 'GET')).toBe(true);
	});

	it('refuses a local-only server with its install instructions', async () => {
		vi.stubGlobal('fetch', router({ 'GET /api/mcp-connections/catalog': () => reply(200, CATALOG) }));
		const { code, json } = await run(['mcp', 'install', 'filesystem', '--agent', AGENT, '--json', '--origin', ORIGIN], env);
		expect(code).toBe(2);
		expect(json.message).toContain('https://example.invalid/fs');
	});

	it('surfaces the server refusal (a blocked private URL) instead of a bare status', async () => {
		vi.stubGlobal('fetch', router({
			'GET /api/agents': agents,
			[`POST ${base}`]: () => reply(400, { error: { code: 'blocked_url', message: 'That address is on a private network.' } }),
		}));
		const { code, json } = await run(['mcp', 'install', 'https://10.0.0.5/mcp', '--agent', AGENT, '--json', '--origin', ORIGIN], env);
		expect(code).toBe(2);
		expect(json.message).toContain('private network');
	});
});

describe('three-ws mcp installed / uninstall', () => {
	let env;
	beforeEach(() => {
		env = tempEnv();
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
	});
	afterEach(() => vi.unstubAllGlobals());

	const base = `/api/v1/agents/${AGENT}/mcp`;
	const agents = () => reply(200, { agents: [{ id: AGENT, name: 'Nova' }] });

	it('lists connections without any credential field', async () => {
		vi.stubGlobal('fetch', router({ 'GET /api/agents': agents, [`GET ${base}`]: () => reply(200, { data: [connection()] }) }));
		const { code, json } = await run(['mcp', 'installed', '--agent', AGENT, '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(json.connections).toHaveLength(1);
		expect(JSON.stringify(json)).not.toMatch(/credentials|token_enc|bearer/i);
	});

	it('removes a connection by name with DELETE', async () => {
		const fetchMock = router({
			'GET /api/agents': agents,
			[`GET ${base}`]: () => reply(200, { data: [connection()] }),
			[`DELETE ${base}/${CONN}`]: () => reply(200, { data: { id: CONN, deleted: true } }),
		});
		vi.stubGlobal('fetch', fetchMock);
		const { code, json } = await run(['mcp', 'uninstall', 'deepwiki', '--agent', AGENT, '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(json).toEqual({ agent: AGENT, removed: CONN, name: 'deepwiki' });
		expect(fetchMock.mock.calls.some(([u, i]) => i?.method === 'DELETE' && u.endsWith(`/mcp/${CONN}`))).toBe(true);
	});

	it('explains a name that is not connected', async () => {
		vi.stubGlobal('fetch', router({ 'GET /api/agents': agents, [`GET ${base}`]: () => reply(200, { data: [] }) }));
		const { code, json } = await run(['mcp', 'uninstall', 'linear', '--agent', AGENT, '--json', '--origin', ORIGIN], env);
		expect(code).toBe(2);
		expect(json.message).toContain('three-ws mcp installed');
	});
});
