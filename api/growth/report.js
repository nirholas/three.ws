/**
 * GET /api/growth/report?from=YYYY-MM-DD&to=YYYY-MM-DD: first-touch campaign
 * results (admin only). Touches and signup / agent_created / forge_generation /
 * paid_call conversions per campaign id. Defaults to the last 30 days.
 */

import { cors, error, json, method, wrap } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin.js';
import { campaignReport } from '../_lib/campaign-ledger.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	if (!(await requireAdmin(req, res))) return;

	const q = new URL(req.url, 'http://internal').searchParams;
	const now = new Date();
	const from = q.get('from') || new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
	const to = q.get('to') || new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
	if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from >= to) {
		return error(res, 400, 'validation_error', 'from and to must be YYYY-MM-DD dates with from before to');
	}
	const campaigns = await campaignReport({ from, to });
	return json(res, 200, { from, to, campaigns });
});
