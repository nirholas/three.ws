#!/usr/bin/env node
// Connector compatibility probe for every hosted three.ws MCP server.
//
// Behaves like a cloud MCP client (Grok Bot, claude.ai connectors, the xAI
// Responses API): it drives the official MCP SDK client over Streamable HTTP,
// falls back to the legacy SSE transport when Streamable HTTP fails for a
// reason other than auth, and checks the raw handshake details a connector
// trips on silently: the GET a client opens for its server-to-client stream,
// protocol-version negotiation, Mcp-Session-Id issue and echo, and the 401
// that must point an OAuth client at the protected-resource metadata.
//
// The server list is public/.well-known/mcp.json, so a server added there is
// probed with no change here. Three modes per server:
//
//   anonymous   no credentials. Must fully work when the server's auth names
//               `none`; otherwise must answer with an OAuth-shaped 401.
//   api key     Authorization: Bearer $THREE_WS_API_KEY, when that is set.
//   oauth       asserts the challenge shape only: WWW-Authenticate carries
//               resource_metadata, that document resolves, its `resource`
//               is one the MCP SDK accepts for this server URL, and the
//               authorization server metadata supports PKCE S256. An
//               invalid bearer must earn the same challenge (re-auth path).
//
// A server that works anonymously AND upgrades on sign-in (/api/mcp-grok)
// names its sign-in URL in the manifest's `signIn` field. The oauth checks run
// against that URL, and an API key must list more tools than an anonymous
// client sees, since the account's tools are what signing in is for.
//
// Records initialize, tools/list count, prompts/list count, and one free
// tools/call where a free tool exists (search_catalog, getting_started).
// No paid tool is ever called and no payment header is ever sent.
//
//   node scripts/mcp-client-probe.mjs                          # https://three.ws
//   node scripts/mcp-client-probe.mjs --base http://localhost:3000
//   node scripts/mcp-client-probe.mjs --json prompts/x-grok/_generated/connector-probe.json
//   node scripts/mcp-client-probe.mjs --only mcp-studio --timeout 45000
//
// Exit code 0 when every server passes, 1 otherwise.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { checkResourceAllowed, resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_INFO = { name: 'probe', version: '1.0.0' };

// Free tools a probe may call: read-only, no GPU, no spend. First match wins.
const FREE_CALLS = [
	{ name: 'search_catalog', arguments: { q: 'chair', limit: 3 } },
	{ name: 'getting_started', arguments: {} },
];

// Versions a real client may open with. The SDK's latest leads; the rest are
// what older connectors still send.
const NEGOTIATION_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

function parseArgs(argv) {
	const out = { base: 'https://three.ws', json: null, only: null, timeout: 30_000 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => {
			const v = argv[++i];
			if (v === undefined) throw new Error(`${a} needs a value`);
			return v;
		};
		if (a === '--base') out.base = next().replace(/\/+$/, '');
		else if (a === '--json') out.json = next();
		else if (a === '--only') out.only = next();
		else if (a === '--timeout') out.timeout = Number(next());
		else if (a === '--help' || a === '-h') {
			console.log('usage: node scripts/mcp-client-probe.mjs [--base <origin>] [--json <path>] [--only <substring>] [--timeout <ms>]');
			process.exit(0);
		} else throw new Error(`unknown argument ${a}`);
	}
	return out;
}

function loadApiKey() {
	if (process.env.THREE_WS_API_KEY) return process.env.THREE_WS_API_KEY;
	for (const f of ['.env', '.env.local']) {
		const p = resolve(ROOT, f);
		if (!existsSync(p)) continue;
		try {
			process.loadEnvFile(p);
		} catch {
			continue;
		}
		if (process.env.THREE_WS_API_KEY) return process.env.THREE_WS_API_KEY;
	}
	return null;
}

// What the manifest's free-text `auth` promises, as flags the checks key on.
export function authExpectations(auth) {
	const s = String(auth || '');
	return {
		anonymous: /\bnone\b/i.test(s),
		oauth: /oauth/i.test(s),
		apiKey: /api key|authenticated three\.ws principals/i.test(s),
	};
}

