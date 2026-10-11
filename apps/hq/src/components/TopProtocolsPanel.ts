import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatLargeNumber, formatPct, pctColor, CATEGORY_FILTERS } from '@/utils/defi-format';

interface TopProtocol {
  name: string;
  slug: string;
  category: string;
  tvl: number;
  change24h: number | null;
  change7d: number | null;
  chains: string[];
  logo: string;
}

interface TopProtocolsResult {
  timestamp: string;
  protocols: TopProtocol[];
  unavailable?: boolean;
}

type SortKey = 'tvl' | 'change24h' | 'change7d';

export class TopProtocolsPanel extends Panel {
  private data: TopProtocol[] = [];
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private categoryFilter = 'All';
  private sortKey: SortKey = 'tvl';
  private sortDir: 'asc' | 'desc' = 'desc';

  constructor() {
    super({ id: 'top-protocols', title: 'Top Protocols', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 2 * 60000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const res = await fetch('/api/top-protocols?limit=100');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TopProtocolsResult = await res.json();
      if (json.unavailable) throw new Error('Data temporarily unavailable');
      this.data = json.protocols;
      this.error = null;
      this.setDataBadge(res.headers.get('X-Cache') === 'HIT' ? 'cached' : 'live');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
      this.setDataBadge('unavailable');
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private getFiltered(): TopProtocol[] {
    let items = this.data;
    if (this.categoryFilter !== 'All') {
      items = items.filter(p => p.category === this.categoryFilter);
    }
    const key = this.sortKey;
    const mult = this.sortDir === 'desc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const av = a[key] ?? -Infinity;
      const bv = b[key] ?? -Infinity;
      return (bv - av) * mult;
    });
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading protocols...'); return; }
    if (this.error || !this.data.length) { this.showError(this.error || 'No data'); return; }

    const filtered = this.getFiltered();
    this.setCount(filtered.length);

    const sortIcon = (key: string): string => {
      if (this.sortKey !== key) return '';
      return this.sortDir === 'desc' ? ' &#x25BC;' : ' &#x25B2;';
    };

    const html = `
      <div class="top-proto-filters" role="tablist" aria-label="Category filter">
        ${CATEGORY_FILTERS.map(c =>
          `<button class="top-proto-filter-btn${this.categoryFilter === c ? ' active' : ''}" data-cat="${escapeHtml(c)}" role="tab" aria-selected="${this.categoryFilter === c}">${escapeHtml(c)}</button>`
        ).join('')}
      </div>
      <div class="top-proto-table" role="table">
        <div class="top-proto-header" role="row">
          <span class="top-proto-col-rank" role="columnheader">#</span>
          <span class="top-proto-col-name" role="columnheader">Protocol</span>
          <span class="top-proto-col-cat" role="columnheader">Category</span>
          <span class="top-proto-col-tvl top-proto-sortable" role="columnheader" tabindex="0" data-sort="tvl" aria-sort="${this.sortKey === 'tvl' ? this.sortDir + 'ending' : 'none'}">TVL${sortIcon('tvl')}</span>
          <span class="top-proto-col-change top-proto-sortable" role="columnheader" tabindex="0" data-sort="change24h" aria-sort="${this.sortKey === 'change24h' ? this.sortDir + 'ending' : 'none'}">24h${sortIcon('change24h')}</span>
          <span class="top-proto-col-change top-proto-sortable" role="columnheader" tabindex="0" data-sort="change7d" aria-sort="${this.sortKey === 'change7d' ? this.sortDir + 'ending' : 'none'}">7d${sortIcon('change7d')}</span>
          <span class="top-proto-col-chains" role="columnheader">Chains</span>
        </div>
        ${filtered.slice(0, 30).map((p, i) => this.renderRow(p, i)).join('')}
      </div>
    `;

    this.setContent(html);
    this.bindEvents();
  }

  private renderRow(p: TopProtocol, i: number): string {
    const chainDisplay = p.chains.length > 3
      ? `<span class="top-proto-chain-count" title="${escapeHtml(p.chains.join(', '))}">${p.chains.length} chains</span>`
      : p.chains.map(c => `<span class="top-proto-chain-tag">${escapeHtml(c)}</span>`).join('');

    return `
      <div class="top-proto-row" role="row">
        <span class="top-proto-col-rank" role="cell">${i + 1}</span>
        <span class="top-proto-col-name" role="cell">
          ${p.logo ? `<img src="${escapeHtml(p.logo)}" class="top-proto-logo" width="20" height="20" alt="${escapeHtml(p.name)}" loading="lazy" data-fallback="true">` : '<span class="top-proto-logo-placeholder"></span>'}
          <span class="top-proto-name-text">${escapeHtml(p.name)}</span>
        </span>
        <span class="top-proto-col-cat" role="cell"><span class="top-proto-badge">${escapeHtml(p.category)}</span></span>
        <span class="top-proto-col-tvl mono" role="cell">${formatLargeNumber(p.tvl)}</span>
        <span class="top-proto-col-change mono" role="cell" style="color:${pctColor(p.change24h)}">${formatPct(p.change24h)}</span>
        <span class="top-proto-col-change mono" role="cell" style="color:${pctColor(p.change7d)}">${formatPct(p.change7d)}</span>
        <span class="top-proto-col-chains" role="cell">${chainDisplay}</span>
      </div>
    `;
  }

  private bindEvents(): void {
    // Category filter buttons
    this.content.querySelectorAll<HTMLButtonElement>('.top-proto-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.categoryFilter = btn.dataset.cat || 'All';
        this.renderPanel();
      });
    });

    // Sortable column headers - click and keyboard
    this.content.querySelectorAll<HTMLElement>('.top-proto-sortable').forEach(el => {
      const handler = (): void => {
        const key = el.dataset.sort as SortKey;
        if (this.sortKey === key) {
          this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          this.sortKey = key;
          this.sortDir = 'desc';
        }
        this.renderPanel();
      };
      el.addEventListener('click', handler);
      el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
      });
    });

    // Image error fallback - replace broken logos with placeholder, no inline onerror
    this.content.querySelectorAll<HTMLImageElement>('img[data-fallback]').forEach(img => {
      img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
    });
  }
}
