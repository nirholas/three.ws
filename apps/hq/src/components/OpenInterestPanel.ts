import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatUsdPrecise as formatUsd } from '@/utils/defi-format';

interface OIExchange {
  openInterest: number;
  oiValue?: number | null;
  changePct?: number | null;
  markPrice?: number;
}

interface OIEntry {
  symbol: string;
  exchanges: Record<string, OIExchange>;
  totalOiValue: number;
  changePct: number;
  signal: string;
}

interface OIResult {
  timestamp: string;
  entries: OIEntry[];
  summary: { totalOI: number; entryCount: number; surgingCount: number; decliningCount: number; btcDominance: number };
  unavailable?: boolean;
}

const SIGNAL_COLORS: Record<string, string> = {
  SURGING: '#ff1744', RISING: '#4caf50', DECLINING: '#ff9800', COLLAPSING: '#2196f3', STABLE: '#888',
};
const SIGNAL_ICONS: Record<string, string> = {
  SURGING: '🔺', RISING: '📈', DECLINING: '📉', COLLAPSING: '💥', STABLE: '➖',
};



function changeColor(pct: number): string {
  if (pct > 10) return '#ff1744';
  if (pct > 3) return '#4caf50';
  if (pct < -10) return '#2196f3';
  if (pct < -3) return '#ff9800';
  return '#888';
}

export class OpenInterestPanel extends Panel {
  private data: OIResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({ id: 'open-interest', title: 'Open Interest', showCount: true });
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
      const res = await fetch('/api/open-interest', { signal });
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
    if (this.loading) { this.showLoading('Loading open interest...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }
    const d = this.data;
    if (d.unavailable) { this.showError('Open interest data temporarily unavailable'); return; }
    if (!d.entries.length) {
      this.setContent('<div class="panel-loading-text">Open interest data temporarily unavailable</div>');
      return;
    }

    this.setCount(d.entries.length);

    // Calculate max OI for bar widths
    const maxOI = Math.max(...d.entries.map(e => e.totalOiValue));

    const html = `
      <div class="oi-summary">
        <div class="oi-stat">
          <span class="oi-stat-value">${formatUsd(d.summary.totalOI)}</span>
          <span class="oi-stat-label">Total OI</span>
        </div>
        <div class="oi-stat">
          <span class="oi-stat-value" style="color:#4caf50">${d.summary.surgingCount}</span>
          <span class="oi-stat-label">Rising</span>
        </div>
        <div class="oi-stat">
          <span class="oi-stat-value" style="color:#ff9800">${d.summary.decliningCount}</span>
          <span class="oi-stat-label">Declining</span>
        </div>
        <div class="oi-stat">
          <span class="oi-stat-value">${d.summary.btcDominance}%</span>
          <span class="oi-stat-label">BTC Dom.</span>
        </div>
      </div>
      <div class="oi-list">
        ${d.entries.map((e, idx) => {
          const pct = maxOI > 0 ? (e.totalOiValue / maxOI) * 100 : 0;
          const sigIcon = SIGNAL_ICONS[e.signal] || '';
          const sigColor = SIGNAL_COLORS[e.signal] || '#888';
          const binance = e.exchanges['Binance'];
          const hl = e.exchanges['Hyperliquid'];
          return `
            <div class="oi-row" data-oi-idx="${idx}" style="cursor:pointer">
              <div class="oi-row-header">
                <span class="oi-signal" style="color:${sigColor}">${sigIcon}</span>
                <span class="oi-symbol">${escapeHtml(e.symbol)}</span>
                <span class="oi-value">${formatUsd(e.totalOiValue)}</span>
                <span class="oi-change" style="color:${changeColor(e.changePct)}">
                  ${e.changePct !== 0 ? `${e.changePct > 0 ? '+' : ''}${e.changePct.toFixed(1)}%` : '-'}
                </span>
              </div>
              <div class="oi-bar-wrap">
                <div class="oi-bar" style="width:${pct}%;background:${sigColor}30;border-left:3px solid ${sigColor}">
                  ${binance ? `<span class="oi-exchange-tag oi-binance" title="Binance OI">${binance.oiValue ? formatUsd(binance.oiValue) : '-'}</span>` : ''}
                  ${hl ? `<span class="oi-exchange-tag oi-hl" title="Hyperliquid OI">${formatUsd(hl.oiValue || 0)}</span>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this.setContent(html);

    // Bind click handlers on OI rows
    this.content.querySelectorAll<HTMLElement>('.oi-row[data-oi-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.oiIdx ?? '0');
        const entry = d.entries[idx];
        if (!entry) return;
        // Strip trailing 'USDT' if present for the symbol
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
