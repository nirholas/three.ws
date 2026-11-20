// GET /api/cron/forge-storage-purge: finish deleting forge creations whose
// bucket objects storage refused to remove at delete time.
//
// forgeStore.deleteCreation takes a creation's row down even when object
// storage is down, queueing each object (or failed listing) it could not
// remove in forge_storage_purges (api/_lib/forge-storage-purges.js). /cdn/
// refuses those keys meanwhile. This cron retries the queue every 15 minutes
// and stops at the first storage outage fault, since every later entry would
// fail the same way. An entry still pending after a day raises one ops alert
// per day, because it means storage has been refusing writes that long.
//
// Auth: the shared, fail-closed cron gate (api/_lib/cron-auth.js).

import { sql } from '../_lib/db.js';
import { cors, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import { drainStoragePurges } from '../_lib/forge-storage-purges.js';

export default wrapCron(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const out = await drainStoragePurges({ limit: 300 });
	if (out.pending > 0) {
		const [stale] = await sql`
			select count(*)::int as n, min(created_at) as oldest, max(last_error) as sample_error
			from forge_storage_purges
			where purged_at is null and created_at < now() - interval '1 day'
		`;
		if (stale?.n > 0) {
			await sendOpsAlert(
				'Forge storage purges stuck',
				[
					`${stale.n} object(s) from deleted forge models are still in the bucket, oldest queued ${new Date(stale.oldest).toISOString()}.`,
					`Last storage error: ${stale.sample_error || 'none recorded'}`,
					'They are blocked on /cdn/ but still readable on the public bucket domain until storage accepts deletes.',
					'Check the S3_* credential on three-ws-api, then this cron drains the queue on its own.',
				].join('\n'),
				{ signature: `forge_storage_purge_stuck:${new Date().toISOString().slice(0, 10)}`, severity: 'warn' },
			).catch(() => {});
		}
	}
	return json(res, 200, { ok: true, ...out });
});
