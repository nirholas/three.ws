#!/usr/bin/env node
// End-to-end probe of the paid /api/mcp flow. Does NOT broadcast a real
// payment — exercises each stage and reports what would break in prod.
//
//   node scripts/smoke-paid-mcp.mjs                     # against https://three.ws
//   node scripts/smoke-paid-mcp.mjs http://localhost:3000

const BASE = (process.argv[2] || 'https://three.ws').replace(/\/$/, '');
const URL = `${BASE}/api/mcp`;
const RPC = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'smoke', version: '0' },
	},
};

const fail = [];
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
	console.log(`  FAIL  ${m}`);
	fail.push(m);
};

async function postMcp(headers = {}) {
	const res = await fetch(URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...headers,
		},
		body: JSON.stringify(RPC),
	});
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		/* leave undefined */
	}
	return { status: res.status, headers: res.headers, text, json };
}

async function step1_challenge() {
	console.log('\n[1] 402 challenge shape');
	const r = await postMcp();
	if (r.status !== 402) return bad(`expected 402, got ${r.status}`);
	ok('returns 402');
	const x402Version = r.json?.x402Version;
	if (x402Version !== 2) bad(`expected x402Version=2 (Coinbase v2), got ${x402Version}`);
	const accepts = r.json?.accepts;
	if (!Array.isArray(accepts) || accepts.length === 0)
		return bad('missing accepts[] in 402 body');
	for (const a of accepts) {
		const tag = `${a.network}/${a.scheme}`;
		if (!a.payTo) bad(`${tag}: missing payTo`);
		if (!a.asset) bad(`${tag}: missing asset`);
		// v2 wire uses `amount`, not `maxAmountRequired`.
		if (!a.amount) bad(`${tag}: missing amount (v2 spec)`);
		if (a.network?.startsWith('solana:') && !a.extra?.feePayer)
			bad(`${tag}: missing extra.feePayer (clients cannot build tx)`);
		else if (a.payTo && a.amount)
			ok(`${tag}: ${a.payTo.slice(0, 8)}… amount=${a.amount}`);
	}
	return accepts;
}

async function step2_verifyReachable(accepts) {
	console.log('\n[2] facilitator /verify reachability per network');
	for (const a of accepts) {
		// Shape-correct but unsigned payload — facilitator should respond with
		// a structured invalidReason (not a 5xx network error). v2 wire shape.
		const isSolana = a.network?.startsWith('solana:');
		const payload = isSolana
			? {
					x402Version: 2,
					scheme: 'exact',
					network: a.network,
					payload: { transaction: 'AAA', payer: '11111111111111111111111111111111' },
				}
			: {
					x402Version: 2,
					scheme: 'exact',
					network: a.network,
					payload: {
						signature: '0x' + '00'.repeat(65),
						authorization: {
							from: '0x' + '00'.repeat(20),
							to: a.payTo,
							value: a.amount,
							validAfter: '0',
							validBefore: '99999999999',
							nonce: '0x' + '00'.repeat(32),
						},
					},
				};
		const xPayment = Buffer.from(JSON.stringify(payload)).toString('base64');
		const r = await postMcp({ 'x-payment': xPayment });
		if (r.status === 502 && /No facilitator registered/i.test(r.text))
			bad(`${a.network}: facilitator does not support this network — wrong URL?`);
		else if (r.status === 502 && /facilitator_unreachable/i.test(r.text))
			bad(`${a.network}: facilitator unreachable`);
		else if (r.status === 402 || r.status === 400)
			ok(`${a.network}: facilitator reachable (rejected unsigned: ${r.json?.error_description || r.json?.error || 'invalid'})`);
		else bad(`${a.network}: unexpected ${r.status} — ${r.text.slice(0, 200)}`);
	}
}

async function step3_zauthStatus() {
	console.log('\n[3] zauth telemetry status');
	const r = await fetch(`${BASE}/api/zauth-status`);
	if (!r.ok) return bad(`/api/zauth-status returned ${r.status} (deploy may be missing it)`);
	const { data } = await r.json();
	if (!data?.hasKey) bad('ZAUTH_API_KEY not set in prod env — endpoints will not appear in Provider Hub');
	else ok(`ZAUTH_API_KEY set, prefix=${data.keyPrefix}`);
	if (!data?.initialized) bad('zauth middleware did not initialize');
	else ok('zauth middleware initialized');
}

async function step4_x402Status() {
	console.log('\n[4] /api/x402-status (facilitator /supported probe)');
	const r = await fetch(`${BASE}/api/x402-status`);
	let body;
	try {
		body = await r.json();
	} catch {
		return bad(`/api/x402-status returned non-JSON (status ${r.status})`);
	}
	if (!body || typeof body !== 'object')
		return bad('/api/x402-status returned unexpected body');
	if (!Array.isArray(body.facilitators) || body.facilitators.length === 0)
		return bad('/api/x402-status reported no facilitators');
	for (const f of body.facilitators) {
		if (f.ok) ok(`${f.network}: ${f.url || '(default)'} → ${f.reason}`);
		else bad(`${f.network}: ${f.url || '(unset)'} — ${f.reason}`);
	}
}

(async () => {
	console.log(`Probing ${URL}`);
	const accepts = await step1_challenge();
	if (Array.isArray(accepts)) await step2_verifyReachable(accepts);
	await step3_zauthStatus();
	await step4_x402Status();
	console.log(`\n${fail.length === 0 ? 'PASS' : `FAIL (${fail.length})`}`);
	process.exit(fail.length === 0 ? 0 : 1);
})();
