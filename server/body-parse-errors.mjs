// Express error middleware for body-parser failures (malformed JSON, over-limit
// payloads): turn them into a clean 4xx instead of Express's HTML error page.
//
// Mounted last in server/index.mjs. Body parsing runs ahead of the route table,
// so a rejection here happens before any api/** handler sees the request. That
// includes the MCP servers, whose own -32700 handling therefore never ran: a
// malformed body got `{"error":"bad_request"}`, which no JSON-RPC client can
// read. MCP endpoints get a JSON-RPC error envelope from here instead.

// The JSON-RPC MCP endpoints: every server in public/.well-known/mcp.json, the
// unified route target, the ChatGPT door and the per-agent server.
// tests/server-body-parse-errors.test.js reads mcp.json and fails when a
// published server is missing here.
const MCP_RPC_PATHS = new Set([
	'/mcp',
	'/api/mcp',
	'/api/mcp/all',
	'/api/mcp-3d',
	'/api/mcp-studio',
	'/api/mcp-chatgpt',
	'/api/mcp-grok',
	'/api/mcp-agent',
	'/api/mcp-bazaar',
	'/api/mcp-oracle',
	'/api/pump-fun-mcp',
	'/api/ibm-mcp',
]);
const AGENT_MCP = /^\/api\/v1\/agents\/[^/]+\/mcp(\/.*)?$/;

export function isMcpRpcPath(pathname) {
	const p = String(pathname || '').split('?')[0];
	const trimmed = p.length > 1 ? p.replace(/\/+$/, '') : p;
	return MCP_RPC_PATHS.has(trimmed) || AGENT_MCP.test(trimmed);
}

function humanLimit(bodyLimit) {
	return bodyLimit.toUpperCase().replace(/(KB|MB)$/, ' $1');
}

// JSON-RPC 2.0 §5: an error for a request whose id could not be read carries
// `id: null`. -32700 is the parse error; an over-limit body was never read in
// full, so it is an invalid request (-32600).
function rpcError(res, status, code, message) {
	res.status(status).json({ jsonrpc: '2.0', id: null, error: { code, message } });
}

export function bodyParseErrorHandler({ bodyLimit }) {
	return (err, req, res, next) => {
		if (res.headersSent) return next(err);
		const status = err?.status || err?.statusCode;
		if (status && status >= 400 && status < 500) {
			const tooLarge = err?.type === 'entity.too.large' || status === 413;
			if (isMcpRpcPath(req.path)) {
				if (tooLarge) return rpcError(res, 413, -32600, `Request body is too large. Keep it under ${humanLimit(bodyLimit)}.`);
				return rpcError(res, status, -32700, `Parse error: ${err.message}`);
			}
			// body-parser tags over-limit payloads with type 'entity.too.large'.
			// Surface a specific code + human message so client error paths (which
			// read error/error_description) say something actionable.
			if (tooLarge) {
				// Quote the limit rather than a literal: this said "under 4 MB" long
				// after the cap moved to 8 MB, so a caller inside the real limit was
				// told to shrink a payload that was already small enough.
				res.status(413).json({
					error: 'payload_too_large',
					error_description: `Request body is too large. Keep it under ${humanLimit(bodyLimit)}.`,
					message: err.message,
				});
				return;
			}
			// Same reason as the 413 branch above: client error paths read
			// error/error_description, so a body-parser rejection that carried only
			// `message` rendered as an empty reason next to every handler-emitted
			// 4xx on the same endpoint.
			res.status(status).json({
				error: 'bad_request',
				error_description: err.message,
				message: err.message,
			});
			return;
		}
		console.error('[server] unexpected middleware error:', err);
		res.status(500).json({ error: 'internal_error', message: 'The request failed unexpectedly.' });
	};
}
