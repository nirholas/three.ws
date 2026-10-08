#!/usr/bin/env node
// Probe free-studio install tokens end to end against a running server.
//
//   node scripts/probe-mcp-install-tokens.mjs --base http://localhost:3107 --catalog https://three.ws
//   node scripts/probe-mcp-install-tokens.mjs --base https://three.ws
//
// Mints two install tokens from this machine's IP (POST /api/mcp-studio/install),
// spends token A's per-minute generation burst with real look_at_model renders of
// a catalog GLB, shows token A refused with the JSON-RPC denial, then shows token
// B, same IP, still admitted. Spends 5 generation-quota units and 2 of this IP's
// 10 hourly mints. Exits non-zero when the server does not behave that way.

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = flag('base', 'http://localhost:3107').replace(/\/+$/, '');
const SURFACE = flag('surface', '/api/mcp-studio');

let rpcId = 0;
async function rpc(url, method, params) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
	});
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		throw new Error(`${method} at ${url}: HTTP ${res.status}, non-JSON body: ${text.slice(0, 200)}`);
	}
	return { status: res.status, retryAfter: res.headers.get('retry-after'), body };
}

async function mint() {
	const res = await fetch(`${BASE}/api/mcp-studio/install`, { method: 'POST', headers: { accept: 'application/json' } });
	const body = await res.json();
	if (res.status !== 201) throw new Error(`mint: HTTP ${res.status} ${JSON.stringify(body)}`);
	return body;
}

// The GLB to render: --glb, else the first chair in the catalog at --catalog
// (a local dev server ships an empty catalog, so point it at https://three.ws).
async function catalogGlb() {
	if (flag('glb')) return flag('glb');
	const catalog = flag('catalog', BASE).replace(/\/+$/, '');
	const r = await rpc(`${catalog}/api/mcp-studio`, 'tools/call', { name: 'search_catalog', arguments: { q: 'chair', limit: 1 } });
	const item = r.body?.result?.structuredContent?.items?.[0];
	const glb = item?.format === 'glb' ? item.url : null;
	if (!glb) throw new Error(`search_catalog at ${catalog} returned no GLB; pass --glb <https url>`);
	return glb;
}

function outcome(r) {
	if (r.body?.error) return `REFUSED  ${r.body.error.code} ${r.body.error.data?.limit} keyed_on=${r.body.error.data?.keyed_on}`;
	const res = r.body?.result;
	return `ADMITTED ${res?.isError ? 'tool error: ' + (res.content?.[0]?.text || '').slice(0, 80) : 'ok, ' + (res?.structuredContent?.views?.length ?? 0) + ' frames rendered'}`;
}

const look = (token, glb) =>
	rpc(`${BASE}${SURFACE}?install=${encodeURIComponent(token)}`, 'tools/call', {
		name: 'look_at_model',
		arguments: { glb_url: glb, views: ['front'], size: 256 },
	});

const glb = await catalogGlb();
const a = await mint();
const b = await mint();
console.log(`base ${BASE}${SURFACE}`);
console.log(`minted token A ${a.token.slice(0, 16)}... and token B ${b.token.slice(0, 16)}... from the same IP`);
console.log(`connector URL A: ${a.connector_url.replace(a.token, a.token.slice(0, 16) + '...')}`);
console.log(`GLB: ${glb}`);

let failed = false;
for (let i = 1; i <= 5; i++) {
	const r = await look(a.token, glb);
	console.log(`token A call ${i}: ${outcome(r)}`);
	if (i <= 4 && r.body?.error) failed = true;
	if (i === 5) {
		if (!r.body?.error) failed = true;
		else {
			console.log(`  denial message: ${r.body.error.message}`);
			console.log(`  denial data: ${JSON.stringify(r.body.error.data)}`);
			console.log(`  HTTP ${r.status}, retry-after ${r.retryAfter}`);
		}
	}
}
const rb = await look(b.token, glb);
console.log(`token B call 1: ${outcome(rb)}`);
if (rb.body?.error) failed = true;

console.log(failed ? 'FAIL: token budgets are not independent' : 'PASS: token A capped, token B from the same IP still admitted');
process.exit(failed ? 1 : 0);
