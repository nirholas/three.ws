// GET /api/admin/microsoft: data for the internal Microsoft partnership board
// (/admin/microsoft). SaaS subscriptions and MRR, webhook operations, metering
// verdicts, Teams bot and Power Platform connector traffic, Partner Center
// analytics ingest state, alert incidents, and the "what needs attention" list.
// Aggregation: api/_lib/microsoft-dashboard.js. Metric definitions and runbook:
// docs/ops/microsoft-dashboard.md.
//
// Auth: authorizeOps (a signed-in platform admin, or x-ops-secret / OPS_SECRET),
// the gate every internal board uses. Read-only.

import { error, json, method, rateLimited, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { authorizeOps } from '../_lib/ops-auth.js';
import { missingConfig, publisherConfig } from '../_lib/microsoft-marketplace.js';
import { loadMicrosoftDashboard } from '../_lib/microsoft-dashboard.js';

export const maxDuration = 30;

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	// A session lookup and eight queries per request: same polled-board bucket as /api/ops/payment-outcomes.
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const auth = await authorizeOps(req);
	if (!auth.ok) return error(res, 401, 'unauthorized', 'admin session or ops secret required');
	const board = await loadMicrosoftDashboard({
		config: { missing: missingConfig(), partnerCenterConfigured: Boolean(publisherConfig()) },
	});
	return json(res, 200, { ok: true, viewer: auth.actor, ...board }, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
});