export function serverUrlFor(endpoint, base) {
	const u = new URL(endpoint);
	return new URL(u.pathname + u.search, `${base}/`).href;
}

// RFC 9110 auth-param parsing, enough for `Bearer k="v", k2="v2"`.
export function parseWwwAuthenticate(header) {
	if (!header) return null;
	const m = /^\s*(\S+)\s*(.*)$/.exec(header);
	if (!m) return null;
	const params = {};
	const re = /([a-zA-Z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
	let p;
	while ((p = re.exec(m[2]))) params[p[1].toLowerCase()] = p[2] !== undefined ? p[2].replace(/\\(.)/g, '$1') : p[3];
	return { scheme: m[1], params };
}

async function timedFetch(url, init, timeout) {
	return fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
}

function initBody(protocolVersion, id = 1) {
	return JSON.stringify({
		jsonrpc: '2.0',
		id,
		method: 'initialize',
		params: { protocolVersion, capabilities: {}, clientInfo: CLIENT_INFO },
	});
}

const PROTOCOL_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

// A Streamable HTTP response body is either one JSON object or an SSE stream
// whose `data:` lines carry the JSON-RPC messages.
export function parseRpcBody(text, contentType) {
	if (String(contentType || '').includes('text/event-stream')) {
		for (const line of text.split(/\r?\n/)) {
			if (!line.startsWith('data:')) continue;
			try {
				const msg = JSON.parse(line.slice(5).trim());
				if (msg && (msg.result || msg.error)) return msg;
			} catch {
				continue;
			}
		}
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

async function rawInitialize(url, { headers = {}, protocolVersion = LATEST_PROTOCOL_VERSION, timeout }) {
	const res = await timedFetch(url, { method: 'POST', headers: { ...PROTOCOL_HEADERS, ...headers }, body: initBody(protocolVersion) }, timeout);
	const contentType = res.headers.get('content-type') || '';
	const text = await res.text();
	const msg = parseRpcBody(text, contentType);
	return {
		status: res.status,
		contentType,
		sessionId: res.headers.get('mcp-session-id'),
		wwwAuthenticate: res.headers.get('www-authenticate'),
		protocolVersion: msg?.result?.protocolVersion ?? null,
		rpcError: msg?.error ? { code: msg.error.code, message: msg.error.message } : null,
	};
}

async function probeGetStream(url, { headers = {}, timeout }) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		const res = await fetch(url, { method: 'GET', headers: { accept: 'text/event-stream', ...headers }, signal: controller.signal });
		const out = {
			status: res.status,
			contentType: res.headers.get('content-type') || '',
			allow: res.headers.get('allow'),
			wwwAuthenticate: res.headers.get('www-authenticate'),
		};
		// A live stream never ends on its own; the headers are the answer.
		controller.abort();
		await res.body?.cancel().catch(() => {});
		return out;
	} finally {
		clearTimeout(timer);
	}
}

// What a connector needs from a GET: an event stream, a 405 that says which
// methods do work, or an auth challenge it can act on.
export function judgeGetStream(get) {
	if (get.status === 200 && get.contentType.includes('text/event-stream')) return null;
	if (get.status === 405) return get.allow ? null : 'GET answered 405 without an Allow header';
	if (get.status === 401) return get.wwwAuthenticate ? null : 'GET answered 401 without WWW-Authenticate';
	return `GET with accept: text/event-stream answered ${get.status} ${get.contentType}`.trim();
}

async function probeChallenge(url, { timeout }) {
	const out = { failures: [] };
	const anon = await rawInitialize(url, { timeout });
	out.status = anon.status;
	out.wwwAuthenticate = anon.wwwAuthenticate;
	if (anon.status !== 401) {
		out.failures.push(`unauthenticated initialize answered ${anon.status}, an OAuth client needs 401 to start sign-in`);
		return out;
	}
	const parsed = parseWwwAuthenticate(anon.wwwAuthenticate);
	if (!parsed || parsed.scheme.toLowerCase() !== 'bearer') {
		out.failures.push('401 carries no Bearer WWW-Authenticate challenge');
		return out;
	}
	out.resourceMetadataUrl = parsed.params.resource_metadata || null;
	if (!out.resourceMetadataUrl) {
		out.failures.push('WWW-Authenticate does not name resource_metadata');
		return out;
	}
	const mdRes = await timedFetch(out.resourceMetadataUrl, { headers: { accept: 'application/json' } }, timeout);
	const mdType = mdRes.headers.get('content-type') || '';
	const md = mdType.includes('json') ? await mdRes.json().catch(() => null) : null;
	if (!mdType.includes('json')) await mdRes.body?.cancel().catch(() => {});
	out.metadata = {
		status: mdRes.status,
		resource: md?.resource ?? null,
		authorizationServers: md?.authorization_servers ?? null,
	};
	if (mdRes.status !== 200 || !md) {
		out.failures.push(`protected-resource metadata at ${out.resourceMetadataUrl} answered ${mdRes.status} ${mdType}`);
		return out;
	}
	// The exact gate the MCP SDK client runs before it redirects anyone to sign in.
	out.resourceAllowed = Boolean(md.resource) && checkResourceAllowed({ requestedResource: resourceUrlFromServerUrl(url), configuredResource: md.resource });
	if (!out.resourceAllowed) {
		out.failures.push(`protected resource ${md.resource} does not cover ${url}, so an MCP SDK client refuses to sign in`);
	}
	if (parsed.params.resource && parsed.params.resource !== md.resource) {
		out.failures.push(`WWW-Authenticate resource ${parsed.params.resource} disagrees with the metadata resource ${md.resource}`);
	}
	const as = Array.isArray(md.authorization_servers) ? md.authorization_servers[0] : null;
	if (!as) {
		out.failures.push('protected-resource metadata lists no authorization_servers');
		return out;
	}
	const asUrl = new URL('/.well-known/oauth-authorization-server', as).href;
	const asRes = await timedFetch(asUrl, { headers: { accept: 'application/json' } }, timeout);
	const asMd = await asRes.json().catch(() => null);
	out.authorizationServer = {
		url: asUrl,
		status: asRes.status,
		issuer: asMd?.issuer ?? null,
		pkceS256: Boolean(asMd?.code_challenge_methods_supported?.includes('S256')),
		dynamicRegistration: Boolean(asMd?.registration_endpoint),
	};
	if (asRes.status !== 200 || !asMd?.authorization_endpoint || !asMd?.token_endpoint) {
		out.failures.push(`authorization server metadata at ${asUrl} is incomplete (${asRes.status})`);
	} else if (!out.authorizationServer.pkceS256) {
		out.failures.push('authorization server does not advertise PKCE S256, which OAuth 2.1 requires');
	}
	// A connector holding an expired token must be told to re-authenticate, not
	// handed a dead end.
	const stale = await rawInitialize(url, { headers: { authorization: 'Bearer probe.invalid.token' }, timeout });
	out.invalidBearer = { status: stale.status, wwwAuthenticate: stale.wwwAuthenticate };
	const staleParsed = parseWwwAuthenticate(stale.wwwAuthenticate);
	if (stale.status !== 401 || !staleParsed?.params.resource_metadata) {
		out.failures.push(`an invalid bearer answered ${stale.status} without a resource_metadata challenge`);
	}
	return out;
}

async function probeNegotiation(url, { headers = {}, timeout }) {
	const rows = [];
	for (const v of NEGOTIATION_VERSIONS) {
		const r = await rawInitialize(url, { headers, protocolVersion: v, timeout }).catch((err) => ({ error: err.message }));
		rows.push({
			requested: v,
			status: r.status ?? null,
			negotiated: r.protocolVersion ?? null,
			echoed: r.protocolVersion === v,
			clientSupportsAnswer: r.protocolVersion ? SUPPORTED_PROTOCOL_VERSIONS.includes(r.protocolVersion) : false,
			error: r.error ?? r.rpcError?.message ?? null,
		});
	}
	return rows;
}

// Raw session check, run only when the server issued an id: the echoed id
// must work, and an id the server never issued should earn 404 (spec MUST for
// a session the server does not hold).
async function probeSession(url, sessionId, { headers = {}, negotiated, timeout }) {
	const call = (sid) =>
		timedFetch(
			url,
			{
				method: 'POST',
				headers: { ...PROTOCOL_HEADERS, ...headers, 'mcp-session-id': sid, 'mcp-protocol-version': negotiated },
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
			},
			timeout,
		).then(async (r) => {
			await r.body?.cancel().catch(() => {});
			return r.status;
		});
	return { echoed: await call(sessionId), unknown: await call(`probe-unknown-${Date.now()}`) };
}

function errorStatus(err) {
	if (!err) return null;
	if (typeof err.code === 'number' && err.code >= 100 && err.code < 600) return err.code;
	const m = /\b(4\d\d|5\d\d)\b/.exec(String(err.message || ''));
	return m ? Number(m[1]) : null;
}

// The SDK folds the whole response body into its error message, and a 402
// body is several kilobytes of x402 requirements and bazaar schema. Keep the
// SDK's own prefix and the body's error fields; the evidence file records what
// went wrong, not a copy of the server's discovery metadata.
export function summarizeError(message, max = 400) {
	const text = String(message ?? '');
	const brace = text.indexOf('{');
	if (brace !== -1) {
		try {
			const body = JSON.parse(text.slice(brace));
			if (body && typeof body === 'object') {
				const fields = ['error', 'error_description', 'message', 'code']
					.filter((k) => typeof body[k] === 'string' || typeof body[k] === 'number')
					.map((k) => `${k}=${JSON.stringify(body[k])}`);
				if (body.x402Version !== undefined) fields.unshift(`x402Version=${body.x402Version}`);
				if (Array.isArray(body.accepts)) fields.push(`accepts=${body.accepts.length}`);
				return `${text.slice(0, brace).trimEnd()} {${fields.join(', ')}}`.slice(0, max);
			}
		} catch {
			// Not a JSON body after all; fall through to the plain cut.
		}
	}
	return text.slice(0, max);
}

function isAuthError(err) {
	return err?.name === 'UnauthorizedError' || errorStatus(err) === 401 || /unauthori[sz]ed/i.test(String(err?.message));
}

async function runSdk(url, { headers = {}, transport: kind, timeout }) {
	const client = new Client(CLIENT_INFO, { capabilities: {} });
	const warnings = [];
	let closing = false;
	// Closing aborts the open GET stream; that abort is the probe's own doing.
	client.onerror = (e) => {
		if (!closing) warnings.push(summarizeError(e?.message || e));
	};
	const requestInit = { headers };
	const transport =
		kind === 'sse'
			? new SSEClientTransport(new URL(url), {
					requestInit,
					eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers || {}), ...headers } }) },
				})
			: new StreamableHTTPClientTransport(new URL(url), { requestInit });
	const out = { transport: kind, ok: false };
	const opts = { timeout };
	try {
		await client.connect(transport, opts);
		out.serverInfo = client.getServerVersion() ?? null;
		out.protocolVersion = transport.protocolVersion ?? null;
		out.sessionId = transport.sessionId ?? null;
		const caps = client.getServerCapabilities() || {};
		out.capabilities = Object.keys(caps);
		const tools = await client.listTools(undefined, opts);
		out.tools = tools.tools.length;
		out.toolNames = tools.tools.map((t) => t.name);
		out.prompts = caps.prompts ? (await client.listPrompts(undefined, opts)).prompts.length : null;
		const free = FREE_CALLS.find((c) => out.toolNames.includes(c.name));
		if (free) {
			const started = Date.now();
			const r = await client.callTool(free, undefined, opts);
			out.call = {
				name: free.name,
				ok: !r.isError,
				ms: Date.now() - started,
				contentItems: Array.isArray(r.content) ? r.content.length : 0,
				structured: r.structuredContent !== undefined,
			};
		}
		out.ok = !out.call || out.call.ok;
	} catch (err) {
		out.error = summarizeError(err?.message || err);
		out.status = errorStatus(err);
		out.authRequired = isAuthError(err);
	} finally {
		closing = true;
		if (out.sessionId && kind !== 'sse') await transport.terminateSession().catch((e) => warnings.push(`terminate: ${e.message}`));
		await client.close().catch(() => {});
	}
	delete out.toolNames;
	if (warnings.length) out.warnings = [...new Set(warnings)].slice(0, 5);
	return out;
}

