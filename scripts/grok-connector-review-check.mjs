#!/usr/bin/env node
// Reviewer readiness for the Grok Bot marketplace listing of /api/mcp-grok.
//
// A marketplace reviewer adds https://three.ws/api/mcp-grok?auth=oauth to a
// clean Grok Bot, signs in with a new free account, and asks for a model. This
// script walks that exact path from a client with no stored state and proves
// every hop, timed:
//
//   1. initialize without credentials        401 + WWW-Authenticate resource_metadata
//   2. protected-resource metadata (RFC 9728) names this server and its authorization server
//   3. authorization-server metadata (8414)  authorize, token, registration, S256, public clients
//   4. dynamic client registration (7591)    a public client with a loopback redirect
//   5. PKCE authorize                        lands on the sign-in page, which renders the form
//                                            and carries the consent step (client + challenge)
//   6. token endpoint                        refuses a forged code with invalid_grant
//   7. initialize with an API key            200 and an Mcp-Session-Id
//   8. tools/list                            the studio tools, and no financial-tier tool
//   9. search_catalog                        a real catalog hit
//  10. forge_free + check_job                a finished, downloadable GLB
//
// Steps 7 to 10 need a three.ws API key. THREE_WS_API_KEY is used when set;
// otherwise, when AUDIT_EMAIL / AUDIT_PASSWORD are in .env (the production QA
// account), a short-lived connector key (the grant Grok Bot holds) is minted
// for the run and revoked after it. With neither, those steps print SKIP.
//
//   node scripts/grok-connector-review-check.mjs
//   node scripts/grok-connector-review-check.mjs --base http://localhost:3000 --no-generate
//   node scripts/grok-connector-review-check.mjs --json out.json --record tests/fixtures/grok-review
//   node scripts/grok-connector-review-check.mjs --server /api/mcp-studio   (same path, another listing)
//
// Exit 0 when nothing failed, 1 otherwise.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { POLICY } from '@three-ws/mcp-policy';
import { mintQaKey, revokeQaKey } from './lib/qa-api-key.mjs';

const PROTOCOL = '2025-06-18';
const SERVER_PATH = '/api/mcp-grok';
const REDIRECT_URI = 'http://127.0.0.1:33418/callback';
const SCOPE = 'avatars:read avatars:write profile agents:read offline_access';
export const REQUIRED_TOOLS = Object.freeze([
	'forge_free',
	'check_job',
	'search_catalog',
	'get_job',
]);
const FINANCIAL = new Set(
	Object.entries(POLICY['three.ws'] ?? {})
		.filter(([, v]) => v?.tier === 'financial')
		.map(([k]) => k),
);
export const DEFAULT_PROMPT = 'a small wooden treasure chest with brass corners';

/** A failed expectation inside a step; the message is what the table prints. */
class StepFailure extends Error {}
function expect(cond, message) {
	if (!cond) throw new StepFailure(message);
}

/** Parse a JSON-RPC answer that arrived as JSON or as one SSE `data:` event. */
export function parseRpc(text) {
	const trimmed = text.trim();
	if (trimmed.startsWith('{')) return JSON.parse(trimmed);
	const events = trimmed
		.split(/\n\n+/)
		.map((block) =>
			block
				.split('\n')
				.filter((l) => l.startsWith('data:'))
				.map((l) => l.slice(5).trim())
				.join(''),
		)
		.filter(Boolean)
		.map((d) => JSON.parse(d));
	const answer = events.reverse().find((e) => 'result' in e || 'error' in e);
	if (!answer) throw new StepFailure('no JSON-RPC result in the event stream');
	return answer;
}

/** The value of one key in a `Bearer k="v", ...` challenge. */
export function challengeParam(header, key) {
	const m = new RegExp(`${key}="([^"]+)"`).exec(header || '');
	return m ? m[1] : null;
}

/** Does this HTML render a usable sign-in form (a form, an email field, a password field)? */
export function rendersSignIn(html) {
	return (
		/<form\b/i.test(html) &&
		/<input[^>]*type="email"/i.test(html) &&
		/<input[^>]*type="password"/i.test(html)
	);
}

