// @ts-check
// GET /api/cron/indexnow-reconcile: every ten minutes (vercel.json crons, synced
// to Cloud Scheduler). Enqueues every public agent, avatar, forge creation,
// widget, profile and manifest page that changed since the last run and that
// a write path did not already announce, then drains the IndexNow outbox to
// api.indexnow.org (Bing, Yandex, Seznam, Naver). The response carries the
// per-type counts, each request's HTTP status, and the outbox depth after the
// run; every request is also logged to indexnow_submissions.
// Library: api/_lib/indexnow-queue.js. Runbook: docs/ops/bing-and-indexnow.md.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { reconcileIndexNow, indexNowStatus } from '../_lib/indexnow-queue.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	const result = await reconcileIndexNow({ source: 'cron' });
	const status = await indexNowStatus();
	const errors = result.types.filter((t) => t.error);
	const types = result.types.map(({ urls, ...rest }) => rest);
	console.log(
		`[indexnow-reconcile] ${types.map((t) => `${t.type}=${t.error ? 'error' : t.enqueued}`).join(' ')}` +
			` submitted=${result.drain?.submitted ?? 0} pending=${status.pending}` +
			(result.drain?.skipped ? ` skipped=${result.drain.skipped}` : ''),
	);
	return json(res, 200, { ok: errors.length === 0, types, drain: result.drain, pending: status.pending });
});
