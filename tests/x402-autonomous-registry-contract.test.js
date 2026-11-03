// Caller/endpoint contract for every paid HTTP call the autonomous loop and the
// ring agents make.
//
// The 2026-07-25 briefs recorded a 69% loop failure rate. Part of it was callers
// that disagreed with the live handler: a POST to a GET-only route (`http_405`),
// bodies the handler rejects (`http_400`), a probe that paid for a call the
// endpoint could never serve. Fixing each was done by hand, and nothing stopped a
// new registry entry from reintroducing the same class. This test is that guard.
//
// It drives the REAL handler of every path-based call, unpaid, and reads the
// contract the handler itself advertises in its 402 challenge: the HTTP method
// it serves and the JSON schema of the body or query it requires. The caller's
// method, query and static body must satisfy it. Nothing here is mocked except
// the socket: the handlers are the production ones.
//
// Run-style pipelines (entries with `run`) own their whole call sequence and are
// covered by their own tests; the forge lane is rebuilt elsewhere and is
// excluded by the owner's instruction.

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Keypair } from '@solana/web3.js';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
process.env.X402_ASSET_MINT_SOLANA ||= USDC;
process.env.X402_PAY_TO_SOLANA ||= Keypair.generate().publicKey.toBase58();
process.env.X402_FEE_PAYER_SOLANA ||= Keypair.generate().publicKey.toBase58();

const ROOT = resolve(import.meta.dirname, '..');

/** Calls that are deliberately not checked here, with the reason. */
const EXCEPTIONS = new Map([
	['/api/x402/forge', 'forge lane is rebuilt elsewhere (owner instruction, 2026-07-25 briefs)'],
	[
		'/api/mcp',
		'JSON-RPC transport, not a paidEndpoint: it has no per-route input schema; each tools/call body is built per target by its pipeline',
	],
]);

/**
 * Registry probes that deliberately hit a FREE read endpoint. They never meet a
 * 402 challenge, so the paid-contract checks below do not apply; instead the
 * handler must serve the caller's verb and refuse another one with a 405.
 */
const FREE_PROBES = new Map([
	['GET /api/x402/did', 'public W3C DID document (the paid canary is the POST on the same route)'],
	['GET /api/x402/glb-optimization-report', 'free operational read of the glb_optimizations catalog feed'],
]);

/**
 * Routes with a free daily lane in front of the x402 rail: an unpaid POST that
 * carries a claim spends a free-quota slot and runs the real search+LLM chain, so
 * it answers 200. The handler documents a claim-less body as the discovery probe
 * and answers it with the 402 challenge, so that is what this test sends; the
 * caller's real body is still validated against the schema the challenge carries.
 */
const FREE_LANE_ROUTES = new Set(['/api/x402/fact-check']);

const ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: true });
addFormats(ajv);

/** Run a real handler against a stub socket and return what it wrote. */
async function drive(handler, { method, path, query, body: callBody }) {
	const qs = new URLSearchParams(query).toString();
	const headers = {};
	let body;
	// The Cloud Run server drains the request stream through body-parser and leaves
	// the bytes on req.rawBody before any handler runs (see readBody in
	// api/_lib/http.js). A stub with no body at all would leave readBody waiting on
	// a stream that never ends, so a POST carries what the real caller would send.
	const rawBody = method === 'POST' ? Buffer.from(JSON.stringify(callBody ?? {})) : undefined;
	const res = {
		statusCode: 200,
		headersSent: false,
		setHeader(k, v) {
			headers[k.toLowerCase()] = v;
		},
		getHeader: (k) => headers[k.toLowerCase()],
		removeHeader(k) {
			delete headers[k.toLowerCase()];
		},
		writeHead(status, h) {
			this.statusCode = status;
			Object.assign(headers, Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v])));
		},
		write() {},
		end(b) {
			body = b;
		},
		on() {},
		once() {},
		emit() {},
	};
	const req = {
		method,
		url: qs ? `${path}?${qs}` : path,
		headers: {
			host: 'three.ws',
			'user-agent': 'contract-test',
			'x-forwarded-for': '203.0.113.7',
			...(rawBody ? { 'content-type': 'application/json' } : {}),
		},
		...(rawBody ? { rawBody } : {}),
		socket: { remoteAddress: '203.0.113.7' },
		query: { ...query },
		on() {},
	};
	await Promise.race([
		handler(req, res),
		new Promise((_, reject) => setTimeout(() => reject(new Error(`${path} did not answer in 8s`)), 8000)),
	]);
	return { status: res.statusCode, headers, body };
}

/** The contract a handler advertises in its challenge: method + body/query schema. */
function contractFrom(headers, body) {
	const encoded = headers['payment-required'];
	let challenge = null;
	if (encoded) {
		challenge = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
	} else if (body) {
		try {
			challenge = JSON.parse(String(body));
		} catch {
			challenge = null;
		}
	}
	const bazaar = challenge?.extensions?.bazaar;
	const input = bazaar?.info?.input;
	const schemaInput = bazaar?.schema?.properties?.input?.properties;
	return {
		method: input?.method ?? null,
		bodySchema: schemaInput?.body ?? null,
		querySchema: schemaInput?.queryParams ?? null,
	};
}

