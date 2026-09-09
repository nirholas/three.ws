#!/usr/bin/env node
/**
 * Probe the four paid OKX.AI forge rows exactly the way the A2MCP compliance
 * reviewer does, and fail loudly if either defect behind the 2026-09-04 listing
 * rejection is live again.
 *
 * Pass conditions, per paid row:
 *   1. The guide's own self-check, `curl -i -X POST <endpoint>` with no body and
 *      no content-type, answers HTTP 402 carrying a PAYMENT-REQUIRED header.
 *   2. Every 402 quotes each rail exactly once (no duplicate
 *      scheme|network|asset), so the quotation is unambiguous.
 *   3. Every stablecoin rail quotes the row's registered list price, whether or
 *      not the caller named a priced tool.
 *   4. OKX's OWN published reader parses the quotation. The rejection's internal
 *      note said "x402 quotation cannot be parsed or is non-compliant", which is
 *      a verdict from their parser, not from ours, so the check that answers it
 *      is `parsePaymentRequired()` out of `@okxweb3/app-x402-core` (a declared
 *      dependency of this repo). Both copies are read: the PAYMENT-REQUIRED
 *      header, which is where the SDK's own resource server puts the challenge,
 *      and the response body.
 *
 * Usage:
 *   node scripts/okx-compliance-probe.mjs [--base https://three.ws] [--out <file>] [--note <text>]
 *
 * `--note` is recorded verbatim in the capture, for saying what the run proves
 * when the base is not the public site.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parsePaymentRequired } from '@okxweb3/app-x402-core/schemas';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};

const BASE = (flag('--base', 'https://three.ws') || '').replace(/\/+$/, '');
const OUT = flag('--out', '');
const NOTE = flag('--note', '');

/** service id -> registered list price, in atomic units of a 6-decimal stablecoin. */
const PAID_ROWS = [
	['forge-draft', '10000'],
	['forge-standard', '50000'],
	['forge-hd', '250000'],
	['forge-image', '250000'],
];

/** Every paid row sells the same priced tool; the row picks the tier and price. */
const PRICED_TOOL = 'forge_3d';

/** Readable token label, so the evidence file carries no raw contract addresses. */
function assetLabel(accept) {
	const network = String(accept.network || '');
	const asset = String(accept.asset || '');
	if (network === 'eip155:196') return 'USD₮0 (X Layer settlement stablecoin)';
	if (network === 'eip155:8453') return 'USDC (Base)';
	if (network.startsWith('solana:')) return /pump$/.test(asset) ? '$THREE' : 'USDC (Solana)';
	return `${network} token`;
}

/** $THREE is priced off a live quote, so it is exempt from the list-price check. */
const isThree = (accept) => assetLabel(accept) === '$THREE';

const railKey = (a) => `${a.scheme}|${a.network}|${a.asset}`;
const amountOf = (a) => a.amount ?? a.maxAmountRequired ?? null;

async function probe(service, label, init) {
	const url = `${BASE}/api/okx/3d/${service}`;
	const res = await fetch(url, { method: 'POST', redirect: 'manual', ...init });
	const text = await res.text();
	const record = {
		service,
		probe: label,
		status: res.status,
		payment_required_header: Boolean(res.headers.get('payment-required')),
	};
	// The header carries the authoritative copy on the OKX rail: their resource
	// server answers with an empty body and the challenge in PAYMENT-REQUIRED,
	// so a buyer's SDK reads the header. Decode it here and hand both copies to
	// the schema check below.
	const header = res.headers.get('payment-required');
	let headerChallenge = null;
	if (header) {
		try {
			headerChallenge = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
		} catch (err) {
			record.payment_required_header_decode_error = String(err?.message || err);
		}
	}
	let parsed = null;
	try {
		parsed = JSON.parse(text);
	} catch {
		record.body = text.slice(0, 400);
		return { record, parsed, headerChallenge };
	}
	if (Array.isArray(parsed?.accepts)) {
		record.accepts = parsed.accepts.map((a) => ({
			scheme: a.scheme,
			network: a.network,
			asset: assetLabel(a),
			amount: amountOf(a),
		}));
		const rails = parsed.accepts.map(railKey);
		record.duplicate_rails = rails.length !== new Set(rails).size;
	} else {
		record.body = text.slice(0, 400);
	}
	return { record, parsed, headerChallenge };
}

