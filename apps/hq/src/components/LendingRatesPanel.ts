import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatTvl } from '@/utils/defi-format';
import type { LendingRatesResult, LendingAsset, LendingRate } from '@/types';

const CHAIN_COLORS: Record<string, string> = {
  Ethereum: '#627eea',
  Arbitrum: '#28a0f0',
  Base: '#0052ff',
  Optimism: '#ff0420',
  Polygon: '#8247e5',
  BSC: '#f0b90b',
  Avalanche: '#e84142',
  Solana: '#9945ff',
  Tron: '#ff0013',
};

function chainBadge(chain: string): string {
  const color = CHAIN_COLORS[chain] || '#888';
  return `<span class="lending-chain-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${escapeHtml(chain)}</span>`;
}

function apyBarHtml(value: number, maxApy: number, type: 'supply' | 'borrow'): string {
  const pct = maxApy > 0 ? Math.min(100, (value / maxApy) * 100) : 0;
  return `<div class="lending-apy-bar ${type}"><div class="lending-apy-fill" style="width:${pct}%"></div><span class="lending-apy-value">${value.toFixed(2)}%</span></div>`;
}

function utilizationBarHtml(util: number): string {
  const pct = Math.round(util * 100);
  const cls = pct >= 90 ? 'high' : pct >= 70 ? 'med' : 'low';
  return `<div class="lending-util-bar"><div class="lending-util-fill ${cls}" style="width:${pct}%"></div><span class="lending-util-label">${pct}%</span></div>`;
}

