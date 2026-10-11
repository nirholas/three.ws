import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatTvl } from '@/utils/defi-format';

// =============================================================================
// Types
// =============================================================================

interface PoolRaw {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  poolMeta: string | null;
  stablecoin: boolean;
}

interface DisplayPool {
  key: string;
  chain: string;
  project: string;
  symbol: string;
  tvl: number;
  apy: number;
}

// =============================================================================
// Helpers
// =============================================================================



function getApyColor(apy: number): string {
  if (apy > 50) return 'var(--red)';
  if (apy > 20) return 'var(--yellow)';
  if (apy > 5) return 'var(--green)';
  return '#4488ff';
}

function getApyLabel(apy: number): string {
  if (apy > 50) return 'defi-apy-hot';
  if (apy > 20) return 'defi-apy-warm';
  if (apy > 5) return 'defi-apy-good';
  return 'defi-apy-low';
}

function chainBadgeColor(chain: string): string {
  const colors: Record<string, string> = {
    Ethereum: '#627eea', Arbitrum: '#28a0f0', Base: '#0052ff', Optimism: '#ff0420',
    Polygon: '#8247e5', BSC: '#f0b90b', Avalanche: '#e84142', Solana: '#9945ff',
    Fantom: '#1969ff', Gnosis: '#04795b',
  };
  return colors[chain] || '#888';
}

// =============================================================================
// Panel
// =============================================================================

export class DeFiScannerPanel extends Panel {
  private pools: DisplayPool[] = [];
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private sortField: 'apy' | 'tvl' = 'apy';
  private sortDir: 'asc' | 'desc' = 'desc';
  private filterChain = '';

  constructor() {
    super({ id: 'defi-scanner', title: 'DeFi Scanner', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60_000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();

    try {
      const res = await fetch('/api/defi-yields?minTvl=1000000', { signal: this.abortController.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { pools?: PoolRaw[]; unavailable?: boolean };

      const rawPools = json.pools ?? [];
      if (json.unavailable) {
        this.setDataBadge('unavailable');
      } else {
        this.setDataBadge('live');
      }

      this.pools = rawPools
        .filter(p => p.apy > 1)
        .sort((a, b) => b.apy - a.apy)
        .slice(0, 30)
        .map(p => ({
          key: p.pool,
          chain: p.chain,
          project: p.project,
          symbol: p.symbol,
          tvl: p.tvlUsd,
          apy: p.apy,
        }));

      this.error = null;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
      this.setDataBadge('unavailable');
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private getSortedPools(): DisplayPool[] {
    let filtered = this.pools;
    if (this.filterChain) {
      filtered = filtered.filter(p => p.chain === this.filterChain);
    }
    const sorted = [...filtered].sort((a, b) => {
      const va = a[this.sortField];
      const vb = b[this.sortField];
      return this.sortDir === 'desc' ? vb - va : va - vb;
    });
    return sorted.slice(0, 15);
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Scanning DeFi yields...'); return; }
    if (this.error || this.pools.length === 0) {
      this.showError(this.error || 'No yield data available');
      return;
    }

    const displayPools = this.getSortedPools();
    this.setCount(displayPools.length);

    const chains = [...new Set(this.pools.map(p => p.chain))].sort();

    const html = `
      <div class="defi-scanner-header">
        <div class="defi-scanner-legend">
          <span class="defi-scanner-legend-label">APY risk:</span>
          <span class="defi-scanner-legend-item"><span class="defi-scanner-dot" style="background:#4488ff"></span>&lt;5%</span>
          <span class="defi-scanner-legend-item"><span class="defi-scanner-dot" style="background:var(--green)"></span>5-20%</span>
          <span class="defi-scanner-legend-item"><span class="defi-scanner-dot" style="background:var(--yellow)"></span>20-50%</span>
          <span class="defi-scanner-legend-item"><span class="defi-scanner-dot" style="background:var(--red)"></span>&gt;50%</span>
        </div>
        <select class="defi-scanner-chain-filter" title="Filter by chain">
          <option value="">All Chains</option>
          ${chains.map(c => `<option value="${escapeHtml(c)}"${this.filterChain === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
      <table class="defi-scanner-table">
        <thead>
          <tr>
            <th>Chain</th>
            <th>Project</th>
            <th>Pool</th>
            <th class="defi-scanner-sortable" data-sort="tvl">TVL ${this.sortField === 'tvl' ? (this.sortDir === 'desc' ? '▼' : '▲') : ''}</th>
            <th class="defi-scanner-sortable" data-sort="apy">APY ${this.sortField === 'apy' ? (this.sortDir === 'desc' ? '▼' : '▲') : ''}</th>
          </tr>
        </thead>
        <tbody>
          ${displayPools.map(p => {
            const color = chainBadgeColor(p.chain);
            return `
            <tr class="defi-scanner-row">
              <td><span class="defi-scanner-chain" style="background:${color}22;color:${color};border:1px solid ${color}44">${escapeHtml(p.chain)}</span></td>
              <td class="defi-scanner-project">${escapeHtml(p.project)}</td>
              <td class="defi-scanner-symbol">${escapeHtml(p.symbol)}</td>
              <td class="defi-scanner-tvl">${formatTvl(p.tvl)}</td>
              <td><span class="${getApyLabel(p.apy)}" style="color:${getApyColor(p.apy)}">${p.apy.toFixed(2)}%</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;

    this.setContent(html);
    this.bindEvents();
  }

  private bindEvents(): void {
    const filter = this.content.querySelector('.defi-scanner-chain-filter') as HTMLSelectElement | null;
    if (filter) {
      filter.addEventListener('change', () => {
        this.filterChain = filter.value;
        this.renderPanel();
      });
    }
    const sortHeaders = this.content.querySelectorAll('.defi-scanner-sortable');
    sortHeaders.forEach(th => {
      th.addEventListener('click', () => {
        const field = (th as HTMLElement).dataset.sort as 'apy' | 'tvl';
        if (this.sortField === field) {
          this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          this.sortField = field;
          this.sortDir = 'desc';
        }
        this.renderPanel();
      });
    });
  }
}
