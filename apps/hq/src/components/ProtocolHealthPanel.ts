import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchProtocolHealth, type ProtocolHealthEntry, type ProtocolHealthReport } from '@/services/protocol-health';

type SortKey = 'score' | 'tvl' | 'change7d';

function formatUsd(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '-';
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

function pctCell(v: number | null): string {
  if (v == null) return '<span class="phs-pct">-</span>';
  const cls = v > 0.05 ? 'change-positive' : v < -0.05 ? 'change-negative' : 'change-neutral';
  return `<span class="phs-pct ${cls}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
}

export class ProtocolHealthPanel extends Panel {
  private report: ProtocolHealthReport | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private sortKey: SortKey = 'score';
  private categoryFilter = 'all';

  constructor() {
    super({
      id: 'protocol-health',
      title: 'Protocol Health',
      showCount: true,
      infoTooltip: `<strong>Protocol Health Scores</strong>
        <p>Composite 0-100 health score for the top DeFi protocols: TVL scale, 7d momentum, 1d stability, chain diversification, listing maturity, and mcap/TVL sanity.</p>
        <p>Source: DeFiLlama. Heuristic ranking signal, not financial advice.</p>
        <p>Updates every 15 minutes.</p>`,
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 15 * 60_000);
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
      this.report = await fetchProtocolHealth(signal);
      this.error = null;
      this.setDataBadge('live');
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

  private sortedRows(): ProtocolHealthEntry[] {
    if (!this.report) return [];
    let rows = this.report.protocols;
    if (this.categoryFilter !== 'all') {
      rows = rows.filter(p => p.category === this.categoryFilter);
    }
    const key = this.sortKey;
    return [...rows].sort((a, b) => {
      if (key === 'score') return b.score - a.score || b.tvl - a.tvl;
      if (key === 'tvl') return b.tvl - a.tvl;
      return (b.change7d ?? -Infinity) - (a.change7d ?? -Infinity);
    });
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Scoring protocols…'); return; }
    if (this.error || !this.report) { this.showError(this.error || 'No data'); return; }

    const rows = this.sortedRows();
    this.setCount(rows.length);

    if (rows.length === 0) {
      this.setContent('<div class="panel-loading-text">No protocols match this filter. Pick another category above.</div>');
      this.bindControls();
      return;
    }

    const categoryOptions = ['all', ...this.report.categories]
      .map(c => `<option value="${escapeHtml(c)}" ${c === this.categoryFilter ? 'selected' : ''}>${c === 'all' ? 'All categories' : escapeHtml(c)}</option>`)
      .join('');

    const tableRows = rows.map(p => `
      <tr class="phs-row" data-phs-url="${escapeHtml(p.url || '')}" title="${escapeHtml(p.topChains.join(', '))}">
        <td class="phs-score-cell"><span class="phs-score phs-grade-${p.grade.toLowerCase()}">${p.score}</span></td>
        <td class="phs-name">
          ${p.logo ? `<img class="phs-logo" src="${escapeHtml(p.logo)}" alt="" loading="lazy" width="16" height="16" data-hide-on-error/>` : ''}
          <span>${escapeHtml(p.name)}</span>
        </td>
        <td class="phs-category">${escapeHtml(p.category)}</td>
        <td class="phs-tvl">${formatUsd(p.tvl)}</td>
        <td>${pctCell(p.change7d)}</td>
        <td class="phs-chains">${p.chainCount}</td>
      </tr>
    `).join('');

    this.setContent(`
      <div class="phs-container">
        <div class="phs-controls">
          <select class="phs-select" data-phs-category aria-label="Filter by category">${categoryOptions}</select>
          <div class="phs-sort-group" role="group" aria-label="Sort protocols">
            <button class="phs-sort-btn ${this.sortKey === 'score' ? 'active' : ''}" data-phs-sort="score">Score</button>
            <button class="phs-sort-btn ${this.sortKey === 'tvl' ? 'active' : ''}" data-phs-sort="tvl">TVL</button>
            <button class="phs-sort-btn ${this.sortKey === 'change7d' ? 'active' : ''}" data-phs-sort="change7d">7d</button>
          </div>
        </div>
        <div class="phs-table-wrap">
          <table class="phs-table">
            <thead><tr><th>Health</th><th>Protocol</th><th>Category</th><th>TVL</th><th>7d</th><th>Chains</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
    `);
    this.bindControls();
  }

  private bindControls(): void {
    const select = this.content.querySelector<HTMLSelectElement>('[data-phs-category]');
    select?.addEventListener('change', () => {
      this.categoryFilter = select.value;
      this.renderPanel();
    });
    this.content.querySelectorAll<HTMLButtonElement>('[data-phs-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sortKey = (btn.dataset.phsSort as SortKey) || 'score';
        this.renderPanel();
      });
    });
    this.content.querySelectorAll<HTMLElement>('.phs-row[data-phs-url]').forEach(row => {
      row.addEventListener('click', () => {
        const url = row.dataset.phsUrl;
        if (url) window.open(url, '_blank', 'noopener');
      });
    });
  }
}
