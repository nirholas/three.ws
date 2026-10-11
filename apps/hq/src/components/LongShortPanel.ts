import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface TopTrader {
  longPct: number;
  shortPct: number;
  ratio: number;
  change: number;
}

interface GlobalRatio {
  longPct: number;
  shortPct: number;
  ratio: number;
}

interface LSEntry {
  symbol: string;
  topTrader: TopTrader;
  global: GlobalRatio | null;
  sentiment: string;
}

interface LSResult {
  timestamp: string;
  entries: LSEntry[];
  summary: { avgRatio: number; extremeCount: number; bullishCount: number; bearishCount: number; marketSentiment: string };
  unavailable?: boolean;
}

function sentimentColor(s: string): string {
  if (s.includes('EXTREME LONG')) return '#ff1744';
  if (s === 'BULLISH') return '#4caf50';
  if (s === 'NEUTRAL') return '#888';
  if (s === 'BEARISH') return '#ff9800';
  if (s.includes('EXTREME SHORT')) return '#2196f3';
  return '#888';
}

function sentimentIcon(s: string): string {
  if (s.includes('EXTREME LONG')) return '🔴';
  if (s === 'BULLISH') return '🟢';
  if (s === 'NEUTRAL') return '⚪';
  if (s === 'BEARISH') return '🟠';
  if (s.includes('EXTREME SHORT')) return '🔵';
  return '⚪';
}

export class LongShortPanel extends Panel {
  private data: LSResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({ id: 'long-short', title: 'Long/Short Ratio', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 2 * 60000);
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
      const res = await fetch('/api/long-short-ratio', { signal });
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
    if (this.loading) { this.showLoading('Loading long/short ratios...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }
    const d = this.data;
    if (d.unavailable) { this.showError('Long/short ratio data temporarily unavailable'); return; }
    if (!d.entries.length) {
      this.setContent('<div class="panel-loading-text">Long/short data temporarily unavailable</div>');
      return;
    }

    this.setCount(d.entries.length);

    const html = `
      <div class="ls-summary">
        <div class="ls-stat">
          <span class="ls-stat-value" style="color:${sentimentColor(d.summary.marketSentiment)}">${escapeHtml(d.summary.marketSentiment)}</span>
          <span class="ls-stat-label">Market</span>
        </div>
        <div class="ls-stat">
          <span class="ls-stat-value">${d.summary.avgRatio.toFixed(2)}</span>
          <span class="ls-stat-label">Avg L/S</span>
        </div>
        <div class="ls-stat">
          <span class="ls-stat-value" style="color:#4caf50">${d.summary.bullishCount}</span>
          <span class="ls-stat-label">Bullish</span>
        </div>
        <div class="ls-stat">
          <span class="ls-stat-value" style="color:#ff9800">${d.summary.bearishCount}</span>
          <span class="ls-stat-label">Bearish</span>
        </div>
      </div>
      <div class="ls-header-row">
        <span class="ls-h-symbol">Asset</span>
        <span class="ls-h-label">Top Traders</span>
        <span class="ls-h-label">Global</span>
        <span class="ls-h-label">Signal</span>
      </div>
      <div class="ls-list">
        ${d.entries.map((e, idx) => {
          const sColor = sentimentColor(e.sentiment);
          const sIcon = sentimentIcon(e.sentiment);
          const trendArrow = e.topTrader.change > 0.05 ? '↑' : e.topTrader.change < -0.05 ? '↓' : '';
          const trendColor = e.topTrader.change > 0.05 ? '#4caf50' : e.topTrader.change < -0.05 ? '#ff9800' : '#888';
          return `
            <div class="ls-row" data-ls-idx="${idx}" style="cursor:pointer">
              <span class="ls-symbol">${escapeHtml(e.symbol)}</span>
              <div class="ls-ratio-bar-wrap">
                <div class="ls-bar-long" style="width:${e.topTrader.longPct}%" title="Long: ${e.topTrader.longPct}%">
                  <span>${e.topTrader.longPct}%</span>
                </div>
                <div class="ls-bar-short" style="width:${e.topTrader.shortPct}%" title="Short: ${e.topTrader.shortPct}%">
                  <span>${e.topTrader.shortPct}%</span>
                </div>
              </div>
              <div class="ls-global-cell">
                ${e.global ? `
                  <div class="ls-mini-bar">
                    <div class="ls-mini-long" style="width:${e.global.longPct}%"></div>
                  </div>
                  <span class="ls-global-ratio">${e.global.ratio.toFixed(2)}</span>
                ` : '<span class="ls-no-data">-</span>'}
              </div>
              <span class="ls-sentiment" style="color:${sColor}">
                ${sIcon} ${trendArrow ? `<span style="color:${trendColor}">${trendArrow}</span>` : ''}
              </span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="ls-legend">
        <span class="ls-legend-note">Top trader accounts - contrarian signal when extreme</span>
      </div>
    `;

    this.setContent(html);

    // Bind click handlers on L/S rows
    this.content.querySelectorAll<HTMLElement>('.ls-row[data-ls-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.lsIdx ?? '0');
        const entry = d.entries[idx];
        if (!entry) return;
        const sym = entry.symbol.replace(/USDT$/i, '');
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'token' as const, data: {
            symbol: sym,
            name: sym,
          }},
        }));
      });
    });
  }
}
