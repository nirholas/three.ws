// Automation mode against a real local HTTP server and a real local JSON-RPC
// node: every documented exit code is triggered, --json keeps stdout to one
// JSON document, --non-interactive never prompts, and the HTML report is a
// single self-contained file.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { main } from '../src/cli.js';
import { EXIT_CODES, exitCodeFor } from '../src/automation.js';
import { ApiError } from '../src/http.js';
import { buildRunReport } from '../src/report/run-report.js';
import { createKeystore } from '../src/pay/keystore.js';
import { USDC_MAINNET } from '../src/pay/permissions.js';

const AGENT = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const GOAL = 'Watch the pool and report if liquidity drops <b>below</b> 50k';
const HEAD = 'a'.repeat(64);

const run = {
	id: RUN,
	agentId: AGENT,
	goal: GOAL,
	status: 'completed',
	model: 'fixture-model',
	maxSteps: 8,
	budget: { creditsUsd: 0.5, usd: 0 },
	spent: { creditsUsd: 0.0123, usd: 0 },
	result: 'Liquidity held above 50k for the whole window.',
	summary: 'Completed after 2 model turns.',
	createdAt: '2026-10-20T10:00:00.000Z',
	startedAt: '2026-10-20T10:00:01.000Z',
	finishedAt: '2026-10-20T10:00:41.000Z',
};
const steps = [
	{ seq: 1, kind: 'status', output: { status: 'queued' }, receipt: null },
	{ seq: 2, kind: 'model_call', model: 'fixture-model', output: { content: 'I will read the pool first.', toolCalls: [{ name: 'get_pool' }] }, receipt: 'b'.repeat(64), at: run.startedAt },
	{ seq: 3, kind: 'tool_call', tool: 'get_pool', input: { pool: 'synthetic-pool' }, receipt: 'c'.repeat(64) },
	{ seq: 4, kind: 'tool_result', tool: 'get_pool', input: { pool: 'synthetic-pool' }, output: { liquidityUsd: 61000 }, receipt: 'd'.repeat(64), latencyMs: 120 },
	{ seq: 5, kind: 'model_call', model: 'fixture-model', output: { content: 'Liquidity is fine; trying a swap quote.', toolCalls: [{ name: 'swap_quote' }] }, receipt: 'e'.repeat(64) },
	{ seq: 6, kind: 'tool_blocked', tool: 'swap_quote', input: { amount: 1 }, output: { reason: 'not in the allowed tool set' }, receipt: 'f'.repeat(64) },
	{ seq: 7, kind: 'final', output: { result: run.result }, receipt: HEAD },
];
const toolTraces = [
	{ tool: 'get_pool', input: { pool: 'synthetic-pool' }, callSeq: 3, status: 'ok', output: { liquidityUsd: 61000 }, resultSeq: 4, receipt: 'd'.repeat(64), latencyMs: 120 },
	{ tool: 'swap_quote', input: { amount: 1 }, callSeq: null, status: 'blocked', output: { reason: 'not in the allowed tool set' }, resultSeq: 6, receipt: 'f'.repeat(64), latencyMs: null },
];
const trail = { agent_id: AGENT, status: 'verified_unanchored', ok: true, chain: { ok: true, count: 3, head_hash: '9'.repeat(64) }, anchor: null, checked_at: '2026-10-20T11:00:00.000Z' };

let server;
let origin;
let rpcServer;
let rpcUrl;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-automation-'));

function reply(res, status, body) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

