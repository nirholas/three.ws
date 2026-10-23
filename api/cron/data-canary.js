// GET /api/cron/data-canary: probe every market-data source against a known
// price and a known historical candle, and record the verdicts that order the
// data layer's fallback chains. Library: api/_lib/data-canaries.js.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runCanaries } from '../_lib/data-canaries.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const verdicts = await runCanaries();
	const failing = verdicts.filter((v) => !v.ok).map((v) => ({ id: v.id, detail: v.detail, consecutive_failures: v.consecutive_failures }));
	return json(res, 200, { ok: true, probed: verdicts.length, healthy: verdicts.length - failing.length, failing }, { 'cache-control': 'no-store' });
});
