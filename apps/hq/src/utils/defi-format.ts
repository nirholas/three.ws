/**
 * Shared formatting utilities for DeFi panels.
 * Precision and thresholds are tuned for dense market tables.
 */

/**
 * Format a number as $1.23T, $34.5B, $340.2M, $12.5K, $1.23.
 * Precision: T→2dp, B→1dp, M→1dp, K→1dp, <1K→2dp.
 * Returns '-' for null/undefined/NaN.
 */
export function formatLargeNumber(value: number | undefined | null): string {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

/**
 * Format a percentage with explicit sign prefix: +5.20% or -3.10%.
 * Returns '-' for null/undefined/NaN.
 */
export function formatPct(value: number | undefined | null): string {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * TVL / circulating-supply formatting with higher precision for B/M tiers.
 * Precision: B→2dp, M→2dp, K→1dp, <1K→0dp.
 * Returns '-' for null/undefined/NaN.
 */
export function formatTvl(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Estimate annual earnings on a $10K position at the given APY.
 * Returns '-' for null/undefined/NaN.
 */
export function estimateEarnings(apy: number | null | undefined): string {
  if (apy === null || apy === undefined) return '-';
  const n = Number(apy);
  if (!Number.isFinite(n)) return '-';
  return `~$${(10_000 * n / 100).toFixed(0)}/yr on $10K`;
}

/** Inline CSS color value for a percentage (green positive, red negative, dim for null). */
export function pctColor(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'var(--text-dim)';
  return v >= 0 ? 'var(--green)' : 'var(--red)';
}

/**
 * Fear & Greed Index → label + hex color.
 * Colors follow the Ant Design palette.
 */
export function getFearGreedMeta(value: number): { color: string; label: string } {
  if (value <= 25) return { color: '#f5222d', label: 'Extreme Fear' };
  if (value <= 45) return { color: '#fa8c16', label: 'Fear' };
  if (value <= 55) return { color: '#8c8c8c', label: 'Neutral' };
  if (value <= 75) return { color: '#52c41a', label: 'Greed' };
  return { color: '#237804', label: 'Extreme Greed' };
}

/** Category filter presets for TopProtocols segmented control. */
export const CATEGORY_FILTERS = [
  'All', 'DEXes', 'Lending', 'Liquid Staking', 'Derivatives', 'Bridge', 'CDP',
] as const;

/**
 * Compact USD formatting for DeFi panels (no decimals at low tiers).
 * $1.2B, $34M, $12K, $500.
 * Returns '-' for null/undefined/NaN.
 */
export function formatUsd(value: number | undefined | null): string {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Higher-precision USD formatting for liquidation / OI panels.
 * $1.23B, $34.5M, $12K, $500.
 * Returns '-' for null/undefined/NaN.
 */
export function formatUsdPrecise(value: number | undefined | null): string {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Human-readable relative time from a date string.
 * "just now", "5m ago", "3h ago", "2d ago".
 */
export function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Human-readable relative time from a Unix timestamp (ms).
 * "5s ago", "3m ago", "2h ago".
 */
export function timeAgoMs(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

/**
 * Inline change-percentage HTML span with sign and color class.
 * Returns '-' span for null/undefined/NaN.
 */
export function changeHtml(val: number | null | undefined, decimals = 0): string {
  if (val === null || val === undefined) return '<span class="change-neutral">-</span>';
  const n = Number(val);
  if (!Number.isFinite(n)) return '<span class="change-neutral">-</span>';
  const cls = n > 0 ? 'change-positive' : n < 0 ? 'change-negative' : 'change-neutral';
  const sign = n > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${n.toFixed(decimals)}%</span>`;
}

/** 10-color palette for chart bars - . */
export const CHAIN_BAR_COLORS = [
  '#1677ff', '#722ed1', '#52c41a', '#fa8c16', '#eb2f96',
  '#13c2c2', '#faad14', '#2f54eb', '#a0d911', '#f5222d',
];
