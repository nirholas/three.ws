// Shared HTTP handler for the free three.ws 3D Studio MCP surfaces.
//
//   POST     JSON-RPC (initialize, tools/list, tools/call, resources/*). A single
//            tools/call that carries `_meta.progressToken`, from a client that
//            accepts text/event-stream, is answered as an SSE stream: progress
//            notifications while the job runs, then the result.
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
// Abuse protection is real: a per-caller transport cap plus a per-caller
// generation burst and hourly quota (../_lib/rate-limit.js), enforced whenever
// Redis is healthy. The caller is, in order: a verified install token on the
// connector URL (./install-token.js), the per-user subject a shared-egress
// surface carries, else the IP. A capped generation answers a JSON-RPC error
// that names the limit, when it resets and the connector URL that lifts it.
// Because every studio tool routes through a zero-cost free lane, these
// generation caps fail OPEN on a Redis outage, so a Redis blip never dead-ends a
// free feature; real paid spend stays fail-closed one layer down in /api/forge.

import { randomUUID } from 'node:crypto';
import { cors, wrap, readJson, rateLimited, setRateLimitHeaders } from '../_lib/http.js';
import { limits, clientIp, STUDIO_LIMITS } from '../_lib/rate-limit.js';
import { dispatch, PROTOCOL_VERSION } from './dispatch.js';
import { TOOL_NAMES } from './tools.js';
import { isIdempotentRepeat, progressReporter } from './jobs.js';
import { installTokenFrom, studioOrigin, INSTALL_PARAM } from './install-token.js';

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

// The progress token a single tools/call asked to be updated on, or null. A
// batch is answered as one JSON array, so it never streams.
export function progressTokenOf(body) {
	if (!body || Array.isArray(body) || body.method !== 'tools/call') return null;
	const token = body.params?._meta?.progressToken;
	return (typeof token === 'string' && token.length > 0 && token.length <= 256) || Number.isInteger(token) ? token : null;
}

function acceptsEventStream(req) {
	return /\btext\/event-stream\b/i.test(String(req?.headers?.accept || ''));
}

// An idle proxy can close a quiet stream between status frames (a submit can run
// 40 s before the first one), so a comment line goes out this often.
const SSE_KEEPALIVE_MS = 15_000;

// Answer one tools/call as a Streamable HTTP SSE response: each status frame of
// the job becomes a notifications/progress message (./jobs.js
// progressReporter), and the JSON-RPC result is the last event.
async function streamToolCall(res, msg, auth, req, { surface, caller, token }) {
	res.statusCode = 200;
	res.setHeader('content-type', 'text/event-stream; charset=utf-8');
	res.setHeader('cache-control', 'no-cache, no-transform');
	res.setHeader('x-accel-buffering', 'no');
	res.setHeader('mcp-protocol-version', PROTOCOL_VERSION);
	res.flushHeaders?.();
	const send = (message) => {
		if (!res.writableEnded) res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
	};
	const keepAlive = setInterval(() => {
		if (!res.writableEnded) res.write(': keep-alive\n\n');
	}, SSE_KEEPALIVE_MS);
	keepAlive.unref?.();
	try {
		const report = progressReporter(token, send);
		report({ status: 'queued', stage: 'submit' }, 'request');
		const response = await dispatch(msg, auth, req, { surface, caller, onProgress: report });
		if (response !== null) send(response);
	} finally {
		clearInterval(keepAlive);
		res.end();
	}
}

// Does the (possibly batched) body invoke any generation tool? Used to apply the
// cost-bearing generation quota only to calls that actually generate.
function callsGenerationTool(body) {
	const batch = Array.isArray(body) ? body : [body];
	return batch.some((m) => m && m.method === 'tools/call' && isGenerationTool(m?.params?.name));
}