beforeAll(async () => {
	server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://x');
		const auth = req.headers.authorization || '';
		if (url.pathname === '/api/skills/community/ext-skill') return reply(res, 200, { skill: { origin: 'external', name: 'Ext', slug: 'ext-skill', source: 'example/skills', ref: 'abc1234', license: 'MIT', tree_url: 'https://example.invalid/tree', import: { registry: 'r', skill: 's' } } });
		if (url.pathname.endsWith('/decision-trail/verify')) return reply(res, 200, trail);
		if (auth === 'Bearer sk_live_revoked') return reply(res, 401, { error: 'invalid_token', error_description: 'revoked' });
		if (auth === 'Bearer sk_live_guarded') return reply(res, 403, { error: 'firewall_blocked', error_description: 'blocked by the trade firewall' });
		if (auth === 'Bearer sk_live_pay') return reply(res, 402, { error: 'payment_required', error_description: 'upgrade your plan' });
		if (auth !== 'Bearer sk_live_ok') return reply(res, 401, { error: 'unauthorized' });
		if (url.pathname === `/api/agents/${AGENT}/custom-skills` && req.method === 'POST') return reply(res, 404, { error: 'not_found' });
		if (url.pathname === '/api/agents' && req.method === 'POST') return reply(res, 201, { agent: { id: AGENT, name: 'x' } });
		if (url.pathname === '/api/agents') return reply(res, 200, { agents: [{ id: AGENT, name: 'Scout', solana_address: 'SyntheticWalletAddress11111111111111111111111', avatar_id: 'av1' }] });
		if (url.pathname === '/api/agents/balances') return reply(res, 200, { data: { [AGENT]: { sol: 1.5, usdc: 20, usd: 250 } } });
		if (url.pathname === '/api/agent-run-replay' && url.searchParams.get('agent')) return reply(res, 200, { data: { runs: [run], hasMore: false, nextBefore: null } });
		if (url.pathname === '/api/agent-run-replay' && url.searchParams.get('run') === RUN) {
			return reply(res, 200, { data: { run, live: false, steps, toolTraces, receiptChain: { verified: true, checked: 6, brokenAt: null }, nextAfter: 7, hasMore: false } });
		}
		if (url.pathname === `/api/agents/${AGENT}/orders`) return reply(res, 200, { data: { orders: [{ id: 'o1', status: 'active', type: 'limit', side: 'buy', symbol: 'THREE' }], summary: { active: 1 } } });
		return reply(res, 404, { error: 'not_found' });
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	origin = `http://127.0.0.1:${server.address().port}`;

	rpcServer = http.createServer(async (req, res) => {
		let body = '';
		for await (const chunk of req) body += chunk;
		const call = JSON.parse(body);
		let result;
		if (call.method === 'getBalance') result = { context: { slot: 1 }, value: 2_500_000_000 };
		if (call.method === 'getTokenAccountsByOwner') {
			result = { context: { slot: 1 }, value: [{ pubkey: 'x', account: { data: { parsed: { info: { tokenAmount: { amount: '7500000' } } } } } }] };
		}
		reply(res, 200, result === undefined ? { jsonrpc: '2.0', id: call.id, error: { code: -32601, message: 'unexpected' } } : { jsonrpc: '2.0', id: call.id, result });
	});
	await new Promise((r) => rpcServer.listen(0, '127.0.0.1', r));
	rpcUrl = `http://127.0.0.1:${rpcServer.address().port}`;
});

afterAll(async () => {
	await new Promise((r) => server.close(r));
	await new Promise((r) => rpcServer.close(r));
});
afterEach(() => vi.restoreAllMocks());

function envWith(key, extra = {}) {
	const home = fs.mkdtempSync(path.join(scratch, 'home-'));
	const vars = { THREE_WS_NO_BROWSER: '1', NO_COLOR: '1', XDG_CONFIG_HOME: path.join(home, '.config'), ...extra };
	if (key) vars.THREE_WS_API_KEY = key;
	return { home, platform: 'linux', cwd: home, vars };
}

async function cli(argv, env) {
	let out = '';
	let err = '';
	vi.spyOn(process.stdout, 'write').mockImplementation((c) => ((out += c.toString()), true));
	vi.spyOn(process.stderr, 'write').mockImplementation((c) => ((err += c.toString()), true));
	const code = await main(argv, env);
	vi.restoreAllMocks();
	return { code, out, err };
}

