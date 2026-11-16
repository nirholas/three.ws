// GET /api/cron/knowledge-pdf-jobs: resume PDF knowledge jobs whose uploading
// browser went away (tab closed, network dropped) so every upload finishes.
//
// The upload panel normally advances a job itself (POST .../jobs/:id/step).
// Any job with no step for 45 seconds and no live lease is picked up here and
// stepped within this request's budget; the next tick continues it. Logic
// lives in api/_lib/knowledge-pdf-jobs.js.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { resumeStalled } from '../_lib/knowledge-pdf-jobs.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;
	const resumed = await resumeStalled({ idleS: 45, limit: 4, budgetMs: 45_000 });
	return json(res, 200, { ok: true, resumed: resumed.length, jobs: resumed });
}, { maxDurationMs: 240_000 });
