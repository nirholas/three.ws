#!/usr/bin/env node
// scripts/x402scan-registration-gap.mjs
//
// Answers one question before anyone spends an owner wallet signature on
// https://www.x402scan.com/resources/register: what would that registration
// actually do to our origin listing?
//
// x402scan's "Add API" flow reads our /openapi.json, classifies every operation
// into an auth mode, probes the ones it treats as payable, and writes the
// survivors as resource rows keyed by (url, method). Anything already listed
// that the document no longer declares gets DEPRECATED in the same pass, so a
// registration run is not automatically additive and is worth previewing.
//
// This script reproduces that pipeline against live production:
//
//   1. Classify   /openapi.json operations exactly the way @agentcash/discovery
//                 does: an operation carrying `x-payment-info` is `paid`; an
//                 explicit `security: []` without it is `unprotected`; a declared
//                 apiKey scheme is `apiKey`. Verified against that library's own
//                 output on 2026-09-09 (123 endpoints, identical classification).
//   2. Read       the resource rows already on our x402scan origin page.
//   3. Probe      every declared-but-unlisted endpoint the way their registrar
//                 does (bare request, minimal required query params) and report
//                 whether it answers a spec-valid 402.
//   4. Report     new / already-listed / would-deprecate / would-fail.
//
// Exit code is 0 whenever the preview succeeds, 1 only when the document or the
// origin page could not be read. A non-empty "would deprecate" list is the one
// result that should stop a registration run.
//
// Usage:
//   node scripts/x402scan-registration-gap.mjs
//   node scripts/x402scan-registration-gap.mjs --base=http://localhost:3000
//   node scripts/x402scan-registration-gap.mjs --json
//   node scripts/x402scan-registration-gap.mjs --no-probe   # classify only, no traffic

const args = process.argv.slice(2);
const argValue = (name) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1) || null;

const base = (argValue('--base') || 'https://three.ws').replace(/\/$/, '');
const originId = argValue('--origin-id') || '17cbd874-52ac-4920-a020-b22ff2489a07';
const asJson = args.includes('--json');
const skipProbe = args.includes('--no-probe');

const PROBE_TIMEOUT_MS = 30_000;
const PROBE_CONCURRENCY = 6;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

async function fetchJson(url) {
	const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`${url} answered ${res.status}`);
	return res.json();
}

// Mirrors @agentcash/discovery's OpenAPI auth-mode assignment. `x-payment-info`
// wins over the security list, which is why our paid operations register as paid
// rows despite declaring `security: []` (payment, not a credential, gates them).
function authModeFor(operation, securitySchemes) {
	if (operation['x-payment-info']) {
		return declaresApiKey(operation.security, securitySchemes) ? 'apiKey+paid' : 'paid';
	}
	if (Array.isArray(operation.security)) {
		if (operation.security.length === 0) return 'unprotected';
		if (declaresApiKey(operation.security, securitySchemes)) return 'apiKey';
	}
	return undefined;
}

function declaresApiKey(security, securitySchemes) {
	if (!Array.isArray(security)) return false;
	return security.some((requirement) =>
		Object.keys(requirement || {}).some((name) => securitySchemes[name]?.type === 'apiKey')
	);
}

// Their registrar only writes rows for these modes; anything else is skipped.
const REGISTRABLE = new Set(['paid', 'apiKey+paid', 'siwx', 'unprotected', 'apiKey']);

function declaredEndpoints(spec) {
	const securitySchemes = spec.components?.securitySchemes || {};
	const out = [];
	for (const [path, item] of Object.entries(spec.paths || {})) {
		for (const method of METHODS) {
			const operation = item?.[method];
			if (!operation) continue;
			const authMode = authModeFor(operation, securitySchemes);
			if (!REGISTRABLE.has(authMode)) continue;
			out.push({
				path,
				method: method.toUpperCase(),
				authMode,
				price: operation['x-payment-info']?.price?.amount || null,
				// Their probe only fills query params the spec marks required, so an
				// endpoint whose paid mode hides behind an optional param cannot be
				// reached by a bare probe. Carry them to explain such a failure.
				requiredQuery: (operation.parameters || [])
					.filter((p) => p?.in === 'query' && p.required)
					.map((p) => p.name),
			});
		}
	}
	return out;
}

