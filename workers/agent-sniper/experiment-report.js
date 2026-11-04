// Pure math for scripts/sniper-experiment-report.mjs: per-arm net P&L after
// model-call cost, and how much of each trailing-stop winner's peak was given
// back before the stop fired. No I/O so the numbers are testable.

const LAMPORTS_PER_SOL = 1e9;
const num = (v) => {
	if (v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

/**
 * Fraction of a position's peak value surrendered before it exited:
 * (peak - exit) / peak. Null when peak or exit is unknown or peak is not positive.
 */
export function givebackFraction(position) {
	const peak = num(position.peak_value_lamports);
	const exit = num(position.exit_quote_lamports);
	if (peak == null || exit == null || peak <= 0) return null;
	return Math.max(0, (peak - exit) / peak);
}

export function median(values) {
	const v = values.filter((x) => x != null).sort((a, b) => a - b);
	if (!v.length) return null;
	const mid = v.length >> 1;
	return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Summarize one arm. `positions` are closed live rows; `judgeCostUsd` is the sum
 * of priced verdict calls attributed to the arm's model; `verdictsPriced` and
 * `verdictsUnpriced` say how much of the verdict volume that cost covers.
 */
export function summarizeArm({ positions, judgeCostUsd = 0, verdictsPriced = 0, verdictsUnpriced = 0, solUsd }) {
	const pnlLamports = positions.reduce((s, p) => s + (num(p.realized_pnl_lamports) ?? 0), 0);
	const pnlSol = pnlLamports / LAMPORTS_PER_SOL;
	const pnlUsd = solUsd ? pnlSol * solUsd : null;
	const trailing = positions.filter((p) => p.exit_reason === 'trailing_stop');
	return {
		closed: positions.length,
		trailingStops: trailing.length,
		trailingPnlSol: trailing.reduce((s, p) => s + (num(p.realized_pnl_lamports) ?? 0), 0) / LAMPORTS_PER_SOL,
		medianGiveback: median(trailing.map(givebackFraction)),
		pnlSol,
		pnlUsd,
		judgeCostUsd,
		verdictsPriced,
		verdictsUnpriced,
		netUsd: pnlUsd == null ? null : pnlUsd - judgeCostUsd,
	};
}
