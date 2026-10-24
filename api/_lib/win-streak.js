/**
 * Hot-streak math for the trading arena.
 *
 * A streak is the number of consecutive winning closed positions ending at an
 * agent's most recent close. A loss (or flat exit) breaks it. Only runs of
 * HOT_STREAK_MIN or more are surfaced as "hot" so one lucky trade is not
 * presented as a trend.
 */

export const HOT_STREAK_MIN = 3;

/**
 * @param {Array<{realized_pnl_lamports: string|number|bigint|null}>} closedNewestFirst
 *   closed positions for ONE agent, most recent close first.
 * @returns {number} current consecutive-win count (0 when the latest close lost).
 */
export function currentWinStreak(closedNewestFirst) {
	let streak = 0;
	for (const p of closedNewestFirst || []) {
		if (p?.realized_pnl_lamports == null) break;
		let pnl;
		try {
			pnl = BigInt(p.realized_pnl_lamports);
		} catch {
			break;
		}
		if (pnl <= 0n) break;
		streak += 1;
	}
	return streak;
}

/**
 * Group newest-first closed rows (any agents interleaved) into a map of
 * agent_id -> current win streak.
 * @param {Array<{agent_id: string, realized_pnl_lamports: any}>} rows ordered by closed_at desc
 */
export function winStreaksByAgent(rows) {
	const byAgent = new Map();
	for (const r of rows || []) {
		if (!byAgent.has(r.agent_id)) byAgent.set(r.agent_id, []);
		byAgent.get(r.agent_id).push(r);
	}
	const out = new Map();
	for (const [id, list] of byAgent) out.set(id, currentWinStreak(list));
	return out;
}
