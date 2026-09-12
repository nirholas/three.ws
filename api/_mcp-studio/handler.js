// Shared HTTP handler for the free three.ws 3D Studio MCP surfaces.
//
//   POST     JSON-RPC (initialize, tools/list, tools/call, resources/*)
//   GET      not offered (no server-initiated stream), answers 405
//   OPTIONS  CORS preflight
//
// Parameterized by the tool surface it serves (SURFACES in ./dispatch.js):
//   api/mcp-studio.js   surface 'full'     every tool, both widgets
//   api/mcp-chatgpt.js  surface 'chatgpt'  generation tools, model viewer only
// Both front doors share one transport cap, one per-IP generation quota and one
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

import { cors, wrap, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { dispatch, PROTOCOL_VERSION } from './dispatch.js';
import { TOOL_NAMES } from './tools.js';

// check_job collects a job that is already running rather than starting one: it
// must never burn the caller's generation quota, or collecting a pending job
// could be rate-blocked by the very generation that created it. It rides the
// transport cap only.
const GEN_TOOLS = new Set(TOOL_NAMES.filter((name) => name !== 'check_job'));

function rpcError(res, status, code, message, extra = {}) {
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message, ...(Object.keys(extra).length ? { data: extra } : {}) } }));
}

// Does the (possibly batched) body invoke any generation tool? Used to apply the
// cost-bearing generation quota only to calls that actually generate.
function callsGenerationTool(body) {
	const batch = Array.isArray(body) ? body : [body];
	return batch.some((m) => m && m.method === 'tools/call' && GEN_TOOLS.has(m?.params?.name));
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
			const burst = await limits.studioGenBurst(ip);
			if (!burst.success) return rateLimited(res, burst, 'generation rate limit, slow down and try again shortly');
			const hourly = await limits.studioGenHourly(ip);
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
		res.end(JSON.stringify(Array.isArray(body) ? responses : (responses[0] ?? null)));
	});
}
