/**
 * The rivalry engine: leaderboard deltas turned into matchups.
 *
 * A leaderboard answers "who is ahead". It never answers the question people
 * actually argue about, which is "who just took whose place, and can they hold
 * it". This module derives that from the same ledger the board is computed from,
 * with no new table and no cron: it fetches every public trader's positions once
 * and computes THREE boards from that one fetch through the shared, pure
 * `computeTraderMetrics`:
 *
 *   now    · the current window, exactly what /api/sniper/leaderboard ranks
 *   past   · the same window length measured at the lookback cutoff, built from
 *            positions that had already closed by then, so it is what the board
 *            really said back then rather than a snapshot nobody stored
 *   since  · only the round-trips closed inside the lookback, which is momentum:
 *            who is actually gaining ground right now
 *
 * Rank changes between `now` and `past` are the events; `since` is why. Because
 * the past board is re-derived from close timestamps rather than read from a
 * snapshot table, this works retroactively from day one and cannot drift out of
 * agreement with the live board.
 *
 * The copy is deterministic, not generated. Every clause is a number from the
 * boards above, phrased in the platform's voice: no hype, no prediction, no
 * promise, and never a claim the ledger cannot back. That also makes the strip
 * instant and free to render, which a public surface refreshing every 30 seconds
 * has to be.
 */

import {
	computeTraderMetrics,
	fetchLeaderboardPositions,
	selfDealMintsByUsers,
	mintLaunchTimes,
	cachedSolUsd,
	windowStartIso,
	WINDOWS,
} from './trader-stats.js';

/** Lookback windows the rivalry feed will diff over. */
export const LOOKBACKS = new Map([
	['1h', 3_600_000],
	['24h', 86_400_000],
	['7d', 604_800_000],
]);

const WINDOW_LABEL = { '24h': '24h', '7d': '7d', '30d': '30d', all: 'all-time' };
const LOOKBACK_LABEL = { '1h': 'hour', '24h': '24 hours', '7d': '7 days' };

/** Below this many settled round-trips a "board position" is noise, not a record. */
const MIN_CLOSED = 3;

// ── formatting ──────────────────────────────────────────────────────────────

function digitsFor(abs) {
	return abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
}

export function fmtSol(n, scale = n) {
	const v = Number(n) || 0;
	// Two amounts compared in one sentence are formatted against the same scale,
	// so a line never reads "+2.00 SOL against +0.500 SOL".
	const digits = digitsFor(Math.abs(Number(scale) || 0));
	return `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(digits)} SOL`;
}

/** Gaps are distances, so they never carry a sign. */
export function fmtGap(n) {
	const abs = Math.abs(Number(n) || 0);
	return `${abs.toFixed(digitsFor(abs))} SOL`;
}

// ── board building (pure) ───────────────────────────────────────────────────

/**
 * Group raw board rows by agent. One pass, so the three boards below all read
 * the same objects.
 */
export function groupByAgent(rows) {
	const byAgent = new Map();
	for (const r of rows || []) {
		let g = byAgent.get(r.agent_id);
		if (!g) {
			g = {
				agent_id: r.agent_id,
				user_id: r.agent_user_id,
				name: r.agent_name || 'Unnamed trader',
				image: r.agent_image || r.agent_avatar || null,
				positions: [],
			};
			byAgent.set(r.agent_id, g);
		}
		g.positions.push(r);
	}
	return byAgent;
}

function closedAt(p) {
	const t = Date.parse(p.closed_at);
	return Number.isFinite(t) ? t : null;
}

/**
 * Rank one board out of grouped positions, counting only round-trips that had
 * closed inside [from, to]. Open positions are deliberately excluded from every
 * board here: the composite score is computed from realized history alone, and a
 * position that is open now was open then too, so including it would make the
 * past board disagree with itself.
 */
