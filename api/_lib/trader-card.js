/**
 * The trader card model: one trader reduced to what fits in someone else's page.
 *
 * `/api/sniper/trader` answers "show me everything", and for a well-traded agent
 * that is a quarter of a megabyte of history. A widget running in a stranger's
 * blog, stream overlay or link-in-bio cannot pay that, and does not need it: it
 * needs the headline record, the last few results, whatever is open right now,
 * and a way to act. This module is that projection, pure and separate from the
 * endpoint that serves it so the shape can be tested without a database.
 *
 * Every number here is copied from `computeTraderMetrics`, the same truth layer
 * the leaderboard and the profile read, so an embedded card on a third-party
 * site cannot show a record that three.ws itself would dispute.
 */

const SITE = 'https://three.ws';

/** Round to `d` places, preserving null rather than turning it into a zero. */
function round(n, d = 6) {
	if (n == null || !Number.isFinite(Number(n))) return null;
	return Number(Number(n).toFixed(d));
}

/**
 * The return multiple of a closed round-trip, derived from its realized
 * percentage rather than exit over entry: a position that took its initials out
 * first rewrote its own cost basis, so exit/entry would understate it. Matches
 * how the Live Trade Feed derives the same number.
 */
export function multipleFromPct(pct) {
	if (pct == null || !Number.isFinite(Number(pct))) return null;
	return round(1 + Number(pct) / 100, 3);
}

/** Absolute three.ws links, because the card renders on someone else's origin. */
export function cardLinks({ agentId, mint = null, size = null, window: win = '30d', ref = null }) {
	const q = (params) => {
		const u = new URLSearchParams(params);
		if (ref) u.set('ref', ref);
		const s = u.toString();
		return s ? `?${s}` : '';
	};
	return {
		profile: `${SITE}/trader/${agentId}${q({})}`,
		ghost_copy: `${SITE}/ghost-copy${q({ leader: agentId, window: win })}`,
		fork: mint ? `${SITE}/trades${q({ fork: mint, ...(size ? { fork_size: String(size) } : {}) })}` : null,
		site: `${SITE}${q({})}`,
	};
}

/**
 * Project a full `getTraderStats` result into the card payload.
 *
 * `recentLimit` closed round-trips and `openLimit` live positions is the whole
 * budget: enough to prove the record is moving, small enough that the card stays
 * a few kilobytes no matter how long the trader has been running.
 */
export function buildTraderCard(stats, { recentLimit = 3, openLimit = 2, ref = null } = {}) {
	if (!stats || !stats.agent) return null;
	const m = stats.metrics || {};
	const agentId = stats.agent.id;
	const win = stats.window;

	const recent = (stats.closed || [])
		.slice(0, recentLimit)
		.map((t) => ({
			mint: t.mint,
			symbol: t.symbol || null,
			pnl_sol: round(t.pnl_sol),
			pnl_pct: round(t.pnl_pct, 2),
			multiple: multipleFromPct(t.pnl_pct),
			exit_reason: t.exit_reason || null,
			closed_at: t.closed_at,
			moonbag_held: !!t.moonbag_held,
			tx_url: t.sell_url || t.buy_url || null,
			fork_url: cardLinks({ agentId, mint: t.mint, window: win, ref }).fork,
		}));

	const open = (stats.open || [])
		.slice(0, openLimit)
		.map((t) => ({
			mint: t.mint,
			symbol: t.symbol || null,
			entry_sol: round(t.entry_sol),
			unrealized_pct: round(t.unrealized_pct, 2),
			opened_at: t.opened_at,
			fork_url: cardLinks({ agentId, mint: t.mint, size: round(t.entry_sol, 4), window: win, ref }).fork,
		}));

	return {
		agent: {
			id: agentId,
			name: stats.agent.name || 'Unnamed trader',
			image: stats.agent.image || null,
			verified: !!m.verified,
			copiers: Number(stats.agent.copiers || 0),
		},
		network: stats.network,
		window: win,
		sol_usd: stats.sol_usd ?? null,
		stats: {
			score: m.score ?? null,
			closed: m.closed_count ?? 0,
			wins: m.wins ?? 0,
			losses: m.losses ?? 0,
			win_rate: m.win_rate ?? null,
			realized_pnl_sol: round(m.realized_pnl_sol),
			realized_pnl_usd: round(m.realized_pnl_usd, 2),
			roi_pct: m.roi_pct ?? null,
			best_pnl_pct: m.best_pnl_pct ?? null,
			max_drawdown_pct: m.max_drawdown_pct ?? null,
			open_positions: m.open_count ?? 0,
			last_active_at: m.last_active_at || null,
		},
		recent,
		open,
		links: cardLinks({ agentId, window: win, ref }),
		computed_at: new Date().toISOString(),
	};
}
