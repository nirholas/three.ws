import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeStore, readStore } from '../src/store.js';
import { main } from '../src/cli.js';
import { copyText } from '../src/clipboard.js';
import { isLocalHost, getRemoteClient } from '../src/clients/remote.js';

const ORIGIN = 'https://three.ws';
const GROK_URL = `${ORIGIN}/api/mcp-grok`;
const KEY = 'sk_live_cli_grok_connector_00000000';

function tempEnv() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-grok-'));
	return { home, platform: process.platform, cwd: home, vars: { THREE_WS_NO_BROWSER: '1' } };
}

function reply(status, body, headers = {}) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
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

/** A Streamable HTTP MCP server that lists `names` as its tools. */
function mcpServer(names, { onRequest } = {}) {
	return vi.fn(async (url, init) => {
		onRequest?.(String(url), init);
		const msg = JSON.parse(init.body);
		if (msg.method === 'initialize') return reply(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'grok', version: '1' } } }, { 'mcp-session-id': 's1' });
		if (msg.method === 'tools/list') return reply(200, { jsonrpc: '2.0', id: msg.id, result: { tools: names.map((name) => ({ name, inputSchema: { type: 'object' } })) } });
		return new Response(null, { status: 202 });
	});
}

describe('three-ws setup --client grok-bot', () => {
	let env;
	beforeEach(() => {
		env = tempEnv();
	});
	afterEach(() => vi.unstubAllGlobals());

	it('prints the connector fields and verifies the public URL without any sign-in', async () => {
		const calls = [];
		vi.stubGlobal('fetch', mcpServer(['forge_free', 'search_catalog'], { onRequest: (url, init) => calls.push({ url, auth: init.headers.authorization }) }));
		const { code, json } = await run(['setup', '--client', 'grok-bot', '--json', '--no-copy', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(json.remote).toHaveLength(1);
		const [r] = json.remote;
		expect(r.fields).toEqual({ Name: 'three-ws', Transport: 'Streamable HTTP', 'Server URL': GROK_URL, Authentication: 'None' });
		expect(r.chat_prompt).toBe(`Add a custom MCP server called three-ws at ${GROK_URL}`);
		expect(r).toMatchObject({ verified: true, tools: 2, api_key: null, reachable_from_cloud: true, copied: false });
		expect(calls.every((c) => c.url === GROK_URL && c.auth === undefined)).toBe(true);
		expect(readStore(env).auth).toBeNull();
	});

	it('renders the human output with the URL and the verification line', async () => {
		vi.stubGlobal('fetch', mcpServer(['forge_free']));
		const { code, out } = await run(['setup', '--clients', 'grok-bot', '--no-copy', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(out).toContain('Grok Bot');
		expect(out).toContain(`Server URL      ${GROK_URL}`);
		expect(out).toMatch(/answered tools\/list with 1 tools \(no sign-in\)/);
	});

	it('exits 1 and reports the error when the public URL does not answer', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => reply(503, { error: 'down' })));
		const { code, json } = await run(['setup', '--client', 'grok-bot', '--json', '--no-copy', '--origin', ORIGIN], env);
		expect(code).toBe(1);
		expect(json.remote[0]).toMatchObject({ verified: false, tools: null });
		expect(json.remote[0].error).toMatch(/503/);
	});

	it('warns that a localhost origin is unreachable from the xAI cloud', async () => {
		vi.stubGlobal('fetch', mcpServer(['forge_free']));
		const { json } = await run(['setup', '--client', 'grok-bot', '--json', '--no-copy', '--origin', 'http://localhost:3000'], env);
		expect(json.remote[0].reachable_from_cloud).toBe(false);
		expect(json.remote[0].url).toBe('http://localhost:3000/api/mcp-grok');
	});

	it('with --connector-key mints a preset key from the stored sign-in, reuses it, and verifies with it', async () => {
		writeStore({ origin: ORIGIN, account: { user_id: 'u1', email: 'a@b.c' }, auth: { type: 'apikey', key: 'sk_live_signed_in_key_000000000', prefix: 'sk_live_sign' } }, env);
		const seen = [];
		const grok = mcpServer(['forge_free', 'search_catalog', 'list_my_agents'], { onRequest: (url, init) => seen.push({ url, auth: init.headers.authorization }) });
		const fetchMock = vi.fn(async (url, init) => {
			if (String(url).endsWith('/api/cli/whoami')) return reply(200, { user: { id: 'u1', email: 'a@b.c' } });
			if (String(url).endsWith('/api/api-keys')) return reply(201, { data: { id: 'k1', prefix: 'sk_live_cli_', scope: 'read generate agents:write', token: KEY } });
			return grok(url, init);
		});
		vi.stubGlobal('fetch', fetchMock);

		const first = await run(['setup', '--client', 'grok-bot', '--connector-key', '--json', '--no-copy', '--origin', ORIGIN], env);
		expect(first.code).toBe(0);
		const mint = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/api-keys'));
		expect(JSON.parse(mint[1].body)).toEqual({ name: expect.stringMatching(/^Grok Bot connector/), preset: 'connector' });
		expect(first.json.remote[0]).toMatchObject({ api_key: KEY, verified: true, tools: 3 });
		expect(first.json.remote[0].fields.Authentication).toMatch(/API key/);
		expect(seen.every((s) => s.auth === `Bearer ${KEY}`)).toBe(true);

		fetchMock.mockClear();
		const second = await run(['setup', '--client', 'grok-bot', '--connector-key', '--json', '--no-copy', '--origin', ORIGIN], env);
		expect(second.json.remote[0].api_key).toBe(KEY);
		expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/api-keys'))).toBe(false);
	});

	it('writes the local clients and prints grok-bot in one run', async () => {
		writeStore({ origin: ORIGIN, account: { user_id: 'u1', email: 'a@b.c' }, auth: { type: 'apikey', key: 'sk_live_signed_in_key_000000000', prefix: 'sk_live_sign' } }, env);
		const grok = mcpServer(['forge_free']);
		vi.stubGlobal('fetch', vi.fn(async (url, init) => {
			const u = String(url);
			if (u.endsWith('/api/cli/whoami')) return reply(200, { user: { id: 'u1', email: 'a@b.c' } });
			if (u.endsWith('/.well-known/mcp.json')) return reply(200, { servers: [{ name: 'Studio', endpoint: `${ORIGIN}/api/mcp-studio`, transport: 'streamable-http', auth: 'none' }] });
			return grok(url, init);
		}));
		const { code, json } = await run(['setup', '--clients', 'cursor,grok-bot', '--yes', '--json', '--no-copy', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(json.clients.map((c) => c.id)).toEqual(['cursor']);
		expect(json.remote.map((r) => r.id)).toEqual(['grok-bot']);
		expect(fs.existsSync(path.join(env.home, '.cursor', 'mcp.json'))).toBe(true);
	});
});

describe('remote client helpers', () => {
	it('registers grok-bot as a remote client on the Grok connector path', () => {
		expect(getRemoteClient('grok-bot')).toMatchObject({ kind: 'remote', serverPath: '/api/mcp-grok' });
		expect(getRemoteClient('cursor')).toBeNull();
	});

	it('classifies hosts a vendor cloud can never reach', () => {
		for (const h of ['localhost', '127.0.0.1', '10.0.0.4', '192.168.1.9', '172.20.1.1', 'app.localhost']) expect(isLocalHost(h)).toBe(true);
		for (const h of ['three.ws', '172.32.0.1', '8.8.8.8']) expect(isLocalHost(h)).toBe(false);
	});

	it('copies with the first clipboard tool that works and returns null when none does', () => {
		const run = vi.fn((cmd) => (cmd === 'xclip' ? { status: 0 } : { error: new Error('ENOENT'), status: null }));
		expect(copyText(GROK_URL, { platform: 'linux', run })).toBe('xclip');
		expect(run.mock.calls.find(([c]) => c === 'xclip')[2].input).toBe(GROK_URL);
		expect(copyText(GROK_URL, { platform: 'linux', run: () => ({ error: new Error('ENOENT'), status: null }) })).toBeNull();
		expect(copyText(GROK_URL, { platform: 'darwin', run: () => ({ status: 0 }) })).toBe('pbcopy');
	});
});
