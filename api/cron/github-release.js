// @ts-check
// GET /api/cron/github-release - weekly GitHub Release for nirholas/three.ws.
//
// Runs Mondays 15:00 UTC. Finds the newest published platform release (a v*
// tag), takes the changelog entries dated after it up to today from the
// data/changelog.json baked into the running image, passes them through the
// same public filter the X lane and scripts/github-release.mjs use
// (api/_lib/github-release.js is the one implementation), and publishes
// `vYYYY.MM.DD` titled "Week of YYYY-MM-DD" at the commit production runs
// (dist/build-info.json, else COMMIT_SHA, else main).
//
// Skips, always 200: no GITHUB_RELEASE_TOKEN (missing_token), tag already
// released (tag_exists), nothing user-facing since the last release
// (no_entries). A GitHub API failure answers 502 so wrapCron records a failed
// heartbeat. Token: a fine-grained PAT with Contents: read and write on
// nirholas/three.ws, as GITHUB_RELEASE_TOKEN on the Cloud Run service.

import { error, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { loadBundledEntries, deployedSha, runWeeklyRelease } from '../_lib/github-release.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	let entries;
	try {
		entries = loadBundledEntries();
	} catch (err) {
		error(res, 500, 'feed_unreadable', String(err?.message || err));
		return;
	}

	try {
		const result = await runWeeklyRelease({ token: process.env.GITHUB_RELEASE_TOKEN, entries, sha: deployedSha() });
		console.log('[cron] github-release', result);
		json(res, 200, result);
	} catch (err) {
		console.warn('[cron] github-release failed', String(err?.message || err));
		json(res, 502, { ok: false, error: String(err?.message || err) });
	}
});
