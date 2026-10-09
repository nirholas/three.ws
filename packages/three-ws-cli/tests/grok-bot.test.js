import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeStore, readStore } from '../src/store.js';
import { main } from '../src/cli.js';
import { hostedServers } from '../src/servers.js';
import { getClient, REMOTE_CLIENTS, isRemote } from '../src/clients/index.js';
import { recommendedServer, modesFor, defaultMode, parseMode, connectorUrl, connectorFields, isPublicUrl, connectorKeyProblem } from '../src/remote.js';
import { copyToClipboard, clipboardCommands } from '../src/clipboard.js';

const ORIGIN = 'https://three.ws';
const KEY = 'sk_live_cli_grok_test_signin_key_000000';
const CONNECTOR = 'sk_live_cli_grok_test_connector_key_00';

// Fixture: the directory this repo publishes at /.well-known/mcp.json, and the
// same document as a deployment that predates its `clients` block and the Grok
// surface (production on 2026-10-09).
const DIRECTORY = JSON.parse(fs.readFileSync(new URL('../../../public/.well-known/mcp.json', import.meta.url), 'utf8'));
const OLD_DIRECTORY = (() => {
	const { clients: _clients, ...rest } = DIRECTORY;
	return { ...rest, servers: rest.servers.filter((s) => !s.endpoint.endsWith('/api/mcp-grok')) };
})();

function tempEnv() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-grok-'));
	return { home, platform: process.platform, cwd: home, vars: { THREE_WS_NO_BROWSER: '1', THREE_WS_NO_CLIPBOARD: '1', XDG_CONFIG_HOME: path.join(home, '.config') } };
}

function reply(status, body, headers = {}) {
	return new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const toolList = (n) => Array.from({ length: n }, (_, i) => ({ name: `tool_${i}`, description: 'fixture tool', inputSchema: { type: 'object' } }));

/**
 * A fetch that answers like the platform: the directory, the install mint, the
 * key routes, and Streamable HTTP MCP servers. `anonTools` and `keyTools` are
 * how many tools tools/list returns without and with a bearer.
 */
function platformFetch({ directory = DIRECTORY, anonTools = 15, keyTools = 26, install = 'ok', keyMint = 'ok', whoamiScope = 'avatars:read agents:read memory:read connector' } = {}) {
	return vi.fn(async (url, init = {}) => {
		const u = new URL(url);
		const auth = init.headers?.authorization || null;
		if (u.pathname === '/.well-known/mcp.json') return reply(200, directory);
		if (u.pathname === '/api/mcp-studio/install') {
			if (install === 'missing') return reply(404, { error: 'not_found', message: 'No API route matches /api/mcp-studio/install.' });
			const token = 'tws_tmm834_3cd31c19c4ac43d0e72e539055edb441f0b7a6eb10676d4479c2314dd207f2fe';
			return reply(201, {
				token,
				created_at: '2026-10-09T00:59:19.000Z',
				connector_url: `${u.origin}/api/mcp-studio?install=${token}`,
				connector_urls: { studio: `${u.origin}/api/mcp-studio?install=${token}`, grok: `${u.origin}/api/mcp-grok?install=${token}`, chatgpt: `${u.origin}/api/mcp-chatgpt?install=${token}` },
				limits: { generations_per_minute: 3, generations_per_hour: 20, requests_per_minute: 120 },
			});
		}
		if (u.pathname === '/api/cli/whoami') {
			if (auth === `Bearer ${KEY}`) return reply(200, { user: { id: 'u1', email: 'qa@three.ws' }, credential: { source: 'apikey', scope: 'profile avatars:read avatars:write agents:read memory:read memory:write wallet:read' } });
			if (auth === `Bearer ${CONNECTOR}`) return reply(200, { user: { id: 'u1' }, credential: { source: 'apikey', scope: whoamiScope } });
			return reply(401, { error: 'invalid_token' });
		}
		if (u.pathname === '/api/api-keys' && init.method === 'POST') {
			if (keyMint === 'old') return reply(400, { error: 'validation_error', error_description: 'unknown scopes: connector' });
			return reply(201, { data: { id: 'k-conn', name: 'Grok Bot', prefix: CONNECTOR.slice(0, 12), scope: 'avatars:read avatars:write agents:read memory:read memory:write connector', token: CONNECTOR } });
		}
		if (/^\/api\/mcp/.test(u.pathname)) {
			const body = JSON.parse(init.body);
			if (u.searchParams.get('auth') === 'oauth' && !auth) {
				return reply(401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${u.origin}/.well-known/oauth-protected-resource${u.pathname}", resource="${u.origin}${u.pathname}"` });
			}
			if (body.method === 'initialize') return reply(200, { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'three-ws-3d-studio-free', version: '1.0.0' } } }, { 'mcp-session-id': 'grk_fixture' });
			if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
			if (body.method === 'tools/list') return reply(200, { jsonrpc: '2.0', id: body.id, result: { tools: toolList(auth ? keyTools : anonTools) } });
		}
		if (u.pathname.startsWith('/.well-known/oauth-protected-resource')) return reply(200, { resource: `${u.origin}/api/mcp-grok`, authorization_servers: [u.origin] });
		return reply(404, { error: 'not_found' });
	});
}

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

