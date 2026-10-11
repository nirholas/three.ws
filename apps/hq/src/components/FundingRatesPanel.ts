import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface FundingExchange {
  fundingRate: number;
  markPrice: number;
  level: string;
}

interface FundingEntry {
  symbol: string;
  exchanges: Record<string, FundingExchange>;
  avgFunding: number;
  level: string;
}

interface FundingResult {
  timestamp: string;
  rates: FundingEntry[];
  summary: { avgFunding: number; extremeCount: number; sentiment: string; sourceCount: number };
  unavailable?: boolean;
}

function rateClass(rate: number): string {
  const abs = Math.abs(rate);
  if (abs >= 0.1) return 'rate-extreme';
  if (abs >= 0.05) return 'rate-high';
  if (abs >= 0.01) return 'rate-moderate';
  return 'rate-normal';
}

function rateColor(rate: number): string {
  if (rate >= 0.1) return '#f44336';
  if (rate >= 0.05) return '#ff9800';
  if (rate >= 0.01) return '#4caf50';
  if (rate <= -0.1) return '#2196f3';
  if (rate <= -0.05) return '#03a9f4';
  if (rate <= -0.01) return '#4caf50';
  return '#888';
}

function sentimentClass(sentiment: string): string {
  if (sentiment.includes('LONG')) return 'sentiment-bearish';
  if (sentiment.includes('SHORT')) return 'sentiment-bullish';
  return 'sentiment-neutral';
}

export class FundingRatesPanel extends Panel {
  private data: FundingResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({ id: 'funding-rates', title: 'Funding Rates', showCount: true });
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
      const res = await fetch('/api/funding-rates', { signal });
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
    if (this.loading) { this.showLoading('Loading funding rates...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    if (d.unavailable) { this.showError('Funding rate data temporarily unavailable'); return; }
    if (!d.rates.length) {
      this.setContent('<div class="panel-loading-text">Funding rate data temporarily unavailable</div>');
      return;
    }

    this.setCount(d.rates.length);

    const html = `
      <div class="funding-summary">
        <div class="fund-stat">
          <span class="fund-stat-value ${sentimentClass(d.summary.sentiment)}">${escapeHtml(d.summary.sentiment)}</span>
          <span class="fund-stat-label">Market Sentiment</span>
        </div>
        <div class="fund-stat">
          <span class="fund-stat-value">${d.summary.avgFunding.toFixed(3)}%</span>
          <span class="fund-stat-label">Avg Rate</span>
        </div>
        <div class="fund-stat">
          <span class="fund-stat-value${d.summary.extremeCount > 0 ? ' rate-extreme' : ''}">${d.summary.extremeCount}</span>
          <span class="fund-stat-label">Extreme</span>
        </div>
      </div>
      <div class="funding-heatmap">
        <div class="funding-header-row">
          <span class="fh-symbol">Asset</span>
          <span class="fh-exchange">Binance</span>
          <span class="fh-exchange">Hyperliquid</span>
          <span class="fh-avg">Avg</span>
        </div>
        ${d.rates.map((r, idx) => {
          const binance = r.exchanges['Binance'];
          const hl = r.exchanges['Hyperliquid'];
          return `
            <div class="funding-row" data-fund-idx="${idx}" style="cursor:pointer">
              <span class="fund-symbol">${escapeHtml(r.symbol)}</span>
              <span class="fund-cell ${binance ? rateClass(binance.fundingRate) : ''}" style="color:${binance ? rateColor(binance.fundingRate) : '#555'}">
                ${binance ? `${binance.fundingRate > 0 ? '+' : ''}${binance.fundingRate.toFixed(4)}%` : '-'}
              </span>
              <span class="fund-cell ${hl ? rateClass(hl.fundingRate) : ''}" style="color:${hl ? rateColor(hl.fundingRate) : '#555'}">
                ${hl ? `${hl.fundingRate > 0 ? '+' : ''}${hl.fundingRate.toFixed(4)}%` : '-'}
              </span>
              <span class="fund-avg ${rateClass(r.avgFunding)}" style="color:${rateColor(r.avgFunding)}">
                ${r.avgFunding > 0 ? '+' : ''}${r.avgFunding.toFixed(4)}%
              </span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="funding-legend">
        <span class="legend-item"><span class="legend-dot" style="background:#4caf50"></span>Normal</span>
        <span class="legend-item"><span class="legend-dot" style="background:#ff9800"></span>High</span>
        <span class="legend-item"><span class="legend-dot" style="background:#f44336"></span>Extreme</span>
      </div>
    `;

    this.setContent(html);

    // Bind click handlers on funding rows
    this.content.querySelectorAll<HTMLElement>('.funding-row[data-fund-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.fundIdx ?? '0');
        const entry = d.rates[idx];
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