async function loadCalls() {
	const { getFullRegistry } = await import('../api/_lib/x402/autonomous-registry.js');
	const { PERSONAS } = await import('../api/_lib/x402/agents/index.js');
	const calls = new Map();
	const add = (source, method, rawPath, body) => {
		const url = new URL(rawPath, 'https://three.ws');
		const key = `${method} ${url.pathname}${url.search}|${JSON.stringify(body ?? null)}`;
		if (calls.has(key)) {
			calls.get(key).sources.push(source);
			return;
		}
		calls.set(key, {
			sources: [source],
			method,
			path: url.pathname,
			query: Object.fromEntries(url.searchParams),
			body,
		});
	};

	for (const e of getFullRegistry()) {
		if (typeof e.run === 'function' || !e.path || e.url) continue;
		add(`registry:${e.id}`, e.method || 'POST', e.path, typeof e.body === 'function' ? undefined : e.body);
	}
	for (const persona of PERSONAS) {
		for (let seed = 0; seed < 64; seed++) {
			for (const p of persona.plan({ origin: 'https://three.ws', seed, maxBuys: 4 })) {
				add(`persona:${persona.id}:${p.slug}`, p.method || 'GET', p.url, p.body);
			}
		}
	}
	return [...calls.values()];
}

let calls = [];
beforeAll(async () => {
	calls = await loadCalls();
}, 60_000);

describe('autonomous registry and ring agents: caller/endpoint contract', () => {
	it('collects a non-trivial set of calls to check', () => {
		expect(calls.length).toBeGreaterThan(30);
	});

	it('every checked call resolves to a real handler that serves its method and accepts its input', async () => {
		const problems = [];
		const checked = [];

		for (const call of calls) {
			if (EXCEPTIONS.has(call.path)) continue;
			const label = `${call.method} ${call.path}${Object.keys(call.query).length ? '?' + new URLSearchParams(call.query) : ''} (${[...new Set(call.sources)].slice(0, 2).join(', ')})`;
			const file = resolve(ROOT, call.path.replace(/^\//, '') + '.js');
			if (!existsSync(file)) {
				problems.push(`${label}: no handler file at ${call.path.replace(/^\//, '')}.js`);
				continue;
			}
			const mod = await import(/* @vite-ignore */ pathToFileURL(file).href);
			if (FREE_PROBES.has(`${call.method} ${call.path}`)) {
				const served = await drive(mod.default, call).catch((err) => ({ error: err }));
				const wrongVerb = await drive(mod.default, { ...call, method: 'DELETE' }).catch((err) => ({ error: err }));
				if (served.error || wrongVerb.error) {
					problems.push(`${label}: free probe handler threw or hung: ${(served.error || wrongVerb.error).message}`);
				} else if (served.status === 405) {
					problems.push(`${label}: free probe answered 405 to the verb the caller sends`);
				} else if (wrongVerb.status !== 405) {
					problems.push(`${label}: free probe answered ${wrongVerb.status} to a DELETE, expected 405`);
				}
				continue;
			}
			const probe = FREE_LANE_ROUTES.has(call.path) ? { ...call, body: {} } : call;
			const out = await drive(mod.default, probe).catch((err) => ({ error: err }));
			if (out.error) {
				problems.push(`${label}: handler threw or hung: ${out.error.message}`);
				continue;
			}
			if (out.status !== 402) {
				problems.push(`${label}: unpaid request got ${out.status}, expected a 402 challenge`);
				continue;
			}
			const contract = contractFrom(out.headers, out.body);
			if (!contract.method) {
				problems.push(`${label}: handler's challenge does not declare an HTTP method`);
				continue;
			}
			// A paid request (it carries x-payment) on any other method is a hard 405.
			const served = contract.method;
			if (served !== call.method) {
				problems.push(`${label}: handler serves ${served} only; the caller sends ${call.method}`);
				continue;
			}
			if (call.body !== undefined && contract.bodySchema) {
				const validate = ajv.compile(contract.bodySchema);
				if (!validate(call.body)) {
					problems.push(`${label}: body ${JSON.stringify(call.body)} rejected by the handler's schema: ${ajv.errorsText(validate.errors)}`);
					continue;
				}
			}
			if (contract.querySchema) {
				const validate = ajv.compile(contract.querySchema);
				if (!validate(call.query)) {
					problems.push(`${label}: query rejected by the handler's schema: ${ajv.errorsText(validate.errors)}`);
					continue;
				}
			}
			checked.push(label);
		}

		expect(problems).toEqual([]);
		expect(checked.length).toBeGreaterThan(25);
	}, 180_000);

	it('only excepts calls that exist, so a stale exception cannot hide a regression', () => {
		const paths = new Set(calls.map((c) => c.path));
		for (const path of EXCEPTIONS.keys()) {
			expect(paths.has(path), `${path} is excepted but no call uses it any more`).toBe(true);
		}
	});
});
