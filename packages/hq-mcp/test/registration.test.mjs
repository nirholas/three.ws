// Offline invariants for @three-ws/hq-mcp plus the real handler path against a
// local HTTP server that speaks the /api/agent-tools contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { TOOLS, buildServer } from '../src/index.js';

const EXPECTED = [
	'hq_top_yields', 'hq_chain_tvl', 'hq_protocol_health', 'hq_funding_rates', 'hq_liquidations',
	'hq_venue_spread', 'hq_whale_activity', 'hq_gas', 'analyze_portfolio_risk', 'hq_ask',
];

test('registers exactly the expected tools and builds a server without HQ_BASE', () => {
	assert.deepEqual(new Set(TOOLS.map((t) => t.name)), new Set(EXPECTED));
	assert.ok(buildServer());
});

test('every tool is read-only with a title, description, schema and handler', () => {
	for (const t of TOOLS) {
		assert.ok(t.title && t.description && t.inputSchema && typeof t.handler === 'function', t.name);
		assert.equal(t.annotations.readOnlyHint, true, t.name);
		assert.equal(t.annotations.destructiveHint, false, t.name);
	}
});

test('without HQ_BASE a call fails with not_configured and says how to fix it', async () => {
	delete process.env.HQ_BASE;
	await assert.rejects(TOOLS.find((t) => t.name === 'hq_gas').handler({}), (e) => e.code === 'not_configured' && /HQ_BASE/.test(e.message));
});

test('handlers POST the right tool and args to /api/agent-tools and return its data', async () => {
	const seen = [];
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			seen.push({ method: req.method, url: req.url, body: JSON.parse(body) });
			const parsed = JSON.parse(body);
			if (parsed.tool === 'gas') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ tool: 'gas', rows: [{ chain: 'Base', gasGwei: 0.01 }], facts: ['Base: 0.01 gwei'] }));
			} else {
				res.writeHead(422, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: 'No tool matched' }));
			}
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	process.env.HQ_BASE = `http://127.0.0.1:${server.address().port}`;
	try {
		const ok = await TOOLS.find((t) => t.name === 'hq_gas').handler({ chain: 'Base' });
		assert.equal(ok.ok, true);
		assert.equal(ok.rows[0].chain, 'Base');
		assert.deepEqual(seen[0], { method: 'POST', url: '/api/agent-tools', body: { tool: 'gas', args: { chain: 'Base' } } });

		await assert.rejects(TOOLS.find((t) => t.name === 'hq_ask').handler({ question: 'joke' }), (e) => e.code === 'upstream_error' && e.status === 422);
		assert.deepEqual(seen[1].body, { question: 'joke', narrate: true });

		await assert.rejects(TOOLS.find((t) => t.name === 'analyze_portfolio_risk').handler({ positions: [{ symbol: 'ETH', usd: 1 }] }), (e) => e.status === 422);
		assert.equal(seen[2].body.tool, 'portfolio_risk');

		const owner = 'THREEsynthetic1111111111111111111111111111';
		await assert.rejects(TOOLS.find((t) => t.name === 'analyze_portfolio_risk').handler({ address: owner }), (e) => e.status === 422);
		assert.deepEqual(seen[3].body, { tool: 'portfolio_risk', args: { address: owner } });
		await assert.rejects(TOOLS.find((t) => t.name === 'analyze_portfolio_risk').handler({ address: '0x2222222222222222222222222222222222222222', chain: 'optimism' }), (e) => e.status === 422);
		assert.deepEqual(seen[4].body.args, { address: '0x2222222222222222222222222222222222222222', chain: 'optimism' });

		const portfolio = TOOLS.find((t) => t.name === 'analyze_portfolio_risk');
		await assert.rejects(portfolio.handler({}), (e) => e.code === 'bad_input');
		await assert.rejects(portfolio.handler({ address: owner, positions: [{ symbol: 'SOL', usd: 1 }] }), (e) => e.code === 'bad_input');
		assert.equal(seen.length, 5);
	} finally {
		delete process.env.HQ_BASE;
		server.close();
	}
});
