// Session-token mode must enforce the same per-call spend cap as self-custodial
// mode: probe the 402, refuse before /api/pay/execute when the price is over
// MAX_PAY_USD / max_usd. Real local HTTP servers stand in for the paid endpoint
// and the three.ws execute endpoint; the code under test is unmodified.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
let paid, platform, executeHits, payUrl;

function listen(handler) {
	return new Promise((resolve) => {
		const s = http.createServer(handler);
		s.listen(0, '127.0.0.1', () => resolve(s));
	});
}

before(async () => {
	executeHits = [];
	paid = await listen((req, res) => {
		res.writeHead(402, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ accepts: [{ network: 'solana:mainnet', asset: USDC_SOL, amount: '5000000', extra: { name: 'USDC', decimals: 6 } }] }));
	});
	platform = await listen((req, res) => {
		let b = '';
		req.on('data', (c) => (b += c));
		req.on('end', () => {
			executeHits.push(JSON.parse(b));
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ ok: true, price_usd: 5, network: 'solana' }));
		});
	});
	process.env.THREE_WS_BASE = `http://127.0.0.1:${platform.address().port}`;
	process.env.MAX_PAY_USD = '1';
	process.env.REQUIRE_CONFIRM = '0';
	process.env.X402_MCP_LEDGER_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'x402-cap-')), 'ledger.jsonl');
	({ payUrl } = await import('../src/lib/pay-core.js'));
});

after(() => {
	paid.close();
	platform.close();
});

test('session mode refuses a $5 endpoint when MAX_PAY_USD is $1 and never calls execute', async () => {
	const url = `http://127.0.0.1:${paid.address().port}/x`;
	await assert.rejects(payUrl(url, { session_token: 'pss_test' }), (e) => e.code === 'over_cap');
	assert.equal(executeHits.length, 0);
});

test('session mode refuses when max_usd lowers the cap below the price', async () => {
	const url = `http://127.0.0.1:${paid.address().port}/x`;
	await assert.rejects(payUrl(url, { session_token: 'pss_test', max_usd: 0.5 }), (e) => e.code === 'over_cap');
	assert.equal(executeHits.length, 0);
});