// Is every generation call in the body a repeat of an idempotency_key its
// caller already used? Those return the first call's job and start nothing, so
// a scheduled agent's retry never spends its generation quota.
async function onlyRepeats(body, caller) {
	const batch = Array.isArray(body) ? body : [body];
	const calls = batch.filter((m) => m && m.method === 'tools/call' && isGenerationTool(m?.params?.name));
	const repeats = await Promise.all(calls.map((m) => isIdempotentRepeat(m, caller)));
	return repeats.every(Boolean);
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

/**
 * Who the per-caller caps charge, on every surface: a verified install token
 * first, then the surface's own subject, then the IP. An unknown or forged token
 * is ignored, so the request keys exactly as it would with no token at all.
 * @returns {{ key: string, kind: 'install'|'session'|'chatgpt_user'|'ip' }}
 */
export function studioCaller(surface, body, req, ip, install = installTokenFrom(req)) {
	if (install) return { key: `inst:${install.id}`, kind: 'install' };
	const subject = callerSubject(surface, body, req);
	if (subject) return { key: subject, kind: surface === 'chatgpt' ? 'chatgpt_user' : 'session' };
	return { key: ip, kind: 'ip' };
}

// JSON-RPC implementation-defined server error, the code the authenticated MCP
// server uses for rate_limited too (api/_mcp/tools/agents.js).
export const STUDIO_RATE_LIMITED = -32000;

const CALLER_SCOPE = {
	install: 'this install token',
	session: 'this MCP session',
	chatgpt_user: 'this ChatGPT user',
	ip: 'your IP address',
};

const WINDOW_WORDS = { '1 m': 'minute', '1 h': 'hour' };

// Each generation bucket a denial can name: the numbers come from the limiter's
// own table, so the message can never drift from what is enforced.
const GEN_BUCKETS = {
	pool: { id: 'generation_ip_pool', spec: STUDIO_LIMITS.genPoolHourly, scope: () => 'one source IP, across every caller on it' },
	burst: { id: 'generation_burst', spec: STUDIO_LIMITS.genBurst, scope: (kind) => CALLER_SCOPE[kind] },
	hourly: { id: 'generation_hourly', spec: STUDIO_LIMITS.genHourly, scope: (kind) => CALLER_SCOPE[kind] },
	global: { id: 'generation_global', spec: STUDIO_LIMITS.genGlobal, scope: () => 'the whole free studio, every caller combined' },
};

function resetAt(result) {
	const reset = Number(result?.reset);
	return Number.isFinite(reset) && reset > Date.now() ? new Date(reset) : new Date(Date.now() + 1000);
}

/**
 * The remedy for a capped caller. A per-IP caller is told to get an install
 * token (one URL of its own); a caller that already has its own budget, or hit a
 * cap no token lifts, is pointed at the signed-in server, whose free lane is
 * metered per account.
 */
export function studioRemedy(kind, bucket, surfacePath) {
	const origin = studioOrigin();
	const installEndpoint = `${origin}/api/mcp-studio/install`;
	const accountServer = `${origin}/api/mcp-3d`;
	if (bucket !== 'global' && bucket !== 'pool' && kind !== 'install') {
		return {
			kind: 'install_token',
			install_endpoint: installEndpoint,
			connector_url: `${origin}${surfacePath}?${INSTALL_PARAM}=<token>`,
			text:
				`Lift it with a free install token: POST ${installEndpoint} (no account, no key) and reconnect at ` +
				`${origin}${surfacePath}?${INSTALL_PARAM}=<token>, which gets its own budget. Or sign in at ${accountServer} ` +
				'(OAuth 2.1), metered per account.',
		};
	}
	return {
		kind: 'account',
		oauth_server: accountServer,
		text: `Wait for the reset, or sign in at ${accountServer} (OAuth 2.1), whose generation is metered per account instead.`,
	};
}

/**
 * The JSON-RPC error for a capped generation: what limit, when it resets, and
 * the connector URL that lifts it. Exported for tests and docs.
 */
export function studioDenial({ bucket, kind, result, surfacePath, now = Date.now() }) {
	const b = GEN_BUCKETS[bucket];
	const at = resetAt(result);
	const retryAfter = Math.max(1, Math.ceil((at.getTime() - now) / 1000));
	const remedy = studioRemedy(kind, bucket, surfacePath);
	const per = WINDOW_WORDS[b.spec.window] || b.spec.window;
	const message =
		`Rate limited: the free 3D studio allows ${b.spec.limit} generations per ${per} for ${b.scope(kind)}, ` +
		`and that limit is used up. It resets at ${at.toISOString()} (in ${retryAfter} s). ${remedy.text}`;
	return {
		code: STUDIO_RATE_LIMITED,
		message,
		data: {
			reason: 'rate_limited',
			limit: b.id,
			max: b.spec.limit,
			window: b.spec.window,
			keyed_on: bucket === 'global' ? 'platform' : bucket === 'pool' ? 'ip' : kind,
			reset_at: at.toISOString(),
			retry_after: retryAfter,
			...(result?.reason ? { limiter: result.reason } : {}),
			remedy: remedyData(remedy),
		},
	};
}

// The machine-readable half of a remedy; its text already rides the message.
function remedyData({ text: _text, ...rest }) {
	return rest;
}

// Every request in the body that expects a response gets the same denial, so a
// client matching responses by id sees its own call refused, never a stray id.
function rpcDenial(res, body, denial, result) {
	setRateLimitHeaders(res, result);
	res.setHeader('retry-after', String(denial.data.retry_after));
	res.statusCode = 200;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('mcp-protocol-version', PROTOCOL_VERSION);
	const one = (m) => ({ jsonrpc: '2.0', id: m?.id ?? null, error: denial });
	if (Array.isArray(body)) {
		res.end(JSON.stringify(body.filter((m) => m && m.id !== undefined).map(one)));
		return;
	}
	res.end(JSON.stringify(one(body)));
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
		const install = installTokenFrom(req);
		const surfacePath = new URL(req.url || '/api/mcp-studio', 'http://localhost').pathname;

		// Cheap transport cap on every request (discovery + calls), per install
		// token when the connector URL carries one, so callers sharing a cloud
		// agent's egress do not share one flood guard either.
		const ipRl = await limits.studioIp(install ? `inst:${install.id}` : ip);
		if (!ipRl.success) {
			const at = resetAt(ipRl);
			const remedy = studioRemedy(install ? 'install' : 'ip', 'transport', surfacePath);
			return rateLimited(
				res,
				ipRl,
				`too many requests: ${STUDIO_LIMITS.transport.limit} per minute for ${install ? 'this install token' : 'your IP address'}, resets at ${at.toISOString()}. ${remedy.text}`,
				{ reset_at: at.toISOString(), remedy: remedyData(remedy) },
			);
		}

		let body;
		try {
			body = await readJson(req, 1_000_000);
		} catch (err) {
			return rpcError(res, err.status || 400, -32700, err.message || 'invalid JSON');
		}

		const batch = Array.isArray(body) ? body : [body];
		if (batch.length > 16) return rpcError(res, 400, -32600, 'batch too large (max 16)');

		// Who this request is: the key the per-caller caps charge, and the owner of
		// any idempotency_key it sends (./jobs.js).
		const caller = studioCaller(surface, body, req, ip, install);

		// Generation quota, burst then hourly, per caller. Applied only when the
		// request actually calls a generation tool, so discovery is never throttled
		// by it. A denial is a JSON-RPC error on HTTP 200: an MCP client hands that
		// message to the model, where a 429 body is often dropped by the transport.
		if (callsGenerationTool(body) && !(await onlyRepeats(body, caller.key))) {
			const deny = (bucket, result) =>
				rpcDenial(res, body, studioDenial({ bucket, kind: caller.kind, result, surfacePath }), result);
			// Any caller key other than the IP is one the client chose, so one source
			// IP is still held to a pool across all of them.
			if (caller.kind !== 'ip') {
				const pool = await limits.studioGenPoolHourly(ip);
				if (!pool.success) return deny('pool', pool);
			}
			const burst = await limits.studioGenBurst(caller.key);
			if (!burst.success) return deny('burst', burst);
			const hourly = await limits.studioGenHourly(caller.key);
			if (!hourly.success) return deny('hourly', hourly);
			// Platform-wide circuit breaker across ALL free-studio callers, backstops
			// the shared GPU/provider budget when many distinct IPs, each under their
			// own hourly cap, would collectively drain it.
			const global = await limits.studioGenerateGlobal();
			if (!global.success) return deny('global', global);
		}

		// Anonymous principal, no auth, no scope. rateKey carries the IP for usage logs.
		const auth = { userId: null, rateKey: ip, scope: '' };

		const token = progressTokenOf(body);
		if (token !== null && acceptsEventStream(req)) {
			return streamToolCall(res, body, auth, req, { surface, caller: caller.key, token });
		}

		const responses = [];
		for (const msg of batch) {
			const r = await dispatch(msg, auth, req, { surface, caller: caller.key });
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
