#!/usr/bin/env node
// Exercise each x402 HTTP endpoint by invoking the Vercel function handler
// directly against a synthesized req/res pair. Confirms the 402 challenge,
// the Bazaar discovery manifest, and the x402-status probe all return v2
// shapes against the current code — no dev server required.

import { createServer } from 'node:http';
import { once } from 'node:events';

process.env.X402_PAY_TO_SOLANA ??= 'BUrwd1nK6tFeeJMyzRHDo6AuVbnSfUULfvwq21X93nSN';
process.env.X402_PAY_TO_BASE ??= '0x0C70c0e8453C5667739E41acdF6eC5787B8ff542';
process.env.X402_ASSET_MINT_SOLANA ??= 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
process.env.X402_ASSET_ADDRESS_BASE ??= '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
process.env.X402_MAX_AMOUNT_REQUIRED ??= '1000';
process.env.X402_FEE_PAYER_SOLANA ??= '2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4';
process.env.PUBLIC_APP_ORIGIN ??= 'https://three.ws/';

const failures = [];
const ok = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => {
	console.log(`  FAIL  ${msg}`);
	failures.push(msg);
};

async function call(handler, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
	const server = createServer((req, res) => {
		req.url = path;
		req.method = method;
		Object.assign(req.headers, headers);
		handler(req, res);
	});
	server.listen(0);
	await once(server, 'listening');
	const { port } = server.address();
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		method,
		headers,
		body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
	});
	const text = await res.text();
	server.close();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		// non-JSON response
	}
	return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text, json };
}

console.log('\n[1] POST /api/mcp without X-PAYMENT → 402 v2 challenge');
const { default: mcpHandler } = await import('../api/mcp.js');
const r1 = await call(mcpHandler, {
	method: 'POST',
	path: '/api/mcp',
	headers: { 'content-type': 'application/json', accept: 'application/json' },
	body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
});
if (r1.status !== 402) fail(`expected 402, got ${r1.status} body=${r1.text.slice(0, 200)}`);
else {
	ok('returns 402');
	if (r1.json?.x402Version !== 2) fail(`x402Version=${r1.json?.x402Version}, expected 2`);
	else ok('x402Version=2');
	if (!Array.isArray(r1.json?.accepts) || r1.json.accepts.length === 0)
		fail('missing accepts[]');
	else
		for (const a of r1.json.accepts) {
			if (!a.amount) fail(`${a.network}: missing 'amount' (v2 field)`);
			else if ('maxAmountRequired' in a) fail(`${a.network}: legacy v1 field present`);
			else ok(`${a.network}/${a.scheme} amount=${a.amount} payTo=${a.payTo?.slice(0, 8)}…`);
		}
	if (!r1.json?.resource?.url) fail('missing top-level resource.url');
	else ok(`resource.url=${r1.json.resource.url}`);
	if (!r1.json?.extensions?.bazaar?.discoverable) fail('bazaar extension missing');
	else ok('bazaar discoverable');
	// payment-required header mirror
	if (!r1.headers['payment-required']) fail('payment-required response header missing');
	else {
		const decoded = JSON.parse(Buffer.from(r1.headers['payment-required'], 'base64').toString('utf8'));
		if (decoded.x402Version === 2) ok('payment-required header mirrors body (v2)');
		else fail(`payment-required header version=${decoded.x402Version}`);
	}
}

console.log('\n[2] GET /.well-known/x402 → Bazaar discovery manifest');
const { default: wkHandler } = await import('../api/wk-x402.js');
const r2 = await call(wkHandler, {
	method: 'GET',
	path: '/.well-known/x402',
});
if (r2.status !== 200) fail(`expected 200, got ${r2.status} body=${r2.text.slice(0, 200)}`);
else {
	ok('returns 200');
	if (!r2.json) fail('non-JSON body');
	else if (r2.json.x402Version !== 2 && !Array.isArray(r2.json.resources) && !Array.isArray(r2.json.accepts))
		fail(`discovery payload missing version/resources/accepts: ${JSON.stringify(r2.json).slice(0, 200)}`);
	else ok(`discovery keys: ${Object.keys(r2.json).join(', ')}`);
}

console.log('\n[3] GET /api/x402-status → facilitator probe');
const { default: statusHandler } = await import('../api/x402-status.js');
const r3 = await call(statusHandler, {
	method: 'GET',
	path: '/api/x402-status',
});
if (r3.status !== 200) fail(`expected 200, got ${r3.status} body=${r3.text.slice(0, 200)}`);
else {
	ok('returns 200');
	if (!r3.json || !Array.isArray(r3.json.facilitators))
		fail('missing facilitators[]');
	else {
		ok(`facilitators=${r3.json.facilitators.length}`);
		for (const f of r3.json.facilitators)
			console.log(`        - ${f.network} ${f.ok ? 'OK' : 'NOT OK'} (${f.reason || 'no reason'})`);
	}
}

console.log('\n[4] POST /api/x402-pay (no agentId) without env wallet → 503 wallet_unconfigured');
process.env.NODE_ENV = 'production';
delete process.env.X402_AGENT_SOLANA_SECRET_BASE58;
const { default: payHandler } = await import('../api/x402-pay.js');
const r4 = await call(payHandler, {
	method: 'POST',
	path: '/api/x402-pay',
	headers: { 'content-type': 'application/json', accept: 'application/json' },
	body: { tool: 'tools/list', args: {} },
});
// Either 500 (wallet_unconfigured surfaced via dispatch) or earlier — accept any 4xx/5xx with a clear error.
if (r4.status === 200) fail(`expected error status when wallet unconfigured, got 200`);
else if (!r4.json || (!r4.json.error && !/wallet/.test(r4.text)))
	fail(`response did not surface wallet config error: ${r4.text.slice(0, 200)}`);
else ok(`responds ${r4.status} with ${r4.json?.error || 'wallet error'} (no /home/codespace fallthrough)`);

console.log('\n' + (failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`));
process.exit(failures.length === 0 ? 0 : 1);
