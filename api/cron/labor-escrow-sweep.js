// GET/POST /api/cron/labor-escrow-sweep: drives labor-market escrow cases by the
// clock (Cloud Scheduler, every 5 minutes).
//
// Applies each due time-driven event: a delivery nobody evaluated by attest_by,
// a bounty past its deadline, a dispute nobody ruled on, and the end of a dispute
// window (release on pass, refund on fail). Also retries any terminal decision
// whose payout has not landed, so a failed transfer never strands funds. Every
// transition is a compare-and-set and every payout is claimed, so an overlapping
// tick is safe (api/_lib/labor-evaluation.js).
//
// Auth: the shared, fail-closed cron gate (api/_lib/cron-auth.js).

import { cors, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sweepCases } from '../_lib/labor-evaluation.js';

export const maxDuration = 300;

export default wrapCron(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const t0 = Date.now();
	const summary = await sweepCases();
	const allFailed = summary.scanned > 0 && summary.failed === summary.scanned;
	return json(res, allFailed ? 502 : 200, { ok: !allFailed, ms: Date.now() - t0, ...summary });
}, { maxDurationMs: maxDuration * 1000 });
