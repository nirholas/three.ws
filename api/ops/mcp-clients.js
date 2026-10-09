// GET /api/ops/mcp-clients?days=30: which AI clients use the hosted MCP servers.
//
// Every MCP initialize names its client. api/_lib/mcp-clients.js records that per
// session and counts tool calls against it; this endpoint reads the aggregates:
// per client, sessions, calls, versions, surfaces, auth kinds and top tools,
// plus a daily series for the chart on /mcp-clients.
//
//   days   Rolling window in whole days, 1 to 365. Default 30.
//
// Auth: requireAdmin (a signed-in platform admin session). 401 without a
// session, 403 for a signed-in non-admin. Read-only: SELECTs and nothing else.
// A missing table (migration 20261009172000 not applied) answers 503 and names
// the migration, never a bare 500.

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireAdmin } from '../_lib/admin.js';
import { gatherMcpClients, clampReportDays } from '../_lib/mcp-clients.js';

export const maxDuration = 30;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const url = new URL(req.url, 'http://localhost');
	const days = clampReportDays(url.searchParams.get('days') ?? undefined);

	try {
		const report = await gatherMcpClients({ days });
		return json(res, 200, report, { 'cache-control': 'private, no-store' });
	} catch (err) {
		if (err?.code === '42P01') {
			return error(
				res,
				503,
				'migration_pending',
				'MCP client analytics tables are missing: apply 20261009172000_mcp_client_analytics.sql (npm run db:status)',
			);
		}
		throw err;
	}
});
