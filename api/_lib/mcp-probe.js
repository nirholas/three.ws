// @ts-check
// Synthetic probe for the hosted MCP connectors that Grok and Cursor connect to.
//
// One probe drives a server the way a cloud connector does over Streamable HTTP
// (JSON-RPC 2.0 over POST): `initialize`, the `notifications/initialized` that
// every SDK client sends next, `tools/list`, then one cheap read-only tool call.
// The Mcp-Session-Id the server issues on initialize is echoed on every later
// request, with the negotiated MCP-Protocol-Version, exactly as the official
// TypeScript and Python SDK transports do. When the server publishes an OAuth
// sign-in URL (the manifest's `signIn`), the probe also checks the discovery
// path a connector takes on first sign-in: an unauthenticated initialize must
// answer 401 with a WWW-Authenticate challenge naming the protected-resource
// metadata, and that document must resolve with its authorization servers.
//
// Every step is timed and bounded. The result says which step failed, how long
// each step took, and why, in one structured record the cron stores in
// mcp_probe_results and the operator CLI prints as a table.
//
// Consumers:
//   api/cron/mcp-probe.js        every five minutes, from inside production
//   scripts/grok-mcp-probe.mjs   once, from an operator machine
//   scripts/mcp-client-probe.mjs the parsers below (one implementation)
//
// No tool that writes, generates, spends or reaches an account is ever called,
// and no credential is ever sent.

import { readFile } from 'node:fs/promises';

export const PROBE_PROTOCOL_VERSION = '2025-06-18';
export const STEP_TIMEOUT_MS = 10_000;
export const PROBE_CLIENT_INFO = Object.freeze({ name: 'three-ws-mcp-probe', version: '1.0.0' });
const USER_AGENT = 'three.ws-mcp-probe/1.0 (+https://three.ws/status)';

// Step names, in the order a connector performs them. The first four are the
// MCP methods themselves; the oauth steps run only for a server with a signIn URL.
export const STEPS = Object.freeze([
	'initialize',
	'notifications/initialized',
	'tools/list',
	'tools/call',
	'oauth_challenge',
	'oauth_metadata',
]);

// The read the probe makes per server, chosen from each server's tools/list.
// /api/mcp-grok: search_docs is the cheapest tool it lists (readOnlyHint and
// openWorldHint:false; an in-process index read with no object-storage or
// database round trip). /api/mcp-studio: the catalog search the marketplace
// reviewers try first. A server not named here gets the first of SAFE_CALLS
// that it lists.
export const PREFERRED_CALLS = Object.freeze({
	'/api/mcp-grok': { name: 'search_docs', arguments: { query: 'connect Grok to three.ws', limit: 1 } },
	'/api/mcp-studio': { name: 'search_catalog', arguments: { q: 'chair', limit: 1 } },
});
const SAFE_CALLS = Object.freeze([
	{ name: 'search_docs', arguments: { query: 'getting started', limit: 1 } },
	{ name: 'search_catalog', arguments: { q: 'chair', limit: 1 } },
	{ name: 'getting_started', arguments: {} },
]);

const MANIFEST_FILE = new URL('../../public/.well-known/mcp.json', import.meta.url);

// ---------------------------------------------------------------------------
// Parsers, which scripts/mcp-client-probe.mjs reuses.
// ---------------------------------------------------------------------------

/**
 * A Streamable HTTP response body is either one JSON object or an SSE stream
 * whose `data:` lines carry the JSON-RPC messages. Returns the first message
 * that carries a result or an error, or null.
 * @param {string} text
 * @param {string|null|undefined} contentType
 */
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

/**
 * RFC 9110 auth-param parsing, enough for `Bearer k="v", k2="v2"`.
 * @param {string|null|undefined} header
 * @returns {{ scheme: string, params: Record<string, string> } | null}
 */
