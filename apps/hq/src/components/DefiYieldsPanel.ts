import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatTvl } from '@/utils/defi-format';

interface PoolData {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  apyBase: number | null;
  apyReward: number | null;
  il7d: number | null;
  apyMean30d: number | null;
  stablecoin: boolean;
  volumeUsd7d: number | null;
}

interface YieldsResult {
  timestamp: string;
  pools: PoolData[];
  summary: { poolCount: number; avgApy: number; totalTvl: number; topChain: string };
  unavailable?: boolean;
}



function apyClass(apy: number): string {
  if (apy >= 20) return 'apy-hot';
  if (apy >= 10) return 'apy-good';
  if (apy >= 5) return 'apy-ok';
  return 'apy-low';
}

function chainBadge(chain: string): string {
  const colors: Record<string, string> = {
    Ethereum: '#627eea', Arbitrum: '#28a0f0', Base: '#0052ff', Optimism: '#ff0420',
    Polygon: '#8247e5', BSC: '#f0b90b', Avalanche: '#e84142', Solana: '#9945ff',
  };
  const color = colors[chain] || '#888';
  return `<span class="chain-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${escapeHtml(chain)}</span>`;
}

export class DefiYieldsPanel extends Panel {
  private data: YieldsResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private filterChain = '';
  private filterStable = false;

  constructor() {
    super({ id: 'defi-yields', title: 'DeFi Yields', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60000);
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
      const params = new URLSearchParams();
      if (this.filterChain) params.set('chain', this.filterChain);
      const res = await fetch(`/api/defi-yields?${params}`, { signal });
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
    if (this.loading) { this.showLoading('Loading yields...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    if (!d.pools.length) {
      this.setContent('<div class="panel-loading-text">Yield data temporarily unavailable</div>');
      return;
    }

    this.setCount(d.summary.poolCount);

    let pools = d.pools;
    if (this.filterStable) pools = pools.filter(p => p.stablecoin);

    const html = `
      <div class="defi-yields-summary">
        <div class="yield-stat"><span class="yield-stat-value">${formatTvl(d.summary.totalTvl)}</span><span class="yield-stat-label">Total TVL</span></div>
        <div class="yield-stat"><span class="yield-stat-value">${d.summary.avgApy.toFixed(1)}%</span><span class="yield-stat-label">Avg APY</span></div>
        <div class="yield-stat"><span class="yield-stat-value">${d.summary.topChain}</span><span class="yield-stat-label">Top Chain</span></div>
      </div>
      <div class="defi-yields-filters">
        <select class="yield-chain-filter" title="Filter by chain">
          <option value="">All Chains</option>
          <option value="Ethereum"${this.filterChain === 'Ethereum' ? ' selected' : ''}>Ethereum</option>
          <option value="Arbitrum"${this.filterChain === 'Arbitrum' ? ' selected' : ''}>Arbitrum</option>
          <option value="Base"${this.filterChain === 'Base' ? ' selected' : ''}>Base</option>
          <option value="Optimism"${this.filterChain === 'Optimism' ? ' selected' : ''}>Optimism</option>
          <option value="BSC"${this.filterChain === 'BSC' ? ' selected' : ''}>BSC</option>
          <option value="Solana"${this.filterChain === 'Solana' ? ' selected' : ''}>Solana</option>
        </select>
        <label class="yield-stable-filter"><input type="checkbox" class="stable-only-cb"${this.filterStable ? ' checked' : ''}> Stables only</label>
      </div>
      <div class="defi-yields-list">
        ${pools.slice(0, 20).map(p => `
          <div class="yield-row">
            <div class="yield-info">
              <span class="yield-project">${escapeHtml(p.project)}</span>
              <span class="yield-symbol">${escapeHtml(p.symbol)}</span>
              ${chainBadge(p.chain)}
              ${p.stablecoin ? '<span class="stable-tag">STABLE</span>' : ''}
            </div>
            <div class="yield-metrics">
              <span class="yield-apy ${apyClass(p.apy)}">${p.apy.toFixed(2)}%</span>
              <span class="yield-tvl">${formatTvl(p.tvlUsd)}</span>
              ${p.apyBase != null ? `<span class="yield-base" title="Base APY">${p.apyBase.toFixed(1)}%b</span>` : ''}
              ${p.apyReward != null && p.apyReward > 0 ? `<span class="yield-reward" title="Reward APY">+${p.apyReward.toFixed(1)}%r</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    this.setContent(html);
    this.setupFilters();
    this.bindClicks(pools.slice(0, 20));
  }

  private bindClicks(pools: PoolData[]): void {
    const rows = this.content.querySelectorAll('.yield-row');
    rows.forEach((row, i) => {
      const p = pools[i];
      if (!p) return;
      (row as HTMLElement).style.cursor = 'pointer';
      row.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'protocol', data: { name: p.project, topPool: { pool: p.pool, apy: p.apy, tvl: p.tvlUsd } } }
        }));
      });
    });
  }

  private setupFilters(): void {
    const chainSelect = this.element.querySelector('.yield-chain-filter') as HTMLSelectElement;
    const stableCb = this.element.querySelector('.stable-only-cb') as HTMLInputElement;

    chainSelect?.addEventListener('change', () => {
      this.filterChain = chainSelect.value;
      void this.fetchData();
    });

    stableCb?.addEventListener('change', () => {
      this.filterStable = stableCb.checked;
      this.renderPanel();
    });
  }
}