// Streamable HTTP first; the legacy SSE transport only when Streamable HTTP
// failed for a reason other than auth (an auth failure is an answer, not a
// transport problem).
async function runMode(url, { headers, timeout }) {
	const primary = await runSdk(url, { headers, transport: 'streamable-http', timeout });
	if (primary.ok || primary.authRequired) return primary;
	const fallback = await runSdk(url, { headers, transport: 'sse', timeout });
	return { ...primary, fallback };
}

export function judgeServer(r) {
	const failures = [];
	const { expects, modes, http } = r;
	if (http.getStreamProblem) failures.push(http.getStreamProblem);
	if (expects.anonymous) {
		const a = modes.anonymous;
		if (!a.ok && !a.fallback?.ok) failures.push(`anonymous connect failed: ${a.error || a.call?.name + ' call errored'}`);
		else if (!(a.tools > 0 || a.fallback?.tools > 0)) failures.push('anonymous tools/list returned no tools');
		if (http.initialize && !/application\/json|text\/event-stream/.test(http.initialize.contentType)) {
			failures.push(`initialize answered content-type ${http.initialize.contentType}`);
		}
		if (r.signIn) {
			if (modes.oauth?.error) failures.push(modes.oauth.error);
			for (const f of modes.oauth?.failures || []) failures.push(`sign-in URL: ${f}`);
			const k = modes.apiKey;
			if (k?.ok && a.ok && !(k.tools > a.tools)) {
				failures.push(`signing in with an API key listed ${k.tools} tools, no more than the ${a.tools} an anonymous client sees`);
			}
		}
	} else {
		if (modes.anonymous.ok) failures.push('anonymous MCP client was served on a server that requires auth');
		for (const f of modes.oauth?.failures || []) failures.push(f);
	}
	if (modes.apiKey && !modes.apiKey.skipped && (expects.apiKey || expects.oauth)) {
		const k = modes.apiKey;
		if (!k.ok) failures.push(`api key connect failed: ${k.error || k.call?.name + ' call errored'}`);
		else if (!(k.tools > 0)) failures.push('api key tools/list returned no tools');
	}
	for (const n of http.negotiation || []) {
		if (n.negotiated && !n.clientSupportsAnswer) failures.push(`requested ${n.requested}, server answered ${n.negotiated} which no SDK client supports`);
	}
	return failures;
}

