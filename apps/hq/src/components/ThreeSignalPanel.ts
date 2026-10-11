import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchThreeSignal, THREE_MINT, THREE_SOLSCAN_URL } from '@/services/three-signal';
import type { ThreeSignalPoint, ThreeSignalResponse } from '@/types';

const REFRESH_MS = 3 * 60_000;

function fmtUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return 'n/a';
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function fmtPrice(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return 'n/a';
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  if (v >= 0.0001) return `$${v.toFixed(6)}`;
  return `$${v.toPrecision(3)}`;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return 'n/a';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function changeClass(v: number | null): string {
  if (v == null) return 'three-neutral';
  if (v > 0.05) return 'three-up';
  if (v < -0.05) return 'three-down';
  return 'three-neutral';
}

function fmtAge(seconds: number | null): string {
  if (seconds == null) return '';
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function sparkline(history: ThreeSignalPoint[]): string {
  const pts = history
    .filter((p) => p.price_usd != null && Number.isFinite(p.price_usd))
    .map((p) => ({ t: new Date(p.ts).getTime(), v: p.price_usd as number }))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return '';
  const W = 240;
  const H = 48;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const coords = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - 3 - ((p.v - min) / span) * (H - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = pts[pts.length - 1]!.v >= pts[0]!.v;
  const cls = up ? 'three-spark-up' : 'three-spark-down';
  return `
    <svg class="three-spark ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="$THREE price, last ${pts.length} samples">
      <polyline class="three-spark-fill" points="0,${H} ${coords.join(' ')} ${W},${H}"></polyline>
      <polyline class="three-spark-line" points="${coords.join(' ')}"></polyline>
    </svg>`;
}

export class ThreeSignalPanel extends Panel {
  private data: ThreeSignalResponse | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'three-signal',
      title: '$THREE',
      showCount: false,
      infoTooltip: 'Live $THREE market signal from the three.ws API. Refreshes every 3 minutes.',
    });
    this.render();
    void this.fetchData();
    this.refreshInterval = setInterval(() => void this.fetchData(), REFRESH_MS);
  }

  public destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    try {
      this.data = await fetchThreeSignal(signal);
      this.error = null;
      this.setDataBadge(this.data.stale || !this.data.latest ? 'cached' : 'live');
    } catch (err: unknown) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch the $THREE signal';
      this.setDataBadge('unavailable');
    } finally {
      if (!signal.aborted) {
        this.loading = false;
        this.render();
      }
    }
  }

  private render(): void {
    if (this.loading) {
      this.showLoading('Loading $THREE signal');
      return;
    }
    if (this.error && !this.data) {
      this.setContent(`
        <div class="three-state">
          <div class="three-state-title">Signal unavailable</div>
          <div class="three-state-body">${escapeHtml(this.error)}</div>
          <button type="button" class="three-retry" data-action="retry">Retry</button>
        </div>`);
      this.bind();
      return;
    }
    const d = this.data;
    if (!d || !d.latest) {
      this.setContent(`
        <div class="three-state">
          <div class="three-state-title">No signal yet</div>
          <div class="three-state-body">three.ws has not published a $THREE reading. This panel checks again every 3 minutes.</div>
          ${this.footer()}
        </div>`);
      this.bind();
      return;
    }

    const l = d.latest;
    const stale = d.stale
      ? `<span class="three-stale" title="The newest reading is older than expected">Stale${d.age_seconds != null ? ` (${escapeHtml(fmtAge(d.age_seconds))})` : ''}</span>`
      : '';
    const refreshWarn = this.error
      ? `<div class="three-warn">Refresh failed: ${escapeHtml(this.error)}. Showing the last reading.</div>`
      : '';
    const headline = l.headline
      ? `<div class="three-headline">${escapeHtml(l.headline)}</div>`
      : '';
    const signalChip = l.signal
      ? `<span class="three-chip">${escapeHtml(String(l.signal))}${l.confidence != null ? ` ${escapeHtml(String(Math.round(l.confidence <= 1 ? l.confidence * 100 : l.confidence)))}%` : ''}</span>`
      : '';

    this.setContent(`
      <div class="three-panel">
        ${refreshWarn}
        <div class="three-top">
          <div class="three-price">${escapeHtml(fmtPrice(l.price_usd))}</div>
          <div class="three-change ${changeClass(l.change_24h)}">${escapeHtml(fmtPct(l.change_24h))} <span class="three-dim">24h</span></div>
          ${signalChip}${stale}
        </div>
        ${headline}
        ${sparkline(d.history)}
        <div class="three-stats">
          <div class="three-stat"><span class="three-stat-label">Market cap</span><span class="three-stat-val">${escapeHtml(fmtUsd(l.market_cap_usd))}</span></div>
          <div class="three-stat"><span class="three-stat-label">Liquidity</span><span class="three-stat-val">${escapeHtml(fmtUsd(l.liquidity_usd))}</span></div>
          <div class="three-stat"><span class="three-stat-label">24h volume</span><span class="three-stat-val">${escapeHtml(fmtUsd(l.volume_24h_usd))}</span></div>
        </div>
        ${this.footer()}
      </div>`);
    this.bind();
  }

  private footer(): string {
    const short = `${THREE_MINT.slice(0, 4)}...${THREE_MINT.slice(-4)}`;
    return `<div class="three-foot"><a href="${escapeHtml(THREE_SOLSCAN_URL)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(THREE_MINT)}">Solscan ${escapeHtml(short)}</a><span class="three-dim">via three.ws</span></div>`;
  }

  private bind(): void {
    this.content.querySelector<HTMLElement>('[data-action="retry"]')?.addEventListener('click', () => {
      this.loading = true;
      this.render();
      void this.fetchData();
    });
  }
}
