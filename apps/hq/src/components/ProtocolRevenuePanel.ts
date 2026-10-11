import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatUsd, changeHtml as sharedChangeHtml } from '@/utils/defi-format';
import { TimeSeriesChart, createPeriodToggle } from '@/utils/d3-timeseries';

interface ProtocolData {
  name: string;
  category: string;
  chains: string[];
  dailyFees: number;
  dailyRevenue: number;
  monthlyRevenue: number;
  tvl: number;
  revenuePerTvl: number | null;
  change1d: number | null;
  change7d: number | null;
  change1m: number | null;
}

interface RevenueResult {
  timestamp: string;
  protocols: ProtocolData[];
  summary: { protocolCount: number; totalDailyRevenue: number; totalDailyFees: number };
  unavailable?: boolean;
}

function changeHtml(val: number | null): string {
  return sharedChangeHtml(val);
}

export class ProtocolRevenuePanel extends Panel {
  private data: RevenueResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private sortBy: 'revenue' | 'fees' | 'efficiency' = 'revenue';
  private tsChart: TimeSeriesChart | null = null;
  private tsChartExpanded = false;
  private tsPeriod = '30d';
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    super({ id: 'protocol-revenue', title: 'Protocol Revenue', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 10 * 60000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.abortController?.abort();
    this.abortController = null;
    this.tsChart?.destroy();
    this.tsChart = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const res = await fetch('/api/protocol-revenue', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;
    } catch (err) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading revenue data...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    if (!d.protocols.length) {
      this.setContent('<div class="panel-loading-text">Revenue data temporarily unavailable</div>');
      return;
    }

    this.setCount(d.summary.protocolCount);

    let protocols = [...d.protocols];
    if (this.sortBy === 'fees') protocols.sort((a, b) => b.dailyFees - a.dailyFees);
    else if (this.sortBy === 'efficiency') protocols.sort((a, b) => (b.revenuePerTvl ?? 0) - (a.revenuePerTvl ?? 0));

    const html = `
      <div class="revenue-summary">
        <div class="rev-stat"><span class="rev-stat-value">${formatUsd(d.summary.totalDailyRevenue)}</span><span class="rev-stat-label">Daily Revenue</span></div>
        <div class="rev-stat"><span class="rev-stat-value">${formatUsd(d.summary.totalDailyFees)}</span><span class="rev-stat-label">Daily Fees</span></div>
        <div class="rev-stat"><span class="rev-stat-value">${d.summary.protocolCount}</span><span class="rev-stat-label">Protocols</span></div>
      </div>
      <div class="revenue-sort">
        <button class="sort-btn${this.sortBy === 'revenue' ? ' active' : ''}" data-sort="revenue">Revenue</button>
        <button class="sort-btn${this.sortBy === 'fees' ? ' active' : ''}" data-sort="fees">Fees</button>
        <button class="sort-btn${this.sortBy === 'efficiency' ? ' active' : ''}" data-sort="efficiency">Rev/TVL</button>
      </div>
      <div class="revenue-list">
        ${protocols.slice(0, 20).map((p, i) => `
          <div class="rev-row">
            <span class="rev-rank">${i + 1}</span>
            <div class="rev-info">
              <span class="rev-name">${escapeHtml(p.name)}</span>
              <span class="rev-category">${escapeHtml(p.category || '')}</span>
            </div>
            <div class="rev-numbers">
              <span class="rev-daily" title="Daily revenue">${formatUsd(p.dailyRevenue)}</span>
              <span class="rev-fees" title="Daily fees">${formatUsd(p.dailyFees)}</span>
              ${p.revenuePerTvl != null ? `<span class="rev-efficiency" title="Annualized Rev/TVL">${(p.revenuePerTvl * 100).toFixed(1)}%</span>` : ''}
              ${changeHtml(p.change1d)}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    this.setContent(html);
    this.element.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sortBy = (btn as HTMLElement).dataset.sort as 'revenue' | 'fees' | 'efficiency';
        this.renderPanel();
      });
    });

    this.appendChartSection();
  }

  private appendChartSection(): void {
    const container = document.createElement('div');
    container.className = 'ts-chart-container';

    const header = document.createElement('div');
    header.className = 'ts-chart-header';
    header.innerHTML = '<span class="ts-chart-title">Revenue Trend</span><span class="ts-chart-toggle">▼</span>';
    container.appendChild(header);

    const body = document.createElement('div');
    body.className = `ts-chart-body ${this.tsChartExpanded ? 'expanded' : 'collapsed'}`;
    container.appendChild(body);

    header.addEventListener('click', () => {
      this.tsChartExpanded = !this.tsChartExpanded;
      const toggle = header.querySelector('.ts-chart-toggle');
      if (toggle) toggle.classList.toggle('expanded', this.tsChartExpanded);
      body.classList.toggle('collapsed', !this.tsChartExpanded);
      body.classList.toggle('expanded', this.tsChartExpanded);
      if (this.tsChartExpanded && !this.tsChart) {
        this.loadChartData(body);
      }
    });

    this.content.appendChild(container);
  }

  private async loadChartData(body: HTMLElement): Promise<void> {
    body.innerHTML = '<div class="ts-chart-loading">Loading chart…</div>';

    const { setActive } = createPeriodToggle(body, ['7d', '30d', '90d', '1y'], this.tsPeriod, (p) => {
      this.tsPeriod = p;
      setActive(p);
      this.refreshChart(chartDiv);
    });

    const chartDiv = document.createElement('div');
    chartDiv.style.position = 'relative';
    body.appendChild(chartDiv);

    await this.refreshChart(chartDiv);
  }

  private async refreshChart(chartDiv: HTMLElement): Promise<void> {
    // Revenue panel uses total DeFi TVL as a proxy trend (DeFiLlama doesn't expose historical revenue for all protocols)
    try {
      const res = await fetch(`/api/historical-tvl?type=total&period=${this.tsPeriod}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const series = (json.series || []).map((s: { name: string; data: { date: string; value: number }[] }) => ({
        name: 'DeFi TVL',
        data: s.data,
        color: '#ff9800',
      }));

      if (this.tsChart) {
        this.tsChart.update(series);
      } else {
        this.tsChart = new TimeSeriesChart({
          container: chartDiv,
          series,
          height: 180,
          yAxisFormat: 'currency',
          showLegend: false,
        });
        this.resizeObserver?.disconnect();
        this.resizeObserver = new ResizeObserver(() => this.tsChart?.resize());
        this.resizeObserver.observe(chartDiv);
      }
    } catch {
      chartDiv.innerHTML = '<div class="ts-chart-loading">Failed to load chart</div>';
    }
  }
}
