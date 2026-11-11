// GET /api/cron/creation-describe
//
// Drains the Florence-2 describe queue (work order 819). Every finished
// creation is enqueued by materializeCreation; each tick leases the newest
// queued rows (then, with spare capacity, the newest never-described
// creations, which is the steady backfill), sends each poster to the
// model-florence2 worker and stores caption, detailed caption, tags and object
// boxes with the model version. See api/_lib/creation-descriptions.js.
//
// Env:
//   CRON_SECRET                    required (Bearer)
//   MODEL_FLORENCE2_URL            the describe service; unset = report only
//   GCP_RECONSTRUCTION_KEY         the shared worker bearer
//   CREATION_DESCRIBE_BATCH        creations per tick (default 48)
//   CREATION_DESCRIBE_CONCURRENCY  parallel describes (default 4, the
//                                  service's request concurrency)
//
// Sizing: a describe is about a second on the L4, so 48 at concurrency 4 is
// well inside the 90 s claim deadline even with a cold start (the weights are
// baked into the image). `?dry_run=1` reports coverage without describing.
// The bulk backlog is cleared faster by the GPU batch job
// (scripts/creation-descriptions-backfill.mjs --export / --import), which
// shares this ledger.

import { json, method, wrapCron } from '../_lib/http.js';
import { logger } from '../_lib/usage.js';
import { requireCron } from '../_lib/cron-auth.js';
import { forgeStoreEnabled } from '../_lib/forge-store.js';
import { describeStats, describeWorkerUrl, describeWorkerKey, runDescribeBatch } from '../_lib/creation-descriptions.js';

export const maxDuration = 120;

const log = logger('creation-describe');

const BATCH = Math.max(0, Number(process.env.CREATION_DESCRIBE_BATCH || 48));
const CONCURRENCY = Math.max(1, Number(process.env.CREATION_DESCRIBE_CONCURRENCY || 4));

export default wrapCron(
	async (req, res) => {
		if (!method(req, res, ['GET'])) return;
		if (!requireCron(req, res)) return;
		if (!forgeStoreEnabled()) return json(res, 200, { ok: false, reason: 'persistence_unconfigured' });

		const url = new URL(req.url || '/', 'https://three.ws');
		const coverage = await describeStats();
		if (url.searchParams.get('dry_run') === '1') return json(res, 200, { ok: true, dry_run: true, coverage, batch: BATCH });

		if (!describeWorkerUrl() || !describeWorkerKey()) {
			// Not an error: creations keep queueing and are described once the
			// service is wired (deploy workers/model-florence2, then set
			// MODEL_FLORENCE2_URL on the API service).
			return json(res, 200, { ok: false, reason: 'worker_unconfigured', coverage });
		}
		if (BATCH === 0) return json(res, 200, { ok: true, coverage, described: 0, note: 'batch size is 0' });

		const result = await runDescribeBatch({ limit: BATCH, concurrency: CONCURRENCY, deadlineMs: 90_000 });
		if (result.failed) log.warn('describe_failures', { failed: result.failed, claimed: result.claimed });
		return json(res, 200, {
			ok: true,
			coverage,
			claimed: result.claimed,
			described: result.described,
			failed: result.failed,
			skipped: result.skipped,
		});
	},
	{ maxDurationMs: maxDuration * 1000 },
);