const grok = getClient('grok-bot');
const servers = (directory) => hostedServers(directory, ORIGIN);

describe('the grok-bot client', () => {
	it('is a remote client: never detected, nothing to write', () => {
		expect(isRemote(grok)).toBe(true);
		expect(REMOTE_CLIENTS.map((c) => c.id)).toContain('grok-bot');
		expect(grok.configPath).toBeUndefined();
	});

	it('recommends the server the directory names for it', () => {
		expect(recommendedServer(grok, DIRECTORY, servers(DIRECTORY)).path).toBe('/api/mcp-grok');
	});

	it('falls back to the free studio on a deployment with no Grok surface', () => {
		expect(recommendedServer(grok, OLD_DIRECTORY, servers(OLD_DIRECTORY)).path).toBe('/api/mcp-studio');
	});

	it('offers every mode on the Grok surface and only keyed modes on an account server', () => {
		const all = servers(DIRECTORY);
		const grokServer = all.find((s) => s.path === '/api/mcp-grok');
		expect(grokServer.keyless).toBe(true);
		expect(modesFor(grokServer)).toEqual(['none', 'install', 'key', 'oauth']);
		expect(modesFor(all.find((s) => s.path === '/api/mcp-studio'))).toEqual(['none', 'install']);
		expect(modesFor(all.find((s) => s.path === '/api/mcp'))).toEqual(['key', 'oauth']);
		expect(defaultMode(grok, DIRECTORY, grokServer)).toBe('none');
		expect(defaultMode(grok, DIRECTORY, all.find((s) => s.path === '/api/mcp'))).toBe('key');
	});

	it('parses --auth with the directory spelling too', () => {
		expect(parseMode('api-key')).toBe('key');
		expect(parseMode('OAuth')).toBe('oauth');
		expect(() => parseMode('x402')).toThrow(/none, install, key, oauth/);
	});

	it('asks for sign-in with ?auth=oauth only where anonymous callers are otherwise served', () => {
		const all = servers(DIRECTORY);
		expect(connectorUrl(all.find((s) => s.path === '/api/mcp-grok'), 'oauth')).toBe(`${ORIGIN}/api/mcp-grok?auth=oauth`);
		expect(connectorUrl(all.find((s) => s.path === '/api/mcp'), 'oauth')).toBe(`${ORIGIN}/api/mcp`);
	});

	it('prints the key fields Grok Bot asks for', () => {
		const server = servers(DIRECTORY).find((s) => s.path === '/api/mcp-grok');
		expect(connectorFields({ client: grok, server, mode: 'key', url: server.url, key: CONNECTOR })).toEqual([
			['Name', 'three-ws-grok'],
			['Transport', 'Streamable HTTP'],
			['Server URL', `${ORIGIN}/api/mcp-grok`],
			['Authentication', 'API key'],
			['Header', 'Authorization'],
			['Value', `Bearer ${CONNECTOR}`],
		]);
	});

	it('treats only a public https host as reachable from a cloud agent', () => {
		expect(isPublicUrl('https://three.ws/api/mcp-grok')).toBe(true);
		for (const u of ['http://three.ws/api/mcp', 'https://localhost:3000/api/mcp', 'https://127.0.0.1/api/mcp', 'https://192.168.1.4/api/mcp', 'https://box.local/api/mcp', 'https://[::1]/api/mcp']) {
			expect(isPublicUrl(u), u).toBe(false);
		}
	});

	it('refuses to hand a key that can spend to an unattended connector', () => {
		expect(connectorKeyProblem('avatars:read wallet:write')).toMatch(/wallet:write/);
		expect(connectorKeyProblem('avatars:read agents:read connector')).toBeNull();
	});
});

