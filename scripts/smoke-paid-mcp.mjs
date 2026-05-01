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
	const accepts = r.json?.accepts;
	if (!Array.isArray(accepts) || accepts.length === 0)
		return bad('missing accepts[] in 402 body');
	for (const a of accepts) {
		const tag = `${a.network}/${a.scheme}`;
		if (!a.payTo) bad(`${tag}: missing payTo`);
		if (!a.asset) bad(`${tag}: missing asset`);
		if (!a.maxAmountRequired) bad(`${tag}: missing maxAmountRequired`);
		if (a.network === 'solana' && !a.extra?.feePayer)
			bad(`${tag}: missing extra.feePayer (clients cannot build tx)`);
		else ok(`${tag}: ${a.payTo.slice(0, 8)}… amount=${a.maxAmountRequired}`);
	}
	return accepts;
}

async function step2_verifyReachable(accepts) {
	console.log('\n[2] facilitator /verify reachability per network');
	for (const a of accepts) {
		// Shape-correct but unsigned payload — facilitator should respond with
		// a structured invalidReason (not a 5xx network error).
		const payload =
			a.network === 'solana'
				? {
						x402Version: 1,
						scheme: 'exact',
						network: a.network,
						payload: { transaction: 'AAA', payer: '11111111111111111111111111111111' },
					}
				: {
						x402Version: 1,
						scheme: 'exact',
						network: a.network,
						payload: {
							signature: '0x' + '00'.repeat(65),
							authorization: {
								from: '0x' + '00'.repeat(20),
								to: a.payTo,
								value: a.maxAmountRequired,
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

(async () => {
	console.log(`Probing ${URL}`);
	const accepts = await step1_challenge();
	if (Array.isArray(accepts)) await step2_verifyReachable(accepts);
	await step3_zauthStatus();
	console.log(`\n${fail.length === 0 ? 'PASS' : `FAIL (${fail.length})`}`);
	process.exit(fail.length === 0 ? 0 : 1);
})();
