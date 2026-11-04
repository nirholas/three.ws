// GET /api/cron/build-leaderboard - recompute the activity leaderboard of every
// open or judging Build round from real paid-call, volume and launch records.

import { cors, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import { computeLeaderboard } from '../_lib/build-program.js';

export default wrapCron(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	const rounds = await sql`SELECT id, starts_at, ends_at FROM program_rounds WHERE status IN ('open', 'judging')`;
	const results = [];
	for (const r of rounds) results.push(await computeLeaderboard(r));
	json(res, 200, { ok: true, rounds: results });
});
