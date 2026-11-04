// GET/POST /api/cron/human-tasks-sweep: the human-task marketplace's background
// tick (Cloud Scheduler, every 2 minutes).
//
// Confirms escrow transfers that landed after the poster closed the tab,
// expires tasks past their deadline, auto-approves submissions the poster never
// reviewed, pays out approved tasks and refunds cancelled or expired ones,
// closes empty escrow token accounts, and mirrors or withdraws external
// listings. Every stage is bounded and idempotent (api/_lib/human-tasks/service.js),
// so an overlapping tick is safe.
//
// Auth: the shared, fail-closed cron gate (api/_lib/cron-auth.js).

import { cors, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runHumanTasksSweep } from '../_lib/human-tasks/service.js';

export const maxDuration = 300;

export default wrapCron(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const t0 = Date.now();
	const summary = await runHumanTasksSweep();
	if (summary.errors.length) console.warn('[human-tasks-sweep] errors', JSON.stringify(summary.errors).slice(0, 2000));
	return json(res, 200, { ok: true, ms: Date.now() - t0, ...summary });
}, { maxDurationMs: maxDuration * 1000 });
