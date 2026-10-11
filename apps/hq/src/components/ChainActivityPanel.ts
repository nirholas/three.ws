import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import * as d3 from 'd3';
import type { ChainActivity, ChainActivityResult } from '@/types';

type SortColumn = 'dailyTransactions' | 'dailyActiveAddresses' | 'avgTxFee' | 'dailyActiveAddressesChange';

function formatNumber(v: number): string {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toLocaleString();
}

function formatFee(fee: number): string {
  if (fee < 0.001) return `$${fee.toFixed(5)}`;
  if (fee < 0.01) return `$${fee.toFixed(4)}`;
  if (fee < 1) return `$${fee.toFixed(3)}`;
  return `$${fee.toFixed(2)}`;
}

function changeClass(val: number): string {
  if (val > 0.1) return 'positive';
  if (val < -0.1) return 'negative';
  return '';
}

function changeArrow(val: number): string {
  if (val > 0.1) return '↑';
  if (val < -0.1) return '↓';
  return '→';
}

function feeColor(fee: number, cheapest: number, mostExpensive: number): string {
  if (mostExpensive <= cheapest) return 'rgba(255,255,255,0.85)';
  const ratio = (fee - cheapest) / (mostExpensive - cheapest);
  if (ratio < 0.3) return '#4ade80'; // green
  if (ratio < 0.6) return '#facc15'; // yellow
  return '#f87171'; // red
}

export class ChainActivityPanel extends Panel {
  private data: ChainActivityResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private sortColumn: SortColumn = 'dailyTransactions';
  private sortDirection: 'asc' | 'desc' = 'desc';

