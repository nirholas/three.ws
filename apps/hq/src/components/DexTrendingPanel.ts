import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatUsd } from '@/utils/defi-format';

interface TokenPair {
  chainId: string;
  dexId: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { symbol: string };
  priceUsd: string;
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  volume: { h24: number };
  liquidity: { usd: number };
  txns: { h24: { buys: number; sells: number } };
  fdv: number;
  signal: string;
  isNew: boolean;
  isTrending: boolean;
  url?: string;
}

interface ChainStats {
  count: number;
  newCount: number;
  hotCount: number;
  totalVolume: number;
}

interface DexTrendingResult {
  timestamp: string;
  tokens: TokenPair[];
  chainStats: Record<string, ChainStats>;
  summary: { totalTokens: number; parabolicCount: number; hotCount: number; newCount: number; dumpingCount: number };
  unavailable?: boolean;
}

const CHAIN_LABELS: Record<string, string> = {
  solana: 'SOL', bsc: 'BSC', base: 'BASE', ethereum: 'ETH',
  polygon: 'POLY', arbitrum: 'ARB', avalanche: 'AVAX', optimism: 'OP',
};
const CHAIN_COLORS: Record<string, string> = {
  solana: '#9945ff', bsc: '#f0b90b', base: '#0052ff', ethereum: '#627eea',
  polygon: '#8247e5', arbitrum: '#28a0f0', avalanche: '#e84142', optimism: '#ff0420',
};
const SIGNAL_ICONS: Record<string, string> = {
  PARABOLIC: '🚀', HOT: '🔥', RISING: '📈', DUMPING: '📉', STABLE: '➖',
};



function formatPrice(p: string): string {
  const n = parseFloat(p);
  if (isNaN(n)) return p;
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

function changeClass(pct: number): string {
  if (pct > 50) return 'dex-parabolic';
  if (pct > 10) return 'dex-hot';
  if (pct > 0) return 'dex-up';
  if (pct < -20) return 'dex-dump';
  if (pct < 0) return 'dex-down';
  return '';
}

export class DexTrendingPanel extends Panel {
  private data: DexTrendingResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private activeChain: string = 'all';

  constructor() {
    super({ id: 'dex-trending', title: 'DEX Trending', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 60000); // 1 min
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
      const res = await fetch('/api/dex-trending', { signal });
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
    if (this.loading) { this.showLoading('Scanning DEXes...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }
    const d = this.data;
    if (d.unavailable) { this.showError('DEX trending data temporarily unavailable'); return; }
    if (!d.tokens.length) {
      this.setContent('<div class="panel-loading-text">No trending tokens found</div>');
      return;
    }

    const filtered = this.activeChain === 'all' ? d.tokens : d.tokens.filter(t => t.chainId === this.activeChain);
    this.setCount(filtered.length);

    const html = `
      <div class="dex-summary">
        <div class="dex-stat">
          <span class="dex-stat-value" style="color:#ff1744">${d.summary.parabolicCount}</span>
          <span class="dex-stat-label">🚀 Parabolic</span>
        </div>
        <div class="dex-stat">
          <span class="dex-stat-value" style="color:#ff9100">${d.summary.hotCount}</span>
          <span class="dex-stat-label">🔥 Hot</span>
        </div>
        <div class="dex-stat">
          <span class="dex-stat-value" style="color:#4caf50">${d.summary.newCount}</span>
          <span class="dex-stat-label">🆕 New (&lt;24h)</span>
        </div>
        <div class="dex-stat">
          <span class="dex-stat-value" style="color:#2196f3">${d.summary.dumpingCount}</span>
          <span class="dex-stat-label">📉 Dumping</span>
        </div>
      </div>
      <div class="dex-chain-filter">
        <button class="dex-chain-btn ${this.activeChain === 'all' ? 'active' : ''}" data-chain="all">All</button>
        ${['solana', 'bsc', 'base', 'ethereum'].map(c => `
          <button class="dex-chain-btn ${this.activeChain === c ? 'active' : ''}" data-chain="${c}"
            style="--chain-color:${CHAIN_COLORS[c]}">${CHAIN_LABELS[c]}${d.chainStats[c]?.hotCount ? ` <span class="dex-chain-hot">${d.chainStats[c].hotCount}</span>` : ''}</button>
        `).join('')}
      </div>
      <div class="dex-token-list">
        ${filtered.slice(0, 30).map(t => {
          const sigIcon = SIGNAL_ICONS[t.signal] || '';
          const chainColor = CHAIN_COLORS[t.chainId] || '#888';
          const chainLabel = CHAIN_LABELS[t.chainId] || t.chainId;
          const buyRatio = (t.txns?.h24?.buys ?? 0) + (t.txns?.h24?.sells ?? 0) > 0
            ? Math.round(((t.txns?.h24?.buys ?? 0) / ((t.txns?.h24?.buys ?? 0) + (t.txns?.h24?.sells ?? 0))) * 100)
            : 50;
          return `
            <div class="dex-token-row ${t.isNew ? 'dex-new-token' : ''} ${t.isTrending ? 'dex-trending-token' : ''}">
              <div class="dex-token-main">
                <div class="dex-token-name">
                  <span class="dex-signal-icon" title="${escapeHtml(t.signal)}">${sigIcon}</span>
                  <span class="dex-symbol">${escapeHtml(t.baseToken.symbol)}</span>
                  <span class="dex-chain-tag" style="background:${chainColor}20;color:${chainColor}">${chainLabel}</span>
                  ${t.isNew ? '<span class="dex-new-badge">NEW</span>' : ''}
                  ${t.isTrending ? '<span class="dex-boost-badge">⚡</span>' : ''}
                </div>
                <span class="dex-price">${formatPrice(t.priceUsd)}</span>
              </div>
              <div class="dex-token-metrics">
                <span class="dex-change ${changeClass(Number(t.priceChange?.h1) || 0)}">1h: ${Number(t.priceChange?.h1) > 0 ? '+' : ''}${(Number(t.priceChange?.h1) || 0).toFixed(1)}%</span>
                <span class="dex-change ${changeClass(Number(t.priceChange?.h24) || 0)}">24h: ${Number(t.priceChange?.h24) > 0 ? '+' : ''}${(Number(t.priceChange?.h24) || 0).toFixed(1)}%</span>
                <span class="dex-vol">Vol: ${formatUsd(t.volume?.h24)}</span>
                <span class="dex-liq">Liq: ${formatUsd(t.liquidity?.usd)}</span>
                <span class="dex-buysell" title="Buy/Sell ratio">
                  <span class="dex-buy-bar" style="width:${buyRatio}%"></span>
                  <span class="dex-buysell-text">${buyRatio}% buy</span>
                </span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this.setContent(html);

    // Wire chain filter buttons
    this.content.querySelectorAll('.dex-chain-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeChain = (btn as HTMLElement).dataset.chain || 'all';
        this.renderPanel();
      });
    });
  }
}