// Read a challenge with OKX's own SDK. A rejection here is the exact failure
// their reviewer's internal note describes, so it is recorded per copy rather
// than collapsed into one boolean.
//
// `parsePaymentRequired` is a zod SAFE parse: it returns `{ success, error }`
// and never throws, so "it did not throw" is a false green that passes an empty
// object. Read `success`, and report the failing field paths, which name the
// part of the quotation their parser could not read.
function sdkVerdict(challenge) {
	if (!challenge) return 'absent';
	const result = parsePaymentRequired(challenge);
	if (result?.success === true) return 'parsed';
	const issues = (result?.error?.issues || [])
		.map((i) => `${(i.path || []).join('.') || '<root>'}: ${i.message}`)
		.join('; ');
	return `rejected: ${issues.slice(0, 300) || 'schema rejected the challenge'}`;
}

function check(record, parsed, headerChallenge, listPrice, failures) {
	const where = `${record.service} / ${record.probe}`;
	if (record.status !== 402) {
		failures.push(`${where}: expected HTTP 402, got ${record.status}`);
		return;
	}
	if (!record.payment_required_header) {
		failures.push(`${where}: 402 carried no PAYMENT-REQUIRED header`);
	}
	const accepts = parsed?.accepts;
	if (!Array.isArray(accepts) || accepts.length === 0) {
		failures.push(`${where}: challenge body carried no accepts array`);
		return;
	}
	if (parsed.x402Version !== 2) {
		failures.push(`${where}: x402Version is ${parsed.x402Version}, expected 2`);
	}
	if (accepts[0].network !== 'eip155:196') {
		failures.push(`${where}: first accept is ${accepts[0].network}, expected the X Layer rail to lead`);
	}
	if (record.duplicate_rails) {
		failures.push(`${where}: the same rail is quoted more than once, so the quotation is ambiguous`);
	}
	for (const a of accepts) {
		if (isThree(a)) continue;
		const amount = amountOf(a);
		if (amount !== listPrice) {
			failures.push(`${where}: ${assetLabel(a)} quoted ${amount}, expected the list price ${listPrice}`);
		}
	}
	record.okx_sdk_reads_header = sdkVerdict(headerChallenge);
	record.okx_sdk_reads_body = sdkVerdict(parsed);
	if (record.okx_sdk_reads_header !== 'parsed') {
		failures.push(`${where}: OKX's own SDK could not read the PAYMENT-REQUIRED header (${record.okx_sdk_reads_header})`);
	}
	if (record.okx_sdk_reads_body !== 'parsed') {
		failures.push(`${where}: OKX's own SDK could not read the challenge body (${record.okx_sdk_reads_body})`);
	}
}

const probes = [];
const failures = [];

for (const [service, listPrice] of PAID_ROWS) {
	const shapes = [
		[
			'GET, the SSE transport a streaming MCP client opens with',
			{ method: 'GET', headers: { accept: 'text/event-stream' } },
		],
		['docs self-check: POST, no body, no content-type', {}],
		[
			'POST {} with content-type application/json',
			{ headers: { 'content-type': 'application/json' }, body: '{}' },
		],
		[
			'POST a plain business payload, naming no tool',
			{
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: 'a low-poly fox' }),
			},
		],
		[
			`well-formed tools/call ${PRICED_TOOL} (control)`,
			{
				headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: PRICED_TOOL, arguments: { prompt: 'a low-poly fox' } },
				}),
			},
		],
	];
	for (const [label, init] of shapes) {
		const { record, parsed, headerChallenge } = await probe(service, label, init);
		check(record, parsed, headerChallenge, listPrice, failures);
		probes.push(record);
	}
}

const report = {
	captured_at: new Date().toISOString(),
	base: BASE,
	what: "Live A2MCP compliance capture of the four paid OKX.AI forge rows: the bodyless self-check answers the quotation, every quotation names each rail once at the registered list price, and OKX's own SDK reader parses both the header and the body copy.",
	pass: failures.length === 0,
	failures,
	probes,
	...(NOTE ? { note: NOTE } : {}),
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (OUT) {
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, serialized);
	console.log(`wrote ${OUT}`);
} else {
	process.stdout.write(serialized);
}

for (const f of failures) console.error(`FAIL ${f}`);
console.log(failures.length === 0 ? `PASS ${probes.length} probes against ${BASE}` : `${failures.length} failing check(s)`);
process.exit(failures.length === 0 ? 0 : 1);
