// GET /api/ops/forge-funnel?days=30: the Forge funnel report.
//
// The forge health sensor says whether meshes come back. This board says
// whether anyone keeps them: useful-output rate, first-asset success and
// second-asset rate for new makers, D7/D30 return, what each generation was for,
// which lane earns its attempts, and x402 revenue per kept asset. Definitions
// and the queries live in api/_lib/forge-funnel.js, shared with
// `npm run forge:funnel`, so the board and the CLI can never disagree.
//
//   days   Rolling window in whole days, 1 to 365. Default 30. Retention always
//          uses its own fixed cohort lookback, stated in the response.
//
// A failed panel names itself in `degraded` and the response is 207, matching
// /api/ops/health and /api/ops/payment-outcomes. `ok` reports whether the board
// rendered, never whether the funnel is good.
//
// Auth: authorizeOps (admin session, or x-ops-secret / OPS_SECRET). Owner-only
// on purpose: it carries per-lane performance and revenue.
// Read-only: SELECTs and nothing else.

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { authorizeOps } from '../_lib/ops-auth.js';
import { gatherForgeFunnel, clampFunnelDays } from '../_lib/forge-funnel.js';

export const maxDuration = 30;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	// Same bucket as the other ops boards: a polled board must not drain the
	// login budget of the IP that watches it.
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const auth = await authorizeOps(req);
	if (!auth.ok) return error(res, 401, 'unauthorized', 'ops secret or admin session required');

	const url = new URL(req.url, 'http://localhost');
	const days = clampFunnelDays(url.searchParams.get('days') ?? undefined);

	const report = await gatherForgeFunnel({ days });
	return json(res, report.ok ? 200 : 207, report, { 'cache-control': 'private, no-store' });
});
