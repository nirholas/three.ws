/**
 * Pure maths for the protocol dashboards. No I/O, so it is unit-tested directly
 * (tests/protocol-dashboard.test.mjs).
 */

/**
 * Impermanent loss of a constant-product LP position versus holding, as a
 * fraction (0 to -1). `ratio` is the end price of token0 in token1 divided by
 * its start price. IL = 2*sqrt(r)/(1+r) - 1, always <= 0, and 0 at r = 1.
 */
export function impermanentLoss(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return (2 * Math.sqrt(ratio)) / (1 + ratio) - 1;
}

/**
 * Fees versus impermanent loss over a window. `feeApyPct` is the annualised base
 * fee yield in percent; the fee return for `days` is simple (not compounded)
 * pro-rata. Returns percentages: { feePct, ilPct, netPct, verdict }.
 */
export function lpProfitability({ feeApyPct, days, ratio }) {
  const il = impermanentLoss(ratio);
  if (il == null || !Number.isFinite(feeApyPct) || !(days > 0)) return null;
  const feePct = (feeApyPct * days) / 365;
  const ilPct = il * 100;
  const netPct = feePct + ilPct;
  return { feePct, ilPct, netPct, verdict: netPct >= 0 ? 'fees-win' : 'il-wins' };
}

/** Borrow / supply as a 0-1 utilization, or null when nothing is supplied. */
export function utilization(totalSupplyUsd, totalBorrowUsd) {
  if (!(totalSupplyUsd > 0) || !Number.isFinite(totalBorrowUsd) || totalBorrowUsd < 0) return null;
  return Math.min(1, totalBorrowUsd / totalSupplyUsd);
}

/** Percent change of the last point versus the point `days` earlier. series: [[tsSeconds, value]]. */
export function seriesChangePct(series, days) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const last = series[series.length - 1];
  const target = last[0] - days * 86400;
  let base = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i][0] <= target) { base = series[i]; break; }
  }
  if (!base || !(base[1] > 0)) return null;
  return ((last[1] - base[1]) / base[1]) * 100;
}

/** Keep at most `max` evenly spaced points, always including the last. */
export function downsample(series, max) {
  if (!Array.isArray(series) || series.length <= max) return series || [];
  const step = (series.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(series[Math.round(i * step)]);
  return out;
}

/** Chain TVL keys from DeFiLlama's currentChainTvls, dropping the borrowed/staking/pool2 side-channels. */
export function chainTvlRows(currentChainTvls) {
  const rows = [];
  for (const [key, value] of Object.entries(currentChainTvls || {})) {
    if (!Number.isFinite(value) || value <= 0) continue;
    if (/-(borrowed|staking|pool2|vesting|treasury)$/i.test(key) || ['borrowed', 'staking', 'pool2', 'treasury', 'vesting'].includes(key)) continue;
    rows.push({ chain: key, tvl: value });
  }
  const total = rows.reduce((s, r) => s + r.tvl, 0);
  return rows
    .sort((a, b) => b.tvl - a.tvl)
    .map((r) => ({ ...r, share: total > 0 ? r.tvl / total : 0 }));
}
