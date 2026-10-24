// @ts-check
// GET /api/cron/commit-feed-push — posts every new commit on `main` to
// Telegram as it lands, independent of the curated changelog cron
// (changelog-push.js only ships holder-readable, deploy-gated entries).
//
// Runs every 5 minutes. Reads the commit list from the GitHub REST API,
// diffs it against the last-posted SHA in app_settings, and posts anything
// newer, oldest-first, one message per commit.
//
// Destination: TELEGRAM_COMMITS_CHAT_ID if set, else TELEGRAM_CHANGELOG_CHAT_ID
// (the existing @three_ws channel) so this works out of the box on the same
// bot. Point TELEGRAM_COMMITS_CHAT_ID at a separate chat to split dev/commit
// noise out of the holder-facing channel.
//
// A lane whose credentials are absent reports { skipped: 'not_configured' }.
//   Telegram: TELEGRAM_BOT_TOKEN + (TELEGRAM_COMMITS_CHAT_ID or TELEGRAM_CHANGELOG_CHAT_ID)
//
// A DB lock (app_settings) keeps overlapping ticks from double-posting.

import { json, method, wrapCron } from '../_lib/http.js';
import { acquireLock, releaseLock, pushTelegramLane } from '../_lib/commit-feed-push.js';
import { requireCron } from '../_lib/cron-auth.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	if (!(await acquireLock())) {
		json(res, 200, { ok: true, skipped: 'locked' });
		return;
	}

	try {
		const telegram = await pushTelegramLane();
		const failed = Boolean(telegram.error);
		if (failed) console.warn('[cron] commit-feed-push lane error', { telegram });
		json(res, failed ? 502 : 200, { ok: !failed, telegram });
	} catch (err) {
		// pushTelegramLane only swallows its own GitHub-rate-limit case; a
		// transient GitHub 5xx or network blip fetching a commit page throws
		// here instead. The lane is idempotent (state lives in app_settings),
		// so reporting the failure and letting the next tick retry is correct;
		// re-throwing to wrap()'s generic handler only turned that into a raw
		// 500 and an unnecessary ops alert.
		console.warn('[cron] commit-feed-push threw', err?.message || err);
		json(res, 502, { ok: false, error: String(err?.message || err) });
	} finally {
		await releaseLock().catch(() => {});
	}
});