export function parseWwwAuthenticate(header) {
	if (!header) return null;
	const m = /^\s*(\S+)\s*(.*)$/.exec(header);
	if (!m) return null;
	/** @type {Record<string, string>} */
	const params = {};
	const re = /([a-zA-Z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
	let p;
	while ((p = re.exec(m[2]))) params[p[1].toLowerCase()] = p[2] !== undefined ? p[2].replace(/\\(.)/g, '$1') : p[3];
	return { scheme: m[1], params };
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/**
 * Read the MCP directory. From an origin it is fetched (what clients see);
 * with none, the copy deployed beside this module is read.
 * @param {{ base?: string|null, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 */
export async function loadManifest({ base = null, fetchImpl = fetch, timeoutMs = STEP_TIMEOUT_MS } = {}) {
	if (base) {
		const res = await fetchImpl(`${base.replace(/\/+$/, '')}/.well-known/mcp.json`, {
			headers: { accept: 'application/json', 'user-agent': USER_AGENT },
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!res.ok) throw new Error(`/.well-known/mcp.json answered HTTP ${res.status}`);
		return res.json();
	}
	return JSON.parse(await readFile(MANIFEST_FILE, 'utf8'));
}

/**
 * Move a published endpoint onto another origin (the dev server, a staging host).
 * @param {string} endpoint
 * @param {string|null|undefined} base
 */
export function onOrigin(endpoint, base) {
	if (!base) return endpoint;
	const u = new URL(endpoint);
	return new URL(u.pathname + u.search, `${base.replace(/\/+$/, '')}/`).href;
}

/**
 * The Grok-facing servers in the MCP directory: the server the Grok Bot client
 * entry recommends, plus every server that connects with no credential and
 * upgrades through a published OAuth sign-in URL (`signIn`), which is the shape
 * a Grok or Cursor connector needs. A server added to the manifest in that shape
 * is probed with no code change.
 * @param {any} manifest
 * @param {{ base?: string|null }} [opts]
 * @returns {Array<{ server: string, path: string, name: string, signIn: string|null }>}
 */
export function grokFacingTargets(manifest, { base = null } = {}) {
	const servers = Array.isArray(manifest?.servers) ? manifest.servers : [];
	const grokBot = manifest?.clients?.['grok-bot'];
	const wanted = new Map();
	for (const s of servers) {
		if (typeof s?.endpoint !== 'string') continue;
		const recommended = grokBot?.recommendedServer === s.endpoint;
		if (!recommended && typeof s.signIn !== 'string') continue;
		const signIn = typeof s.signIn === 'string' ? s.signIn : recommended && grokBot?.authUpgrade?.url ? grokBot.authUpgrade.url : null;
		wanted.set(s.endpoint, {
			server: onOrigin(s.endpoint, base),
			path: new URL(s.endpoint).pathname,
			name: String(s.name || new URL(s.endpoint).pathname),
			signIn: signIn ? onOrigin(signIn, base) : null,
		});
	}
	return [...wanted.values()];
}

/**
 * Which side-effect-free tool to call on a server, given what it lists.
 * @param {string} path
 * @param {Array<{ name: string }>} tools
 */
export function chooseProbeCall(path, tools) {
	const listed = new Set(tools.map((t) => t?.name));
	const candidates = [PREFERRED_CALLS[path], ...SAFE_CALLS].filter(Boolean);
	return candidates.find((c) => listed.has(c.name)) || null;
}

// xAI's Responses API answers HTTP 400 invalid_client_tool_schema for the whole
// request when one tool's input schema root is not a plain object: "tool
// parameter root must be an object type (root schema is an anyOf/oneOf union
// with a non-object branch)". The handshake still passes, so check it here.
const ROOT_COMBINATORS = ['anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else', 'enum', 'const'];
export function clientAcceptsRootSchema(schema) {
	if (!schema || typeof schema !== 'object' || schema.type !== 'object') return false;
	return !ROOT_COMBINATORS.some((k) => Object.hasOwn(schema, k));
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

class StepError extends Error {}

function describeError(err, timeoutMs) {
	if (err instanceof StepError) return err.message;
	if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `timed out after ${timeoutMs}ms`;
	const cause = err?.cause?.code || err?.cause?.message;
	return String(err?.message || err) + (cause ? ` (${cause})` : '');
}

function clip(s, max = 300) {
	const t = String(s ?? '').replace(/\s+/g, ' ').trim();
	return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

/**
 * Probe one server.
 * @param {{ server: string, path?: string, signIn?: string|null }} target
 * @param {{ fetchImpl?: typeof fetch, stepTimeoutMs?: number, now?: () => number }} [opts]
 * @returns {Promise<{
 *   server: string, ok: boolean, failedStep: string|null, error: string|null,
 *   latencyMs: Record<string, number>, checkedAt: string,
 *   detail: { protocolVersion: string|null, sessionIssued: boolean, toolCount: number|null, tool: string|null, warnings: string[] },
 * }>}
 */
export async function probeServer(target, { fetchImpl = fetch, stepTimeoutMs = STEP_TIMEOUT_MS, now = () => performance.now() } = {}) {
	const path = target.path || new URL(target.server).pathname;
	const checkedAt = new Date().toISOString();
	/** @type {Record<string, number>} */
	const latencyMs = {};
	const detail = { protocolVersion: /** @type {string|null} */ (null), sessionIssued: false, toolCount: /** @type {number|null} */ (null), tool: /** @type {string|null} */ (null), warnings: /** @type {string[]} */ ([]) };
	/** @type {{ step: string, error: string } | null} */
	let failure = null;

	async function step(name, fn) {
		const t0 = now();
		try {
			return await fn();
		} catch (err) {
			if (!failure) failure = { step: name, error: clip(describeError(err, stepTimeoutMs)) };
			throw err;
		} finally {
			latencyMs[name] = Math.round(now() - t0);
		}
	}

	const baseHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': USER_AGENT };
	/** @type {Record<string, string>} */
	let sessionHeaders = {};
	let nextId = 1;

	async function rpc(url, method, params, { notification = false, fresh = false } = {}) {
		const body = notification ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) };
		const res = await fetchImpl(url, {
			method: 'POST',
			headers: fresh ? baseHeaders : { ...baseHeaders, ...sessionHeaders },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(stepTimeoutMs),
		});
		const contentType = res.headers.get('content-type') || '';
		const text = await res.text();
		return { res, text, contentType, msg: notification ? null : parseRpcBody(text, contentType) };
	}

	function expectResult(method, { res, text, msg }) {
		if (res.status !== 200) throw new StepError(`${method} answered HTTP ${res.status}: ${clip(text, 160)}`);
		if (!msg) throw new StepError(`${method} answered a body that is not JSON-RPC: ${clip(text, 160)}`);
		if (msg.error) throw new StepError(`${method} returned JSON-RPC error ${msg.error.code}: ${clip(msg.error.message, 160)}`);
		if (!msg.result) throw new StepError(`${method} returned no result`);
		return msg.result;
	}

	try {
		await step('initialize', async () => {
			const r = await rpc(target.server, 'initialize', {
				protocolVersion: PROBE_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: PROBE_CLIENT_INFO,
			});
			const result = expectResult('initialize', r);
			if (typeof result.protocolVersion !== 'string') throw new StepError('initialize result has no protocolVersion');
			if (!result.capabilities?.tools) throw new StepError('initialize result does not declare the tools capability');
			detail.protocolVersion = result.protocolVersion;
			const sid = r.res.headers.get('mcp-session-id');
			detail.sessionIssued = Boolean(sid);
			sessionHeaders = { 'mcp-protocol-version': result.protocolVersion, ...(sid ? { 'mcp-session-id': sid } : {}) };
		});

		await step('notifications/initialized', async () => {
			const r = await rpc(target.server, 'notifications/initialized', null, { notification: true });
			if (r.res.status < 200 || r.res.status >= 300) throw new StepError(`notifications/initialized answered HTTP ${r.res.status}: ${clip(r.text, 160)}`);
			// Spec 2025-06-18 (Streamable HTTP): an accepted notification MUST get
			// 202 with no body. The SDK clients Grok and Cursor run tolerate a 2xx
			// with a body, so this is a conformance warning, not an outage.
			if (r.res.status !== 202 || r.text.length > 0) {
				detail.warnings.push(`notifications/initialized answered HTTP ${r.res.status}${r.text ? ` with body ${clip(r.text, 40)}` : ''}; the spec requires 202 with no body`);
			}
		});

		const tools = await step('tools/list', async () => {
			const result = expectResult('tools/list', await rpc(target.server, 'tools/list', {}));
			if (!Array.isArray(result.tools) || result.tools.length === 0) throw new StepError('tools/list returned no tools');
			detail.toolCount = result.tools.length;
			const rejected = result.tools.filter((t) => !clientAcceptsRootSchema(t?.inputSchema)).map((t) => t?.name);
			if (rejected.length) throw new StepError(`xAI refuses every tool on this server while one has a non-object or union root schema: ${rejected.join(', ')}`);
			return result.tools;
		});

		await step('tools/call', async () => {
			const call = chooseProbeCall(path, tools);
			if (!call) throw new StepError('the server lists no side-effect-free tool the probe may call');
			detail.tool = call.name;
			const result = expectResult('tools/call', await rpc(target.server, 'tools/call', call));
			if (result.isError) throw new StepError(`${call.name} returned isError: ${clip(result.content?.[0]?.text, 160)}`);
			if (!Array.isArray(result.content) || result.content.length === 0) throw new StepError(`${call.name} returned no content`);
		});
	} catch {
		// Recorded by step(); the session flow stops at its first failure.
	}

	if (target.signIn) {
		try {
			const metadataUrl = await step('oauth_challenge', async () => {
				const r = await rpc(target.signIn, 'initialize', { protocolVersion: PROBE_PROTOCOL_VERSION, capabilities: {}, clientInfo: PROBE_CLIENT_INFO }, { fresh: true });
				if (r.res.status !== 401) throw new StepError(`unauthenticated initialize on the sign-in URL answered HTTP ${r.res.status}, expected 401`);
				const challenge = parseWwwAuthenticate(r.res.headers.get('www-authenticate'));
				if (!challenge || challenge.scheme.toLowerCase() !== 'bearer') throw new StepError('401 carried no Bearer WWW-Authenticate challenge');
				if (!challenge.params.resource_metadata) throw new StepError('WWW-Authenticate challenge names no resource_metadata');
				return challenge.params.resource_metadata;
			});
			await step('oauth_metadata', async () => {
				const res = await fetchImpl(metadataUrl, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(stepTimeoutMs) });
				const text = await res.text();
				if (res.status !== 200) throw new StepError(`protected-resource metadata answered HTTP ${res.status}`);
				let doc;
				try {
					doc = JSON.parse(text);
				} catch {
					throw new StepError('protected-resource metadata is not JSON');
				}
				if (typeof doc.resource !== 'string') throw new StepError('protected-resource metadata has no resource');
				if (!Array.isArray(doc.authorization_servers) || doc.authorization_servers.length === 0) throw new StepError('protected-resource metadata names no authorization_servers');
			});
		} catch {
			// Recorded by step().
		}
	}

	return {
		server: target.server,
		ok: failure === null,
		failedStep: failure?.step ?? null,
		error: failure?.error ?? null,
		latencyMs,
		checkedAt,
		detail,
	};
}

/**
 * Probe every target concurrently.
 * @param {Array<{ server: string, path?: string, signIn?: string|null }>} targets
 * @param {Parameters<typeof probeServer>[1]} [opts]
 */
export function probeAll(targets, opts) {
	return Promise.all(targets.map((t) => probeServer(t, opts)));
}

/**
 * Initialize-to-tools/list latency: the time a connector waits from opening a
 * session to seeing the tool list (initialize + initialized + tools/list).
 * @param {Record<string, number>} latencyMs
 * @returns {number|null}
 */
export function handshakeMs(latencyMs) {
	const parts = ['initialize', 'notifications/initialized', 'tools/list'].map((k) => latencyMs?.[k]);
	return parts.every((n) => Number.isFinite(n)) ? parts.reduce((a, b) => a + b, 0) : null;
}