describe('clipboard', () => {
	it('uses the OS tool and reports which one took the text', () => {
		const run = vi.fn(() => ({ status: 0 }));
		expect(copyToClipboard('https://three.ws/api/mcp-grok', { platform: 'darwin', env: {}, run })).toBe('pbcopy');
		expect(run.mock.calls[0][2].input).toBe('https://three.ws/api/mcp-grok');
	});

	it('tries the next Linux tool when one is missing, and gives up quietly with no display', () => {
		const run = vi.fn((cmd) => (cmd === 'xclip' ? { error: new Error('ENOENT') } : { status: 0 }));
		expect(copyToClipboard('x', { platform: 'linux', env: { DISPLAY: ':0' }, run })).toBe('xsel');
		expect(clipboardCommands({ platform: 'linux', env: {} })).toEqual([]);
		expect(copyToClipboard('x', { platform: 'linux', env: {}, run })).toBeNull();
	});
});

describe('three-ws setup --client grok-bot', () => {
	let env;
	afterEach(() => vi.unstubAllGlobals());
	beforeEach(() => {
		env = tempEnv();
	});

	it('prints the free connector and passes the live check without signing in', async () => {
		const fetchMock = platformFetch();
		vi.stubGlobal('fetch', fetchMock);
		const { code, json } = await run(['setup', '--client', 'grok-bot', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		const [r] = json.remote;
		expect(r).toMatchObject({ id: 'grok-bot', server: 'three-ws-grok', auth: 'none', url: `${ORIGIN}/api/mcp-grok`, ok: true, error: null });
		expect(r.fields).toEqual({ Name: 'three-ws-grok', Transport: 'Streamable HTTP', 'Server URL': `${ORIGIN}/api/mcp-grok`, Authentication: 'None' });
		expect(r.say).toBe(`Add a custom MCP server called three-ws-grok at ${ORIGIN}/api/mcp-grok`);
		expect(r.checks.map((c) => [c.id, c.ok])).toEqual([['public', true], ['tools', true]]);
		expect(r.checks[1].detail).toBe('15 tools from three-ws-3d-studio-free 1.0.0');
		expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/cli/whoami'))).toBe(false);
	});

	it('connects the free studio on a deployment that predates the Grok surface', async () => {
		vi.stubGlobal('fetch', platformFetch({ directory: OLD_DIRECTORY, anonTools: 14 }));
		const { code, json } = await run(['setup', '--client', 'grok-bot', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(json.remote[0]).toMatchObject({ server: 'three-ws-studio', url: `${ORIGIN}/api/mcp-studio`, ok: true });
	});

	it('mints an install token once and reuses it on the next run', async () => {
		const fetchMock = platformFetch();
		vi.stubGlobal('fetch', fetchMock);
		const first = await run(['setup', '--client', 'grok-bot', '--auth', 'install', '--json', '--origin', ORIGIN], env);
		expect(first.code).toBe(0);
		expect(first.json.remote[0].url).toMatch(/^https:\/\/three\.ws\/api\/mcp-grok\?install=tws_/);
		expect(first.json.remote[0].fields.Authentication).toBe('None');
		const second = await run(['setup', '--client', 'grok-bot', '--auth', 'install', '--json', '--origin', ORIGIN], env);
		expect(second.json.remote[0].url).toBe(first.json.remote[0].url);
		expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/api/mcp-studio/install'))).toHaveLength(1);
	});

	it('says plainly when the deployment cannot mint install tokens', async () => {
		vi.stubGlobal('fetch', platformFetch({ install: 'missing' }));
		const { code, json } = await run(['setup', '--client', 'grok-bot', '--auth', 'install', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(1);
		expect(json.remote[0].error).toMatch(/cannot mint install tokens yet/);
	});

	it('mints a connector key for the signed-in account and checks it signed in', async () => {
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		const fetchMock = platformFetch();
		vi.stubGlobal('fetch', fetchMock);
		const { code, json } = await run(['setup', '--client', 'grok-bot', '--auth', 'key', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		const [r] = json.remote;
		expect(r.fields).toMatchObject({ Authentication: 'API key', Header: 'Authorization', Value: `Bearer ${CONNECTOR}` });
		expect(r.say).toBeNull();
		expect(r.key).toMatchObject({ connector: true, reused: false });
		expect(r.checks[1].detail).toMatch(/^26 tools/);
		const mint = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/api/api-keys') && i.method === 'POST');
		expect(mint[1].headers.authorization).toBe(`Bearer ${KEY}`);
		expect(JSON.parse(mint[1].body)).toMatchObject({ preset: 'connector' });
		expect(readStore(env).connector_keys[ORIGIN]).toMatchObject({ key: CONNECTOR, key_id: 'k-conn' });
	});

	it('never mints a wider key on a deployment without the connector preset', async () => {
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		vi.stubGlobal('fetch', platformFetch({ keyMint: 'old' }));
		const { code, json } = await run(['setup', '--client', 'grok-bot', '--auth', 'key', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(1);
		expect(json.remote[0].error).toMatch(/cannot mint connector keys from the CLI yet.*--connector-key/);
		expect(readStore(env).connector_keys).toBeUndefined();
	});

	it('takes a key passed with --connector-key and refuses one that can spend', async () => {
		vi.stubGlobal('fetch', platformFetch());
		const ok = await run(['setup', '--client', 'grok-bot', '--connector-key', CONNECTOR, '--json', '--origin', ORIGIN], env);
		expect(ok.code).toBe(0);
		expect(ok.json.remote[0]).toMatchObject({ auth: 'key', key: { connector: true, reused: true } });

		vi.stubGlobal('fetch', platformFetch({ whoamiScope: 'avatars:read wallet:write' }));
		const refused = await run(['setup', '--client', 'grok-bot', '--connector-key', CONNECTOR, '--json', '--origin', ORIGIN], env);
		expect(refused.code).toBe(1);
		expect(refused.json.remote[0].error).toMatch(/wallet:write, which moves funds/);
	});

	it('checks OAuth from outside: a 401 challenge and a published authorization server', async () => {
		vi.stubGlobal('fetch', platformFetch());
		const { code, json } = await run(['setup', '--client', 'grok-bot', '--auth', 'oauth', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		const [r] = json.remote;
		expect(r.url).toBe(`${ORIGIN}/api/mcp-grok?auth=oauth`);
		expect(r.fields).toMatchObject({ Authentication: 'OAuth 2.1', 'Client ID': 'leave empty: the connector registers itself' });
		expect(r.checks.map((c) => [c.id, c.ok])).toEqual([['public', true], ['oauth-challenge', true], ['oauth-metadata', true]]);
	});

	it('fails the live check for a URL a cloud agent cannot reach', async () => {
		vi.stubGlobal('fetch', platformFetch());
		const { code, json } = await run(['setup', '--client', 'grok-bot', '--json', '--origin', 'http://localhost:3107'], env);
		expect(code).toBe(1);
		expect(json.remote[0].checks[0]).toMatchObject({ id: 'public', ok: false });
		expect(json.remote[0].checks[1]).toMatchObject({ id: 'tools', ok: true });
	});

	it('refuses a mode the server does not take', async () => {
		vi.stubGlobal('fetch', platformFetch());
		const { code, json } = await run(['setup', '--client', 'grok-bot', '--servers', 'three-ws-studio', '--auth', 'oauth', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(1);
		expect(json.remote[0].error).toBe('three-ws-studio does not take --auth oauth; it supports none, install');
	});

	it('prints the fields and the live check for a person', async () => {
		vi.stubGlobal('fetch', platformFetch());
		const { code, out } = await run(['setup', '--client', 'grok-bot', '--yes', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(out).toContain('three-ws-grok');
		expect(out).toContain(`${ORIGIN}/api/mcp-grok`);
		expect(out).toContain('Streamable HTTP');
		expect(out).toContain('15 tools');
		expect(out).toContain(`${ORIGIN}/docs/grok-bot`);
	});
});

describe('three-ws mcp add --clients grok-bot', () => {
	it('points at setup, since there is no file to edit', async () => {
		vi.stubGlobal('fetch', platformFetch());
		const { code, json } = await run(['mcp', 'add', 'three-ws-grok', '--clients', 'grok-bot', '--json', '--origin', ORIGIN], tempEnv());
		vi.unstubAllGlobals();
		expect(code).toBe(1);
		expect(json.message).toMatch(/setup --client grok-bot/);
	});
});
