import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatUsdPrecise as formatUsd } from '@/utils/defi-format';
import { TimeSeriesChart, createPeriodToggle } from '@/utils/d3-timeseries';

interface DexEntry {
  name: string;
  displayName: string;
  chains: string[];
  dailyVolume: number;
  change1d: number;
  change7d: number;
  change1m: number;
}

interface ChainEntry {
  chain: string;
  volume: number;
  dexCount: number;
}

interface DexVolResult {
  timestamp: string;
  dexes: DexEntry[];
  chainRanking: ChainEntry[];
  focusedChains: ChainEntry[];
  summary: { totalDailyVolume: number; topDex: string | null; topDexVolume: number; dexCount: number; topChain: string | null };
  unavailable?: boolean;
}

const CHAIN_COLORS: Record<string, string> = {
  Ethereum: '#627eea', Solana: '#9945ff', BSC: '#f0b90b', Base: '#0052ff',
  Arbitrum: '#28a0f0', Polygon: '#8247e5', Optimism: '#ff0420', Avalanche: '#e84142',
};



function changeClass(pct: number): string {
  if (pct > 20) return 'dv-surge';
  if (pct > 0) return 'dv-up';
  if (pct < -20) return 'dv-drop';
  if (pct < 0) return 'dv-down';
  return '';
}

export class DexVolumePanel extends Panel {
  private data: DexVolResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private viewMode: 'dexes' | 'chains' = 'dexes';
  private tsChart: TimeSeriesChart | null = null;
  private tsChartExpanded = false;
  private tsPeriod = '30d';
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    super({ id: 'dex-volume', title: 'DEX Volume', showCount: true });
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
      const res = await fetch('/api/dex-volume', { signal });
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

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading DEX volumes...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }
    const d = this.data;
    if (d.unavailable) { this.showError('DEX volume data temporarily unavailable'); return; }
    if (!d.dexes.length) {
      this.setContent('<div class="panel-loading-text">DEX volume data temporarily unavailable</div>');
      return;
    }

    this.setCount(d.dexes.length);

    const html = `
      <div class="dv-summary">
        <div class="dv-stat">
          <span class="dv-stat-value">${formatUsd(d.summary.totalDailyVolume)}</span>
          <span class="dv-stat-label">24h Volume</span>
        </div>
        <div class="dv-stat">
          <span class="dv-stat-value">${d.summary.dexCount}</span>
          <span class="dv-stat-label">Active DEXes</span>
        </div>
        <div class="dv-stat">
          <span class="dv-stat-value">${d.summary.topDex ? escapeHtml(d.summary.topDex) : '-'}</span>
          <span class="dv-stat-label">#1 DEX</span>
        </div>
      </div>
      <div class="dv-view-toggle">
        <button class="dv-toggle-btn ${this.viewMode === 'dexes' ? 'active' : ''}" data-view="dexes">Top DEXes</button>
        <button class="dv-toggle-btn ${this.viewMode === 'chains' ? 'active' : ''}" data-view="chains">By Chain</button>
      </div>
      ${this.viewMode === 'dexes' ? this.renderDexes(d) : this.renderChains(d)}
    `;

    this.setContent(html);

    this.content.querySelectorAll('.dv-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.viewMode = ((btn as HTMLElement).dataset.view || 'dexes') as 'dexes' | 'chains';
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
    header.innerHTML = '<span class="ts-chart-title">Volume Trend</span><span class="ts-chart-toggle">▼</span>';
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
      const res = await fetch(`/api/historical-volume?period=${this.tsPeriod}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const series = (json.series || []).map((s: { name: string; data: { date: string; value: number }[] }) => ({
        name: s.name,
        data: s.data,
        color: '#28a0f0',
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

  private renderDexes(d: DexVolResult): string {
    const maxVol = d.dexes[0]?.dailyVolume || 1;
    return `
      <div class="dv-dex-list">
        ${d.dexes.slice(0, 20).map((dx, i) => {
          const barWidth = (dx.dailyVolume / maxVol) * 100;
          const chainTags = dx.chains.slice(0, 4).map(c => {
            const color = CHAIN_COLORS[c] || '#888';
            return `<span class="dv-chain-tag" style="background:${color}20;color:${color}">${escapeHtml(c)}</span>`;
          }).join('');
          return `
            <div class="dv-dex-row">
              <div class="dv-dex-header">
                <span class="dv-rank">${i + 1}</span>
                <span class="dv-dex-name">${escapeHtml(dx.displayName)}</span>
                <span class="dv-dex-vol">${formatUsd(dx.dailyVolume)}</span>
              </div>
              <div class="dv-dex-bar" style="width:${barWidth}%">
                <div class="dv-dex-changes">
                  <span class="${changeClass(dx.change1d)}">1d: ${dx.change1d > 0 ? '+' : ''}${dx.change1d.toFixed(0)}%</span>
                  <span class="${changeClass(dx.change7d)}">7d: ${dx.change7d > 0 ? '+' : ''}${dx.change7d.toFixed(0)}%</span>
                </div>
              </div>
              <div class="dv-dex-chains">${chainTags}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  private renderChains(d: DexVolResult): string {
    const maxVol = d.chainRanking[0]?.volume || 1;
    return `
      <div class="dv-chain-list">
        ${d.chainRanking.slice(0, 12).map(c => {
          const barWidth = (c.volume / maxVol) * 100;
          const color = CHAIN_COLORS[c.chain] || '#888';
          const pct = d.summary.totalDailyVolume > 0 ? ((c.volume / d.summary.totalDailyVolume) * 100).toFixed(1) : '0';
          return `
            <div class="dv-chain-row">
              <div class="dv-chain-header">
                <span class="dv-chain-name" style="color:${color}">${escapeHtml(c.chain)}</span>
                <span class="dv-chain-vol">${formatUsd(c.volume)}</span>
                <span class="dv-chain-pct">${pct}%</span>
              </div>
              <div class="dv-chain-bar-wrap">
                <div class="dv-chain-bar" style="width:${barWidth}%;background:${color}40;border-left:3px solid ${color}"></div>
              </div>
              <span class="dv-chain-dexes">${c.dexCount} DEXes</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
}
