// Resolver: event_leaderboard. Winner = rank 1 of the event quest line's board at
// the window end, using the board's own ranking (runs, then event gold, then who
// reached it first, then account key), which is total, so it never ties.

import { pending, voided, won, findOutcome, refHash, iso, ruleOf } from './common.js';

export const kind = 'event_leaderboard';

export function describe() {
	return 'Resolves to the player ranked first on the event leaderboard when the event window ends. Players are ranked by completed event jobs, then event gold earned, then whoever reached that score first. If nobody scored the market is void and picks are refunded; if the leader was not one of the listed entrants the market is also void.';
}

async function defaultDeps() {
	const [store, board, cfg] = await Promise.all([
		import('../../event-leaderboard-store.js'),
		import('../../../../multiplayer/src/event-leaderboard.js'),
		import('../../event-config.js'),
	]);
	return { readEventRecords: store.readEventRecords, rankEventBoard: board.rankEventBoard, eventConfig: cfg.eventConfig };
}

export async function resolve(market, { now = Date.now(), deps } = {}) {
	const d = deps || (await defaultDeps());
	const eventId = market.source_ref;
	if (!eventId) return voided('invalid_source_ref', { source_ref: null });

	const rule = ruleOf(market);
	const cfg = d.eventConfig(now);
	const configured = cfg && cfg.id === eventId ? cfg : null;
	const endMs = new Date(rule.ends_at || (configured ? configured.endsAt : market.resolves_at)).getTime();
	if (!Number.isFinite(endMs)) return voided('no_window_end', { event_id: eventId });
	const base = { event_id: eventId, window_end: iso(endMs) };
	if (now < endMs) return pending('event_running', base);

	const { records, durable } = await d.readEventRecords(eventId);
	const ranked = d.rankEventBoard(records);
	const top = ranked.slice(0, 5).map((r) => ({ rank: r.rank, name: r.name || 'Anonymous', account_ref: refHash(r.account), runs: r.runs, cash: r.cash, last_at: iso(r.lastAt) }));
	const evidence = { ...base, players: ranked.length, total_runs: ranked.reduce((n, r) => n + r.runs, 0), top, store_durable: durable };

	if (!ranked.length) return voided('no_data', evidence);
	const winner = ranked[0];
	const outcome = findOutcome(market.outcomes, ['wallet'], winner.account);
	if (!outcome) return voided('winner_not_an_outcome', evidence);
	return won(outcome, evidence);
}
