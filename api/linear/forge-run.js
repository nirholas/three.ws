// POST /api/linear/forge-run: internal. Runs one Linear agent 3D model job
// (api/_lib/linear-agent.js runLinearForge) inside this request and posts the
// finished model into the agent session it was asked from.
//
// Linear wants its webhook answered within five seconds, and Cloud Run throttles
// the CPU of work left running after a response is sent. So the webhook
// dispatches each job here with the scheduler's bearer (CRON_SECRET): this
// handler sends its 202 headers at once, which is all the dispatcher waits for,
// and holds the request open while the job runs. A generation that outlives one
// run is handed to a fresh one.

import { wrap, method, error, readJson } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { isJobKey, runLinearForge } from '../_lib/linear-agent.js';

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST'])) return;
	if (!requireCron(req, res)) return;
	const body = await readJson(req);
	const key = body?.key;
	if (!isJobKey(key)) return error(res, 400, 'validation_error', 'a linear forge job key is required');
	res.writeHead(202, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	res.flushHeaders?.();
	let final;
	try {
		final = await runLinearForge(key);
	} catch (err) {
		console.error(`[linear-agent] run ${key} threw: ${err?.message || err}`);
		return res.end(JSON.stringify({ key, state: 'error', error: err?.message || String(err) }));
	}
	return res.end(JSON.stringify({ key, state: final?.state || 'unknown' }));
});
