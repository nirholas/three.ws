// @ts-check
// GET /api/cron/content-safety-sweep: the recurring half of the public-listing
// safety screen (api/_lib/content-safety.js).
//
// Promotes models whose maker asked for public while the screen was unavailable,
// holds the ones that stay unscreenable past the deadline for an admin, takes down
// already-public models the screen blocks, and pages when the screen itself is
// down. Logic and rationale: api/_lib/content-safety-sweep.js. Runs every 5
// minutes from Cloud Scheduler.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sweepContentSafety } from '../_lib/content-safety-sweep.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;
	const stats = await sweepContentSafety();
	return json(res, 200, { ok: true, ...stats });
});