describe('exit-code table', () => {
	it('0: success, with --json stdout a single document and stderr empty', async () => {
		const r = await cli(['agents', 'list', '--json', '--origin', origin], envWith('sk_live_ok'));
		expect(r.code).toBe(EXIT_CODES.OK);
		expect(JSON.parse(r.out).agents).toHaveLength(1);
		expect(r.out.trim().split('\n').filter((l) => l.startsWith('{')).length).toBe(1);
		expect(r.err).toBe('');
	});

	it('1: an error with no better code (the server does not know the run)', async () => {
		const r = await cli(['runs', 'get', '33333333-3333-4333-8333-333333333333', '--json', '--origin', origin], envWith('sk_live_ok'));
		expect(r.code).toBe(EXIT_CODES.ERROR);
		expect(JSON.parse(r.out)).toMatchObject({ error: 'not_found', exit: 1 });
	});

	it('2: usage, for an unknown flag, a missing agent, an unknown command and a bad run id', async () => {
		const env = envWith('sk_live_ok');
		expect((await cli(['agents', 'list', '--bogus'], env)).code).toBe(2);
		expect((await cli(['frobnicate', '--json'], env)).code).toBe(2);
		const noAgent = await cli(['runs', 'list', '--json', '--origin', origin], env);
		expect(noAgent.code).toBe(2);
		expect(JSON.parse(noAgent.out)).toMatchObject({ error: 'missing_input', exit: 2 });
		expect((await cli(['runs', 'get', 'not-a-uuid', '--origin', origin], env)).code).toBe(2);
	});

	it('3: auth, with no credential and with a revoked key', async () => {
		const none = await cli(['agents', 'list', '--json', '--origin', origin], envWith(null));
		expect(none.code).toBe(EXIT_CODES.AUTH);
		expect(JSON.parse(none.out).error).toBe('login_required');
		expect((await cli(['agents', 'list', '--origin', origin], envWith('sk_live_revoked'))).code).toBe(3);
	});

	it('4: refused by a guard, from the server and from the external-skill confirmation', async () => {
		const r = await cli(['agents', 'list', '--json', '--origin', origin], envWith('sk_live_guarded'));
		expect(r.code).toBe(EXIT_CODES.GUARD);
		expect(JSON.parse(r.out).error).toBe('firewall_blocked');
		expect(exitCodeFor(new ApiError('x', { status: 403, code: 'spend_policy' }))).toBe(4);
	});

	it('5: payment required', async () => {
		const r = await cli(['agents', 'list', '--json', '--origin', origin], envWith('sk_live_pay'));
		expect(r.code).toBe(EXIT_CODES.PAYMENT);
		expect(JSON.parse(r.out).exit).toBe(5);
	});

	it('6: network, for an unreachable host and for a server fault', async () => {
		const dead = await cli(['agents', 'list', '--json', '--origin', 'http://127.0.0.1:1'], envWith('sk_live_ok'));
		expect(dead.code).toBe(EXIT_CODES.NETWORK);
		expect(JSON.parse(dead.out).error).toBe('error');
		expect(exitCodeFor(new ApiError('x', { status: 503 }))).toBe(6);
		expect(exitCodeFor(new ApiError('x', { status: 429 }))).toBe(6);
	});

	it('keeps pay\'s own exit codes untouched', () => {
		expect(exitCodeFor(Object.assign(new Error('x'), { exit: 11 }))).toBe(11);
	});
});

describe('stdout purity under --json', () => {
	it('puts exactly one JSON document on stdout for every command, success and failure', async () => {
		const env = envWith('sk_live_ok', { THREE_WS_SOLANA_RPC_URL: rpcUrl });
		const argvs = [
			['agents', 'list'],
			['agents', 'get', 'Scout'],
			['runs', 'list', '--agent', 'Scout'],
			['runs', 'get', RUN],
			['orders', 'list', '--agent', AGENT],
			['wallet', 'balance', '--agent', AGENT],
			['agents', 'get', 'nobody'],
			['version'],
		];
		for (const argv of argvs) {
			const r = await cli([...argv, '--json', '--origin', origin], env);
			expect(() => JSON.parse(r.out), argv.join(' ')).not.toThrow();
		}
	});

	it('reads the orders and run views from the real endpoints', async () => {
		const env = envWith('sk_live_ok');
		const orders = JSON.parse((await cli(['orders', 'list', '--agent', 'Scout', '--json', '--origin', origin], env)).out);
		expect(orders.orders[0]).toMatchObject({ id: 'o1', symbol: 'THREE' });
		const detail = JSON.parse((await cli(['runs', 'get', RUN, '--json', '--origin', origin], env)).out);
		expect(detail.receiptChain).toMatchObject({ verified: true });
		expect(detail.toolTraces).toHaveLength(2);
	});

	it('reads the local pay wallet balance from Solana RPC', async () => {
		const env = envWith(null, { THREE_WS_SOLANA_RPC_URL: rpcUrl, THREE_WS_WALLET_PASSPHRASE: 'correct horse battery staple' });
		const made = await createKeystore({ env }).init({ storage: 'file' });
		const r = await cli(['wallet', 'balance', '--json'], env);
		expect(r.code).toBe(0);
		expect(JSON.parse(r.out)).toMatchObject({ source: 'pay-wallet', address: made.address, sol: 2.5, usdc: 7.5, network: 'mainnet' });
		expect(USDC_MAINNET).toBeTruthy();
	});

	it('reads an agent wallet balance', async () => {
		const r = await cli(['wallet', 'balance', '--agent', 'Scout', '--json', '--origin', origin], envWith('sk_live_ok'));
		expect(JSON.parse(r.out)).toMatchObject({ source: 'agent-wallet', usdc: 20, sol: 1.5 });
	});
});