function pkce() {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

/**
 * Walk the reviewer path. Every network call goes through `fetchImpl`, so the
 * test replays recorded production answers through the same code.
 *
 * @returns {Promise<{ rows: Array<{step:string,status:'PASS'|'FAIL'|'SKIP',ms:number,detail:string}>, glbUrl: string|null, signedInToModelMs: number|null }>}
 */
export async function runReviewCheck({
	base = 'https://three.ws',
	apiKey = null,
	generate = true,
	prompt = DEFAULT_PROMPT,
	fetchImpl = fetch,
	makePkce = pkce,
	sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
	generationTimeoutMs = 15 * 60_000,
	onRow = () => {},
	serverPath = SERVER_PATH,
} = {}) {
	const origin = base.replace(/\/+$/, '');
	const serverUrl = `${origin}${serverPath}`;
	const rows = [];
	const ctx = { glbUrl: null };

	async function step(name, fn) {
		const t0 = Date.now();
		let row;
		try {
			const detail = await fn();
			row = { step: name, status: 'PASS', ms: Date.now() - t0, detail: detail ?? '' };
		} catch (err) {
			const detail = err instanceof StepFailure ? err.message : `${err.name}: ${err.message}`;
			row = { step: name, status: 'FAIL', ms: Date.now() - t0, detail };
		}
		rows.push(row);
		onRow(row);
		return row.status === 'PASS';
	}
	function skip(name, detail) {
		const row = { step: name, status: 'SKIP', ms: 0, detail };
		rows.push(row);
		onRow(row);
	}

	const initBody = (id) => ({
		jsonrpc: '2.0',
		id,
		method: 'initialize',
		params: {
			protocolVersion: PROTOCOL,
			capabilities: {},
			clientInfo: { name: 'three.ws-review-check', version: '1' },
		},
	});
	const rpcHeaders = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
	};

	// 1 to 6: the OAuth discovery a clean client performs.
	const oauth = {};
	const discovered =
		(await step('unauthenticated initialize answers 401 with a challenge', async () => {
			const res = await fetchImpl(`${serverUrl}?auth=oauth`, {
				method: 'POST',
				headers: rpcHeaders,
				body: JSON.stringify(initBody(1)),
			});
			expect(res.status === 401, `expected 401, got ${res.status}`);
			const challenge = res.headers.get('www-authenticate');
			oauth.resourceMetadata = challengeParam(challenge, 'resource_metadata');
			expect(
				oauth.resourceMetadata,
				`WWW-Authenticate carries no resource_metadata: ${challenge}`,
			);
			return oauth.resourceMetadata;
		})) &&
		(await step('protected-resource metadata names this server', async () => {
			const res = await fetchImpl(oauth.resourceMetadata, {
				headers: { accept: 'application/json' },
			});
			expect(res.status === 200, `expected 200, got ${res.status}`);
			const doc = await res.json();
			expect(
				doc.resource === serverUrl,
				`resource is ${doc.resource}, expected ${serverUrl}`,
			);
			expect(
				Array.isArray(doc.authorization_servers) && doc.authorization_servers.length,
				'no authorization_servers',
			);
			oauth.issuer = doc.authorization_servers[0].replace(/\/+$/, '');
			return `resource ${doc.resource}, authorization server ${oauth.issuer}`;
		})) &&
		(await step(
			'authorization-server metadata supports DCR, PKCE S256, public clients',
			async () => {
				const res = await fetchImpl(
					`${oauth.issuer}/.well-known/oauth-authorization-server`,
					{ headers: { accept: 'application/json' } },
				);
				expect(res.status === 200, `expected 200, got ${res.status}`);
				const md = await res.json();
				for (const key of [
					'authorization_endpoint',
					'token_endpoint',
					'registration_endpoint',
				])
					expect(md[key], `metadata lacks ${key}`);
				expect(
					md.issuer?.replace(/\/+$/, '') === oauth.issuer,
					`issuer ${md.issuer} does not match ${oauth.issuer}`,
				);
				expect(
					md.code_challenge_methods_supported?.includes('S256'),
					'S256 is not advertised',
				);
				expect(
					md.token_endpoint_auth_methods_supported?.includes('none'),
					'public clients (auth method none) are not advertised',
				);
				Object.assign(oauth, {
					authorize: md.authorization_endpoint,
					token: md.token_endpoint,
					register: md.registration_endpoint,
				});
				return `registration ${md.registration_endpoint}`;
			},
		)) &&
		(await step('dynamic client registration issues a public client', async () => {
			const res = await fetchImpl(oauth.register, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({
					client_name: 'three.ws review check',
					redirect_uris: [REDIRECT_URI],
					grant_types: ['authorization_code', 'refresh_token'],
					response_types: ['code'],
					token_endpoint_auth_method: 'none',
					scope: SCOPE,
				}),
			});
			expect(res.status === 201 || res.status === 200, `expected 201, got ${res.status}`);
			const client = await res.json();
			expect(client.client_id, 'no client_id in the registration answer');
			expect(
				client.redirect_uris?.includes(REDIRECT_URI),
				'the registered client lost its redirect URI',
			);
			oauth.clientId = client.client_id;
			return `client_id ${client.client_id.slice(0, 8)}…`;
		})) &&
		(await step('PKCE authorize lands on a sign-in page that renders the form', async () => {
			const { challenge } = makePkce();
			const url = new URL(oauth.authorize);
			const params = {
				response_type: 'code',
				client_id: oauth.clientId,
				redirect_uri: REDIRECT_URI,
				code_challenge: challenge,
				code_challenge_method: 'S256',
				scope: SCOPE,
				state: randomBytes(8).toString('hex'),
				resource: serverUrl,
			};
			for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
			let res = await fetchImpl(url.href, { redirect: 'manual' });
			let page = url;
			if (res.status >= 300 && res.status < 400) {
				page = new URL(res.headers.get('location'), url);
				expect(
					page.origin === new URL(oauth.issuer).origin,
					`authorize redirected off-site to ${page.origin}`,
				);
				const next = page.searchParams.get('next') || '';
				expect(
					next.includes(oauth.clientId),
					'the sign-in redirect drops the client_id, so consent cannot resume',
				);
				expect(next.includes(challenge), 'the sign-in redirect drops the PKCE challenge');
				res = await fetchImpl(page.href, { redirect: 'manual' });
			}
			expect(res.status === 200, `sign-in page answered ${res.status}`);
			const html = await res.text();
			expect(
				rendersSignIn(html),
				'the sign-in page has no form with email and password fields',
			);
			return `${page.pathname} renders the sign-in form, consent resumes after sign-in`;
		})) &&
		(await step('token endpoint refuses a forged code', async () => {
			const res = await fetchImpl(oauth.token, {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					accept: 'application/json',
				},
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code: `forged-${randomBytes(12).toString('hex')}`,
					redirect_uri: REDIRECT_URI,
					client_id: oauth.clientId,
					code_verifier: pkce().verifier,
				}).toString(),
			});
			expect(res.status === 400, `expected 400, got ${res.status}`);
			const body = await res.json();
			expect(body.error === 'invalid_grant', `expected invalid_grant, got ${body.error}`);
			return 'invalid_grant';
		}));

	// 7 to 10: what the signed-in reviewer does.
	const authed = [
		'initialize with an API key issues a session',
		'tools/list serves the studio tools and nothing that spends',
		'search_catalog returns a catalog hit',
		'forge_free returns a finished GLB',
	];
	if (!apiKey) {
		for (const name of authed) skip(name, 'no THREE_WS_API_KEY and no QA login to mint one');
		return { rows, glbUrl: null, signedInToModelMs: null, discovered };
	}

	const session = { id: null, nextId: 10 };
	async function rpc(method, params) {
		const headers = {
			...rpcHeaders,
			authorization: `Bearer ${apiKey}`,
			'mcp-protocol-version': PROTOCOL,
		};
		if (session.id) headers['mcp-session-id'] = session.id;
		const res = await fetchImpl(serverUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify({ jsonrpc: '2.0', id: session.nextId++, method, params }),
		});
		expect(res.status === 200, `${method} answered HTTP ${res.status}`);
		const msg = parseRpc(await res.text());
		expect(!msg.error, `${method} JSON-RPC error ${msg.error?.code}: ${msg.error?.message}`);
		return { res, result: msg.result };
	}
	async function callTool(name, args, { allowRetryable = false } = {}) {
		const { result } = await rpc('tools/call', { name, arguments: args });
		const out = result.structuredContent ?? {};
		// A job check that failed while the job keeps running says so with
		// retryable + retry_after; a contract-following client checks again.
		if (result.isError && allowRetryable && out.retryable)
			return { ...out, status: 'pending', retryAfter: Number(out.retry_after) || 10 };
		expect(
			!result.isError,
			`${name} answered isError: ${result.content?.[0]?.text?.slice(0, 200)}`,
		);
		return out;
	}

	const signedInAt = Date.now();
	const ready = await step(authed[0], async () => {
		const res = await fetchImpl(serverUrl, {
			method: 'POST',
			headers: { ...rpcHeaders, authorization: `Bearer ${apiKey}` },
			body: JSON.stringify(initBody(2)),
		});
		expect(res.status === 200, `expected 200, got ${res.status}`);
		const msg = parseRpc(await res.text());
		expect(msg.result?.serverInfo?.name, 'initialize returned no serverInfo');
		session.id = res.headers.get('mcp-session-id');
		expect(session.id, 'no Mcp-Session-Id issued');
		await fetchImpl(serverUrl, {
			method: 'POST',
			headers: {
				...rpcHeaders,
				authorization: `Bearer ${apiKey}`,
				'mcp-session-id': session.id,
				'mcp-protocol-version': PROTOCOL,
			},
			body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
		});
		return `${msg.result.serverInfo.name} ${msg.result.serverInfo.version}, session ${session.id.slice(0, 4)}…`;
	});
	if (!ready) {
		for (const name of authed.slice(1)) skip(name, 'no session');
		return { rows, glbUrl: null, signedInToModelMs: null, discovered };
	}

	await step(authed[1], async () => {
		const { result } = await rpc('tools/list', {});
		const names = (result.tools ?? []).map((t) => t.name);
		const missing = REQUIRED_TOOLS.filter((n) => !names.includes(n));
		expect(!missing.length, `missing ${missing.join(', ')}`);
		const spending = names.filter((n) => FINANCIAL.has(n));
		expect(!spending.length, `financial-tier tools listed: ${spending.join(', ')}`);
		return `${names.length} tools, 0 financial-tier`;
	});

	await step(authed[2], async () => {
		const out = await callTool('search_catalog', { q: 'chair', limit: 3 });
		const items = out.items ?? out.results ?? [];
		expect(items.length > 0, 'no catalog items for "chair"');
		return `${items.length} hits, first "${items[0].title ?? items[0].name ?? items[0].id}"`;
	});

	if (!generate) {
		skip(authed[3], '--no-generate');
		return { rows, glbUrl: null, signedInToModelMs: null, discovered };
	}
	await step(authed[3], async () => {
		let out = await callTool('forge_free', { prompt });
		const deadline = Date.now() + generationTimeoutMs;
		let polls = 0;
		let retries = 0;
		while (out.status === 'pending') {
			expect(
				Date.now() < deadline,
				`still pending after ${Math.round(generationTimeoutMs / 1000)} s`,
			);
			const jobId = out.job_id ?? out.jobId;
			expect(jobId, 'pending result carries no job_id');
			const waitS =
				out.retryAfter ?? Math.min(Math.max(Number(out.eta_seconds) || 10, 5), 30);
			await sleep(waitS * 1000);
			out = await callTool('check_job', { job_id: jobId }, { allowRetryable: true });
			if (out.retryAfter) retries++;
			polls++;
		}
		expect(out.status === 'done' || out.glb_url, `generation ended with status ${out.status}`);
		const glb = out.glb_url ?? out.glbUrl ?? out.model_url;
		expect(
			typeof glb === 'string' && /^https:\/\//.test(glb),
			'finished result has no https glb_url',
		);
		const head = await fetchImpl(glb, { method: 'HEAD' });
		expect(head.status === 200, `the GLB answered ${head.status}`);
		ctx.glbUrl = glb;
		const retried = retries
			? `, ${retries} retryable check${retries === 1 ? '' : 's'} retried`
			: '';
		return `done after ${polls} check_job poll${polls === 1 ? '' : 's'}${retried}`;
	});

	const signedInToModelMs = ctx.glbUrl ? Date.now() - signedInAt : null;
	return { rows, glbUrl: ctx.glbUrl, signedInToModelMs, discovered };
}

