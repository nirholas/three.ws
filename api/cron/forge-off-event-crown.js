// @ts-check
// GET /api/cron/forge-off-event-crown: crown the daily and overall winners of
// every Forge-Off themed event (data/forge-off-events.json).
//
// A day that has closed is crowned with the top-voted public creation made
// inside that UTC day (at least one vote), recorded with the day's theme. Once
// the whole event has closed, the overall winner is the top-voted creation made
// anywhere in the event window. Zero votes crowns nobody. Idempotent and
// permanent: the first crowning for (event, board) wins (ON CONFLICT DO NOTHING).
//
// The weekly crown (api/cron/forge-off-crown) is untouched and keeps running
// whether or not an event is active.
//
// `?dry_run=1` previews without writing. `?now=<ISO>` replays a past moment
// (owner backfill and tests). Runs daily 00:07 UTC. Auth: CRON_SECRET.

import { error, json, method, wrapCron } from '../_lib/http.js';
import { sql } from '../_lib/db.js';
import { forgeStoreEnabled } from '../_lib/forge-store.js';
import { requireCron } from '../_lib/cron-auth.js';
import { closedDays, eventPhase, listEvents } from '../_lib/forge-off-events.js';

async function topIn(from, to) {
	const rows = await sql`
		select id, prompt, glb_url, preview_image_url, model_category, vote_count
		from forge_creations
		where status = 'done' and glb_url is not null
			and (outcome is null or outcome != 'rejected')
			and (visibility is null or visibility = 'public')
			and created_at >= ${from.toISOString()}::timestamptz
			and created_at < ${to.toISOString()}::timestamptz
			and vote_count >= 1
		order by vote_count desc, created_at desc
		limit 1
	`;
	return rows[0] || null;
}

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	if (!forgeStoreEnabled()) {
		return json(res, 200, { ok: false, reason: 'persistence_unconfigured' });
	}

	const url = new URL(req.url || '/', 'https://three.ws');
	const dryRun = url.searchParams.get('dry_run') === '1';
	const nowParam = url.searchParams.get('now');
	let now = new Date();
	if (nowParam) {
		const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(nowParam) ? Date.parse(nowParam) : NaN;
		if (!Number.isFinite(t)) {
			return error(res, 400, 'invalid_now', 'now must be an ISO UTC timestamp like 2026-11-14T00:07:00Z');
		}
		now = new Date(t);
	}

	const crowned = [];
	for (const event of listEvents()) {
		const boards = closedDays(event, now).map((d) => ({
			key: `day-${d.index}`,
			theme: d.theme,
			from: d.start,
			to: d.end,
		}));
		if (eventPhase(event, now) === 'ended') {
			boards.push({ key: 'overall', theme: event.title, from: event.start, to: event.end });
		}
		for (const b of boards) {
			const winner = await topIn(b.from, b.to);
			if (!winner) continue;
			const entry = {
				event_slug: event.slug,
				board_key: b.key,
				theme: b.theme,
				creation_id: winner.id,
				votes: Number(winner.vote_count) || 0,
				prompt: winner.prompt,
			};
			if (dryRun) {
				crowned.push(entry);
				continue;
			}
			const inserted = await sql`
				insert into forge_event_winners
					(event_slug, board_key, theme, creation_id, votes, prompt, glb_url, preview_image_url, model_category)
				values (
					${event.slug}, ${b.key}, ${b.theme}, ${winner.id}, ${entry.votes}, ${winner.prompt},
					${winner.glb_url}, ${winner.preview_image_url}, ${winner.model_category || 'other'}
				)
				on conflict (event_slug, board_key) do nothing
				returning board_key
			`;
			if (inserted.length > 0) crowned.push(entry);
		}
	}

	return json(res, 200, { ok: true, dry_run: dryRun, now: now.toISOString(), crowned });
});