// The origin page streams its resource rows inside the RSC payload. Read the
// (resource, method) pairs out of it rather than guessing from our own document.
async function listedRows() {
	const url = `https://www.x402scan.com/server/${originId}`;
	const res = await fetch(url, {
		headers: { 'user-agent': 'three-ws-registration-gap/1.0' },
		signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`${url} answered ${res.status}`);
	const html = await res.text();
	const rows = new Map();
	const pattern = /\\"resource\\":\\"([^\\"]+)\\",\\"method\\":\\"(\w+)\\"(.{0,600}?)\\"deprecatedAt\\":(null|\\"[^\\"]*\\")/g;
	for (const match of html.matchAll(pattern)) {
		const [, resource, method, , deprecatedAt] = match;
		if (!resource.startsWith(base)) continue;
		rows.set(`${resource.slice(base.length)} ${method}`, { deprecated: deprecatedAt !== 'null' });
	}
	if (rows.size === 0) throw new Error(`no resource rows parsed from ${url} (their page format may have changed)`);
	return rows;
}

async function probe(endpoint) {
	const url = new URL(base + endpoint.path);
	for (const name of endpoint.requiredQuery) url.searchParams.set(name, 'probe');
	const init = {
		method: endpoint.method,
		headers: { 'user-agent': 'three-ws-registration-gap/1.0' },
		signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
	};
	if (endpoint.method !== 'GET' && endpoint.method !== 'HEAD') {
		init.headers['content-type'] = 'application/json';
		init.body = '{}';
	}
	try {
		const res = await fetch(url, init);
		if (res.status !== 402) return { status: res.status, valid: false, reason: `answered ${res.status}, not 402` };
		const body = await res.json().catch(() => null);
		const accepts = Array.isArray(body?.accepts) ? body.accepts : [];
		if (accepts.length === 0) return { status: 402, valid: false, reason: '402 carried no accepts[]' };
		const networks = [...new Set(accepts.map((a) => a?.network).filter(Boolean))];
		return { status: 402, valid: true, networks };
	} catch (err) {
		return { status: null, valid: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

async function mapWithConcurrency(items, worker, limit) {
	const results = new Array(items.length);
	let next = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await worker(items[index]);
		}
	});
	await Promise.all(runners);
	return results;
}

async function main() {
	const spec = await fetchJson(`${base}/openapi.json`);
	const declared = declaredEndpoints(spec);
	const listed = await listedRows();

	const key = (e) => `${e.path} ${e.method}`;
	const declaredKeys = new Set(declared.map(key));

	const unlisted = declared.filter((e) => !listed.has(key(e)));
	const already = declared.filter((e) => listed.has(key(e)));
	const wouldDeprecate = [...listed.keys()].filter((k) => !declaredKeys.has(k) && !listed.get(k).deprecated);

	// Only payable modes get probed; free catalog rows register without one.
	const toProbe = skipProbe ? [] : unlisted.filter((e) => e.authMode === 'paid' || e.authMode === 'apiKey+paid');
	const probes = await mapWithConcurrency(toProbe, async (e) => ({ endpoint: e, result: await probe(e) }), PROBE_CONCURRENCY);
	const failing = probes.filter((p) => !p.result.valid);

	const report = {
		base,
		originId,
		declaredRegistrable: declared.length,
		alreadyListed: already.length,
		newRows: unlisted.length,
		wouldDeprecate,
		probed: probes.length,
		probeFailures: failing.map((p) => ({ path: p.endpoint.path, method: p.endpoint.method, reason: p.result.reason })),
		newEndpoints: unlisted.map((e) => ({ path: e.path, method: e.method, authMode: e.authMode, price: e.price })),
	};

	if (asJson) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}

	console.log(`x402scan registration preview for ${base}`);
	console.log(`  declared registrable in /openapi.json : ${report.declaredRegistrable}`);
	console.log(`  already listed on the origin page     : ${report.alreadyListed}`);
	console.log(`  would be added                        : ${report.newRows}`);
	console.log(`  would be deprecated                   : ${wouldDeprecate.length}`);
	if (wouldDeprecate.length > 0) {
		console.log('\n  STOP: registering now would deprecate these listed rows:');
		for (const k of wouldDeprecate.sort()) console.log(`    ${k}`);
	}
	if (!skipProbe) {
		console.log(`\n  probed ${report.probed} payable endpoints: ${report.probed - failing.length} answer a valid 402, ${failing.length} do not`);
		for (const p of failing) console.log(`    ${p.endpoint.method} ${p.endpoint.path}: ${p.result.reason}`);
	}
	if (report.newRows > 0) {
		console.log('\n  new rows this run would add:');
		for (const e of report.newEndpoints) {
			console.log(`    ${e.method.padEnd(4)} ${e.path}${e.price ? `  $${e.price}` : ''}  [${e.authMode}]`);
		}
	}
}

main().catch((err) => {
	console.error(`x402scan-registration-gap: ${err instanceof Error ? err.message : String(err)}`);
	process.exitCode = 1;
});
