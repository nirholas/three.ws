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
// Per-caller caps key on an install token (?install=, minted free at
// POST /api/mcp-studio/install) when one is present, else on the surface's own
// subject (ChatGPT subject, Grok session), else the IP. A capped caller gets a
// JSON-RPC error naming the limit, its reset time and how to lift it.
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
import { cors, wrap, readJson, setRateLimitHeaders } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { dispatch, PROTOCOL_VERSION } from './dispatch.js';
import { TOOL_NAMES } from './tools.js';
import { resolveInstallToken } from '../_lib/mcp-studio-installs.js';

const ORIGIN = 'https://three.ws';

// check_job collects a job that is already running rather than starting one: it
// must never burn the caller's generation quota, or collecting a pending job
// could be rate-blocked by the very generation that created it. It rides the
// transport cap only.
const GEN_TOOLS = new Set(TOOL_NAMES.filter((name) => name !== 'check_job'));

/** Does calling this tool start a generation that counts against the quota? */
export function isGenerationTool(name) {
	return GEN_TOOLS.has(name);
}

function rpcError(res, status, code, message, extra = {}, id = null) {
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, ...(Object.keys(extra).length ? { data: extra } : {}) } }));
}

/** "in 12 minutes (at 14:05 UTC)" for a limiter reset time in epoch ms. */
export function describeReset(resetMs, now = Date.now()) {
	const secs = Math.max(1, Math.ceil(((Number(resetMs) || now) - now) / 1000));
	const span = secs < 90 ? `${secs} seconds` : secs < 5400 ? `${Math.ceil(secs / 60)} minutes` : `${Math.ceil(secs / 3600)} hours`;
	return `in ${span} (at ${new Date(now + secs * 1000).toISOString().slice(11, 16)} UTC)`;
}

/** How a capped caller lifts the limit: the install token, or an account. */
function remedyFor(installed) {
	if (installed) {
		return `This installation's budget refills at the reset time. For a larger budget connect the account server ${ORIGIN}/api/mcp (OAuth sign-in).`;
	}
	return (
		`Give this connector its own budget: POST ${ORIGIN}/api/mcp-studio/install returns a free token, then use ` +
		`${ORIGIN}/api/mcp-studio?install=<token> as the connector URL. For an account-level budget connect ${ORIGIN}/api/mcp (OAuth sign-in).`
	);
}

// A capped caller gets a JSON-RPC error (HTTP 429) that says which limit it hit,
// when it resets and how to lift it, so an agent can relay a plan to its user
// instead of a bare "rate limited". data carries the same facts for machines.
function capped(res, result, { what, id, installed }) {
	const retryAfter = Math.max(1, setRateLimitHeaders(res, result));
	res.setHeader('retry-after', String(retryAfter));
	res.setHeader('cache-control', 'no-store');
	const resets = describeReset(result?.reset);
	const unavailable = result?.reason === 'rate_limiter_unavailable';
	const message = unavailable
		? `${what}: the limiter is temporarily unavailable. Retry in ${retryAfter} seconds.`
		: `${what}. It resets ${resets}. ${remedyFor(installed)}`;
	return rpcError(
		res,
		429,
		-32029,
		message,
		{
			error: 'rate_limited',
			limit: what,
			retry_after: retryAfter,
			resets_at: new Date(Date.now() + retryAfter * 1000).toISOString(),
			remedy: {
				install_token_endpoint: `POST ${ORIGIN}/api/mcp-studio/install`,
				connector_url_template: `${ORIGIN}/api/mcp-studio?install=<token>`,
				account_server: `${ORIGIN}/api/mcp`,
			},
			...(result?.reason ? { reason: result.reason } : {}),
		},
		id,
	);
}

/** The ?install= value of a request, from the parsed query or the raw URL. */
export function installParam(req) {
	const q = req?.query?.install;
	if (typeof q === 'string') return q;
	try {
		return new URL(req?.url || '', 'http://x').searchParams.get('install');
	} catch {
		return null;
	}
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
		if (!ipRl.success) return capped(res, ipRl, { what: 'Too many requests from this network (300 per minute)', id: null, installed: false });

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
			// An install token (per-installation identity, free and anonymous) beats
			// the surface's own subject, which beats the IP. An unknown or malformed
			// token resolves to null and the caller is keyed exactly as without one.
			const installKey = await resolveInstallToken(installParam(req));
			const subject = installKey || callerSubject(surface, body, req);
			const id = batch.find((m) => m && m.id !== undefined)?.id ?? null;
			const installed = Boolean(installKey);
			if (subject) {
				const pool = await limits.studioGenPoolHourly(ip);
				if (!pool.success) return capped(res, pool, { what: 'The free 3D studio is at capacity for this network right now (300 generations per hour across every installation behind one IP)', id, installed });
			}
			const caller = subject || ip;
			const burst = await limits.studioGenBurst(caller);
			if (!burst.success) return capped(res, burst, { what: 'Generation burst limit reached (4 generations per minute per caller)', id, installed });
			const hourly = await limits.studioGenHourly(caller);
			if (!hourly.success) return capped(res, hourly, { what: 'Hourly generation limit reached (30 generations per hour per caller)', id, installed });
			// Platform-wide circuit breaker across ALL free-studio callers, backstops
			// the shared GPU/provider budget when many distinct IPs, each under their
			// own hourly cap, would collectively drain it. Fails closed in prod.
			const global = await limits.studioGenerateGlobal();
			if (!global.success) return capped(res, global, { what: 'The free 3D studio is at capacity across all users right now', id, installed });
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
