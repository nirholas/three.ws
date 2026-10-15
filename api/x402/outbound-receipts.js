// GET /api/x402/outbound-receipts?network=<solana|base>&host=<endpoint-host>&cursor=<iso>&limit=<n>
//
// Outbound receipts: what the caller's agents spent at OTHER, external x402
// merchants while executing an Agent Payment Session (api/pay/session.js),
// enriched with what the Solana chain itself says settled (payer, payee,
// mint, amount, fee, slot, time), not just what the settlement response
// claimed. This is the counterpart to /api/x402/my-receipts (which answers
// "what did three.ws charge wallet X"); this endpoint answers "what did my
// agents spend elsewhere."
//
// Authentication: account session cookie, or a bearer token with wallet:write
// (the same credential that is allowed to see what a session spent, matching
// GET /api/pay/session/:id/executions). Read-only methods pass assertBearerMaySpend
// unconditionally, so a read-scoped key works too.

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { assertBearerMaySpend } from '../_lib/spend-scope.js';
import { cors, error, json, method, rateLimited, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { clampInt } from '../_lib/http-params.js';
import { listOutboundReceipts, summarizeOutboundReceipts } from '../_lib/x402/outbound-receipts.js';

async function resolveUser(req, res) {
	const session = await getSessionUser(req, res);
	if (session) return session;
	const bearer = assertBearerMaySpend(await authenticateBearer(extractBearer(req)), req);
	if (bearer) return { id: bearer.userId };
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const user = await resolveUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'authentication required');

	const url = new URL(req.url, 'http://x');
	const network = url.searchParams.get('network') || null;
	const host = url.searchParams.get('host') || null;
	const rawCursor = url.searchParams.get('cursor');
	const cursor = rawCursor && Number.isFinite(Date.parse(rawCursor)) ? rawCursor : null;
	if (rawCursor && !cursor) {
		return error(res, 400, 'invalid_cursor', 'cursor must be an ISO 8601 timestamp');
	}
	const limit = clampInt(url.searchParams.get('limit'), { min: 1, max: 100, fallback: 20 });

	const [{ receipts, nextCursor }, summary] = await Promise.all([
		listOutboundReceipts(user.id, { limit, cursor, network, host }),
		summarizeOutboundReceipts(user.id),
	]);

	return json(res, 200, { receipts, nextCursor, summary });
});
