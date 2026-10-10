// Resolver: arena_tournament. Winner = rank 1 of the tournament's final standings.
// Reads the same loadStandings layer the Arena page, the share card and the
// on-chain podium attestation use, as of the end of the window, so the market can
// never disagree with the board.

import { pending, voided, won, findOutcome, iso } from './common.js';

export const kind = 'arena_tournament';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function describe() {
	return 'Resolves to the entrant ranked first on the tournament\'s final standings once the window has closed and the board is frozen. The board ranks by the tournament\'s own scoring metric, then realized P&L, then closed-trade count; an entrant with no closed trade never outranks one that traded. If nobody traded, or the top two are level on all three measures, the market is void and picks are refunded. A cancelled tournament voids the market.';
}

async function defaultDeps() {
	const [store, engine] = await Promise.all([import('../../tournament-store.js'), import('../../tournament-engine.js')]);
	return { getTournament: store.getTournament, loadStandings: engine.loadStandings };
}

function row(s) {
	return {
		rank: s.rank,
		agent_id: s.agent_id,
		name: s.agent_name,
		score: s.score_value,
		realized_pnl_sol: s.metrics?.realized_pnl_sol ?? null,
		closed_trades: s.in_window_trades,
	};
}

export async function resolve(market, { now = Date.now(), deps } = {}) {
	const d = deps || (await defaultDeps());
	const id = market.source_ref;
	if (!UUID_RE.test(String(id || ''))) return voided('invalid_source_ref', { source_ref: id ?? null });

	const t = await d.getTournament(id);
	if (!t) return voided('source_missing', { tournament_id: id });
	const base = { tournament_id: t.id, name: t.name, status: t.status, scoring: t.scoring, window: { start: iso(t.starts_at), end: iso(t.ends_at) } };
	if (t.status === 'cancelled') return voided('event_cancelled', base);

	const endMs = new Date(t.ends_at).getTime();
	if (now < endMs) return pending('event_running', base);
	if (!['closed', 'settled'].includes(t.status)) return pending('awaiting_finalization', base);

	const view = await d.loadStandings(t, { now: endMs + 1 });
	const traded = view.standings.filter((s) => s.rank != null && s.in_window_trades > 0);
	const evidence = { ...base, standings_computed_at: iso(view.computed_at), entrants: view.standings.filter((s) => s.entry_status !== 'withdrawn').length, top: traded.slice(0, 5).map(row) };

	if (!traded.length) return voided('no_data', evidence);
	const [first, second] = traded;
	if (second && second.score_value === first.score_value
		&& (second.metrics?.realized_pnl_sol ?? 0) === (first.metrics?.realized_pnl_sol ?? 0)
		&& second.in_window_trades === first.in_window_trades) {
		return voided('tie', evidence);
	}
	const outcome = findOutcome(market.outcomes, ['agent'], first.agent_id);
	if (!outcome) return voided('winner_not_an_outcome', { ...evidence, winner: row(first) });
	return won(outcome, { ...evidence, winner: row(first) });
}
