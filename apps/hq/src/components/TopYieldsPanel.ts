import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

// =============================================================================
// Types
// =============================================================================

interface YieldPool {
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
  exposure: string | null;
  volumeUsd7d: number | null;
}

interface YieldResult {
  timestamp: string;
  pools: YieldPool[];
  summary: { poolCount: number; avgApy: number; totalTvl: number; topChain: string };
  unavailable?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

function formatLargeNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function computeYieldScore(pool: YieldPool): number {
  return (
    pool.apy *
    Math.min(pool.tvlUsd / 1_000_000, 10) *
    (pool.stablecoin ? 1.5 : 1) *
    (pool.il7d === null || pool.il7d === 0 ? 1.2 : 0.8)
  );
}

function estimateEarnings(apy: number | null | undefined): string {
  if (apy === null || apy === undefined || Number.isNaN(apy)) return '-';
  return `~$${(10_000 * apy / 100).toFixed(0)}/yr on $10K`;
}

// =============================================================================
// TopYieldsPanel
// =============================================================================

export class TopYieldsPanel extends Panel {
  private data: YieldResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'top-yields', title: 'Top Yields', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60_000);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
  }

  private async fetchData(): Promise<void> {
    try {
      const res = await fetch('/api/defi-yields');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: YieldResult = await res.json();
      this.data = json;
      this.error = null;

      const cacheHeader = res.headers.get('X-Cache');
      if (cacheHeader === 'HIT') this.setDataBadge('cached');
      else this.setDataBadge('live');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
      if (!this.data) this.setDataBadge('unavailable');
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading yield pools...'); return; }
    if (this.error && !this.data) { this.showError(this.error); return; }
    if (!this.data || this.data.unavailable) {
      this.setContent('<div class="panel-loading-text">Yield data temporarily unavailable</div>');
      return;
    }

    const pools = [...this.data.pools]
      .filter(p => p.apy > 0 && p.tvlUsd > 100_000)
      .sort((a, b) => computeYieldScore(b) - computeYieldScore(a))
      .slice(0, 8);

    this.setCount(pools.length);

    if (pools.length === 0) {
      this.setContent('<div class="panel-loading-text">No yield pools available</div>');
      return;
    }

    const summary = this.data.summary;

    const html = `
      <div class="ty-container">
        <div class="ty-summary">
          <div class="ty-stat">
            <span class="ty-stat-value">${summary.poolCount}</span>
            <span class="ty-stat-label">Pools</span>
          </div>
          <div class="ty-stat">
            <span class="ty-stat-value">${summary.avgApy.toFixed(1)}%</span>
            <span class="ty-stat-label">Avg APY</span>
          </div>
          <div class="ty-stat">
            <span class="ty-stat-value">${formatLargeNumber(summary.totalTvl)}</span>
            <span class="ty-stat-label">Total TVL</span>
          </div>
          <div class="ty-stat">
            <span class="ty-stat-value">${escapeHtml(summary.topChain)}</span>
            <span class="ty-stat-label">Top Chain</span>
          </div>
        </div>
        <div class="ty-pools">
          ${pools.map(pool => `
            <div class="ty-card">
              <div class="ty-card-left">
                <span class="ty-card-symbol">${escapeHtml(pool.symbol)}</span>
                <div class="ty-card-meta">
                  <span class="ty-card-project">${escapeHtml(pool.project)}</span>
                  <span class="ty-card-sep">·</span>
                  <span class="ty-card-chain">${escapeHtml(pool.chain)}</span>
                  ${pool.stablecoin ? '<span class="ty-badge ty-badge-stable">Stable</span>' : ''}
                  ${pool.il7d === null || pool.il7d === 0 ? '<span class="ty-badge ty-badge-noil">No IL</span>' : ''}
                </div>
              </div>
              <div class="ty-card-right">
                <span class="ty-card-apy">${pool.apy.toFixed(2)}%</span>
                <span class="ty-card-tvl">TVL ${formatLargeNumber(pool.tvlUsd)}</span>
                <span class="ty-card-earn">${estimateEarnings(pool.apy)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    this.setContent(html);
    this.bindClicks(pools);
  }

  private bindClicks(pools: Array<{ pool: string; project: string; apy: number; tvlUsd: number }>): void {
    const cards = this.content.querySelectorAll('.ty-card');
    cards.forEach((card, i) => {
      const pool = pools[i];
      if (!pool) return;
      (card as HTMLElement).style.cursor = 'pointer';
      card.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'protocol', data: { name: pool.project, topPool: { pool: pool.pool, apy: pool.apy, tvl: pool.tvlUsd } } }
        }));
      });
    });
  }
}