describe('--non-interactive', () => {
	it('never signs in with a browser: exit 3 and no request is made', async () => {
		const spy = vi.fn();
		const probe = http.createServer((req, res) => (spy(), reply(res, 500, {})));
		await new Promise((r) => probe.listen(0, '127.0.0.1', r));
		const o = `http://127.0.0.1:${probe.address().port}`;
		const r = await cli(['login', '--non-interactive', '--json', '--origin', o], envWith(null));
		await new Promise((res) => probe.close(res));
		expect(r.code).toBe(3);
		expect(JSON.parse(r.out).error).toBe('login_required');
		expect(spy).not.toHaveBeenCalled();
	});

	it('treats missing input as a usage error instead of asking', async () => {
		const r = await cli(['create', '--non-interactive', '--json', '--origin', origin], envWith('sk_live_ok'));
		expect(r.code).toBe(2);
		expect(JSON.parse(r.out).exit).toBe(2);
	});

	it('refuses an external skill install without --yes (exit 4), never asking', async () => {
		const r2 = await cli(['skill', 'install', 'ext-skill', '--agent', AGENT, '--non-interactive', '--origin', origin], envWith('sk_live_ok'));
		expect(r2.code).toBe(EXIT_CODES.GUARD);
		expect(r2.out + r2.err).toContain('Not installed');
	});
});

describe('run report', () => {
	const html = buildRunReport({ run, steps, toolTraces, receiptChain: { verified: true, checked: 6, brokenAt: null }, trail, origin: 'https://three.ws', generatedAt: '2026-10-20T12:00:00.000Z' });

	it('contains the goal, tool calls, decisions, outcome and both head hashes, escaped', () => {
		expect(html).toContain('Watch the pool and report if liquidity drops &lt;b&gt;below&lt;/b&gt; 50k');
		expect(html).not.toContain('<b>below</b>');
		expect(html).toContain('get_pool');
		expect(html).toContain('I will read the pool first.');
		expect(html).toContain('Liquidity held above 50k');
		expect(html).toContain(HEAD);
		expect(html).toContain('9'.repeat(64));
		expect(html).toContain('not in the allowed tool set');
	});

	it('names trade-like calls under Trades and says so when there are none', () => {
		expect(html).toMatch(/<h2>Trades<\/h2>[\s\S]*swap_quote/);
		const none = buildRunReport({ run, steps: [], toolTraces: [{ ...toolTraces[0] }], trail: null });
		expect(none).toContain('No trade, swap, order or transfer tool was called');
		expect(none).toContain('decision trail could not be fetched');
	});

	it('references no external URL at all', () => {
		expect(html).not.toMatch(/https?:\/\//i);
		expect(html).not.toMatch(/<(script|link|img|iframe)\b[^>]*\b(src|href)=/i);
		expect(html).not.toMatch(/@import|url\(/i);
		expect(html).not.toMatch(new RegExp(String.fromCharCode(0x2014) + '|' + String.fromCharCode(0x2013)));
	});

	it('is written by `report run` to --out as one file', async () => {
		const file = path.join(scratch, 'out', 'run.html');
		const r = await cli(['report', 'run', RUN, '--out', file, '--json', '--origin', origin], envWith('sk_live_ok'));
		expect(r.code).toBe(0);
		const summary = JSON.parse(r.out);
		expect(summary).toMatchObject({ run: RUN, file, decision_trail_head: '9'.repeat(64) });
		const written = fs.readFileSync(file, 'utf8');
		expect(written.startsWith('<!doctype html>')).toBe(true);
		expect(written).toContain(HEAD);
		expect(written).not.toMatch(/https?:\/\//i);
	});

	it('requires --out', async () => {
		const r = await cli(['report', 'run', RUN, '--json', '--origin', origin], envWith('sk_live_ok'));
		expect(r.code).toBe(2);
	});
});
