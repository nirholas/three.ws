// GET /api/cron/scheduler-tick: the one Cloud Scheduler job, run every minute,
// that fires every cron in vercel.json whose schedule is due in that minute.
// The how and why are in api/_lib/cron-tick.js.
//
// ?dry=1 lists the crons due in the tick minute without firing any, which is how
// a deploy proves the tick reads the right schedule before the job is enabled.

import { readFileSync } from 'node:fs';
import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { env } from '../_lib/env.js';
import { tickMinute, dueCrons, runDue, childOrigin, CHILD_TIMEOUT_MS } from '../_lib/cron-tick.js';

// vercel.json only changes with a deploy, so read it once per container.
let declared = null;
function declaredCrons() {
	if (!declared) {
		declared = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')).crons || [];
	}
	return declared;
}

export default wrapCron(
	async (req, res) => {
		if (!method(req, res, ['GET'])) return;
		if (!requireCron(req, res)) return;

		const tick = tickMinute(req.headers['x-cloudscheduler-scheduletime']);
		const { due, invalid } = dueCrons(declaredCrons(), tick);
		for (const bad of invalid) {
			console.error(`[scheduler-tick] invalid schedule for ${bad.path} "${bad.schedule}": ${bad.error}`);
		}

		const dry = new URL(req.url || '/', 'http://localhost').searchParams.get('dry') === '1';
		if (dry) {
			return json(res, 200, { ok: true, dry: true, tick: tick.toISOString(), due: due.map((d) => d.path), invalid });
		}

		const t0 = Date.now();
		const results = await runDue(due, {
			origin: childOrigin(),
			secret: process.env.CRON_SECRET || env.CRON_SECRET,
			tick,
			host: req.headers.host,
			proto: req.headers['x-forwarded-proto'],
		});
		const failed = results.filter((r) => !r.ok);
		for (const f of failed) {
			console.error(`[scheduler-tick] ${f.path} failed: ${f.status ?? f.error} after ${f.ms}ms`);
		}

		// 200 even when a child failed: each cron records its own failure in its
		// heartbeat, and a 5xx here would mark the clock itself unhealthy.
		return json(res, 200, {
			ok: true,
			tick: tick.toISOString(),
			fired: results.length,
			failed,
			invalid,
			ms: Date.now() - t0,
		});
	},
	// Outlasts the longest child so the tick never answers (and lets Cloud Run
	// throttle the container's CPU) while a cron is still running.
	{ maxDurationMs: CHILD_TIMEOUT_MS + 30_000 },
);
