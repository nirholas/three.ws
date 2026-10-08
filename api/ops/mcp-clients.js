// GET /api/ops/mcp-clients?days=30: which AI clients use the hosted MCP servers.
//
// Per client family (claude, chatgpt, cursor, grok, ...): sessions opened,
// tools called, calls per session, the names and versions it sent, how it
// authenticated, which surface it used and its top tools, plus a per-day series
// for the chart. Built from the daily aggregate in mcp_client_daily
// (api/_lib/mcp-client-report.js); no request body is ever stored.
//
//   days   Rolling window in whole days, 1 to 365. Default 30.
//
// A failed read names itself in `degraded` and the response is 207, matching
// the other ops boards. Auth: requireAdmin (signed-in platform admin): 401
// without a session, 403 for anyone else. Read-only.

import { cors, json, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireAdmin } from '../_lib/admin.js';
import { gatherMcpClients, clampReportDays } from '../_lib/mcp-client-report.js';

export const maxDuration = 30;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	// Same polled-read bucket as the other ops boards, so watching a board never
	// drains the login budget of the IP that watches it.
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const url = new URL(req.url, 'http://localhost');
	const days = clampReportDays(url.searchParams.get('days') ?? undefined);

	const report = await gatherMcpClients({ days });
	return json(res, report.ok ? 200 : 207, report, { 'cache-control': 'private, no-store' });
});
