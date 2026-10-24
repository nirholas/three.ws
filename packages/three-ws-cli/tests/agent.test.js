import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeStore } from '../src/store.js';
import { main } from '../src/cli.js';

const ORIGIN = 'https://three.ws';
const KEY = 'sk_live_cli_agent_test_key_00000000';

function tempEnv() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-agent-'));
	return { home, platform: process.platform, cwd: home, vars: { THREE_WS_NO_BROWSER: '1' } };
}

function reply(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Run the CLI and capture stdout, parsing it when --json was passed. */
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

describe('three-ws create', () => {
	let env;
	let fetchMock;
	beforeEach(() => {
		env = tempEnv();
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('creates the agent with the stored key and reports its page and wallet', async () => {
		fetchMock.mockResolvedValueOnce(reply(201, { agent: { id: 'a1', name: 'Nova', solana_address: 'So1anaAddre55', walletReady: true, avatar_id: null } }));
		const { code, json } = await run(['create', 'Nova', '--description', 'A deep-space guide.', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${ORIGIN}/api/agents`);
		expect(init.method).toBe('POST');
		expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
		expect(JSON.parse(init.body)).toEqual({ name: 'Nova', description: 'A deep-space guide.' });
		expect(json).toEqual({ agent: { id: 'a1', name: 'Nova', solana_address: 'So1anaAddre55', wallet_ready: true }, page: `${ORIGIN}/agents/a1` });
	});

	it('explains an impersonation refusal instead of printing a bare 409', async () => {
		fetchMock.mockResolvedValueOnce(reply(409, { error: 'identity_conflict', integrity: { reasons: ['too close to the public agent "Nova Prime"'] } }));
		const { code, json } = await run(['create', 'Nova Prime', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(1);
		expect(json.error).toBe('identity_conflict');
		expect(json.message).toContain('too close to the public agent "Nova Prime"');
		expect(json.message).toContain('Pick a distinct name');
	});

	it('refuses to run without a credential when it cannot prompt', async () => {
		const bare = tempEnv();
		const { code, json } = await run(['create', 'Nova', '--json', '--origin', ORIGIN], bare);
		expect(code).toBe(3);
		expect(json.message).toContain('npx three-ws login');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('three-ws launch', () => {
	let env;
	let fetchMock;
	beforeEach(() => {
		env = tempEnv();
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('never spends: it only reads the agent list and hands back a prefilled /launch URL', async () => {
		fetchMock.mockResolvedValueOnce(reply(200, { agents: [{ id: 'a1', name: 'Nova', avatar_id: 'av1' }] }));
		const { code, json } = await run(
			['launch', '--agent', 'a1', '--name', 'Nova Coin', '--symbol', 'nova', '--description', 'The Nova agent coin.', '--image', 'https://example.com/nova.png', '--initial-buy', '0.1', '--json', '--origin', ORIGIN],
			env,
		);
		expect(code).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe(`${ORIGIN}/api/agents`);
		expect(fetchMock.mock.calls[0][1].method || 'GET').toBe('GET');
		const url = new URL(json.review_url);
		expect(url.origin + url.pathname).toBe(`${ORIGIN}/launch`);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			avatar: 'av1',
			name: 'Nova Coin',
			symbol: 'NOVA',
			description: 'The Nova agent coin.',
			image: 'https://example.com/nova.png',
			initialBuy: '0.1',
		});
	});

	it('stops when the agent has no 3D body, since /launch selects agents by their body', async () => {
		fetchMock.mockResolvedValueOnce(reply(200, { agents: [{ id: 'a1', name: 'Nova', avatar_id: null }] }));
		const { code, json } = await run(['launch', '--agent', 'a1', '--name', 'Nova Coin', '--symbol', 'NOVA', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(1);
		expect(json.message).toContain('has no 3D body yet');
		expect(json.message).toContain(`${ORIGIN}/agents/a1`);
	});

	it('rejects a ticker with symbols in it', async () => {
		fetchMock.mockResolvedValueOnce(reply(200, { agents: [{ id: 'a1', name: 'Nova', avatar_id: 'av1' }] }));
		const { code, json } = await run(['launch', '--agent', 'a1', '--name', 'Nova Coin', '--symbol', 'NO$VA', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(1);
		expect(json.message).toContain('Letters and digits only');
	});
});
