// Shared HTTP handler for the free three.ws 3D Studio MCP surfaces.
//
//   POST     JSON-RPC (initialize, tools/list, tools/call, resources/*)
//   GET      not offered (no server-initiated stream), answers 405
//   OPTIONS  CORS preflight
//
// Parameterized by the tool surface it serves (SURFACES in ./dispatch.js):
//   api/mcp-studio.js   surface 'full'     every tool, both widgets
//   api/mcp-chatgpt.js  surface 'chatgpt'  generation tools, model viewer only
//   api/mcp-grok.js     surface 'grok'     every tool, for Grok Bot and the xAI API
// Every front door shares one transport cap, one per-IP generation quota and one
// platform-wide circuit breaker, so a second door never doubles the free GPU
// budget.
//
// There is no OAuth and no payment path anywhere in this server: generation runs
// operator-funded over /api/forge, whose server-side keys cover provider cost.
// Abuse protection is real: a per-IP transport cap plus a per-IP generation burst
// and hourly quota (../_lib/rate-limit.js), enforced whenever Redis is healthy.
// Because every studio tool routes through a zero-cost free lane, these
// generation caps fail OPEN on a Redis outage, so a Redis blip never dead-ends a
// free feature; real paid spend stays fail-closed one layer down in /api/forge.

import { randomUUID } from 'node:crypto';
import { cors, wrap, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { dispatch, PROTOCOL_VERSION } from './dispatch.js';
import { TOOL_NAMES } from './tools.js';

// check_job collects a job that is already running rather than starting one: it
// must never burn the caller's generation quota, or collecting a pending job
// could be rate-blocked by the very generation that created it. It rides the
// transport cap only.
const GEN_TOOLS = new Set(TOOL_NAMES.filter((name) => name !== 'check_job'));

/** Does calling this tool start a generation that counts against the quota? */
export function isGenerationTool(name) {
	return GEN_TOOLS.has(name);
}

function rpcError(res, status, code, message, extra = {}) {
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message, ...(Object.keys(extra).length ? { data: extra } : {}) } }));
}

// Does the (possibly batched) body invoke any generation tool? Used to apply the
// cost-bearing generation quota only to calls that actually generate.
function callsGenerationTool(body) {
	const batch = Array.isArray(body) ? body : [body];
	return batch.some((m) => m && m.method === 'tools/call' && isGenerationTool(m?.params?.name));
}

// ChatGPT sends an anonymized, per-user `openai/subject` on every tool call and
// documents it for rate limiting. All ChatGPT traffic shares OpenAI's egress
// IPs, so on that surface the per-caller caps key on it. Bounded to a sane
// token shape; anything else falls back to the IP.
const SUBJECT_RE = /^[A-Za-z0-9_.:/+=-]{8,256}$/;
export function chatgptSubject(body) {
	const batch = Array.isArray(body) ? body : [body];
	for (const m of batch) {
		const sub = m?.params?._meta?.['openai/subject'];
		if (typeof sub === 'string' && SUBJECT_RE.test(sub)) return sub;
	}
	return null;
}

// Grok Bot and the xAI Responses API also reach us from one shared egress pool,
// and send no per-user id of their own. MCP Streamable HTTP has one: a server
// may assign an Mcp-Session-Id on initialize, and a conforming client echoes it
// on every later request of that connection. The grok surface issues one and
// keys the per-caller caps on it. Minting is free, so a forged or rotated id
// buys nothing past the per-IP pool cap that bounds the ChatGPT subject too.
const SESSION_RE = /^grk_[0-9a-f-]{36}$/;
export function grokSession(req) {
	const sid = req?.headers?.['mcp-session-id'];
	return typeof sid === 'string' && SESSION_RE.test(sid) ? sid : null;
}

function initializes(body) {
	const batch = Array.isArray(body) ? body : [body];
	return batch.some((m) => m && m.method === 'initialize');
}

/** The per-user identity a shared-egress surface carries, or null for per-IP keying. */
export function callerSubject(surface, body, req) {
	if (surface === 'chatgpt') {
		const sub = chatgptSubject(body);
		return sub ? `oai:${sub}` : null;
	}
	if (surface === 'grok') return grokSession(req);
	return null;
}

export function studioHandler({ surface = 'full' } = {}) {
	return wrap(async (req, res) => {
		if (cors(req, res, { methods: 'GET,HEAD,POST,OPTIONS', origins: '*', payments: false })) return;

		// No server-initiated SSE stream, this server answers requests synchronously.
		if (req.method === 'GET' || req.method === 'HEAD') {
			res.statusCode = 405;
			res.setHeader('allow', 'POST, OPTIONS');
			res.setHeader('content-type', 'application/json; charset=utf-8');
			res.end(JSON.stringify({ error: 'method_not_allowed', error_description: 'POST JSON-RPC to this MCP endpoint' }));
			return;
		}
		if (req.method !== 'POST') return rpcError(res, 405, -32600, 'method not supported');

		const ip = clientIp(req);

		// Cheap transport cap on every request (discovery + calls).
		const ipRl = await limits.studioIp(ip);
		if (!ipRl.success) return rateLimited(res, ipRl, 'too many requests');

		let body;
		try {
			body = await readJson(req, 1_000_000);
		} catch (err) {
			return rpcError(res, err.status || 400, -32700, err.message || 'invalid JSON');
		}

		const batch = Array.isArray(body) ? body : [body];
		if (batch.length > 16) return rpcError(res, 400, -32600, 'batch too large (max 16)');

		// Generation quota, burst then hourly, per IP. Applied only when the request
		// actually calls a generation tool, so discovery is never throttled by it.
		if (callsGenerationTool(body)) {
			const subject = callerSubject(surface, body, req);
			if (subject) {
				const pool = await limits.studioGenPoolHourly(ip);
				if (!pool.success) return rateLimited(res, pool, 'the free 3D studio is at capacity right now, please try again later');
			}
			const caller = subject || ip;
			const burst = await limits.studioGenBurst(caller);
			if (!burst.success) return rateLimited(res, burst, 'generation rate limit, slow down and try again shortly');
			const hourly = await limits.studioGenHourly(caller);
			if (!hourly.success) return rateLimited(res, hourly, 'hourly generation limit reached, try again later');
			// Platform-wide circuit breaker across ALL free-studio callers, backstops
			// the shared GPU/provider budget when many distinct IPs, each under their
			// own hourly cap, would collectively drain it. Fails closed in prod.
			const global = await limits.studioGenerateGlobal();
			if (!global.success) return rateLimited(res, global, 'the free 3D studio is at capacity right now, please try again later');
		}

		// Anonymous principal, no auth, no scope. rateKey carries the IP for usage logs.
		const auth = { userId: null, rateKey: ip, scope: '' };

		const responses = [];
		for (const msg of batch) {
			const r = await dispatch(msg, auth, req, { surface });
			if (r !== null) responses.push(r);
		}

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json; charset=utf-8');
		res.setHeader('mcp-protocol-version', PROTOCOL_VERSION);
		if (surface === 'grok' && initializes(body)) {
			res.setHeader('mcp-session-id', `grk_${randomUUID()}`);
			// A browser MCP client cannot echo a header it is not allowed to read.
			const exposed = res.getHeader('access-control-expose-headers');
			res.setHeader('access-control-expose-headers', exposed ? `${exposed}, mcp-session-id` : 'mcp-session-id');
		}
		res.end(JSON.stringify(Array.isArray(body) ? responses : (responses[0] ?? null)));
	});
}
