// Tool-surface and error-shaping invariants for @three-ws/oracle-mcp. Offline:
// a local HTTP server stands in for three.ws so the handlers run for real.
//
// Run: node --test packages/oracle-mcp/test/registration.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let base;
let server;
const hits = [];
server = http.createServer((req, res) => {
	hits.push(req.url);
	const u = new URL(req.url, 'http://x');
	res.setHeader('content-type', 'application/json');
	if (u.pathname === '/api/oracle/coin') {
		res.statusCode = 404;
		return res.end(JSON.stringify({ error: 'not_found' }));
	}
	if (u.pathname === '/api/oracle/stats') {
		res.statusCode = 503;
		return res.end(JSON.stringify({ error: 'db_unavailable' }));
	}
	res.end(JSON.stringify({ items: [{ mint: 'x', score: 81 }] }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
base = `http://127.0.0.1:${server.address().port}`;
process.env.THREE_WS_BASE = base;
after(() => server.close());

const { TOOLS, buildServer } = await import('../src/index.js');

test('at most 14 tools and every one is read-only', () => {
	assert.ok(TOOLS.length <= 14);
	for (const t of TOOLS) {
		assert.equal(t.annotations.readOnlyHint, true, t.name);
		assert.equal(t.annotations.destructiveHint, false, t.name);
		assert.ok(t.description.length > 0 && t.title.length > 0, t.name);
		assert.match(t.description, /Use this (when|to|for|before|first)/, `${t.name} needs a when-to-use sentence`);
	}
});

test('no tool can arm, trade or spend', () => {
	for (const t of TOOLS) assert.doesNotMatch(t.name, /arm|trade|buy|sell|send|withdraw/);
});

test('buildServer registers every tool without network or key', () => {
	const registered = buildServer()._registeredTools;
	for (const t of TOOLS) assert.ok(registered[t.name], t.name);
});

test('getting_started points write tools to the agent-trader server', async () => {
	const text = await TOOLS.find((t) => t.name === 'oracle_getting_started').handler();
	assert.match(text, /agent-trader-mcp/);
	assert.match(text, /simulate/);
});

test('top plays defaults to the strong-and-above floor and 5 rows', async () => {
	hits.length = 0;
	await TOOLS.find((t) => t.name === 'oracle_top_plays').handler({});
	assert.match(hits[0], /min_score=72/);
	assert.match(hits[0], /limit=5/);
});

test('a 404 reads as not found and an outage reads as transient, never empty', async () => {
	const coin = await TOOLS.find((t) => t.name === 'oracle_coin').handler({ mint: '11111111111111111111111111111111' });
	assert.equal(coin.found, false);
	assert.match(coin.message, /not an outage/);
	const stats = await TOOLS.find((t) => t.name === 'oracle_stats').handler({});
	assert.equal(stats.transient, true);
	assert.match(stats.message, /not an empty market/);
});

test('an invalid mint is refused before any request', async () => {
	hits.length = 0;
	const r = await TOOLS.find((t) => t.name === 'oracle_coin').handler({ mint: 'nope' });
	assert.equal(r.ok, false);
	assert.equal(hits.length, 0);
});
