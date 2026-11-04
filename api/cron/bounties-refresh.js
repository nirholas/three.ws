// GET /api/cron/bounties-refresh - pull every bounty source into bounty_listings
// and triage what is new or changed.
//
// Every source is fetched independently: one that is down is reported in the
// result and closes nothing, so an upstream outage never empties the feed. A
// run where every source failed answers 502, which wrapCron records as a failed
// heartbeat so it turns red on /api/ops/health.

import { cors, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { refreshSources, untriagedListings, saveTriage } from '../_lib/bounties/store.js';
import { triageListing } from '../_lib/bounties/triage.js';
import { contentHash } from '../_lib/bounties/normalize.js';

export const maxDuration = 120;

const TRIAGE_BATCH = 20;
const TIME_BUDGET_MS = 90_000;

export default wrapCron(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	const started = Date.now();
	const { results, expired } = await refreshSources();

	let triaged = 0;
	let triageFailed = 0;
	for (const row of await untriagedListings(TRIAGE_BATCH)) {
		if (Date.now() - started > TIME_BUDGET_MS) break;
		try {
			const { triage, model } = await triageListing(row);
			await saveTriage(row.id, { triage, hash: row.content_hash || contentHash(row), model });
			triaged += 1;
		} catch (err) {
			triageFailed += 1;
			console.warn(`[bounties-refresh] triage ${row.id}: ${err?.message || err}`);
		}
	}

	const allFailed = results.length > 0 && results.every((r) => !r.ok);
	json(res, allFailed ? 502 : 200, { ok: !allFailed, sources: results, expired, triaged, triageFailed, ms: Date.now() - started });
}, { maxDurationMs: maxDuration * 1000 });
