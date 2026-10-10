// GET /api/cron/event-market-announce: writes announcement DRAFTS for Event
// Markets whose lifecycle changed (opened, locking soon, odds shifted, resolved).
// It never posts and never approves: drafts wait in the admin review queue.
// Idempotent, a second tick writes nothing new. Library:
// api/_lib/event-markets/announce.js. Guide: docs/event-markets.md.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { draftPending } from '../_lib/event-markets/announce.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	const { written, skipped } = await draftPending();
	return json(res, 200, { ok: true, drafted: written.length, written, skipped }, { 'cache-control': 'no-store' });
});