async function probeServer(server, { base, timeout, apiKey }) {
	const url = serverUrlFor(server.endpoint, base);
	const expects = authExpectations(server.auth);
	const r = { name: server.name, endpoint: server.endpoint, url, auth: server.auth, expects, http: {}, modes: {} };
	if (expects.anonymous && expects.oauth && server.signIn) r.signIn = serverUrlFor(server.signIn, base);
	const guard = async (label, fn) => {
		try {
			return await fn();
		} catch (err) {
			return { error: `${label}: ${String(err?.message || err).slice(0, 300)}` };
		}
	};

	r.http.initialize = await guard('initialize', () => rawInitialize(url, { timeout }));
	// One retry on a timeout: a cold instance can hold the first GET past the
	// budget, and a connector retries that too.
	r.http.getStream = await guard('get', () => probeGetStream(url, { timeout: Math.min(timeout, 15_000) }));
	if (r.http.getStream.error) {
		r.http.getStream = await guard('get', () => probeGetStream(url, { timeout: Math.min(timeout, 15_000) }));
		r.http.getStream.retried = true;
	}
	r.http.getStreamProblem = r.http.getStream.error || judgeGetStream(r.http.getStream);

	r.modes.anonymous = await runMode(url, { headers: {}, timeout });
	if (!expects.anonymous) r.modes.oauth = await guard('oauth', () => probeChallenge(url, { timeout }));
	else if (r.signIn) r.modes.oauth = await guard('oauth', () => probeChallenge(r.signIn, { timeout }));
	if (!apiKey) r.modes.apiKey = { skipped: 'THREE_WS_API_KEY is not set' };
	else r.modes.apiKey = await runMode(url, { headers: { authorization: `Bearer ${apiKey}` }, timeout });

	// Negotiation and session checks run on whichever mode actually connects.
	const authed = expects.anonymous ? {} : apiKey && r.modes.apiKey.ok ? { authorization: `Bearer ${apiKey}` } : null;
	const working = expects.anonymous ? r.modes.anonymous : r.modes.apiKey;
	if (authed) {
		r.http.negotiation = await guard('negotiation', () => probeNegotiation(url, { headers: authed, timeout }));
		if (working?.sessionId) {
			r.http.session = await guard('session', () =>
				probeSession(url, working.sessionId, { headers: authed, negotiated: working.protocolVersion, timeout }),
			);
		}
		r.http.sessionIssued = Boolean(working?.sessionId);
	}
	if (Array.isArray(r.http.negotiation) === false && r.http.negotiation?.error) r.http.negotiation = [{ error: r.http.negotiation.error }];

	r.failures = judgeServer(r);
	r.pass = r.failures.length === 0;
	return r;
}

