import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatTvl } from '@/utils/defi-format';
import { TimeSeriesChart, createPeriodToggle } from '@/utils/d3-timeseries';

interface ChainData {
  name: string;
  gecko_id: string;
  tvl: number;
  tokenSymbol: string;
}

interface ChainTvlResult {
  timestamp: string;
  chains: ChainData[];
  summary: { chainCount: number; totalTvl: number; dominantChain: string; ethDominance: number };
  unavailable?: boolean;
}



function barWidth(tvl: number, maxTvl: number): number {
  return maxTvl > 0 ? Math.max(2, (tvl / maxTvl) * 100) : 0;
}

const CHAIN_COLORS: Record<string, string> = {
  Ethereum: '#627eea', BSC: '#f0b90b', Solana: '#9945ff', Tron: '#ff0013',
  Arbitrum: '#28a0f0', Base: '#0052ff', Optimism: '#ff0420', Polygon: '#8247e5',
  Avalanche: '#e84142', Sui: '#4da2ff', Aptos: '#2dd8a3', Fantom: '#1969ff',
  Cardano: '#0033ad', TON: '#0098ea', Mantle: '#000', Blast: '#fcfc03',
  Sei: '#9b1c1c', zkSync: '#4e529a', Cronos: '#002d74', Manta: '#1d1f28',
};

export class ChainTvlPanel extends Panel {
  private data: ChainTvlResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private tsChart: TimeSeriesChart | null = null;
  private tsChartExpanded = false;
  private tsPeriod = '30d';
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    super({ id: 'chain-tvl', title: 'Chain TVL', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60000);
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
      const res = await fetch('/api/chain-tvl', { signal });
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
    if (this.loading) { this.showLoading('Loading chain data...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    if (!d.chains.length) {
      this.setContent('<div class="panel-loading-text">Chain data temporarily unavailable</div>');
      return;
    }

    this.setCount(d.summary.chainCount);
    const maxTvl = d.chains[0]?.tvl || 1;

    const html = `
      <div class="chain-tvl-summary">
        <div class="chain-stat"><span class="chain-stat-value">${formatTvl(d.summary.totalTvl)}</span><span class="chain-stat-label">Total DeFi TVL</span></div>
        <div class="chain-stat"><span class="chain-stat-value">${d.summary.ethDominance}%</span><span class="chain-stat-label">ETH Dominance</span></div>
        <div class="chain-stat"><span class="chain-stat-value">${d.summary.chainCount}</span><span class="chain-stat-label">Active Chains</span></div>
      </div>
      <div class="chain-tvl-list">
        ${d.chains.slice(0, 20).map((c, i) => {
          const color = CHAIN_COLORS[c.name] || '#888';
          const pct = ((c.tvl / d.summary.totalTvl) * 100).toFixed(1);
          return `
            <div class="chain-row">
              <span class="chain-rank">${i + 1}</span>
              <div class="chain-info">
                <span class="chain-name" style="color:${color}">${escapeHtml(c.name)}</span>
                ${c.tokenSymbol ? `<span class="chain-token">${escapeHtml(c.tokenSymbol)}</span>` : ''}
              </div>
              <div class="chain-bar-wrap">
                <div class="chain-bar" style="width:${barWidth(c.tvl, maxTvl)}%;background:${color}"></div>
              </div>
              <div class="chain-numbers">
                <span class="chain-tvl-val">${formatTvl(c.tvl)}</span>
                <span class="chain-pct">${pct}%</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this.setContent(html);
    this.bindClicks();
    this.appendChartSection();
  }

  private appendChartSection(): void {
    const container = document.createElement('div');
    container.className = 'ts-chart-container';

    const header = document.createElement('div');
    header.className = 'ts-chart-header';
    header.innerHTML = '<span class="ts-chart-title">TVL Trend</span><span class="ts-chart-toggle">▼</span>';
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

    const top5 = (this.data?.chains ?? []).slice(0, 5).map(c => c.name);
    if (!top5.length) { body.innerHTML = '<div class="ts-chart-loading">No chain data</div>'; return; }

    const { setActive } = createPeriodToggle(body, ['7d', '30d', '90d', '1y'], this.tsPeriod, (p) => {
      this.tsPeriod = p;
      setActive(p);
      this.refreshChart(chartDiv, top5);
    });

    const chartDiv = document.createElement('div');
    chartDiv.style.position = 'relative';
    body.appendChild(chartDiv);

    await this.refreshChart(chartDiv, top5);
  }

  private async refreshChart(chartDiv: HTMLElement, chainNames: string[]): Promise<void> {
    try {
      const res = await fetch(`/api/historical-tvl?type=chains&chains=${encodeURIComponent(chainNames.join(','))}&period=${this.tsPeriod}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const colors = ['#627eea', '#9945ff', '#f0b90b', '#28a0f0', '#ff0420'];
      const series = (json.series || []).map((s: { name: string; data: { date: string; value: number }[] }, i: number) => ({
        name: s.name,
        data: s.data,
        color: CHAIN_COLORS[s.name] || colors[i % colors.length],
      }));

      if (this.tsChart) {
        this.tsChart.update(series);
      } else {
        this.tsChart = new TimeSeriesChart({
          container: chartDiv,
          series,
          height: 180,
          yAxisFormat: 'currency',
          showLegend: true,
        });
        this.resizeObserver?.disconnect();
        this.resizeObserver = new ResizeObserver(() => this.tsChart?.resize());
        this.resizeObserver.observe(chartDiv);
      }
    } catch {
      chartDiv.innerHTML = '<div class="ts-chart-loading">Failed to load chart</div>';
    }
  }

  private bindClicks(): void {
    const rows = this.content.querySelectorAll('.chain-row');
    const chains = this.data?.chains.slice(0, 20) ?? [];
    rows.forEach((row, i) => {
      const c = chains[i];
      if (!c) return;
      (row as HTMLElement).style.cursor = 'pointer';
      row.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'protocol', data: { name: c.name, tvl: c.tvl, category: 'Chain' } }
        }));
      });
    });
  }
}
