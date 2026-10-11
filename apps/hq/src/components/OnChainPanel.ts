import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatTvl, formatPct, formatLargeNumber } from '@/utils/defi-format';
import type {
  UniswapPool,
  UniswapSubgraphResult,
  AaveLendingMarket,
  AaveSubgraphResult,
  CompoundMarket,
  CompoundSubgraphResult,
} from '@/types';

type TabId = 'uniswap' | 'aave' | 'compound';

/* ── CSS (injected once) ── */
const STYLE_ID = 'on-chain-panel-styles';
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .on-chain-tabs {
      display: flex;
      gap: 4px;
      padding: 0 0 8px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      margin-bottom: 8px;
    }
    .on-chain-tab {
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 6px;
      color: rgba(255,255,255,.6);
      font-size: 11px;
      font-weight: 600;
      padding: 5px 12px;
      cursor: pointer;
      transition: all .15s;
      white-space: nowrap;
    }
    .on-chain-tab:hover { background: rgba(255,255,255,.1); color: #fff; }
    .on-chain-tab.active { background: rgba(99,102,241,.25); border-color: rgba(99,102,241,.5); color: #a5b4fc; }

    .on-chain-summary {
      display: flex;
      gap: 12px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .on-chain-stat {
      display: flex;
      flex-direction: column;
      min-width: 80px;
    }
    .on-chain-stat-value {
      font-size: 13px;
      font-weight: 700;
      color: #e2e8f0;
    }
    .on-chain-stat-label {
      font-size: 10px;
      color: rgba(255,255,255,.45);
      text-transform: uppercase;
      letter-spacing: .5px;
    }

    .on-chain-list { display: flex; flex-direction: column; gap: 2px; }
    .on-chain-row {
      display: grid;
      grid-template-columns: minmax(90px,1.2fr) auto 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 5px 4px;
      border-radius: 4px;
      font-size: 11px;
      transition: background .12s;
    }
    .on-chain-row:hover { background: rgba(255,255,255,.04); }

    .on-chain-row-lending {
      grid-template-columns: minmax(60px,1fr) 60px 60px 1fr auto;
    }

    .on-chain-pair { font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .on-chain-fee-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 2px 5px;
      border-radius: 4px;
      background: rgba(99,102,241,.2);
      color: #a5b4fc;
      white-space: nowrap;
    }
    .on-chain-fee-badge[data-fee="100"]   { background: rgba(16,185,129,.18); color: #6ee7b7; }
    .on-chain-fee-badge[data-fee="500"]   { background: rgba(59,130,246,.18); color: #93c5fd; }
    .on-chain-fee-badge[data-fee="3000"]  { background: rgba(168,85,247,.18); color: #c4b5fd; }
    .on-chain-fee-badge[data-fee="10000"] { background: rgba(239,68,68,.18); color: #fca5a5; }

    .on-chain-util-bar {
      height: 6px;
      background: rgba(255,255,255,.08);
      border-radius: 3px;
      overflow: hidden;
      min-width: 50px;
    }
    .on-chain-util-fill {
      height: 100%;
      border-radius: 3px;
      transition: width .3s;
    }
    .on-chain-util-fill.low { background: #10b981; }
    .on-chain-util-fill.mid { background: #f59e0b; }
    .on-chain-util-fill.high { background: #ef4444; }

    .on-chain-num { font-variant-numeric: tabular-nums; color: rgba(255,255,255,.7); text-align: right; white-space: nowrap; }
    .on-chain-supply-apy { color: #34d399; font-weight: 600; }
    .on-chain-borrow-apy { color: #fbbf24; font-weight: 600; }
    .on-chain-symbol { font-weight: 600; color: #e2e8f0; }
    .on-chain-col-factor { color: rgba(255,255,255,.5); font-size: 10px; }

    .on-chain-header-row {
      display: grid;
      gap: 8px;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: rgba(255,255,255,.35);
      padding: 0 4px 4px;
      border-bottom: 1px solid rgba(255,255,255,.06);
      margin-bottom: 2px;
    }
    .on-chain-header-row.pool-header {
      grid-template-columns: minmax(90px,1.2fr) auto 1fr auto;
    }
    .on-chain-header-row.lending-header {
      grid-template-columns: minmax(60px,1fr) 60px 60px 1fr auto;
    }
  `;
  document.head.appendChild(style);
}

export class OnChainPanel extends Panel {
  private activeTab: TabId = 'uniswap';
  private uniswapData: UniswapSubgraphResult | null = null;
  private aaveData: AaveSubgraphResult | null = null;
  private compoundData: CompoundSubgraphResult | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'on-chain',
      title: 'On-Chain Data',
      showCount: true,
      infoTooltip: 'Live protocol data from The Graph subgraphs - Uniswap pools, Aave & Compound lending markets',
    });
    injectStyles();
    void this.fetchAll();
    this.refreshInterval = setInterval(() => this.fetchAll(), 5 * 60_000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.abortController?.abort();
    this.abortController = null;
    super.destroy();
  }

  /* ── Data fetching ── */
  private async fetchAll(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const endpoints = [
      { key: 'uniswap', url: '/api/subgraph-uniswap' },
      { key: 'aave', url: '/api/subgraph-aave' },
      { key: 'compound', url: '/api/subgraph-compound' },
    ] as const;

    const results = await Promise.allSettled(
      endpoints.map(async (ep) => {
        const res = await fetch(ep.url, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { key: ep.key, data: await res.json() };
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { key, data } = r.value;
        if (key === 'uniswap') this.uniswapData = data as UniswapSubgraphResult;
        else if (key === 'aave') this.aaveData = data as AaveSubgraphResult;
        else if (key === 'compound') this.compoundData = data as CompoundSubgraphResult;
      }
    }

    this.updateCount();
    this.render();
  }

  private updateCount(): void {
    let count = 0;
    if (this.uniswapData?.pools?.length) count += this.uniswapData.pools.length;
    if (this.aaveData?.markets?.length) count += this.aaveData.markets.length;
    if (this.compoundData?.markets?.length) count += this.compoundData.markets.length;
    this.setCount(count);
  }

  /* ── Rendering ── */
  private render(): void {
    const tabs = this.buildTabs();
    let body = '';

    switch (this.activeTab) {
      case 'uniswap':
        body = this.renderUniswap();
        break;
      case 'aave':
        body = this.renderAave();
        break;
      case 'compound':
        body = this.renderCompound();
        break;
    }

    this.setContent(tabs + body);
    this.bindTabClicks();
  }

  private buildTabs(): string {
    const tabs: { id: TabId; label: string }[] = [
      { id: 'uniswap', label: 'Uniswap V3' },
      { id: 'aave', label: 'Aave V3' },
      { id: 'compound', label: 'Compound' },
    ];
    return `<div class="on-chain-tabs">${tabs.map(t =>
      `<button class="on-chain-tab${t.id === this.activeTab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`,
    ).join('')}</div>`;
  }

  private bindTabClicks(): void {
    this.content.querySelectorAll<HTMLButtonElement>('.on-chain-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as TabId;
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;
          this.render();
        }
      });
    });
  }

  /* ── Uniswap tab ── */
  private renderUniswap(): string {
    const d = this.uniswapData;
    if (!d || d.unavailable || !d.pools?.length) {
      return '<div class="panel-loading-text">Uniswap data unavailable</div>';
    }

    const summary = `
      <div class="on-chain-summary">
        <div class="on-chain-stat"><span class="on-chain-stat-value">${formatTvl(d.summary.totalTvl)}</span><span class="on-chain-stat-label">Total TVL</span></div>
        <div class="on-chain-stat"><span class="on-chain-stat-value">${formatTvl(d.summary.totalVolume24h)}</span><span class="on-chain-stat-label">24h Volume</span></div>
        <div class="on-chain-stat"><span class="on-chain-stat-value">${d.summary.poolCount}</span><span class="on-chain-stat-label">Pools</span></div>
        <div class="on-chain-stat"><span class="on-chain-stat-value">${formatPct(d.summary.avgUtilization * 100)}</span><span class="on-chain-stat-label">Avg Util</span></div>
      </div>`;

    const headerRow = `
      <div class="on-chain-header-row pool-header">
        <span>Pool</span><span>Fee</span><span>Utilization</span><span>TVL</span>
      </div>`;

    const rows = d.pools.slice(0, 20).map((p: UniswapPool) => {
      const utilPct = Math.min(p.utilization * 100, 100);
      const utilClass = utilPct > 80 ? 'high' : utilPct > 40 ? 'mid' : 'low';
      return `
        <div class="on-chain-row">
          <span class="on-chain-pair" title="${escapeHtml(p.token0.name)}/${escapeHtml(p.token1.name)}">${escapeHtml(p.pair)}</span>
          <span class="on-chain-fee-badge" data-fee="${p.feeTier}">${escapeHtml(p.feeTierDisplay)}</span>
          <div class="on-chain-util-bar"><div class="on-chain-util-fill ${utilClass}" style="width:${utilPct}%"></div></div>
          <span class="on-chain-num">${formatTvl(p.tvl)}</span>
        </div>`;
    }).join('');

    return summary + headerRow + `<div class="on-chain-list">${rows}</div>`;
  }

  /* ── Aave tab ── */
  private renderAave(): string {
    const d = this.aaveData;
    if (!d || d.unavailable || !d.markets?.length) {
      return '<div class="panel-loading-text">Aave data unavailable</div>';
    }

    const summary = `
      <div class="on-chain-summary">
        <div class="on-chain-stat"><span class="on-chain-stat-value">${formatLargeNumber(d.summary.totalTvl)}</span><span class="on-chain-stat-label">Total Supplied</span></div>
        <div class="on-chain-stat"><span class="on-chain-stat-value">${formatLargeNumber(d.summary.totalBorrowed)}</span><span class="on-chain-stat-label">Total Borrowed</span></div>
        <div class="on-chain-stat"><span class="on-chain-stat-value">${formatPct(d.summary.avgUtilization * 100)}</span><span class="on-chain-stat-label">Avg Util</span></div>
        <div class="on-chain-stat"><span class="on-chain-stat-value">${d.summary.marketCount}</span><span class="on-chain-stat-label">Markets</span></div>
      </div>`;

    const headerRow = `
      <div class="on-chain-header-row lending-header">
        <span>Asset</span><span>Supply</span><span>Borrow</span><span>Utilization</span><span>TVL</span>
      </div>`;

    const rows = d.markets.slice(0, 20).map((m: AaveLendingMarket) => {
      const utilPct = Math.min(m.utilization * 100, 100);
      const utilClass = utilPct > 80 ? 'high' : utilPct > 40 ? 'mid' : 'low';
      return `
        <div class="on-chain-row on-chain-row-lending">
          <span class="on-chain-symbol">${escapeHtml(m.symbol)}</span>
          <span class="on-chain-supply-apy">${m.supplyAPY.toFixed(2)}%</span>
          <span class="on-chain-borrow-apy">${m.borrowAPY.toFixed(2)}%</span>
          <div class="on-chain-util-bar"><div class="on-chain-util-fill ${utilClass}" style="width:${utilPct}%"></div></div>
          <span class="on-chain-num">${formatLargeNumber(m.tvlUSD)}</span>
        </div>`;
    }).join('');

    return summary + headerRow + `<div class="on-chain-list">${rows}</div>`;
  }

  /* ── Compound tab ── */
  private renderCompound(): string {
    const d = this.compoundData;
    if (!d || d.unavailable || !d.markets?.length) {
      return '<div class="panel-loading-text">Compound data unavailable</div>';
    }

    const summary = `
      <div class="on-chain-summary">
        <div class="on-chain-stat"><span class="on-chain-stat-value">${formatTvl(d.summary.totalTvl)}</span><span class="on-chain-stat-label">Total TVL</span></div>
        <div class="on-chain-stat"><span class="on-chain-stat-value">${formatTvl(d.summary.totalBorrowed)}</span><span class="on-chain-stat-label">Total Borrowed</span></div>
        <div class="on-chain-stat"><span class="on-chain-stat-value">${formatPct(d.summary.avgUtilization * 100)}</span><span class="on-chain-stat-label">Avg Util</span></div>
        <div class="on-chain-stat"><span class="on-chain-stat-value">${d.summary.marketCount}</span><span class="on-chain-stat-label">Markets</span></div>
      </div>`;

    const headerRow = `
      <div class="on-chain-header-row lending-header">
        <span>Asset</span><span>Supply</span><span>Borrow</span><span>Utilization</span><span>TVL</span>
      </div>`;

    const rows = d.markets.slice(0, 20).map((m: CompoundMarket) => {
      const utilPct = Math.min(m.utilization * 100, 100);
      const utilClass = utilPct > 80 ? 'high' : utilPct > 40 ? 'mid' : 'low';
      return `
        <div class="on-chain-row on-chain-row-lending">
          <span class="on-chain-symbol" title="Collateral: ${m.collateralFactor}%">${escapeHtml(m.symbol)}</span>
          <span class="on-chain-supply-apy">${m.supplyAPY.toFixed(2)}%</span>
          <span class="on-chain-borrow-apy">${m.borrowAPY.toFixed(2)}%</span>
          <div class="on-chain-util-bar"><div class="on-chain-util-fill ${utilClass}" style="width:${utilPct}%"></div></div>
          <span class="on-chain-num">${formatTvl(m.tvlUSD)}</span>
        </div>`;
    }).join('');

    return summary + headerRow + `<div class="on-chain-list">${rows}</div>`;
  }
}
