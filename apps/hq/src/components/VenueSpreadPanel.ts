import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

/**
 * Cross-venue price divergence. Shows where the same asset is quoted
 * cheapest and dearest right now, and how wide the gap is in basis points.
 */

interface VenueQuote {
  venue: string;
  price: number;
}

interface SpreadRow {
  symbol: string;
  name: string;
  venues: VenueQuote[];
  venueCount: number;
  low: VenueQuote;
  high: VenueQuote;
  mid: number;
  spreadAbs: number;
  spreadBps: number;
  level: 'WIDE' | 'NOTABLE' | 'TIGHT';
}

interface SpreadResult {
  timestamp: string;
  count: number;
  venues: string[];
  thresholds: { notableBps: number; wideBps: number };
  summary: {
    avgSpreadBps: number;
    wideCount: number;
    notableCount: number;
    widest: { symbol: string; spreadBps: number } | null;
  };
  spreads: SpreadRow[];
  unavailable?: boolean;
}

type SortKey = 'spread' | 'symbol';

function formatPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(6)}`;
}

export class VenueSpreadPanel extends Panel {
  private data: SpreadResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private sortKey: SortKey = 'spread';
  private onlyDivergent = false;

  constructor() {
    super({
      id: 'venue-spread',
      title: 'Venue Spread',
      showCount: true,
      infoTooltip: `<strong>Cross-Venue Price Divergence</strong>
        <p>The same asset quoted on Coinbase, Kraken and OKX at the same moment, with the gap between cheapest and dearest in basis points.</p>
        <p>A wide spread is either an arbitrage window or a thin/stale book on one venue.</p>
        <p>Updates every minute.</p>`,
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 60_000);
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
      const res = await fetch('/api/venue-spread', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;
      this.setDataBadge(this.data?.unavailable ? 'unavailable' : 'live');
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

  private visibleRows(): SpreadRow[] {
    if (!this.data) return [];
    let rows = this.data.spreads;
    if (this.onlyDivergent) {
      rows = rows.filter(r => r.level !== 'TIGHT');
    }
    return [...rows].sort((a, b) => (
      this.sortKey === 'spread' ? b.spreadBps - a.spreadBps : a.symbol.localeCompare(b.symbol)
    ));
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Comparing venues…'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    if (this.data.unavailable || this.data.venues.length < 2) {
      this.setContent('<div class="panel-loading-text">Need at least two live venues to compute a spread. Retrying shortly.</div>');
      return;
    }

    const rows = this.visibleRows();
    this.setCount(rows.length);

    const s = this.data.summary;
    const header = `
      <div class="vs-summary">
        <div class="vs-summary-item">
          <span class="vs-summary-label">Avg Spread</span>
          <span class="vs-summary-value">${s.avgSpreadBps} bps</span>
        </div>
        <div class="vs-summary-item">
          <span class="vs-summary-label">Widest</span>
          <span class="vs-summary-value">${s.widest ? `${escapeHtml(s.widest.symbol)} ${s.widest.spreadBps}` : '-'}</span>
        </div>
        <div class="vs-summary-item">
          <span class="vs-summary-label">Venues</span>
          <span class="vs-summary-value">${this.data.venues.length}</span>
        </div>
      </div>`;

    if (rows.length === 0) {
      this.setContent(`${header}<div class="panel-loading-text">Every venue agrees within ${this.data.thresholds.notableBps} bps right now. Uncheck the filter to see all assets.</div>${this.controlsHtml()}`);
      this.bindControls();
      return;
    }

    const tableRows = rows.map(r => `
      <tr class="vs-row vs-level-${r.level.toLowerCase()}" title="${escapeHtml(r.venues.map(v => `${v.venue} ${formatPrice(v.price)}`).join('  |  '))}">
        <td class="vs-symbol">${escapeHtml(r.symbol)}</td>
        <td class="vs-bps vs-level-${r.level.toLowerCase()}">${r.spreadBps}</td>
        <td class="vs-venue-low">${escapeHtml(r.low.venue)} ${formatPrice(r.low.price)}</td>
        <td class="vs-venue-high">${escapeHtml(r.high.venue)} ${formatPrice(r.high.price)}</td>
      </tr>
    `).join('');

    this.setContent(`
      ${header}
      ${this.controlsHtml()}
      <div class="vs-table-wrap">
        <table class="vs-table">
          <thead><tr><th>Asset</th><th>Spread</th><th>Cheapest</th><th>Dearest</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `);
    this.bindControls();
  }

  private controlsHtml(): string {
    return `
      <div class="vs-controls">
        <div class="vs-sort-group" role="group" aria-label="Sort assets">
          <button class="vs-sort-btn ${this.sortKey === 'spread' ? 'active' : ''}" data-vs-sort="spread">Spread</button>
          <button class="vs-sort-btn ${this.sortKey === 'symbol' ? 'active' : ''}" data-vs-sort="symbol">Asset</button>
        </div>
        <label class="vs-filter-label">
          <input type="checkbox" data-vs-divergent ${this.onlyDivergent ? 'checked' : ''}/>
          Divergent only
        </label>
      </div>`;
  }

  private bindControls(): void {
    this.content.querySelectorAll<HTMLButtonElement>('[data-vs-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sortKey = (btn.dataset.vsSort as SortKey) || 'spread';
        this.renderPanel();
      });
    });
    const toggle = this.content.querySelector<HTMLInputElement>('[data-vs-divergent]');
    toggle?.addEventListener('change', () => {
      this.onlyDivergent = toggle.checked;
      this.renderPanel();
    });
  }
}
