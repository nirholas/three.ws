import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface SectorEntry {
  id: string;
  name: string;
  marketCap: number;
  change24h: number | null;
  volume24h: number | null;
  topCoins: string[];
}

interface SectorRotationResult {
  timestamp: string;
  summary: {
    sectorCount: number;
    advancing: number;
    declining: number;
    topGainer: { name: string; change24h: number } | null;
    topLoser: { name: string; change24h: number } | null;
  };
  sectors: SectorEntry[];
}

type SortMode = 'change' | 'mcap';

function formatUsd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

export class SectorRotationPanel extends Panel {
  private data: SectorRotationResult | null = null;
  private loading = true;
  private error: string | null = null;
  private sortMode: SortMode = 'change';
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({ id: 'sector-rotation', title: 'Sector Rotation', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60 * 1000); // matches the API's CoinGecko-friendly TTL
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
      const res = await fetch('/api/sector-rotation?limit=30', { signal });
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

  private sortedSectors(): SectorEntry[] {
    if (!this.data) return [];
    const sectors = [...this.data.sectors];
    if (this.sortMode === 'change') {
      sectors.sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity));
    } else {
      sectors.sort((a, b) => b.marketCap - a.marketCap);
    }
    return sectors;
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Fetching sector data...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    const sectors = this.sortedSectors();
    this.setCount(sectors.length);

    const maxAbsChange = Math.max(1, ...sectors.map((s) => Math.abs(s.change24h ?? 0)));

    const html = `
      <div class="sector-summary">
        <div class="sector-stat">
          <span class="sector-stat-value positive">${d.summary.advancing}</span>
          <span class="sector-stat-label">Advancing</span>
        </div>
        <div class="sector-stat">
          <span class="sector-stat-value negative">${d.summary.declining}</span>
          <span class="sector-stat-label">Declining</span>
        </div>
        ${d.summary.topGainer ? `
        <div class="sector-stat">
          <span class="sector-stat-value ${d.summary.topGainer.change24h >= 0 ? 'positive' : 'negative'}">${escapeHtml(d.summary.topGainer.name)}</span>
          <span class="sector-stat-label">${d.summary.topGainer.change24h >= 0 ? '+' : ''}${d.summary.topGainer.change24h.toFixed(1)}% leader</span>
        </div>` : ''}
      </div>
      <div class="sector-sort" role="tablist" aria-label="Sector sort order">
        <button class="sector-sort-btn ${this.sortMode === 'change' ? 'active' : ''}" data-sort="change" role="tab" aria-selected="${this.sortMode === 'change'}">By 24h Change</button>
        <button class="sector-sort-btn ${this.sortMode === 'mcap' ? 'active' : ''}" data-sort="mcap" role="tab" aria-selected="${this.sortMode === 'mcap'}">By Market Cap</button>
      </div>
      <div class="sector-list">
        ${sectors.map((s) => {
          const change = s.change24h;
          const width = change != null ? Math.min(100, (Math.abs(change) / maxAbsChange) * 100) : 0;
          return `
          <div class="sector-row" title="${escapeHtml(s.name)}: ${formatUsd(s.marketCap)} market cap">
            <span class="sector-name">${escapeHtml(s.name)}</span>
            <span class="sector-mcap">${formatUsd(s.marketCap)}</span>
            <span class="sector-bar-track">
              <span class="sector-bar ${change != null && change >= 0 ? 'sector-bar-up' : 'sector-bar-down'}" style="width:${width.toFixed(0)}%"></span>
            </span>
            <span class="sector-change ${change != null && change >= 0 ? 'positive' : 'negative'}">${change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '-'}</span>
          </div>`;
        }).join('')}
      </div>
    `;
    this.setContent(html);

    this.content.querySelectorAll<HTMLButtonElement>('.sector-sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.sort as SortMode;
        if (next && next !== this.sortMode) {
          this.sortMode = next;
          this.renderPanel();
        }
      });
    });
  }
}
