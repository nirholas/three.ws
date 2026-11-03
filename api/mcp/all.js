// Unified MCP server, Streamable HTTP transport (MCP 2025-06-18, JSON-RPC 2.0).
// Served at https://three.ws/mcp and /api/mcp/all: every tool of every hosted
// three.ws MCP server behind one endpoint and one sign-in. The seven legacy
// endpoints keep working unchanged.
//
// POST: JSON-RPC (single or batch). GET: the OAuth + x402 challenge for an
// unauthenticated caller, or the resource-update stream for an authenticated
// one. DELETE: terminate the (stateless) session.
//
// Pricing, payment replay protection and settlement are identical to
// api/mcp.js; only the tool table differs. Per-tool prices come from the
// registry, so a priced tool costs the same here as on its own endpoint.

import { cors, readJson, wrap } from '../_lib/http.js';
import { issueSession, trackMcp } from '../_lib/mcp-clients.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { settlePayment, encodePaymentResponseHeader } from '../_lib/x402-spec.js';
import { priceBatch, isDiscoveryOnlyBatch } from '../_lib/mcp-batch-price.js';
import {
	send401,
	sendJsonRpcError,
	authenticateRequest,
	handleSse,
	handleTerminate,
	isMcpProtocolClient,
} from '../_mcp/auth.js';
import { sendX402Error, reservePaymentProof } from '../_mcp/payments.js';
import { PROTOCOL_VERSION, dispatch, priceOptions } from '../_mcpall/server.js';
import { UNIFIED_RESOURCE_SERVER } from '../_mcpall/registry.js';

// The OAuth protected resource and x402 resource URL this server is known by.
const RESOURCE_PATH = '/mcp';
const BATCH_CAP = 32;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,HEAD,POST,DELETE,OPTIONS', origins: '*' })) return;

	if (req.method === 'GET' || req.method === 'HEAD') {
		return handleSse(req, res, { resourceServer: UNIFIED_RESOURCE_SERVER, resourcePath: RESOURCE_PATH });
	}
	if (req.method === 'DELETE') {
		return handleTerminate(req, res, { resourceServer: UNIFIED_RESOURCE_SERVER, resourcePath: RESOURCE_PATH });
	}
	if (req.method !== 'POST') return send401(res, 'method not supported', { req, resourcePath: RESOURCE_PATH });

	const body = await readJson(req, 2_000_000);

	// Sum the per-tool price of every tools/call so one payment covers the whole
	// batch (see api/_lib/mcp-batch-price.js).
	const { totalAmount: x402Amount, allFree } = priceBatch(body, priceOptions());

	const result = await authenticateRequest(req, res, {
		x402Amount,
		resourcePath: RESOURCE_PATH,
		allowFree: allFree || (isDiscoveryOnlyBatch(body) && !isMcpProtocolClient(req)),
	});
	if (!result) return;
	const { auth, x402Ctx } = result;

	const ipRl = await limits.mcpIp(clientIp(req));
	if (!ipRl.success) {
		return sendJsonRpcError(res, null, -32000, 'rate_limited', { retry_after: Math.ceil((ipRl.reset - Date.now()) / 1000) });
	}
	const userRl = await limits.mcpUser(auth.userId || auth.rateKey || clientIp(req));
	if (!userRl.success) {
		return sendJsonRpcError(res, null, -32000, 'rate_limited', { retry_after: Math.ceil((userRl.reset - Date.now()) / 1000) });
	}

	const batch = Array.isArray(body) ? body : [body];
	if (batch.length > BATCH_CAP) return sendJsonRpcError(res, null, -32600, `batch too large (max ${BATCH_CAP})`);

	let releaseProof = async () => {};
	if (x402Ctx) {
		const guard = await reservePaymentProof(RESOURCE_PATH, req.headers['x-payment'] || req.headers['payment-signature']);
		if (!guard.ok) return sendJsonRpcError(res, null, -32000, 'payment_in_flight', { retry_after: 1 });
		releaseProof = guard.release;
	}

	try {
		const responses = [];
		for (const msg of batch) {
			const r = await dispatch(msg, auth, req);
			if (r !== null) responses.push(r);
		}

		// Settle only when at least one call produced a result; a partial failure
		// in a batch does not void the calls that succeeded.
		const anySuccess = responses.some((r) => r && !r.error && !(r.result && r.result.isError));
		if (x402Ctx && anySuccess) {
			try {
				const settled = await settlePayment({ verified: x402Ctx.verified });
				res.setHeader('x-payment-response', encodePaymentResponseHeader(settled));
				for (const run of auth?.afterSettle ?? []) {
					await run().catch((e) => console.warn('[mcp-all] post-settle payout failed:', e?.message));
				}
			} catch (err) {
				return sendX402Error(res, { resourceUrl: x402Ctx.resourceUrl, accepts: x402Ctx.requirements }, err);
			}
		}

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json; charset=utf-8');
		res.setHeader('mcp-protocol-version', PROTOCOL_VERSION);
		const issuedSessionId = issueSession(res, body);
		res.end(JSON.stringify(Array.isArray(body) ? responses : (responses[0] ?? null)));
		trackMcp({ surface: 'mcp-all', req, body, responses, auth, issuedSessionId });
	} finally {
		await releaseProof();
	}
});