export class LendingRatesPanel extends Panel {
  private data: LendingRatesResult | null = null;
  private selectedAsset = 'USDC';
  private selectedProtocol = '';
  private viewMode: 'asset' | 'protocol' = 'asset';
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'lending-rates',
      title: 'Lending Rates',
      showCount: true,
      infoTooltip: 'Compare supply and borrow rates across DeFi lending protocols. Data from DeFiLlama.',
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60_000);
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
      const res = await fetch('/api/lending-rates', { signal });
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
    if (this.loading) { this.showLoading('Loading lending rates...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    if (!d.assets.length) {
      this.setContent('<div class="panel-loading-text">Lending rate data temporarily unavailable</div>');
      return;
    }

    this.setCount(d.summary.assetCount);

    // Set default selected protocol if needed
    if (!this.selectedProtocol && d.protocols.length > 0) {
      this.selectedProtocol = d.protocols[0] ?? '';
    }

    const summaryHtml = this.renderSummary(d);
    const viewToggle = this.renderViewToggle();
    const bodyHtml = this.viewMode === 'asset'
      ? this.renderAssetView(d)
      : this.renderProtocolView(d);

    this.setContent(`${summaryHtml}${viewToggle}${bodyHtml}`);
    this.bindEvents();
  }

  private renderSummary(d: LendingRatesResult): string {
    const bestSupply = d.summary.bestOverallSupply;
    const lowestBorrow = d.summary.lowestBorrow;
    return `
      <div class="lending-summary">
        <div class="lending-stat">
          <span class="lending-stat-value">${d.summary.avgSupplyAPY.toFixed(2)}%</span>
          <span class="lending-stat-label">Avg Supply</span>
        </div>
        <div class="lending-stat">
          <span class="lending-stat-value">${d.summary.avgBorrowAPY.toFixed(2)}%</span>
          <span class="lending-stat-label">Avg Borrow</span>
        </div>
        <div class="lending-stat">
          <span class="lending-stat-value">${bestSupply ? `${bestSupply.apy.toFixed(1)}%` : '-'}</span>
          <span class="lending-stat-label">${bestSupply ? `Best ${escapeHtml(bestSupply.asset)}` : 'Best Supply'}</span>
        </div>
        <div class="lending-stat">
          <span class="lending-stat-value">${lowestBorrow ? `${lowestBorrow.apy.toFixed(1)}%` : '-'}</span>
          <span class="lending-stat-label">${lowestBorrow ? `Cheapest ${escapeHtml(lowestBorrow.asset)}` : 'Low Borrow'}</span>
        </div>
      </div>`;
  }

  private renderViewToggle(): string {
    return `
      <div class="lending-view-toggle">
        <button class="lending-toggle-btn${this.viewMode === 'asset' ? ' active' : ''}" data-view="asset">By Asset</button>
        <button class="lending-toggle-btn${this.viewMode === 'protocol' ? ' active' : ''}" data-view="protocol">By Protocol</button>
      </div>`;
  }

  private renderAssetView(d: LendingRatesResult): string {
    const tabsHtml = d.assets.map(a =>
      `<button class="lending-asset-tab${a.symbol === this.selectedAsset ? ' active' : ''}" data-asset="${escapeHtml(a.symbol)}">${escapeHtml(a.symbol)}</button>`
    ).join('');

    const asset = d.assets.find(a => a.symbol === this.selectedAsset) || d.assets[0];
    if (!asset) return '<div class="panel-loading-text">No asset data</div>';

    // Update selected in case we fell back
    this.selectedAsset = asset.symbol;

    const maxApy = Math.max(...asset.rates.map(r => Math.max(r.netSupplyAPY, r.netBorrowAPY, 1)));

    const rowsHtml = asset.rates.map(r => {
      const isBestSupply = r.protocol === asset.bestSupply.protocol && r.chain === asset.bestSupply.chain;
      const isBestBorrow = r.protocol === asset.bestBorrow.protocol && r.chain === asset.bestBorrow.chain && asset.bestBorrow.apy > 0;

      return `
        <div class="lending-rate-row">
          <div class="lending-rate-info">
            <span class="lending-protocol-name">${escapeHtml(r.protocol)}</span>
            ${chainBadge(r.chain)}
            ${isBestSupply ? '<span class="lending-best-badge supply" title="Best supply rate">★ Best Supply</span>' : ''}
            ${isBestBorrow ? '<span class="lending-best-badge borrow" title="Lowest borrow rate">★ Best Borrow</span>' : ''}
          </div>
          <div class="lending-rate-bars">
            <div class="lending-bar-group">
              <span class="lending-bar-label">Supply</span>
              ${apyBarHtml(r.netSupplyAPY, maxApy, 'supply')}
              ${r.rewardAPY > 0 ? `<span class="lending-reward-apy" title="Includes reward APY">+${r.rewardAPY.toFixed(1)}% reward</span>` : ''}
            </div>
            <div class="lending-bar-group">
              <span class="lending-bar-label">Borrow</span>
              ${r.borrowAPY > 0 ? apyBarHtml(r.netBorrowAPY, maxApy, 'borrow') : '<span class="lending-apy-value na">N/A</span>'}
            </div>
          </div>
          <div class="lending-rate-meta">
            ${utilizationBarHtml(r.utilization)}
            <span class="lending-tvl">${formatTvl(r.tvl)}</span>
          </div>
        </div>`;
    }).join('');

    const spreadText = asset.spread !== 0 ? `Spread: ${Math.abs(asset.spread).toFixed(2)}%` : '';

    return `
      <div class="lending-asset-tabs">${tabsHtml}</div>
      <div class="lending-asset-header">
        <span class="lending-asset-name">${escapeHtml(asset.name)} (${escapeHtml(asset.symbol)})</span>
        ${spreadText ? `<span class="lending-spread">${spreadText}</span>` : ''}
      </div>
      <div class="lending-rate-table-header">
        <span>Protocol</span>
        <span>Rates</span>
        <span>Util / TVL</span>
      </div>
      <div class="lending-rates-list">${rowsHtml}</div>`;
  }

  private renderProtocolView(d: LendingRatesResult): string {
    const tabsHtml = d.protocols.map(p =>
      `<button class="lending-asset-tab${p === this.selectedProtocol ? ' active' : ''}" data-protocol="${escapeHtml(p)}">${escapeHtml(p)}</button>`
    ).join('');

    const protoName = this.selectedProtocol || d.protocols[0];
    if (!protoName) return '<div class="panel-loading-text">No protocol data</div>';

    // Gather all assets that have this protocol
    const protoAssets: { asset: LendingAsset; rate: LendingRate }[] = [];
    for (const asset of d.assets) {
      for (const rate of asset.rates) {
        if (rate.protocol === protoName) {
          protoAssets.push({ asset, rate });
        }
      }
    }

    if (protoAssets.length === 0) {
      return `<div class="lending-asset-tabs">${tabsHtml}</div><div class="panel-loading-text">No data for ${escapeHtml(protoName)}</div>`;
    }

    const maxApy = Math.max(...protoAssets.map(pa => Math.max(pa.rate.netSupplyAPY, pa.rate.netBorrowAPY, 1)));

    const rowsHtml = protoAssets.map(({ asset, rate }) => `
      <div class="lending-rate-row">
        <div class="lending-rate-info">
          <span class="lending-protocol-name">${escapeHtml(asset.symbol)}</span>
          ${chainBadge(rate.chain)}
        </div>
        <div class="lending-rate-bars">
          <div class="lending-bar-group">
            <span class="lending-bar-label">Supply</span>
            ${apyBarHtml(rate.netSupplyAPY, maxApy, 'supply')}
            ${rate.rewardAPY > 0 ? `<span class="lending-reward-apy">+${rate.rewardAPY.toFixed(1)}%</span>` : ''}
          </div>
          <div class="lending-bar-group">
            <span class="lending-bar-label">Borrow</span>
            ${rate.borrowAPY > 0 ? apyBarHtml(rate.netBorrowAPY, maxApy, 'borrow') : '<span class="lending-apy-value na">N/A</span>'}
          </div>
        </div>
        <div class="lending-rate-meta">
          ${utilizationBarHtml(rate.utilization)}
          <span class="lending-tvl">${formatTvl(rate.tvl)}</span>
        </div>
      </div>
    `).join('');

    return `
      <div class="lending-asset-tabs">${tabsHtml}</div>
      <div class="lending-asset-header">
        <span class="lending-asset-name">${escapeHtml(protoName)}</span>
        <span class="lending-spread">${protoAssets.length} assets</span>
      </div>
      <div class="lending-rate-table-header">
        <span>Asset</span>
        <span>Rates</span>
        <span>Util / TVL</span>
      </div>
      <div class="lending-rates-list">${rowsHtml}</div>`;
  }

  private bindEvents(): void {
    // View toggle
    this.content.querySelectorAll('.lending-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = (btn as HTMLElement).dataset.view as 'asset' | 'protocol';
        if (view && view !== this.viewMode) {
          this.viewMode = view;
          this.renderPanel();
        }
      });
    });

    // Asset tabs (asset view)
    this.content.querySelectorAll('.lending-asset-tab[data-asset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const asset = (btn as HTMLElement).dataset.asset;
        if (asset && asset !== this.selectedAsset) {
          this.selectedAsset = asset;
          this.renderPanel();
        }
      });
    });

    // Protocol tabs (protocol view)
    this.content.querySelectorAll('.lending-asset-tab[data-protocol]').forEach(btn => {
      btn.addEventListener('click', () => {
        const proto = (btn as HTMLElement).dataset.protocol;
        if (proto && proto !== this.selectedProtocol) {
          this.selectedProtocol = proto;
          this.renderPanel();
        }
      });
    });

    // Click on rate rows to open detail
    this.content.querySelectorAll('.lending-rate-row').forEach(row => {
      (row as HTMLElement).style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const protocolName = row.querySelector('.lending-protocol-name')?.textContent;
        if (protocolName) {
          window.dispatchEvent(new CustomEvent('detail:open', {
            detail: { type: 'protocol', data: { name: protocolName } },
          }));
        }
      });
    });
  }
}
