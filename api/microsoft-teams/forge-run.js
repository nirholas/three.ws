// POST /api/microsoft-teams/forge-run: internal. Runs one Teams "Create a 3D
// model" job (api/_lib/teams-forge.js runTeamsForge) inside this request.
//
// The messaging endpoint has to answer Teams within seconds, and Cloud Run
// throttles the CPU of work left running after a response is sent. So the bot
// dispatches each job here with the scheduler's bearer (CRON_SECRET): this
// handler sends its 202 headers at once, which is all the dispatcher waits
// for, and holds the request open while the job runs and polls, ending it with
// the final state. Cloud Run's 900s request timeout bounds it; the run yields
// before that (RUN_BUDGET_MS) and a later card refresh collects a straggler.

import { wrap, method, error, readJson } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { isForgeKey, runTeamsForge } from '../_lib/teams-forge.js';

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST'])) return;
	if (!requireCron(req, res)) return;
	const body = await readJson(req);
	const key = body?.key;
	if (!isForgeKey(key)) return error(res, 400, 'validation_error', 'a teams forge job key is required');
	res.writeHead(202, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	res.flushHeaders?.();
	let final;
	try {
		final = await runTeamsForge(key);
	} catch (err) {
		console.error(`[teams-forge] run ${key} threw: ${err?.message || err}`);
		return res.end(JSON.stringify({ key, state: 'error', error: err?.message || String(err) }));
	}
	return res.end(JSON.stringify({ key, state: final?.state || 'unknown' }));
});
