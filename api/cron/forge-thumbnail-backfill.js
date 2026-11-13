// GET /api/cron/forge-thumbnail-backfill
//
// Steady-state drain of the Forge thumbnail coverage gap.
//
// ~79% of finished forge models ship with `preview_image_url = NULL` — the free
// NVIDIA/TRELLIS lane (the majority of all generations) is geometry-first and
// paints no reference image, and the client-side poster capture only fires while
// the maker is watching their own result. So every card that renders those
// models — the "Fresh from the Forge" showcase, the gallery, creator portfolios,
// /community, /search — falls back to a gradient placeholder, and the browse
// loop that brings people back looks broken because most of it is empty squares.
//
// Each tick claims the most-recent previewless models, renders each GLB to a
// 512² WebP with the shared headless-chromium renderer, uploads it, and fills the
// preview slot — object confirmed in R2 before the key is committed, so a card
// never points at a missing image. Fill-only: a poster the maker captured in the
// meantime always wins.
//
// Env:
//   CRON_SECRET                       required (Bearer)
//   FORGE_THUMBNAIL_RENDER_BATCH      models rendered per tick (default 8)
//   FORGE_THUMBNAIL_CONCURRENCY       parallel renders (default 2)
//
// Sizing: a render is ~3-6s, so 8 models at concurrency 2 lands ~25-40s, inside
// maxDuration=120. At */5 that is ~96 models/hour. A large legacy PNG backlog
// is drained faster with scripts/upgrade-forge-thumbnails.mjs, which runs the
// same upgradeLegacyBatch() in bulk. `?dry_run=1` reports coverage without
// rendering. Skips cleanly when forge persistence is unconfigured.

import { json, method, wrapCron } from '../_lib/http.js';
import { logger } from '../_lib/usage.js';
import { forgeStoreEnabled } from '../_lib/forge-store.js';
import { renderBatch, coverage, upgradeLegacyBatch } from '../_lib/forge-thumbs.js';
import { requireCron } from '../_lib/cron-auth.js';

export const maxDuration = 120;

const log = logger('forge-thumbnail-backfill');

const RENDER_BATCH = Math.max(0, Number(process.env.FORGE_THUMBNAIL_RENDER_BATCH || 8));
const CONCURRENCY = Math.max(1, Number(process.env.FORGE_THUMBNAIL_CONCURRENCY || 2));

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	// Renders upload to R2 and read/write the DB — no store, nothing to do.
	if (!forgeStoreEnabled()) {
		return json(res, 200, { ok: false, reason: 'persistence_unconfigured' });
	}

	const url = new URL(req.url || '/', 'https://three.ws');
	const dryRun = url.searchParams.get('dry_run') === '1';

	const cov = await coverage();
	if (dryRun) {
		return json(res, 200, { ok: true, dry_run: true, coverage: cov, render_batch: RENDER_BATCH });
	}

	const UPGRADE_BATCH = Math.max(0, Number(process.env.FORGE_THUMBNAIL_UPGRADE_BATCH || 25));
	const runUpgrade = () =>
		UPGRADE_BATCH
			? upgradeLegacyBatch({ limit: UPGRADE_BATCH }).catch((err) => {
					log.warn('upgrade_failed', { message: err?.message });
					return null;
				})
			: null;

	// Rows whose render attempts are exhausted stay "missing" forever, so gate on
	// what is still renderable, not on missing, or the upgrade never runs.
	const renderable = Math.max(0, cov.missing - (cov.exhausted || 0));
	if (RENDER_BATCH === 0 || renderable === 0) {
		const upgrade = await runUpgrade();
		return json(res, 200, { ok: true, coverage: cov, rendered: 0, upgrade, note: 'nothing to render' });
	}

	let result;
	try {
		result = await renderBatch({ limit: RENDER_BATCH, concurrency: CONCURRENCY });
	} catch (err) {
		log.warn('render_batch_failed', { message: err?.message });
		return json(res, 200, { ok: false, reason: `render_failed: ${err?.message}`, coverage: cov });
	}

	for (const r of result.results) {
		if (r.status === 'done') log.info('rendered', { id: r.id, bytes: r.bytes, ms: r.ms });
		else if (r.status === 'failed') log.warn('render_failed', { id: r.id, error: r.error });
	}
	if (result.aborted) log.warn('batch_aborted', { reason: result.aborted });

	// The exhausted ledger can count rows that have since been covered, so a
	// render tick may claim nothing. Spend that tick on the upgrade instead.
	const upgrade = result.claimed === 0 ? await runUpgrade() : null;

	return json(res, 200, {
		ok: true,
		coverage: cov,
		claimed: result.claimed,
		rendered: result.rendered,
		failed: result.failed,
		aborted: result.aborted,
		upgrade,
	});
}, { maxDurationMs: maxDuration * 1000 });
