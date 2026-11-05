import { escapeHtml } from '@/utils/sanitize';

export function usd(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(a < 1 ? 4 : 2)}`;
}

export function pct(v: unknown, digits = 1): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(digits)}%` : '-';
}

export function pctClass(v: unknown): string {
  return typeof v !== 'number' ? 'change-neutral' : v > 0.05 ? 'change-positive' : v < -0.05 ? 'change-negative' : 'change-neutral';
}

/** Inline SVG sparkline from [ts, value] pairs. Empty string when there is nothing to draw. */
export function sparkline(series: unknown, label: string): string {
  if (!Array.isArray(series) || series.length < 2) return '';
  const vals = (series as [number, number][]).map((p) => p[1]).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 200).toFixed(1)},${(38 - ((v - min) / span) * 34).toFixed(1)}`).join(' ');
  return `<svg class="pd-spark" viewBox="0 0 200 40" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

export function skeleton(rows = 4): string {
  return `<div class="pd-skel" aria-busy="true" aria-label="Loading">${'<div class="pd-skel-row"></div>'.repeat(rows)}</div>`;
}

export function errorWithRetry(message: string): string {
  return `<div class="pd-error" role="alert"><p>${escapeHtml(message)}</p><button type="button" class="pd-btn" data-pd-retry>Retry</button></div>`;
}

export function ageLabel(sec: number | null): string {
  if (sec == null) return '-';
  if (sec < 90) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}
