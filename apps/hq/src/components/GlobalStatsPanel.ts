import { Panel } from './Panel';
import { formatLargeNumber, formatPct, pctColor, getFearGreedMeta } from '@/utils/defi-format';
import { TimeSeriesChart, createPeriodToggle } from '@/utils/d3-timeseries';

/**
 * Response shape from /api/defi-global-stats.
 * Aggregates DeFiLlama (TVL, DEX, fees) + CoinGecko (dominance) + Alternative.me (F&G).
 */
interface GlobalStatsData {
  timestamp: string;
  totalTvl: number;
  tvlChange24h: number;
  totalProtocols: number;
  defiDominance: number;       // fraction 0-1 (DeFi TVL / crypto market cap)
  btcDominance: number;        // percentage (e.g. 54.3)
  ethDominance: number;        // percentage (e.g. 18.1)
  totalCryptoMarketCap: number;
  dex: { totalVolume24h: number; change24h: number };
  fees: { totalFees24h: number; totalRevenue24h: number };
  fearGreed: { value: number; classification: string };
  unavailable?: boolean;
}

export class GlobalStatsPanel extends Panel {
  private data: GlobalStatsData | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private tsChart: TimeSeriesChart | null = null;
  private tsChartExpanded = false;
  private tsPeriod = '30d';
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    super({ id: 'global-stats', title: 'DeFi Global Stats' });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.tsChart?.destroy();
    this.tsChart = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const res = await fetch('/api/defi-global-stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: GlobalStatsData = await res.json();
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

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading DeFi stats...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    const fg = getFearGreedMeta(d.fearGreed.value);
    const defiDomPct = d.defiDominance > 0 ? (d.defiDominance * 100).toFixed(1) : '-';

    const html = `
      <div class="global-stats-grid" role="group" aria-label="DeFi global statistics">
        ${this.statCard('Total DeFi TVL', formatLargeNumber(d.totalTvl), formatPct(d.tvlChange24h), pctColor(d.tvlChange24h))}
        ${this.statCard('DEX Volume 24h', formatLargeNumber(d.dex.totalVolume24h), formatPct(d.dex.change24h), pctColor(d.dex.change24h))}
        ${this.statCard('Fees / Revenue 24h', formatLargeNumber(d.fees.totalFees24h), `Rev: ${formatLargeNumber(d.fees.totalRevenue24h)}`)}
        ${this.statCard('Fear &amp; Greed', String(d.fearGreed.value), fg.label, fg.color, fg.color)}
        ${this.statCard('Total Protocols', d.totalProtocols > 0 ? d.totalProtocols.toLocaleString() : '-')}
        ${this.statCard('DeFi Dominance', defiDomPct !== '-' ? defiDomPct + '%' : '-')}
        ${this.statCard('BTC Dominance', d.btcDominance > 0 ? d.btcDominance.toFixed(1) + '%' : '-')}
        ${this.statCard('ETH Dominance', d.ethDominance > 0 ? d.ethDominance.toFixed(1) + '%' : '-')}
      </div>
    `;

    this.setContent(html);

    // Add "View Top Protocols" link
    const grid = this.content.querySelector('.global-stats-grid');
    if (grid) {
      const link = document.createElement('div');
      link.style.cssText = 'text-align:right;padding:8px 4px 0;cursor:pointer;color:var(--accent, #28a0f0);font-size:12px';
      link.textContent = 'View Top Protocols →';
      link.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('enable-panel', { detail: { panelId: 'top-protocols' } }));
      });
      grid.parentElement?.appendChild(link);
    }

    this.appendChartSection();
  }

  private appendChartSection(): void {
    const container = document.createElement('div');
    container.className = 'ts-chart-container';

    const header = document.createElement('div');
    header.className = 'ts-chart-header';
    header.innerHTML = '<span class="ts-chart-title">DeFi TVL History</span><span class="ts-chart-toggle">▼</span>';
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
    try {
      const res = await fetch(`/api/historical-tvl?type=total&period=${this.tsPeriod}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const series = (json.series || []).map((s: { name: string; data: { date: string; value: number }[] }) => ({
        name: s.name,
        data: s.data,
        color: '#00c853',
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

  /**
   * Render a single stat card.
   * @param label   - card header text
   * @param value   - primary display value
   * @param extra   - optional secondary line (change %, sub-label)
   * @param extraColor - CSS color for the extra line
   * @param valueColor - CSS color for the value itself
   */
  private statCard(label: string, value: string, extra?: string, extraColor?: string, valueColor?: string): string {
    return `
      <div class="global-stat-card">
        <div class="global-stat-label">${label}</div>
        <div class="global-stat-value"${valueColor ? ` style="color:${valueColor}"` : ''}>${value}</div>
        ${extra ? `<div class="global-stat-change"${extraColor ? ` style="color:${extraColor}"` : ''}>${extra}</div>` : ''}
      </div>
    `;
  }
}
