import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatUsdPrecise as formatUsd, timeAgoMs } from '@/utils/defi-format';

interface Liquidation {
  symbol: string;
  exchange: string;
  side: string;
  price: number;
  qty: number;
  value: number;
  time: number;
  severity: string;
}

interface SymbolStat {
  symbol: string;
  longValue: number;
  shortValue: number;
  count: number;
}

interface LiqResult {
  timestamp: string;
  liquidations: Liquidation[];
  symbolStats: SymbolStat[];
  summary: {
    totalCount: number; totalValue: number; longCount: number; shortCount: number;
    longValue: number; shortValue: number; megaCount: number; largeCount: number; dominantSide: string;
  };
  unavailable?: boolean;
}

const timeAgo = timeAgoMs;

function severityColor(s: string): string {
  if (s === 'MEGA') return '#ff1744';
  if (s === 'LARGE') return '#ff9100';
  if (s === 'MEDIUM') return '#ffc107';
  return '#888';
}

function dominantSideClass(side: string): string {
  if (side === 'LONG PAIN') return 'liq-long-pain';
  if (side === 'SHORT SQUEEZE') return 'liq-short-squeeze';
  return 'liq-balanced';
}

export class LiquidationPanel extends Panel {
  private data: LiqResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private viewMode: 'feed' | 'symbols' = 'feed';

  constructor() {
    super({ id: 'liquidations', title: 'Liquidations', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 30000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.abortController?.abort();
    this.abortController = null;
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const res = await fetch('/api/liquidations', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;

      const cacheStatus = res.headers.get('X-Cache');
      this.setDataBadge(cacheStatus === 'HIT' ? 'cached' : 'live');
      this.setErrorState(false);
    } catch (err) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
      this.setDataBadge('unavailable');
      this.setErrorState(true, this.error);
    } finally {
      if (!signal.aborted) {
        this.loading = false;
        this.renderPanel();
      }
    }
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading liquidations...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }
    const d = this.data;
    if (d.unavailable) { this.showError('Liquidation data temporarily unavailable'); return; }

    this.setCount(d.summary.totalCount);

    const longPct = d.summary.totalValue > 0 ? Math.round((d.summary.longValue / d.summary.totalValue) * 100) : 50;
    const shortPct = 100 - longPct;

    const html = `
      <div class="liq-summary">
        <div class="liq-stat">
          <span class="liq-stat-value">${formatUsd(d.summary.totalValue)}</span>
          <span class="liq-stat-label">Total Liquidated</span>
        </div>
        <div class="liq-stat">
          <span class="liq-stat-value ${dominantSideClass(d.summary.dominantSide)}">${escapeHtml(d.summary.dominantSide)}</span>
          <span class="liq-stat-label">Market State</span>
        </div>
        <div class="liq-stat">
          <span class="liq-stat-value" style="color:#ff1744">${d.summary.megaCount + d.summary.largeCount}</span>
          <span class="liq-stat-label">Big Liqs</span>
        </div>
      </div>
      <div class="liq-ratio-bar">
        <div class="liq-long-bar" style="width:${longPct}%" title="Longs: ${formatUsd(d.summary.longValue)}">
          <span>LONG ${longPct}%</span>
        </div>
        <div class="liq-short-bar" style="width:${shortPct}%" title="Shorts: ${formatUsd(d.summary.shortValue)}">
          <span>SHORT ${shortPct}%</span>
        </div>
      </div>
      <div class="liq-view-toggle">
        <button class="liq-toggle-btn ${this.viewMode === 'feed' ? 'active' : ''}" data-view="feed">Live Feed</button>
        <button class="liq-toggle-btn ${this.viewMode === 'symbols' ? 'active' : ''}" data-view="symbols">By Asset</button>
      </div>
      ${this.viewMode === 'feed' ? this.renderFeed(d) : this.renderSymbols(d)}
    `;

    this.setContent(html);

    this.content.querySelectorAll('.liq-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.viewMode = ((btn as HTMLElement).dataset.view || 'feed') as 'feed' | 'symbols';
        this.renderPanel();
      });
    });
  }

  private renderFeed(d: LiqResult): string {
    if (!d.liquidations.length) return '<div class="panel-loading-text">No recent liquidations</div>';
    return `
      <div class="liq-feed">
        ${d.liquidations.slice(0, 25).map(l => `
          <div class="liq-item liq-${l.side.toLowerCase()}" style="border-left:3px solid ${severityColor(l.severity)}">
            <div class="liq-item-header">
              <span class="liq-item-symbol">${escapeHtml(l.symbol)}</span>
              <span class="liq-item-side liq-side-${l.side.toLowerCase()}">${l.side}</span>
              <span class="liq-item-value" style="color:${severityColor(l.severity)}">${formatUsd(l.value)}</span>
              <span class="liq-item-time">${timeAgo(l.time)}</span>
            </div>
            <div class="liq-item-detail">
              <span>@ $${l.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              <span class="liq-item-exchange">${escapeHtml(l.exchange)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  private renderSymbols(d: LiqResult): string {
    if (!d.symbolStats.length) return '<div class="panel-loading-text">No data</div>';
    const maxVal = Math.max(...d.symbolStats.map(s => s.longValue + s.shortValue));
    return `
      <div class="liq-symbols">
        ${d.symbolStats.map(s => {
          const total = s.longValue + s.shortValue;
          const longPct = total > 0 ? Math.round((s.longValue / total) * 100) : 50;
          const barWidth = maxVal > 0 ? (total / maxVal) * 100 : 0;
          return `
            <div class="liq-sym-row">
              <span class="liq-sym-name">${escapeHtml(s.symbol)}</span>
              <div class="liq-sym-bar-wrap" style="width:${barWidth}%">
                <div class="liq-sym-long" style="width:${longPct}%" title="Long: ${formatUsd(s.longValue)}"></div>
                <div class="liq-sym-short" style="width:${100 - longPct}%" title="Short: ${formatUsd(s.shortValue)}"></div>
              </div>
              <span class="liq-sym-total">${formatUsd(total)}</span>
              <span class="liq-sym-count">${s.count}×</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
}
