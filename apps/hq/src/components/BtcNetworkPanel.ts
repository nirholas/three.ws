import { Panel } from './Panel';

interface BtcNetworkResult {
  timestamp: string;
  fees: { fastest: number; halfHour: number; hour: number; economy: number; minimum: number };
  mempool: { txCount: number; vsizeVMB: number; totalFeesBTC: number; congestion: string };
  difficulty: { progressPercent: number | null; changePercent: number | null; remainingBlocks: number | null; estimatedRetargetDate: number | null };
  hashrate: { currentEHs: number | null; currentDifficultyT: number | null };
  tipHeight: number;
}

function congestionClass(level: string): string {
  if (level === 'LOW') return 'btcnet-low';
  if (level === 'MODERATE') return 'btcnet-moderate';
  return 'btcnet-high';
}

export class BtcNetworkPanel extends Panel {
  private data: BtcNetworkResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({ id: 'btc-network', title: 'Bitcoin Network', showCount: false });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 60000); // fee tiers move block to block
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
      const res = await fetch('/api/btc-network', { signal });
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
    if (this.loading) { this.showLoading('Fetching Bitcoin network data...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    const diffChange = d.difficulty.changePercent;
    const diffProgress = d.difficulty.progressPercent;

    const html = `
      <div class="btcnet-summary">
        <div class="btcnet-stat">
          <span class="btcnet-stat-value ${congestionClass(d.mempool.congestion)}">${d.fees.fastest}</span>
          <span class="btcnet-stat-label">Fast (sat/vB)</span>
        </div>
        <div class="btcnet-stat">
          <span class="btcnet-stat-value">${d.mempool.txCount.toLocaleString()}</span>
          <span class="btcnet-stat-label">Mempool TXs</span>
        </div>
        <div class="btcnet-stat">
          <span class="btcnet-stat-value">${d.hashrate.currentEHs != null ? `${d.hashrate.currentEHs}` : '-'}</span>
          <span class="btcnet-stat-label">Hashrate (EH/s)</span>
        </div>
        <div class="btcnet-stat">
          <span class="btcnet-stat-value ${congestionClass(d.mempool.congestion)}">${d.mempool.congestion}</span>
          <span class="btcnet-stat-label">Congestion</span>
        </div>
      </div>
      <div class="btcnet-fees">
        ${[
          ['Fastest', d.fees.fastest], ['30 min', d.fees.halfHour],
          ['1 hour', d.fees.hour], ['Economy', d.fees.economy],
        ].map(([label, v]) => `
          <div class="btcnet-fee-tier">
            <span class="btcnet-fee-label">${label}</span>
            <span class="btcnet-fee-value">${v} sat/vB</span>
          </div>`).join('')}
      </div>
      <div class="btcnet-footer">
        <span title="Current chain tip">Block ${d.tipHeight.toLocaleString()}</span>
        <span title="Mempool backlog in virtual megabytes">${d.mempool.vsizeVMB} vMB backlog</span>
        ${diffProgress != null && diffChange != null ? `
          <span title="Progress to next difficulty retarget">Retarget ${diffProgress.toFixed(0)}%
            <span class="${diffChange >= 0 ? 'positive' : 'negative'}">(${diffChange >= 0 ? '+' : ''}${diffChange.toFixed(2)}%)</span>
          </span>` : ''}
      </div>
    `;
    this.setContent(html);
  }
}