function summaryLine(r) {
	const a = r.modes.anonymous;
	const k = r.modes.apiKey;
	const bits = [
		r.pass ? 'PASS' : 'FAIL',
		r.url,
		`init ${r.http.initialize?.status ?? 'err'}`,
		`GET ${r.http.getStream?.status ?? 'err'}`,
		`anon ${a.ok ? `ok tools=${a.tools} prompts=${a.prompts ?? '-'}` : a.authRequired ? '401' : 'fail'}`,
		`key ${k.skipped ? 'skipped' : k.ok ? `ok tools=${k.tools} prompts=${k.prompts ?? '-'}` : 'fail'}`,
	];
	if (r.modes.oauth) bits.push(`oauth ${r.modes.oauth.failures?.length ? 'bad' : r.modes.oauth.error ? 'err' : 'ok'}`);
	const call = (a.ok && a.call) || (k.ok && k.call);
	if (call) bits.push(`call ${call.name}=${call.ok ? 'ok' : 'error'} ${call.ms}ms`);
	return bits.join(' | ');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public/.well-known/mcp.json'), 'utf8'));
	const servers = manifest.servers.filter((s) => !args.only || s.endpoint.includes(args.only) || s.name.includes(args.only));
	if (!servers.length) throw new Error(`no server in public/.well-known/mcp.json matches --only ${args.only}`);
	const apiKey = loadApiKey();
	const startedAt = new Date().toISOString();
	const results = [];
	for (const s of servers) {
		const r = await probeServer(s, { base: args.base, timeout: args.timeout, apiKey });
		results.push(r);
		console.log(summaryLine(r));
		for (const f of r.failures) console.log(`    - ${f}`);
	}
	const report = {
		probe: 'scripts/mcp-client-probe.mjs',
		base: args.base,
		startedAt,
		finishedAt: new Date().toISOString(),
		sdkVersion: JSON.parse(readFileSync(resolve(ROOT, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')).version,
		clientProtocolVersion: LATEST_PROTOCOL_VERSION,
		apiKeyMode: apiKey ? 'ran' : 'skipped (THREE_WS_API_KEY not set)',
		pass: results.every((r) => r.pass),
		servers: results,
	};
	if (args.json) {
		const out = resolve(process.cwd(), args.json);
		mkdirSync(dirname(out), { recursive: true });
		// Server error bodies are quoted verbatim; the repo bans em and en dashes in committed text.
		writeFileSync(out, `${JSON.stringify(report, null, '\t').replace(/[\u2013\u2014]/g, '-')}\n`);
		console.log(`wrote ${args.json}`);
	}
	const failed = results.filter((r) => !r.pass).length;
	console.log(failed ? `${failed} of ${results.length} servers failed` : `all ${results.length} servers passed`);
	process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err?.stack || err);
		process.exit(2);
	});
}
