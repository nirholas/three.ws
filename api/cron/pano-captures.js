// GET /api/cron/pano-captures: advance 360 capture jobs nobody is polling.
//
// A splat job runs 10 to 40 minutes and its owner usually closes the tab. The
// page's own polls move a watched job; this picks up every queued or running
// job with no poll for a minute, reads its worker task, and on success copies
// the files into our bucket, so every capture finishes and is saved whether or
// not anyone is looking. Logic lives in api/_lib/pano-capture.js.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { advanceUnwatched } from '../_lib/pano-capture.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;
	const out = await advanceUnwatched({ limit: 10, budgetMs: 200_000 });
	return json(res, 200, { ok: true, ...out, count: out.advanced.length });
}, { maxDurationMs: 280_000 });