/** The PASS/FAIL table the CLI prints. */
export function formatTable(rows) {
	const w = Math.max(...rows.map((r) => r.step.length));
	return rows
		.map(
			(r, i) =>
				`${String(i + 1).padStart(2)}. ${r.status.padEnd(4)}  ${r.step.padEnd(w)}  ${String(r.ms).padStart(6)} ms  ${r.detail}`,
		)
		.join('\n');
}

/** Wrap fetch so every exchange is written down, secrets redacted, for the test fixture. */
export function recordingFetch(inner, log) {
	const redact = (s) =>
		String(s)
			.replace(/Bearer (?![a-z_]+=")[A-Za-z0-9._~+/=-]+/g, 'Bearer <redacted>')
			.replace(/("token"\s*:\s*")[^"]+/g, '$1<redacted>');
	return async (url, init = {}) => {
		const res = await inner(url, init);
		const body = init.method === 'HEAD' ? '' : await res.clone().text();
		const headers = {};
		for (const k of ['content-type', 'location', 'www-authenticate', 'mcp-session-id']) {
			const v = res.headers.get(k);
			if (v) headers[k] = redact(v);
		}
		log.push({
			request: { method: init.method ?? 'GET', url: new URL(url).pathname },
			response: { status: res.status, headers, body: redact(body) },
		});
		return res;
	};
}

/**
 * Shrink a recorded run to what the check reads, so it can live in the repo as
 * a test fixture: tools/list keeps tool names only and drops the signed-in
 * account tools (the listing is about the studio; the live run still checks
 * every listed tool against the financial tier), initialize keeps serverInfo
 * and drops the long server instructions, the sign-in page keeps its
 * form and its inputs (not the page copy), and job handles (signed tokens that embed a worker address) are
 * replaced by a stable stand-in.
 */
export function fixtureSafe(log, isAccountTool) {
	return log.map((entry) => {
		let body = entry.response.body.replace(
			/f1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
			'f1.recorded-job',
		);
		if (entry.request.url === '/login') {
			const form = /<form\b[^>]*>[\s\S]*?<\/form>/i.exec(body);
			if (form) {
				const open = /<form\b[^>]*>/i.exec(form[0])[0];
				const inputs = form[0].match(/<input\b[^>]*>/gi) ?? [];
				body = `<!doctype html><title>Sign in</title>${open}\n${inputs.join('\n')}\n</form>`;
			}
		} else if (body.includes('"tools":[')) {
			const msg = parseRpc(body);
			const names = msg.result.tools.map((t) => t.name);
			const kept = names.filter((n) => !isAccountTool(n));
			msg.result = {
				tools: kept.map((name) => ({ name })),
				recorded_note: `${names.length - kept.length} signed-in account tools and all descriptions omitted`,
			};
			body = JSON.stringify(msg);
		} else if (body.includes('"serverInfo"')) {
			const msg = parseRpc(body);
			const { instructions, ...rest } = msg.result;
			msg.result = {
				...rest,
				...(instructions ? { recorded_note: 'server instructions omitted' } : {}),
			};
			body = JSON.stringify(msg);
		}
		return { ...entry, response: { ...entry.response, body } };
	});
}

async function main() {
	const { values: opts } = parseArgs({
		options: {
			base: { type: 'string', default: 'https://three.ws' },
			prompt: { type: 'string', default: DEFAULT_PROMPT },
			'no-generate': { type: 'boolean', default: false },
			json: { type: 'string' },
			record: { type: 'string' },
			server: { type: 'string', default: SERVER_PATH },
		},
	});
	const serverPath = `/${opts.server.replace(/^\/+/, '')}`;
	const origin = opts.base.replace(/\/+$/, '');
	let apiKey = process.env.THREE_WS_API_KEY || null;
	let minted = null;
	if (!apiKey) {
		minted = await mintQaKey({ origin, name: 'grok marketplace review check' });
		apiKey = minted?.token ?? null;
		if (minted) console.log('using a short-lived connector key minted for the QA account\n');
	}
	const log = [];
	const fetchImpl = opts.record ? recordingFetch(fetch, log) : fetch;
	console.log(`Marketplace reviewer path: ${origin}${serverPath}?auth=oauth\n`);
	let report;
	try {
		report = await runReviewCheck({
			base: origin,
			apiKey,
			generate: !opts['no-generate'],
			prompt: opts.prompt,
			fetchImpl,
			serverPath,
		});
	} finally {
		if (minted) await revokeQaKey(minted);
	}
	console.log(formatTable(report.rows));
	if (report.glbUrl) {
		console.log(`\nmodel: ${report.glbUrl}`);
		console.log(
			`sign-in to first generated model: ${(report.signedInToModelMs / 1000).toFixed(1)} s`,
		);
	}
	const failed = report.rows.filter((r) => r.status === 'FAIL').length;
	const out = { base: origin, at: new Date().toISOString(), ...report, failed };
	if (opts.json) {
		mkdirSync(dirname(resolve(opts.json)), { recursive: true });
		writeFileSync(opts.json, JSON.stringify(out, null, '\t') + '\n');
	}
	if (opts.record) {
		mkdirSync(resolve(opts.record), { recursive: true });
		const { isAccountTool } = await import('../api/_mcp-studio/account-tools.js');
		writeFileSync(
			join(resolve(opts.record), 'exchanges.json'),
			JSON.stringify(fixtureSafe(log, isAccountTool), null, '\t') + '\n',
		);
		writeFileSync(
			join(resolve(opts.record), 'report.json'),
			JSON.stringify(
				{ rows: report.rows, signedInToModelMs: report.signedInToModelMs },
				null,
				'\t',
			) + '\n',
		);
	}
	console.log(`\n${failed ? `${failed} FAILED` : 'ALL PASS'}`);
	process.exit(failed ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
