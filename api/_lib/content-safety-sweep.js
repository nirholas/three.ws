// The recurring half of the public-listing safety screen. Run by
// /api/cron/content-safety-sweep every few minutes. Three jobs, in order:
//
//   1. Promote   a maker asked for public (publish_requested_at) and the screen
//                could not answer at request time. Retry; a clear verdict makes
//                the model public, a blocked one forces it private, and a request
//                still undecided after HOLD_AFTER_MS goes to the admin queue as
//                'held' with an ops alert (so an outage never strands one silently).
//   2. Backfill  models that were already public before the screen existed
//                (safety_status null). A blocked verdict takes them down; an
//                undecided one is left alone and retried on a later run.
//   3. Alert     when every screen in a run came back undecided, the screen
//                itself is down (a retired model, an exhausted key, a billing
//                lock). That is the exact failure that silently disabled
//                publish-safety.js on 2026-11-16, so it pages instead of hiding.

import { sql } from './db.js';
import { sendOpsAlert } from './alerts.js';
import { setCreationVisibility } from './forge-store.js';
import { HOLD_AFTER_MS, screenAndRecord } from './content-safety-store.js';

const CONCURRENCY = 3;

async function mapLimit(items, limit, fn) {
	const out = [];
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (i < items.length) {
				const idx = i++;
				out[idx] = await fn(items[idx]);
			}
		}),
	);
	return out;
}

async function promote(row, deps) {
	const out = await deps.setVisibility({ id: row.id, moderator: true, visibility: 'public' });
	if (out.outcome === 'updated') {
		await sql`update forge_creations set publish_requested_at = null where id = ${row.id}`;
		return 'promoted';
	}
	return 'promote_failed';
}

/**
 * @param {{ promoteLimit?: number, backfillLimit?: number, now?: number }} [opts]
 * @param {{ screen?: Function, setVisibility?: Function, alert?: Function }} [deps] test seams
 */
export async function sweepContentSafety({ promoteLimit = 20, backfillLimit = 10, now = Date.now() } = {}, deps = {}) {
	const d = { setVisibility: setCreationVisibility, alert: sendOpsAlert, ...deps };
	const screenOpts = d.screen ? { screen: d.screen } : {};
	const stats = { promoted: 0, blocked: 0, held: 0, cleared: 0, undecided: 0, backfilled: 0, errors: 0 };

	const requested = await sql`
		select id, prompt, preview_image_url, source_image_urls, safety_status, publish_requested_at
		from forge_creations
		where publish_requested_at is not null and status = 'done'
			and visibility is distinct from 'public'
			and (safety_status is null or safety_status in ('pending', 'clear'))
		order by publish_requested_at
		limit ${promoteLimit}
	`;
	await mapLimit(requested, CONCURRENCY, async (row) => {
		if (row.safety_status === 'clear') {
			(await promote(row, d)) === 'promoted' ? stats.promoted++ : stats.errors++;
			return;
		}
		const result = await screenAndRecord(row, { ...screenOpts, requested: true });
		if (result.verdict === 'clear') {
			(await promote(row, d)) === 'promoted' ? stats.promoted++ : stats.errors++;
		} else if (result.verdict === 'blocked') {
			stats.blocked++;
		} else if (result.heldForReview) {
			stats.held++;
		} else {
			stats.undecided++;
			if (now - new Date(row.publish_requested_at).getTime() > HOLD_AFTER_MS) {
				await sql`update forge_creations set safety_status = 'held', updated_at = now() where id = ${row.id} and safety_status = 'pending'`;
				await d.alert(
					'⚠️ Forge model held for manual safety review',
					`creation ${row.id} could not be screened for ${Math.round(HOLD_AFTER_MS / 3_600_000)}h (${(result.reasons || []).join('; ') || 'screen unavailable'}). Review with npm run forge:safety -- --prod-env.`,
					{ signature: `content-safety:held:${row.id}`, severity: 'warn' },
				);
				stats.held++;
			}
		}
	});

	const unscreened = await sql`
		select id, prompt, preview_image_url, source_image_urls
		from forge_creations
		where safety_status is null and status = 'done'
			and (visibility is null or visibility = 'public')
			and coalesce(internal, false) = false
		order by safety_checked_at nulls first, created_at desc
		limit ${backfillLimit}
	`;
	await mapLimit(unscreened, CONCURRENCY, async (row) => {
		const result = await screenAndRecord(row, screenOpts);
		stats.backfilled++;
		if (result.verdict === 'clear') stats.cleared++;
		else if (result.verdict === 'blocked') stats.blocked++;
		else stats.undecided++;
	});

	const screened = requested.length + unscreened.length;
	if (screened >= 3 && stats.undecided === screened) {
		await d.alert(
			'⚠️ Content safety screen is not answering',
			`${screened} models were screened this run and every one came back undecided. Public listings are paused until a screen answers. Check NVIDIA_API_KEY and the vision chain (api/_lib/vision.js).`,
			{ signature: 'content-safety:screen-down', severity: 'warn' },
		);
	}
	return { ...stats, requested: requested.length, unscreened: unscreened.length };
}
