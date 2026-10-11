import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface GasChain {
  name: string;
  gasGwei: number;
  unit: string;
  level: string;
  costEstimate: {
    transfer: number;
    swap: number;
    complex: number;
  };
}

interface GasResult {
  timestamp: string;
  chains: GasChain[];
  summary: { chainCount: number; cheapestChain: string; cheapestGas: number | null; ethGas: number | null; ethLevel: string };
  unavailable?: boolean;
}

const CHAIN_COLORS: Record<string, string> = {
  Ethereum: '#627eea', Arbitrum: '#28a0f0', Base: '#0052ff', Optimism: '#ff0420',
  Polygon: '#8247e5', BSC: '#f0b90b', Avalanche: '#e84142',
};

function levelClass(level: string): string {
  if (level === 'LOW') return 'gas-low';
  if (level === 'MODERATE') return 'gas-moderate';
  return 'gas-high';
}

function levelIcon(level: string): string {
  if (level === 'LOW') return '🟢';
  if (level === 'MODERATE') return '🟡';
  return '🔴';
}

export class GasTrackerPanel extends Panel {
  private data: GasResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({ id: 'gas-tracker', title: 'Gas Tracker', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 30000); // 30s refresh
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
      const res = await fetch('/api/gas-tracker', { signal });
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

  private formatGas(gwei: number): string {
    if (gwei >= 1) return gwei.toFixed(2);
    if (gwei >= 0.01) return gwei.toFixed(4);
    if (gwei >= 0.001) return gwei.toFixed(5);
    return gwei.toFixed(6);
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Fetching gas prices...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    if (d.unavailable) { this.showError('Gas data temporarily unavailable'); return; }
    if (!d.chains.length) {
      this.setContent('<div class="panel-loading-text">Gas data temporarily unavailable</div>');
      return;
    }

    this.setCount(d.summary.chainCount);

    const sorted = [...d.chains].sort((a, b) => a.gasGwei - b.gasGwei);

    const html = `
      <div class="gas-summary">
        <div class="gas-stat">
          <span class="gas-stat-value ${levelClass(d.summary.ethLevel)}">${d.summary.ethGas != null ? this.formatGas(d.summary.ethGas) : '-'}</span>
          <span class="gas-stat-label">ETH Gas (gwei)</span>
        </div>
        <div class="gas-stat">
          <span class="gas-stat-value gas-low">${escapeHtml(d.summary.cheapestChain)}</span>
          <span class="gas-stat-label">Cheapest Chain</span>
        </div>
      </div>
      <div class="gas-grid">
        ${sorted.map(c => {
          const color = CHAIN_COLORS[c.name] || '#888';
          return `
            <div class="gas-card ${levelClass(c.level)}">
              <div class="gas-chain-header">
                <span class="gas-chain-name" style="color:${color}">${escapeHtml(c.name)}</span>
                <span class="gas-level-icon">${levelIcon(c.level)}</span>
              </div>
              <div class="gas-price">${this.formatGas(c.gasGwei)} <span class="gas-unit">${escapeHtml(c.unit)}</span></div>
              <div class="gas-costs">
                <span class="gas-cost" title="Simple transfer">Send: ${c.costEstimate.transfer.toFixed(6)}</span>
                <span class="gas-cost" title="DEX swap">Swap: ${c.costEstimate.swap.toFixed(6)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div style="text-align:center;margin-top:12px">
        <span class="gas-eth-link" style="color:#4ecdc4;cursor:pointer;font-size:12px">View ETH details →</span>
      </div>
    `;

    this.setContent(html);

    // Bind click on the ETH link
    const ethLink = this.content.querySelector('.gas-eth-link');
    if (ethLink) {
      ethLink.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'token' as const, data: { symbol: 'ETH', name: 'Ethereum' } },
        }));
      });
    }
  }
}
