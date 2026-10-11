// GET /api/cron/event-markets-feed: turns new picks and status changes into odds
// snapshots and notable-move rows even when nobody is watching the live stream.
// The stream hub runs the same processor while it has listeners, so this is the
// floor that keeps event_market_moves complete. Idempotent: the batch is claimed
// by compare-and-set, so overlapping runs never double-process.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { processFeed } from '../_lib/event-markets/feed.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	const result = await processFeed();
	return json(res, 200, { ok: true, ...result });
});
