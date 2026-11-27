// @ts-check
// GET /api/cron/forge-off-crown: crown the weekly Forge-Off winner.
//
// The Forge-Off board (the "Top this week" ordering of the forge showcase) ranks
// public creations by community vote_count over the current Monday→Monday UTC
// week. When a week completes, its top-voted creation is permanent: this cron
// writes one forge_board_winners row for the just-finished week so the hall of
// fame is stable even after later votes reshuffle the live board.
//
// It is also the writer the Sketchfab showcase cron (api/cron/sketchfab-showcase)
// has been waiting on: that job's strongest candidate tier reads
// forge_board_winners, so until this cron runs the tier is empty and the
// distribution pipeline falls back to raw vote/accepted signals. Crowning
// un-starves it.
//
// Winner definition mirrors the live board (listShowcase sort='top'
// window='week'): most votes among public creations CREATED in the week, newest
// first on a tie, at least one vote. Two rules make the crown final instead of
// a snapshot of whenever the cron ran: only votes cast before the week closed
// count (so a re-run or a backfill weeks later picks the same model), and only
// an entry that is still eligible (public, not rejected, not held or blocked)
// and has passed the content screen is crowned. If the leader's screen is still
// pending the week waits; the cron runs hourly on Mondays to pick it up.
// A week with zero counted votes crowns nobody (no filler).
//
// Idempotent and permanent: the first crowning for a week_start wins and is
// never overwritten (ON CONFLICT DO NOTHING), so a re-run or a late vote can't
// rewrite history. `?week=YYYY-MM-DD` crowns a specific past week (owner
// backfill); `?dry_run=1` previews the pick without writing.
//
// Runs hourly at :07 UTC on Mondays (just after the week rolls over, retrying a
// week whose leader is still being screened). Auth: CRON_SECRET.

import { error, json, method, wrapCron } from '../_lib/http.js';
import { sql } from '../_lib/db.js';
import { forgeOffWeekStart, forgeStoreEnabled } from '../_lib/forge-store.js';
import { requireCron } from '../_lib/cron-auth.js';
import { loadWindow, pickWinner, rankBoard } from '../_lib/forge-off-standings.js';

// The Monday that starts the week we are crowning. Default: the week that just
// completed (the previous Monday relative to now). `weekParam` (YYYY-MM-DD)
// overrides for backfills: it is snapped to its own week's Monday so a mid-week
// date still resolves to a valid week boundary.
//
// An unparseable `weekParam` returns null rather than falling back to the
// default week. A crowning is permanent (ON CONFLICT DO NOTHING below), so an
// owner backfilling `?week=2026-13-99` used to silently and irreversibly crown
// the CURRENT default week instead of erroring: a typo with no undo. The caller
// turns null into a 400.
export function resolveWeekStart(weekParam) {
	if (weekParam) {
		// Strict YYYY-MM-DD. Date.parse alone is not a validator here: V8 falls back
		// to a lenient parser that happily reads `2026-07T00:00:00Z` as 1 July, so a
		// truncated backfill date would resolve to a real (wrong) week rather than
		// erroring, which is the same silent-misread this guard exists to stop.
		if (!/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) return null;
		const t = Date.parse(`${weekParam}T00:00:00Z`);
		return Number.isFinite(t) ? forgeOffWeekStart(new Date(t)) : null;
	}
	const thisWeek = forgeOffWeekStart();
	const prev = new Date(thisWeek);
	prev.setUTCDate(prev.getUTCDate() - 7);
	return prev;
}

// YYYY-MM-DD (UTC) — the DATE primary key for forge_board_winners.
function toDateKey(d) {
	return d.toISOString().slice(0, 10);
}

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	if (!forgeStoreEnabled()) {
		return json(res, 200, { ok: false, reason: 'persistence_unconfigured' });
	}

	const url = new URL(req.url || '/', 'https://three.ws');
	const dryRun = url.searchParams.get('dry_run') === '1';
	const weekParam = url.searchParams.get('week');
	const weekStart = resolveWeekStart(weekParam);
	if (!weekStart) {
		return error(res, 400, 'invalid_week', `week must be a YYYY-MM-DD date; got "${String(weekParam).slice(0, 40)}"`);
	}
	const weekKey = toDateKey(weekStart);
	const weekEnd = new Date(weekStart);
	weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

	// Top public creation made during the week, by votes cast before it closed.
	const { entries, votes } = await loadWindow({ from: weekStart, to: weekEnd });
	const pick = pickWinner(
		rankBoard(entries, votes, {
			from: weekStart,
			to: weekEnd,
			closesAt: weekEnd,
			excludeSelf: false,
			perNetworkCap: Infinity,
			ties: 'latest',
		}),
	);

	if (pick.status === 'deferred') {
		return json(res, 200, {
			ok: true,
			week_start: weekKey,
			crowned: false,
			reason: 'awaiting_content_screen',
			leader: { creation_id: pick.entry.id, votes: pick.votes },
		});
	}
	if (pick.status !== 'crowned') {
		return json(res, 200, {
			ok: true,
			week_start: weekKey,
			crowned: false,
			reason: 'no_votes_this_week',
		});
	}
	const winner = { ...pick.entry, vote_count: pick.votes };

	if (dryRun) {
		return json(res, 200, {
			ok: true,
			dry_run: true,
			week_start: weekKey,
			winner: {
				creation_id: winner.id,
				votes: Number(winner.vote_count) || 0,
				prompt: winner.prompt,
			},
		});
	}

	// First crowning for the week wins and is permanent — a re-run or a later
	// vote shuffle never rewrites it.
	const inserted = await sql`
		insert into forge_board_winners
			(week_start, creation_id, votes, prompt, glb_url, preview_image_url, model_category)
		values (
			${weekKey}, ${winner.id}, ${Number(winner.vote_count) || 0}, ${winner.prompt},
			${winner.glb_url}, ${winner.preview_image_url}, ${winner.model_category || 'other'}
		)
		on conflict (week_start) do nothing
		returning week_start
	`;

	return json(res, 200, {
		ok: true,
		week_start: weekKey,
		crowned: inserted.length > 0,
		already_crowned: inserted.length === 0,
		winner: {
			creation_id: winner.id,
			votes: Number(winner.vote_count) || 0,
			prompt: winner.prompt,
		},
	});
});
