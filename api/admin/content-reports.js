// /api/admin/content-reports: the Responsible AI review queue on the internal
// Microsoft board (/admin/microsoft#responsible-ai).
//
//   GET   ?status=open|actioned|dismissed|all&limit=50
//         the "Report" submissions from the Teams bot (content_reports), newest
//         first, with the agent name; plus the feedback totals and recent
//         feedback comments for the last ?days (default 30).
//   POST  { id, status: 'actioned'|'dismissed'|'open', resolution? }
//         close a report with what was done about it, or reopen it.
//
// Storage and alerting: api/_lib/teams-ai-store.js. Auth: authorizeOps (a
// signed-in platform admin, or the ops secret), the gate every internal board
// uses. Reporter and conversation ids are hashed at write time and never
// returned.

import { error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { authorizeOps } from '../_lib/ops-auth.js';
import { respondMfaRequired } from '../_lib/admin-mfa.js';
import { REPORT_STATUSES, feedbackSummary, listReports, reviewReport } from '../_lib/teams-ai-store.js';

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const auth = await authorizeOps(req);
	if (auth.mfaRequired) return respondMfaRequired(res);
	if (!auth.ok) return error(res, 401, 'unauthorized', 'admin session or ops secret required');

	if (req.method === 'GET') {
		const url = new URL(req.url, 'http://local');
		const status = url.searchParams.get('status') || 'open';
		if (status !== 'all' && !REPORT_STATUSES.includes(status)) {
			return error(res, 400, 'validation_error', `status must be one of ${[...REPORT_STATUSES, 'all'].join(', ')}`);
		}
		const [reports, summary] = await Promise.all([
			listReports({ status, limit: url.searchParams.get('limit') }),
			feedbackSummary({ days: url.searchParams.get('days') }),
		]);
		return json(res, 200, {
			ok: true, status, reports, days: summary.days, feedback: summary.feedback,
			reports_summary: summary.reports, recentComments: summary.recentComments,
		}, NO_STORE);
	}

	const body = (await readJson(req)) || {};
	if (!REPORT_STATUSES.includes(body.status)) {
		return error(res, 400, 'validation_error', `status must be one of ${REPORT_STATUSES.join(', ')}`);
	}
	if (body.status !== 'open' && !String(body.resolution || '').trim()) {
		return error(res, 400, 'validation_error', 'say what was done about the report (resolution) before closing it');
	}
	const row = await reviewReport(body.id, { status: body.status, resolution: String(body.resolution || '').trim(), reviewedBy: auth.actor });
	if (!row) return error(res, 404, 'not_found', 'no report with that id');
	return json(res, 200, { ok: true, report: row }, NO_STORE);
});
