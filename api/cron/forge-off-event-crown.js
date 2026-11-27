// @ts-check
// GET /api/cron/forge-off-event-crown: crown the daily and overall winners of
// every Forge-Off themed event (data/forge-off-events.json).
//
// Each day board closes at its UTC day end; the overall board closes at the
// event end. Once a board has closed it is ranked by the shared contest rules
// (api/_lib/forge-off-standings.js): only eligible entries made inside the
// board's window, only votes cast before the close, no self-votes, at most 3
// votes per network per entry, ties to the entry published first. Because only
// pre-close votes count, a run at 00:07 and a replay a week later pick the same
// winner.
//
// Outcomes per board:
//   crowned   the top entry has at least one counted vote and a clear content
//             screen; written once and never changed (ON CONFLICT DO NOTHING).
//   deferred  the top entry's content screen is still pending; nothing is
//             written and the next hourly run tries again.
//   (nothing) no entries or no counted votes: the board ends with no winner.
// Boards already crowned are skipped before any ranking, so running the cron
// twice crowns each board once.
//
// `?dry_run=1` previews without writing. `?now=<ISO>` replays a past moment
// (owner backfill and tests). Runs hourly at :07 UTC. Auth: CRON_SECRET.

import { error, json, method, wrapCron } from '../_lib/http.js';
import { sql } from '../_lib/db.js';
import { forgeStoreEnabled } from '../_lib/forge-store.js';
import { requireCron } from '../_lib/cron-auth.js';
import { closedDays, eventPhase, listEvents } from '../_lib/forge-off-events.js';
import { loadEventWinners, loadWindow, pickWinner, rankBoard } from '../_lib/forge-off-standings.js';

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

	// Every closed board of every event, before touching the database.
	const pending = [];
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
		if (boards.length) pending.push({ event, boards });
	}

	const crowned = [];
	const deferred = [];
	if (!pending.length) {
		return json(res, 200, { ok: true, dry_run: dryRun, now: now.toISOString(), crowned, deferred });
	}

	const already = await loadEventWinners(pending.map((p) => p.event.slug));
	for (const { event, boards } of pending) {
		const open = boards.filter((b) => !already.has(`${event.slug}/${b.key}`));
		if (!open.length) continue;
		// One read covers every board of the event: day windows sit inside it.
		const { entries, votes } = await loadWindow({ from: event.start, to: event.end });
		for (const b of open) {
			const pick = pickWinner(rankBoard(entries, votes, { from: b.from, to: b.to, closesAt: b.to }));
			if (pick.status === 'deferred') {
				deferred.push({
					event_slug: event.slug,
					board_key: b.key,
					creation_id: pick.entry.id,
					votes: pick.votes,
					reason: 'awaiting_content_screen',
				});
				continue;
			}
			if (pick.status !== 'crowned') continue;
			const winner = pick.entry;
			const entry = {
				event_slug: event.slug,
				board_key: b.key,
				theme: b.theme,
				creation_id: winner.id,
				votes: pick.votes,
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
					${event.slug}, ${b.key}, ${b.theme}, ${winner.id}, ${pick.votes}, ${winner.prompt},
					${winner.glb_url}, ${winner.preview_image_url}, ${winner.model_category || 'other'}
				)
				on conflict (event_slug, board_key) do nothing
				returning board_key
			`;
			if (inserted.length > 0) crowned.push(entry);
		}
	}

	return json(res, 200, { ok: true, dry_run: dryRun, now: now.toISOString(), crowned, deferred });
});