export function rankBoard(groups, { from = null, to = Date.now(), minClosed = MIN_CLOSED, solUsd = null, selfDealByUser = null, mintCreatedAt = null } = {}) {
	const rows = [];
	for (const g of groups.values()) {
		const inRange = g.positions.filter((p) => {
			if (p.status !== 'closed') return false;
			const t = closedAt(p);
			if (t == null) return false;
			return t <= to && (from == null || t >= from);
		});
		if (inRange.length < minClosed) continue;
		const m = computeTraderMetrics(inRange, {
			solUsd,
			selfDealMints: (selfDealByUser && selfDealByUser.get(g.user_id)) || null,
			mintCreatedAt,
		});
		if (!m.closed_count) continue;
		rows.push({
			agent_id: g.agent_id,
			name: g.name,
			image: g.image,
			score: m.score,
			verified: m.verified,
			closed: m.closed_count,
			wins: m.wins,
			win_rate: m.win_rate,
			realized_pnl_sol: m.realized_pnl_sol,
			realized_pnl_usd: m.realized_pnl_usd,
			best_pnl_pct: m.best_pnl_pct,
			max_drawdown_pct: m.max_drawdown_pct,
			top_coin: m.top_coin,
			top_coins: m.top_coins,
			last_active_at: m.last_active_at,
		});
	}
	rows.sort((a, b) => b.score - a.score || b.realized_pnl_sol - a.realized_pnl_sol);
	return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

// ── the matchups (pure) ─────────────────────────────────────────────────────

/**
 * Coins both traders booked a result on, from each side's top-earning coins.
 * Deliberately narrow: `top_coins` is the per-agent breakdown the profile already
 * shows, so an overlap here is one both profiles can be checked against. An empty
 * list means "no shared coin among their best", never "they never overlapped".
 */
export function sharedCoins(a, b, limit = 2) {
	const bySymbol = new Map();
	for (const c of b.top_coins || []) if (c && c.mint) bySymbol.set(c.mint, c);
	const out = [];
	for (const c of a.top_coins || []) {
		const other = c && c.mint ? bySymbol.get(c.mint) : null;
		if (!other) continue;
		out.push({
			mint: c.mint,
			symbol: c.symbol || other.symbol || null,
			leader_pnl_sol: Number(c.pnl_sol || 0),
			chaser_pnl_sol: Number(other.pnl_sol || 0),
		});
		if (out.length >= limit) break;
	}
	return out;
}

/**
 * The copy. `leader` is whoever is ranked higher right now, `chaser` is the agent
 * one place below. Every sentence is assembled from the numbers on the rivalry
 * object, so a reader can check any of them against the two profiles it links to.
 */
export function rivalryCopy(r) {
	const windowLabel = WINDOW_LABEL[r.window] || r.window;
	const lookbackLabel = LOOKBACK_LABEL[r.lookback] || r.lookback;
	const lead = r.leader, chase = r.chaser;
	const gap = fmtGap(r.gap_sol);

	let headline;
	if (r.kind === 'overtake') {
		headline = `${lead.name} passed ${chase.name} on the ${windowLabel} board.`;
	} else if (r.kind === 'debut') {
		headline = `${lead.name} arrived at number ${lead.rank} on the ${windowLabel} board, above ${chase.name}.`;
	} else if (r.gap_sol > 0) {
		headline = `${chase.name} is ${gap} behind ${lead.name}.`;
	} else if (r.gap_sol < 0) {
		// The board ranks on the composite score, not on P&L, so the trader one place
		// down can be the one holding more SOL. Saying "behind" there would be false;
		// the score gap is the real reason they sit below.
		headline = `${chase.name} has out-earned ${lead.name} by ${gap} and still ranks below.`;
	} else {
		headline = `${chase.name} and ${lead.name} are level on P&L, ${Math.abs(r.gap_score)} apart on score.`;
	}

	const moveL = r.since.leader_pnl_sol, moveC = r.since.chaser_pnl_sol;
	const scale = Math.max(Math.abs(moveL), Math.abs(moveC));
	const sol = (n) => fmtSol(n, scale);
	// A trader who settled nothing inside the lookback has not "booked 0.000 SOL":
	// they were not in the market. Saying it the other way round is the difference
	// between a fact and a number that reads like one.
	let subline;
	if (moveL === 0 && moveC === 0) {
		subline = `Neither has settled a trade in the last ${lookbackLabel}. The gap stands at ${gap}.`;
	} else if (moveC === 0) {
		subline = `${chase.name} has not settled a trade in the last ${lookbackLabel}. ${lead.name} booked ${sol(moveL)}.`;
	} else if (moveL === 0) {
		subline = `${lead.name} has not settled a trade in the last ${lookbackLabel}. ${chase.name} booked ${sol(moveC)}.`;
	} else if (moveC > moveL) {
		subline = `${chase.name} booked ${sol(moveC)} in the last ${lookbackLabel} against ${sol(moveL)}, and is closing.`;
	} else if (moveL > moveC) {
		subline = `${lead.name} booked ${sol(moveL)} in the last ${lookbackLabel} against ${sol(moveC)}, and is pulling away.`;
	} else {
		subline = `Both booked ${sol(moveL)} in the last ${lookbackLabel}. The gap stands at ${gap}.`;
	}

	return { headline, subline };
}

/**
 * Turn three ranked boards into the matchup list. Every trader on the current
 * board is paired with the one directly above them, which is the only rivalry
 * that can change hands on the next settled trade.
 */
export function pairRivalries({ now, past, since, window, lookback, limit = 6 }) {
	const pastRank = new Map((past || []).map((r) => [r.agent_id, r.rank]));
	const sincePnl = new Map((since || []).map((r) => [r.agent_id, r.realized_pnl_sol]));
	const out = [];

	for (let i = 1; i < now.length; i++) {
		const leader = now[i - 1];
		const chaser = now[i];
		const pl = pastRank.get(leader.agent_id) ?? null;
		const pc = pastRank.get(chaser.agent_id) ?? null;

		let kind = 'chase';
		if (pl == null) kind = 'debut';
		else if (pc != null && pl > pc) kind = 'overtake';

		const r = {
			kind,
			window,
			lookback,
			leader: { ...leader, was_rank: pl },
			chaser: { ...chaser, was_rank: pc },
			// Signed, leader minus chaser: negative means the trader one place down
			// holds more realized SOL and sits below on the composite score alone.
			gap_sol: Number((leader.realized_pnl_sol - chaser.realized_pnl_sol).toFixed(6)),
			gap_score: leader.score - chaser.score,
			since: {
				leader_pnl_sol: Number(sincePnl.get(leader.agent_id) || 0),
				chaser_pnl_sol: Number(sincePnl.get(chaser.agent_id) || 0),
			},
			shared_coins: sharedCoins(leader, chaser),
			links: {
				leader_profile: `/trader/${leader.agent_id}`,
				chaser_profile: `/trader/${chaser.agent_id}`,
				ghost_copy_leader: `/ghost-copy?leader=${leader.agent_id}&window=${window}`,
			},
		};
		Object.assign(r, rivalryCopy(r));
		out.push(r);
	}

	// Newsworthiness order: a place that actually changed hands beats a standing
	// gap, and among standing gaps the tightest one is the one worth watching.
	const heat = (r) => {
		if (r.kind === 'overtake') return 3;
		if (r.kind === 'debut') return 2;
		return 1;
	};
	const movement = (r) => Math.abs(r.since.leader_pnl_sol) + Math.abs(r.since.chaser_pnl_sol);
	out.sort((a, b) => heat(b) - heat(a) || movement(b) - movement(a) || Math.abs(a.gap_sol) - Math.abs(b.gap_sol));
	return out.slice(0, limit);
}

// ── the read ────────────────────────────────────────────────────────────────

/**
 * Live rivalries for one network. One position fetch, three boards, no writes.
 */
export async function getRivalries({
	network = 'mainnet', window = '7d', lookback = '24h', limit = 6, now = Date.now(),
} = {}) {
	const win = WINDOWS.has(window) ? window : '7d';
	const back = LOOKBACKS.has(lookback) ? lookback : '24h';
	const cutoff = now - LOOKBACKS.get(back);

	// The past board is the same window length measured at the cutoff, so the
	// fetch has to reach back to whichever of the two window starts is earlier.
	const startNow = windowStartIso(win, now);
	const startPast = windowStartIso(win, cutoff);
	const fetchStart = startNow && startPast ? (Date.parse(startPast) < Date.parse(startNow) ? startPast : startNow) : null;

	const rows = await fetchLeaderboardPositions({ network, start: fetchStart });
	const groups = groupByAgent(rows);
	if (!groups.size) {
		return { network, window: win, lookback: back, sol_usd: null, rivalries: [], board_size: 0, t: now };
	}

	const mints = [...new Set(rows.map((r) => r.mint).filter(Boolean))];
	const [solUsd, selfDealByUser, mintCreatedAt] = await Promise.all([
		cachedSolUsd(),
		selfDealMintsByUsers([...groups.values()].map((g) => g.user_id), network),
		mintLaunchTimes(mints, network),
	]);
	const shared = { solUsd, selfDealByUser, mintCreatedAt };

	const nowBoard = rankBoard(groups, { from: startNow ? Date.parse(startNow) : null, to: now, ...shared });
	const pastBoard = rankBoard(groups, { from: startPast ? Date.parse(startPast) : null, to: cutoff, ...shared });
	// Momentum is not a track record: a single settled round-trip inside the
	// lookback is exactly the movement this board exists to show, so the
	// three-trade floor that keeps noise off a ranking does not apply here.
	const sinceBoard = rankBoard(groups, { from: cutoff, to: now, minClosed: 1, ...shared });

	return {
		network,
		window: win,
		lookback: back,
		sol_usd: solUsd,
		board_size: nowBoard.length,
		cutoff: new Date(cutoff).toISOString(),
		min_closed: MIN_CLOSED,
		rivalries: pairRivalries({ now: nowBoard, past: pastBoard, since: sinceBoard, window: win, lookback: back, limit }),
		t: now,
	};
}
