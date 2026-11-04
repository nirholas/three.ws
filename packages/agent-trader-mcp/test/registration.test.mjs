// Safety invariants for @three-ws/agent-trader-mcp, run against a local HTTP
// server that behaves like the Oracle watch endpoints. The handlers run for
// real; nothing is mocked inside the package.
//
// Run: node --test packages/agent-trader-mcp/test/registration.test.mjs

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const AGENT = '8f1c2f3e-6a52-4c53-9f0e-0a1b2c3d4e5f';
const calls = [];
let signed = true;
const watches = { mainnet: null, devnet: null };

const server = http.createServer((req, res) => {
	let raw = '';
	req.on('data', (c) => (raw += c));
	req.on('end', () => {
		const u = new URL(req.url, 'http://x');
		const body = raw ? JSON.parse(raw) : undefined;
		calls.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, auth: req.headers.authorization });
		res.setHeader('content-type', 'application/json');
		if (u.pathname === '/api/oracle/watch' && req.method === 'POST') {
			if (body.armed && body.mode === 'live' && !signed) {
				res.statusCode = 403;
				return res.end(JSON.stringify({ error: 'risk_ack_required', message: 'Sign the real-funds agreements. Sign at https://three.ws/legal/agreements', sign_url: 'https://three.ws/legal/agreements' }));
			}
			const net = body.network || 'mainnet';
			watches[net] = { agent_id: body.agent_id, network: net, armed: !!body.armed, mode: body.mode || 'simulate', per_trade_sol: body.per_trade_sol ?? 0.05, max_daily_sol: 0.5 };
			return res.end(JSON.stringify({ agent_id: body.agent_id, network: net, watch: watches[net] }));
		}
		if (u.pathname === '/api/oracle/watch') {
			const net = u.searchParams.get('network') || 'mainnet';
			return res.end(JSON.stringify({ watch: watches[net], actions: [], summary: {} }));
		}
		res.end(JSON.stringify({ items: [] }));
	});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.THREE_WS_BASE = `http://127.0.0.1:${server.address().port}`;
process.env.THREE_WS_API_KEY = 'sk_test_agent_trader';
after(() => server.close());
beforeEach(() => {
	calls.length = 0;
	signed = true;
	watches.mainnet = null;
	watches.devnet = null;
});

const { TOOLS, buildServer } = await import('../src/index.js');
const tool = (n) => TOOLS.find((t) => t.name === n);

test('at most 8 tools, all annotated, only the expected names', () => {
	assert.ok(TOOLS.length <= 8);
	assert.deepEqual(
		new Set(TOOLS.map((t) => t.name)),
		new Set(['trader_getting_started', 'agent_arm', 'agent_disarm', 'agent_status', 'agent_actions', 'agent_performance', 'agent_positions', 'agent_guardrails']),
	);
	for (const t of TOOLS) {
		assert.equal(typeof t.annotations.readOnlyHint, 'boolean', t.name);
		assert.match(t.description, /Use this (when|to|for|before|first)/, t.name);
	}
	assert.ok(buildServer()._registeredTools.agent_arm);
});

test('getting started says in its first line that real SOL can move', async () => {
	const text = await tool('trader_getting_started').handler();
	assert.match(text.split('\n')[0], /real SOL/);
});

test('arm defaults to simulate and sends the bearer key', async () => {
	const out = await tool('agent_arm').handler({ agent_id: AGENT });
	assert.equal(out.ok, true);
	const post = calls.find((c) => c.method === 'POST');
	assert.equal(post.body.mode, 'simulate');
	assert.equal(post.body.armed, true);
	assert.equal(post.auth, 'Bearer sk_test_agent_trader');
});

test('live arm without confirm_live is refused locally and sends nothing', async () => {
	const out = await tool('agent_arm').handler({ agent_id: AGENT, mode: 'live' });
	assert.equal(out.ok, false);
	assert.equal(out.error, 'confirm_live_required');
	assert.equal(calls.length, 0);
});

test('an unsigned account gets risk_ack_required and the signing link, never an armed agent', async () => {
	signed = false;
	const out = await tool('agent_arm').handler({ agent_id: AGENT, mode: 'live', confirm_live: true });
	assert.equal(out.ok, false);
	assert.equal(out.error, 'risk_ack_required');
	assert.equal(out.sign_url, 'https://three.ws/legal/agreements');
	assert.match(out.message, /agreements/);
	assert.equal(watches.mainnet, null);
});

test('disarm works with only an agent id, on both networks, and keeps the other settings', async () => {
	await tool('agent_arm').handler({ agent_id: AGENT, per_trade_sol: 0.2 });
	calls.length = 0;
	const out = await tool('agent_disarm').handler({ agent_id: AGENT });
	assert.equal(out.ok, true);
	assert.equal(out.results.mainnet.armed, false);
	assert.equal(out.results.devnet.armed, false);
	const posts = calls.filter((c) => c.method === 'POST');
	assert.deepEqual(posts.map((p) => p.body.network).sort(), ['devnet', 'mainnet']);
	assert.ok(posts.every((p) => p.body.armed === false));
	const mainnetPost = posts.find((p) => p.body.network === 'mainnet');
	assert.equal(mainnetPost.body.per_trade_sol, 0.2);
});

test('guardrails with no field only reads; with a field it writes', async () => {
	await tool('agent_guardrails').handler({ agent_id: AGENT });
	assert.equal(calls.at(-1).method, 'GET');
	assert.match(calls.at(-1).path, /\/trade\/limits$/);
	await tool('agent_guardrails').handler({ agent_id: AGENT, kill_switch: true });
	assert.equal(calls.at(-1).method, 'PUT');
	assert.deepEqual(calls.at(-1).body, { kill_switch: true });
});

test('positions asks only for open actions of that agent', async () => {
	await tool('agent_positions').handler({ agent_id: AGENT });
	assert.equal(calls.at(-1).query.outcome, 'open');
	assert.equal(calls.at(-1).query.agent_id, AGENT);
});
