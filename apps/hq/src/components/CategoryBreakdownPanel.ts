import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatLargeNumber, CHAIN_BAR_COLORS } from '@/utils/defi-format';

interface CategorySummary {
  category: string;
  totalTvl: number;
  protocolCount: number;
  topProtocol: string;
  share: number; // percentage of grand total
}

interface ProtocolData {
  name: string;
  category: string;
  tvl: number;
}

interface TopProtocolsResult {
  timestamp: string;
  protocols: ProtocolData[];
  unavailable?: boolean;
}

export class CategoryBreakdownPanel extends Panel {
  private categories: CategorySummary[] = [];
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'category-breakdown', title: 'Category Breakdown', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const res = await fetch('/api/top-protocols?limit=200');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TopProtocolsResult = await res.json();
      if (json.unavailable) throw new Error('Data temporarily unavailable');
      this.categories = this.aggregate(json.protocols);
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

  /**
   * Aggregate protocols into category summaries.
   * Groups by category, sums TVL, counts protocols, tracks top protocol per category.
   */
  private aggregate(protocols: ProtocolData[]): CategorySummary[] {
    const map = new Map<string, { totalTvl: number; count: number; topName: string; topTvl: number }>();

    for (const p of protocols) {
      const cat = p.category || 'Other';
      const entry = map.get(cat) || { totalTvl: 0, count: 0, topName: '', topTvl: 0 };
      entry.totalTvl += p.tvl;
      entry.count++;
      if (p.tvl > entry.topTvl) {
        entry.topName = p.name;
        entry.topTvl = p.tvl;
      }
      map.set(cat, entry);
    }

    const sorted = Array.from(map.entries())
      .map(([category, v]) => ({ category, totalTvl: v.totalTvl, protocolCount: v.count, topProtocol: v.topName, share: 0 }))
      .sort((a, b) => b.totalTvl - a.totalTvl);

    // Compute share percentages against the grand total
    const grandTotal = sorted.reduce((sum, c) => sum + c.totalTvl, 0);
    if (grandTotal > 0) {
      for (const c of sorted) {
        c.share = (c.totalTvl / grandTotal) * 100;
      }
    }

    return sorted;
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading category data...'); return; }
    if (this.error || !this.categories.length) { this.showError(this.error || 'No data'); return; }

    this.setCount(this.categories.length);
    const maxTvl = this.categories[0]?.totalTvl || 1;

    const html = `
      <div class="cat-breakdown-list" role="list" aria-label="DeFi category breakdown">
        ${this.categories.map((c, i) => {
          const barPct = ((c.totalTvl / maxTvl) * 100).toFixed(1);
          const color = CHAIN_BAR_COLORS[i % CHAIN_BAR_COLORS.length];
          return `
            <div class="cat-breakdown-row" role="listitem" aria-label="${escapeHtml(c.category)}: ${formatLargeNumber(c.totalTvl)} (${c.share.toFixed(1)}%)">
              <div class="cat-breakdown-info">
                <span class="cat-breakdown-name">${escapeHtml(c.category)}</span>
                <span class="cat-breakdown-meta">${c.protocolCount} protocol${c.protocolCount !== 1 ? 's' : ''} · Top: ${escapeHtml(c.topProtocol)}</span>
              </div>
              <div class="cat-breakdown-bar-wrap" role="meter" aria-valuenow="${c.share.toFixed(1)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(c.category)} TVL share">
                <div class="cat-breakdown-bar" style="width:${barPct}%;background:${color}"></div>
              </div>
              <div class="cat-breakdown-values">
                <span class="cat-breakdown-tvl mono">${formatLargeNumber(c.totalTvl)}</span>
                <span class="cat-breakdown-share">${c.share.toFixed(1)}%</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this.setContent(html);
    this.bindClicks();
  }

  private bindClicks(): void {
    const rows = this.content.querySelectorAll('.cat-breakdown-row');
    rows.forEach((row, i) => {
      const c = this.categories[i];
      if (!c) return;
      (row as HTMLElement).style.cursor = 'pointer';
      row.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'protocol', data: { name: c.category, category: c.category, tvl: c.totalTvl } }
        }));
      });
    });
  }
}
