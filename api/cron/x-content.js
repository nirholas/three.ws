// @ts-check
// GET /api/cron/x-content - the reviewed @trythreews content queue.
//
// Runs every 15 minutes on Cloud Scheduler. Each tick publishes at most one
// approved item from data/x-content/queue.json (baked into the image by the
// deploy that shipped it): a post or thread with native images, GIF, or video,
// or an X Article followed by posts that quote it. Pacing, jitter, rotation,
// and the publish ledger live in api/_lib/x-content/.
//
// Posting is off until the owner turns it on. With X_CONTENT_AUTO_PUBLISH unset
// the tick runs in preview mode and returns the exact X API calls it would make,
// so the queue can be verified in production before a single post goes out.
//
// Credentials: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
// (OAuth 1.0a user context for @trythreews). Articles also need the account on
// X Premium.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runTick } from '../_lib/x-content/runner.js';
import { dbStore } from '../_lib/x-content/state.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	const store = dbStore();
	if (!(await store.acquireLock())) {
		json(res, 200, { ok: true, skipped: 'locked' });
		return;
	}
	const live = process.env.X_CONTENT_AUTO_PUBLISH === 'true';
	try {
		const result = await runTick({ root: process.cwd(), store, dryRun: !live });
		if (result.blocked.length) console.warn('[cron] x-content approved items failing validation', result.blocked);
		json(res, 200, { ok: true, mode: live ? 'publish' : 'preview', ...result });
	} catch (err) {
		console.error('[cron] x-content publish failed; progress is saved and the next tick resumes', err);
		json(res, 502, { ok: false, mode: live ? 'publish' : 'preview', error: String(/** @type {any} */ (err)?.message || err) });
	} finally {
		await store.releaseLock().catch(() => {});
	}
});
