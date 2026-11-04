// three.ws Oracle: MCP server (Streamable HTTP transport, MCP 2025-06-18).
// POST /api/mcp-oracle: tool calls   GET: SSE   DELETE: terminate.
//
// The Oracle conviction signal as a focused MCP server: eleven free read tools
// (board, one coin, feed, search, movers, wins, backtest, calibration,
// leaderboard, wallet, stats) plus the two account-scoped tools that arm an
// agent on the live stream and report its watch. Reads answer without
// credentials, including initialize and tools/list; arming needs a three.ws
// account (OAuth) and inherits the real-funds agreement gate and the
// `wallet:write` scope rule that /api/oracle/watch enforces. Nothing here
// charges per call. Registered with the MCP Registry as
// io.github.nirholas/threews-oracle (see server-oracle.json).
import { cors, readJson, wrap } from './_lib/http.js';
import { issueSession, trackMcp } from './_lib/mcp-clients.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { PROTOCOL_VERSION, dispatch, isPublicTool } from './_mcporacle/dispatch.js';
import { ORACLE_CHALLENGE } from './_mcporacle/discovery.js';
import { send401, sendJsonRpcError, authenticateRequest, handleSse, handleTerminate } from './_mcp/auth.js';

// Every challenge this server issues is scoped to its OWN resource.
const RESOURCE_PATH = '/api/mcp-oracle';

/** A request needs no credentials when none of its tool calls needs a scope. */
function isFreeBatch(body) {
	const batch = Array.isArray(body) ? body : [body];
	return batch.every((msg) => msg?.method !== 'tools/call' || isPublicTool(msg?.params?.name));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,HEAD,POST,DELETE,OPTIONS', origins: '*' })) return;

	if (req.method === 'GET' || req.method === 'HEAD')
		return handleSse(req, res, { resourcePath: RESOURCE_PATH, challenge: ORACLE_CHALLENGE });
	if (req.method === 'DELETE') return handleTerminate(req, res);
	if (req.method !== 'POST') return send401(res, 'method not supported');

	const body = await readJson(req, 1_000_000);

	const result = await authenticateRequest(req, res, {
		resourcePath: RESOURCE_PATH,
		challenge: ORACLE_CHALLENGE,
		allowFree: isFreeBatch(body),
	});
	if (!result) return;

	// Anonymous callers share no bucket: key every limit off the caller IP so one
	// noisy client cannot exhaust the free tier for everyone.
	const ip = clientIp(req);
	const auth = result.auth.rateKey ? result.auth : { ...result.auth, rateKey: `ip:${ip}` };

	const ipRl = await limits.mcpIp(ip);
	if (!ipRl.success)
		return sendJsonRpcError(res, null, -32000, 'rate_limited', {
			retry_after: Math.ceil((ipRl.reset - Date.now()) / 1000),
		});

	const batch = Array.isArray(body) ? body : [body];
	if (batch.length > 16) return sendJsonRpcError(res, null, -32600, 'batch too large (max 16)');

	const responses = [];
	for (const msg of batch) {
		const r = await dispatch(msg, auth, req);
		if (r !== null) responses.push(r);
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('mcp-protocol-version', PROTOCOL_VERSION);
	const issuedSessionId = issueSession(res, body);
	res.end(JSON.stringify(Array.isArray(body) ? responses : (responses[0] ?? null)));
	trackMcp({ surface: 'mcp-oracle', req, body, responses, auth, issuedSessionId });
});
