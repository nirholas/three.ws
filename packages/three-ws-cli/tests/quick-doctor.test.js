import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeStore, readStore } from '../src/store.js';
import { main, parse } from '../src/cli.js';
import { clientsFromFlags } from '../src/commands/quick.js';
import { checkNode, entryUrl } from '../src/commands/doctor.js';

const ORIGIN = 'https://three.ws';
const KEY = 'sk_live_cli_quick_test_key_000000000';
const SKILL = '---\nname: three-ws\ndescription: test\n---\n\n# three.ws\n';

function tempEnv() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-quick-'));
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

/** The three.ws endpoints the quick path touches, answered like the real ones. */
function platform({ skill = SKILL, toolsStatus = 200 } = {}) {
	return vi.fn(async (url, init = {}) => {
		const u = new URL(String(url));
		if (u.pathname === '/api/cli/whoami') return reply(200, { user: { id: 'u1', email: 'dev@example.com' } });
		if (u.pathname === '/.well-known/mcp.json') return reply(200, { servers: [{ name: 'three.ws', endpoint: `${ORIGIN}/mcp`, transport: 'streamable-http', auth: 'oauth' }] });
		if (u.pathname === '/skill.md') return new Response(skill, { status: skill ? 200 : 404 });
		if (u.pathname === '/mcp') {
			if (toolsStatus !== 200) return reply(toolsStatus, { error: 'unauthorized' });
			const msg = JSON.parse(init.body);
			if (msg.method === 'initialize') return reply(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'three-ws', version: '1' } } }, { 'mcp-session-id': 's' });
			if (msg.method === 'tools/list') return reply(200, { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'forge_free' }, { name: 'create_agent' }] } });
			return new Response(null, { status: 202 });
		}
		return reply(404, { error: 'not_found' });
	});
}

describe('per-client flags', () => {
	it('turn a bare flag into the whole setup for that client', () => {
		expect(parse(['--claude']).command).toBe('quick');
		expect(parse(['--cursor', '--codex']).command).toBe('quick');
		expect(parse(['setup', '--vscode']).command).toBe('quick');
		expect(parse(['status']).command).toBe('status');
		expect(parse([]).command).toBe('help');
		expect(clientsFromFlags(parse(['--windsurf', '--claude']).flags)).toEqual(['claude-code', 'windsurf']);
	});
});

