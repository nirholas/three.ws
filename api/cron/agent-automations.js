// GET /api/cron/agent-automations: the per-minute driver for v1 automations and runs.
//
// Two jobs, in order:
//   1. runAutomationSweep evaluates every live automation with a polled trigger
//      (schedule, price_threshold, balance_below, launch_matching, graduation,
//      whale_buy) and fires the due ones. Tips fire inline from the tip path.
//   2. driveDueRuns steps every queued, scheduled or running agent run a little,
//      including the runs step 1 just started. Each step takes a lease, so this
//      cron, a live SSE stream and the agent page replay can never step one run
//      twice at once, and a cancel requested between steps lands on the next one.
//
// Spend actions do not sign here: they execute through their backing wallet
// intent, which carries the spend policy, per-intent caps and custody claim.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runAutomationSweep } from '../_lib/agents-v1/automations.js';
import { driveDueRuns } from '../_lib/agents-v1/runs.js';

// Leave headroom under the scheduler's request timeout for the sweep itself.
const RUN_DEADLINE_MS = 40_000;

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const startedAt = Date.now();
	let automations;
	try {
		automations = await runAutomationSweep({ now: new Date() });
	} catch (err) {
		console.error('[agent-automations] sweep failed', err);
		automations = { error: String(err?.message || err).slice(0, 200) };
	}
	const runs = await driveDueRuns({ limit: 10, deadlineMs: RUN_DEADLINE_MS });
	const ms = Date.now() - startedAt;
	console.info(`[agent-automations] done in ${ms}ms`, { automations, runs });
	return json(res, 200, { data: { automations, runs, took_ms: ms } });
});
