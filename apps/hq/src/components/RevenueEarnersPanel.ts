import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatLargeNumber } from '@/utils/defi-format';

interface FeeProtocol {
  name: string;
  slug: string;
  fees24h: number;
  revenue24h: number | null;
}

interface DefiFeesResult {
  timestamp: string;
  totalFees24h: number;
  totalRevenue24h: number;
  topProtocols: FeeProtocol[];
  unavailable?: boolean;
}

export class RevenueEarnersPanel extends Panel {
  private data: DefiFeesResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'revenue-earners', title: 'Revenue Earners', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const res = await fetch('/api/defi-fees');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DefiFeesResult = await res.json();
      if (json.unavailable) throw new Error('Data temporarily unavailable');
      this.data = json;
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
   * Compute margin % with null-safety for revenue24h.
   * DeFiLlama may return null for protocols that don't report revenue.
   */
  private computeMargin(p: FeeProtocol): string {
    if (p.revenue24h == null || p.fees24h <= 0) return '-';
    return ((p.revenue24h / p.fees24h) * 100).toFixed(0) + '%';
  }

  /** Builds a single data row. */
  private renderRow(p: FeeProtocol, i: number): string {
    const margin = this.computeMargin(p);
    const revDisplay = p.revenue24h != null ? formatLargeNumber(p.revenue24h) : '-';
    return `
      <div class="rev-earners-row${i % 2 === 1 ? ' alt' : ''}" role="row">
        <span class="rev-col-rank" role="cell">${i + 1}</span>
        <span class="rev-col-name" role="cell">${escapeHtml(p.name)}</span>
        <span class="rev-col-fees mono" role="cell">${formatLargeNumber(p.fees24h)}</span>
        <span class="rev-col-rev mono" role="cell">${revDisplay}</span>
        <span class="rev-col-margin mono" role="cell">${margin}</span>
      </div>
    `;
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading revenue data...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const protocols = this.data.topProtocols;
    this.setCount(protocols.length);

    const html = `
      <div class="rev-earners-summary">
        <div class="rev-earners-stat">
          <span class="rev-earners-stat-label">Total Fees 24h</span>
          <span class="rev-earners-stat-value mono">${formatLargeNumber(this.data.totalFees24h)}</span>
        </div>
        <div class="rev-earners-stat">
          <span class="rev-earners-stat-label">Total Revenue 24h</span>
          <span class="rev-earners-stat-value mono">${formatLargeNumber(this.data.totalRevenue24h)}</span>
        </div>
      </div>
      <div class="rev-earners-table" role="table" aria-label="Revenue earning protocols">
        <div class="rev-earners-header" role="row">
          <span class="rev-col-rank" role="columnheader">#</span>
          <span class="rev-col-name" role="columnheader">Protocol</span>
          <span class="rev-col-fees" role="columnheader">24h Fees</span>
          <span class="rev-col-rev" role="columnheader">24h Revenue</span>
          <span class="rev-col-margin" role="columnheader">Margin</span>
        </div>
        ${protocols.map((p, i) => this.renderRow(p, i)).join('')}
      </div>
    `;

    this.setContent(html);
    this.bindClicks(protocols);
  }

  private bindClicks(protocols: FeeProtocol[]): void {
    const rows = this.content.querySelectorAll('.rev-earners-row');
    rows.forEach((row, i) => {
      const p = protocols[i];
      if (!p) return;
      (row as HTMLElement).style.cursor = 'pointer';
      row.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'protocol', data: { name: p.name, slug: p.slug, revenue24h: p.revenue24h ?? undefined, fees24h: p.fees24h } }
        }));
      });
    });
  }
}