describe('three-ws --<client> on a clean home', () => {
	let env;
	let fetchMock;
	beforeEach(() => {
		env = tempEnv();
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		fetchMock = platform();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	const CASES = [
		['--claude', () => '.claude.json', 'mcpServers'],
		['--cursor', () => path.join('.cursor', 'mcp.json'), 'mcpServers'],
		['--windsurf', () => path.join('.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers'],
		['--gemini', () => path.join('.gemini', 'settings.json'), 'mcpServers'],
		['--bob', () => path.join('.bob', 'settings', 'mcp.json'), 'mcpServers'],
	];

	for (const [flag, rel, root] of CASES) {
		it(`${flag} writes the client config, verifies it live and stores no secret in it`, async () => {
			const { code, json } = await run([flag, '--json', '--origin', ORIGIN], env);
			expect(code).toBe(0);
			expect(json.clients.every((c) => !c.error)).toBe(true);
			const file = path.join(env.home, rel());
			const text = fs.readFileSync(file, 'utf8');
			expect(Object.keys(JSON.parse(text)[root])).toContain('three-ws');
			expect(text).not.toContain(KEY);
			expect(text).toContain('"proxy"');
		});
	}

	it('--codex and --vscode write their own formats without the key', async () => {
		let r = await run(['--codex', '--json', '--origin', ORIGIN], env);
		expect(r.code).toBe(0);
		const toml = fs.readFileSync(path.join(env.home, '.codex', 'config.toml'), 'utf8');
		expect(toml).toContain('mcp_servers');
		expect(toml).not.toContain(KEY);
		r = await run(['--vscode', '--json', '--origin', ORIGIN], env);
		expect(r.code).toBe(0);
		const vs = fs.readFileSync(path.join(env.home, '.config', 'Code', 'User', 'mcp.json'), 'utf8');
		expect(JSON.parse(vs).servers['three-ws']).toBeTruthy();
		expect(vs).not.toContain(KEY);
	});

	it('is idempotent: a second run leaves the same file and one entry', async () => {
		await run(['--cursor', '--json', '--origin', ORIGIN], env);
		const file = path.join(env.home, '.cursor', 'mcp.json');
		const first = fs.readFileSync(file, 'utf8');
		await run(['--cursor', '--json', '--origin', ORIGIN], env);
		expect(fs.readFileSync(file, 'utf8')).toBe(first);
	});

	it('--claude installs the skill once and leaves it alone afterwards', async () => {
		await run(['--claude', '--origin', ORIGIN], env);
		const skill = path.join(env.home, '.claude', 'skills', 'three-ws', 'SKILL.md');
		expect(fs.readFileSync(skill, 'utf8')).toBe(SKILL);
		const before = fs.statSync(skill).mtimeMs;
		await new Promise((r) => setTimeout(r, 15));
		await run(['--claude', '--origin', ORIGIN], env);
		expect(fs.statSync(skill).mtimeMs).toBe(before);
	});

	it('--claude fails loudly when the skill file is not a three.ws skill', async () => {
		vi.stubGlobal('fetch', platform({ skill: '<html>oops</html>' }));
		const { code } = await run(['--claude', '--origin', ORIGIN], env);
		expect(code).toBe(1);
		expect(fs.existsSync(path.join(env.home, '.claude', 'skills'))).toBe(false);
	});

	it('keeps the credential store owner-only and the key out of every written file', async () => {
		await run(['--claude', '--cursor', '--origin', ORIGIN], env);
		const store = path.join(env.home, '.config', 'three-ws', 'credentials.json');
		if (process.platform !== 'win32') expect(fs.statSync(store).mode & 0o077).toBe(0);
		expect(readStore(env).auth.key).toBe(KEY);
		for (const f of ['.claude.json', path.join('.cursor', 'mcp.json')]) {
			expect(fs.readFileSync(path.join(env.home, f), 'utf8')).not.toContain(KEY);
		}
	});
});

describe('three-ws doctor', () => {
	let env;
	afterEach(() => vi.unstubAllGlobals());
	beforeEach(() => {
		env = tempEnv();
	});

	it('checkNode passes current Node and rejects an old one', () => {
		expect(checkNode('24.1.0').status).toBe('ok');
		expect(checkNode('20.12.0').status).toBe('ok');
		expect(checkNode('20.11.9').status).toBe('fail');
		expect(checkNode('18.19.0').status).toBe('fail');
	});

	it('entryUrl reads direct and proxied entries', () => {
		expect(entryUrl({ url: `${ORIGIN}/mcp` })).toBe(`${ORIGIN}/mcp`);
		expect(entryUrl({ command: 'npx', args: ['-y', 'three-ws', 'proxy', `${ORIGIN}/mcp`, '--server', 'three-ws'] })).toBe(`${ORIGIN}/mcp`);
		expect(entryUrl({ command: 'x', args: [] })).toBeNull();
	});

	it('reports a healthy setup and exits 0', async () => {
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		vi.stubGlobal('fetch', platform());
		await run(['--cursor', '--origin', ORIGIN], env);
		const { code, json } = await run(['doctor', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(json.failed).toBe(0);
		expect(json.checks.some((c) => c.id.startsWith('server:') && c.status === 'ok')).toBe(true);
	});

	it('flags a signed-out machine, a broken config and a plain-text key, each with a fix', async () => {
		vi.stubGlobal('fetch', platform());
		const cursor = path.join(env.home, '.cursor', 'mcp.json');
		fs.mkdirSync(path.dirname(cursor), { recursive: true });
		fs.writeFileSync(cursor, JSON.stringify({ mcpServers: { 'three-ws': { url: `${ORIGIN}/mcp`, headers: { Authorization: `Bearer ${KEY}` } } } }));
		const codex = path.join(env.home, '.codex', 'config.toml');
		fs.mkdirSync(path.dirname(codex), { recursive: true });
		fs.writeFileSync(codex, 'this is = = not toml');
		const { code, json } = await run(['doctor', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(1);
		const byId = Object.fromEntries(json.checks.map((c) => [c.id, c]));
		expect(byId.auth.status).toBe('fail');
		expect(byId['secret:cursor:three-ws'].status).toBe('warn');
		expect(byId['client:codex'].status).toBe('fail');
		expect(json.checks.filter((c) => c.status !== 'ok').every((c) => c.fix)).toBe(true);
	});

	it('reports an expired session that cannot refresh', async () => {
		writeStore({ origin: ORIGIN, auth: { type: 'oauth', access_token: 'old', expires_at: Date.now() - 60_000, scope: 'profile' } }, env);
		vi.stubGlobal('fetch', platform());
		const { json } = await run(['doctor', '--json', '--origin', ORIGIN], env);
		const auth = json.checks.find((c) => c.id === 'auth');
		expect(auth.status).toBe('fail');
		expect(auth.fix).toContain('login');
	});

	it('reports an unreachable server', async () => {
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		const ok = platform();
		vi.stubGlobal('fetch', ok);
		await run(['--cursor', '--origin', ORIGIN], env);
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			if (new URL(String(url)).pathname === '/mcp') throw new TypeError('fetch failed');
			return ok(url);
		}));
		const { code, json } = await run(['doctor', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(1);
		expect(json.checks.find((c) => c.id === `server:${ORIGIN}/mcp`).status).toBe('fail');
	});
});

describe('three-ws agent status and team', () => {
	let env;
	beforeEach(() => {
		env = tempEnv();
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('agent status joins the agent list with live balances', async () => {
		const calls = [];
		vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
			const u = new URL(String(url));
			calls.push(`${init.method || 'GET'} ${u.pathname}`);
			if (u.pathname === '/api/agents') return reply(200, { agents: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Nova', avatar_id: 'av1', solana_address: 'So1anaAddre55', walletReady: true }] });
			if (u.pathname === '/api/agents/balances') return reply(200, { data: { '11111111-1111-4111-8111-111111111111': { sol: 1.5, usdc: 20, usd: 250 } } });
			return reply(404, {});
		}));
		const { code, json } = await run(['agent', 'status', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(json.agents[0]).toMatchObject({ name: 'Nova', sol: 1.5, usdc: 20, usd: 250, has_body: true });
		expect(calls).toEqual(['GET /api/agents', 'POST /api/agents/balances']);
	});

	it('agent status names the unknown agent instead of printing nothing', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => reply(200, { agents: [] })));
		const { code } = await run(['agent', 'status', 'ghost', '--origin', ORIGIN], env);
		expect(code).toBe(1);
	});

	it('team lists teams and team status shows one with its roster', async () => {
		const team = { id: 't1', name: 'Alpha', status: 'active', network: 'devnet', member_count: 1, last_finding_at: null, roster: [{ role: 'researcher', name: 'Rex' }] };
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			const p = new URL(String(url)).pathname;
			if (p === '/api/teams') return reply(200, { data: [team] });
			if (p === '/api/teams/t1') return reply(200, { data: { ...team, page_url: '/teams/t1', findings: { total: 3, last_24h: 1, last_at: null }, missing_roles: ['launcher'], last_error: null, trader_balance_sol: 0.25, members: [{ role: 'researcher', agent: { name: 'Rex', wallet: 'So1anaAddre55' } }] } });
			return reply(404, {});
		}));
		let r = await run(['team', '--json', '--origin', ORIGIN], env);
		expect(r.json.teams[0].name).toBe('Alpha');
		r = await run(['team', 'status', 'alpha', '--json', '--origin', ORIGIN], env);
		expect(r.code).toBe(0);
		expect(r.json.team.missing_roles).toEqual(['launcher']);
	});

	it('both ask you to sign in when there is no credential', async () => {
		const bare = tempEnv();
		const a = await run(['agent', 'status', '--origin', ORIGIN], bare);
		const t = await run(['team', '--origin', ORIGIN], bare);
		expect([a.code, t.code]).toEqual([1, 1]);
	});
});

describe('hosted installer scripts', () => {
	const dir = path.resolve(import.meta.dirname, '../../../public/cli');
	const pub = crypto.createPublicKey(fs.readFileSync(path.join(dir, 'signing-key.pem')));

	for (const name of ['install.sh', 'claude.sh']) {
		it(`${name} matches its published checksum and signature`, () => {
			const bytes = fs.readFileSync(path.join(dir, name));
			const sum = fs.readFileSync(path.join(dir, `${name}.sha256`), 'utf8').trim();
			expect(sum).toBe(`${crypto.createHash('sha256').update(bytes).digest('hex')}  ${name}`);
			expect(crypto.verify(null, bytes, pub, fs.readFileSync(path.join(dir, `${name}.sig`)))).toBe(true);
		});

		it(`${name} runs nothing until the whole file has been read, and never touches credentials`, () => {
			const text = fs.readFileSync(path.join(dir, name), 'utf8');
			expect(text.trimEnd().endsWith('main "$@"')).toBe(true);
			expect(text).not.toMatch(/credentials\.json|sudo |\.bashrc|\.zshrc|\.profile/);
		});
	}
});