  constructor() {
    super({
      id: 'chain-activity',
      title: 'Chain Activity',
      showCount: true,
      infoTooltip: 'Daily active addresses, transaction volume, and fees across major chains',
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60_000);
  }

  public destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const res = await fetch('/api/chain-activity', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      this.data = json as ChainActivityResult;
      this.error = null;

      if (this.data?.chains?.length) {
        this.setCount(this.data.chains.length);
      }
      const cacheHeader = res.headers.get('X-Cache');
      if (cacheHeader === 'HIT') {
        this.setDataBadge('cached');
      } else {
        this.setDataBadge('live');
      }
    } catch (err) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
      this.setDataBadge('unavailable');
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private getSortedChains(): ChainActivity[] {
    if (!this.data?.chains) return [];
    const chains = [...this.data.chains];
    const col = this.sortColumn;
    const dir = this.sortDirection === 'desc' ? -1 : 1;
    chains.sort((a, b) => {
      const aVal = a.metrics[col] ?? 0;
      const bVal = b.metrics[col] ?? 0;
      return (aVal - bVal) * dir;
    });
    return chains;
  }

  private renderPanel(): void {
    if (this.loading) {
      this.showLoading('Loading chain activity...');
      return;
    }

    if (this.error || !this.data) {
      this.showError(this.error || 'No data');
      return;
    }

    const d = this.data;
    if (!d.chains?.length) {
      this.setContent('<div class="panel-loading-text">Chain activity data temporarily unavailable</div>');
      return;
    }

    const chains = this.getSortedChains();
    const s = d.summary;
    const comp = d.comparison;

    // Determine fee range for coloring
    const fees = chains.map(c => c.metrics.avgTxFee).filter(f => f > 0);
    const minFee = Math.min(...fees);
    const maxFee = Math.max(...fees);

    // Max tx for bar widths
    const maxTx = Math.max(...chains.map(c => c.metrics.dailyTransactions));

    const sortIcon = (col: string) => {
      if (col !== this.sortColumn) return '';
      return this.sortDirection === 'desc' ? ' ▾' : ' ▴';
    };

    const rows = chains.map(c => {
      const m = c.metrics;
      const barWidth = maxTx > 0 ? Math.round((m.dailyTransactions / maxTx) * 100) : 0;
      const chgClass = changeClass(m.dailyActiveAddressesChange);
      const arrow = changeArrow(m.dailyActiveAddressesChange);
      const feeCol = feeColor(m.avgTxFee, minFee, maxFee);

      return `<tr class="chain-act-row">
        <td class="chain-act-chain">
          <span class="chain-act-dot" style="background:${escapeHtml(c.color)}"></span>
          ${escapeHtml(c.name)}
        </td>
        <td class="chain-act-tx">
          <div class="chain-act-bar-wrapper">
            <div class="chain-act-bar" style="width:${barWidth}%;background:${escapeHtml(c.color)}"></div>
          </div>
          <span class="chain-act-tx-value">${formatNumber(m.dailyTransactions)}</span>
        </td>
        <td class="chain-act-addr">${formatNumber(m.dailyActiveAddresses)}</td>
        <td class="chain-act-fee" style="color:${feeCol}">${formatFee(m.avgTxFee)}</td>
        <td class="chain-act-change ${chgClass}">${arrow} ${Math.abs(m.dailyActiveAddressesChange).toFixed(1)}%</td>
      </tr>`;
    }).join('');

    const growthClass = changeClass(comp.fastestGrowing.growthPercent);
    const growthArrow = changeArrow(comp.fastestGrowing.growthPercent);

    const html = `
      <div class="chain-act-container">
        <div class="chain-act-stats">
          <div class="chain-act-stat">
            <span class="chain-act-stat-value">${formatNumber(s.totalDailyTx)}</span>
            <span class="chain-act-stat-label">Daily Txs</span>
          </div>
          <div class="chain-act-stat">
            <span class="chain-act-stat-value">${formatNumber(s.totalActiveAddresses)}</span>
            <span class="chain-act-stat-label">Active Addrs</span>
          </div>
          <div class="chain-act-stat">
            <span class="chain-act-stat-value ${growthClass}">${growthArrow} ${escapeHtml(comp.fastestGrowing.chain)}</span>
            <span class="chain-act-stat-label">Fastest Growing</span>
          </div>
        </div>

        <div class="chain-act-table-wrap">
          <table class="chain-act-table">
            <thead>
              <tr>
                <th class="chain-act-th" data-sort="dailyTransactions">Chain</th>
                <th class="chain-act-th chain-act-th-sortable" data-sort="dailyTransactions">Daily Txs${sortIcon('dailyTransactions')}</th>
                <th class="chain-act-th chain-act-th-sortable" data-sort="dailyActiveAddresses">Active Addrs${sortIcon('dailyActiveAddresses')}</th>
                <th class="chain-act-th chain-act-th-sortable" data-sort="avgTxFee">Avg Fee${sortIcon('avgTxFee')}</th>
                <th class="chain-act-th chain-act-th-sortable" data-sort="dailyActiveAddressesChange">Growth${sortIcon('dailyActiveAddressesChange')}</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        <div class="chain-activity-chart"></div>
      </div>
    `;

    this.setContent(html);
    this.bindSortHandlers();
    this.renderChart();
  }

  private bindSortHandlers(): void {
    this.content.querySelectorAll<HTMLElement>('.chain-act-th-sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort as SortColumn;
        if (!col) return;
        if (this.sortColumn === col) {
          this.sortDirection = this.sortDirection === 'desc' ? 'asc' : 'desc';
        } else {
          this.sortColumn = col;
          this.sortDirection = 'desc';
        }
        this.renderPanel();
      });
    });
  }

  private renderChart(): void {
    const chartContainer = this.content.querySelector('.chain-activity-chart') as HTMLElement | null;
    if (!chartContainer || !this.data?.chains?.length) return;

    const chains = this.data.chains.slice(0, 8);
    const w = chartContainer.clientWidth || 280;
    const h = 130;
    const margin = { top: 8, right: 10, bottom: 4, left: 70 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    // Clear any existing SVG
    chartContainer.innerHTML = '';

    const svg = d3.select(chartContainer)
      .append('svg')
      .attr('width', w)
      .attr('height', h);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand<string>()
      .domain(chains.map(c => c.name))
      .range([0, innerH])
      .padding(0.2);

    const x = d3.scaleLinear()
      .domain([0, d3.max(chains, c => c.metrics.dailyTransactions) || 1])
      .range([0, innerW]);

    // Bars
    g.selectAll('rect')
      .data(chains)
      .join('rect')
      .attr('y', d => y(d.name) ?? 0)
      .attr('width', d => x(d.metrics.dailyTransactions))
      .attr('height', y.bandwidth())
      .attr('fill', d => d.color)
      .attr('rx', 2)
      .attr('opacity', 0.85);

    // Value labels
    g.selectAll('.bar-label')
      .data(chains)
      .join('text')
      .attr('class', 'bar-label')
      .attr('x', d => Math.min(x(d.metrics.dailyTransactions) + 4, innerW - 5))
      .attr('y', d => (y(d.name) ?? 0) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('font-size', '9px')
      .attr('fill', 'rgba(255,255,255,0.6)')
      .text(d => formatNumber(d.metrics.dailyTransactions));

    // Y-axis labels (chain names)
    g.selectAll('.y-label')
      .data(chains)
      .join('text')
      .attr('class', 'y-label')
      .attr('x', -4)
      .attr('y', d => (y(d.name) ?? 0) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('font-size', '10px')
      .attr('fill', 'rgba(255,255,255,0.7)')
      .text(d => d.name);
  }
}
