import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

/**
 * Cross-chain fee comparison calculator (roadmap: "Cross-chain fee
 * comparison calculator"). Combines the gas tracker with live native-token
 * prices to answer "what does this transaction actually cost, in dollars,
 * on each chain right now".
 */

type TxType = 'transfer' | 'swap' | 'complex';

interface GasChain {
  name: string;
  gasGwei: number;
  unit: string;
  level: string;
  costEstimate: { transfer: number; swap: number; complex: number };
}

interface GasTrackerResult {
  timestamp: string;
  chains: GasChain[];
}

/** Native gas token per chain in the gas tracker. */
const NATIVE_TOKEN: Record<string, string> = {
  Ethereum: 'ETH',
  Arbitrum: 'ETH',
  Base: 'ETH',
  Optimism: 'ETH',
  BSC: 'BNB',
  Avalanche: 'AVAX',
  Polygon: 'POL',
};

const TX_LABELS: Record<TxType, string> = {
  transfer: 'Token transfer',
  swap: 'DEX swap',
  complex: 'Complex contract call',
};

function formatUsdCost(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '-';
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  if (v >= 0.0001) return `$${v.toFixed(5)}`;
  return `<$0.0001`;
}

export class FeeComparePanel extends Panel {
  private gas: GasTrackerResult | null = null;
  private prices: Map<string, number> = new Map();
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private txType: TxType = 'swap';
  private txCount = 1;

  constructor() {
    super({
      id: 'fee-compare',
      title: 'Fee Compare',
      showCount: false,
      infoTooltip: `<strong>Cross-Chain Fee Calculator</strong>
        <p>Live USD cost of a transaction on each supported chain, from current gas prices and native token prices.</p>
        <p>Pick the transaction type and batch size; the cheapest chain is highlighted.</p>
        <p>Updates every 2 minutes.</p>`,
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 2 * 60_000);
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
      const [gasRes, marketsRes] = await Promise.all([
        fetch('/api/gas-tracker', { signal }),
        fetch('/api/coingecko-markets?per_page=100&vs_currency=usd', { signal }),
      ]);
      if (!gasRes.ok) throw new Error(`Gas tracker HTTP ${gasRes.status}`);
      this.gas = await gasRes.json();

      // Price lane degrades independently; fees still render in native units.
      if (marketsRes.ok) {
        const markets: Array<{ symbol?: string; current_price?: number }> = await marketsRes.json();
        if (Array.isArray(markets)) {
          this.prices = new Map();
          for (const coin of markets) {
            const sym = coin.symbol?.toUpperCase();
            if (sym && Number.isFinite(coin.current_price) && !this.prices.has(sym)) {
              this.prices.set(sym, coin.current_price as number);
            }
          }
        }
      }

      this.error = null;
      this.setDataBadge('live');
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
    if (this.loading) { this.showLoading('Loading gas and price data…'); return; }
    if (this.error || !this.gas?.chains?.length) { this.showError(this.error || 'No gas data'); return; }

    const rows = this.gas.chains
      .map(chain => {
        const nativeCost = (chain.costEstimate?.[this.txType] ?? 0) * this.txCount;
        const token = NATIVE_TOKEN[chain.name] || 'ETH';
        const price = this.prices.get(token) ?? null;
        const usd = price != null ? nativeCost * price : null;
        return { chain, token, nativeCost, usd };
      })
      .sort((a, b) => {
        if (a.usd != null && b.usd != null) return a.usd - b.usd;
        if (a.usd != null) return -1;
        if (b.usd != null) return 1;
        return a.nativeCost - b.nativeCost;
      });

    const cheapest = rows[0];
    const tableRows = rows.map(({ chain, token, nativeCost, usd }, i) => `
      <tr class="fc-row ${i === 0 ? 'fc-cheapest' : ''}">
        <td class="fc-chain">${i === 0 ? '<span class="fc-best-badge">BEST</span>' : ''}${escapeHtml(chain.name)}</td>
        <td class="fc-usd">${formatUsdCost(usd)}</td>
        <td class="fc-native">${nativeCost < 0.000001 ? nativeCost.toExponential(2) : nativeCost.toFixed(6)} ${escapeHtml(token)}</td>
        <td class="fc-gas">${chain.gasGwei} ${escapeHtml(chain.unit)}</td>
        <td class="fc-level fc-level-${escapeHtml(chain.level.toLowerCase())}">${escapeHtml(chain.level)}</td>
      </tr>
    `).join('');

    const txOptions = (Object.keys(TX_LABELS) as TxType[])
      .map(t => `<option value="${t}" ${t === this.txType ? 'selected' : ''}>${TX_LABELS[t]}</option>`)
      .join('');

    const priciest = rows.length > 1 ? rows[rows.length - 1] : undefined;
    const savings = cheapest && priciest && cheapest.usd != null && priciest.usd != null
      ? `<span class="fc-savings">${escapeHtml(cheapest.chain.name)} is ${formatUsdCost(priciest.usd - cheapest.usd)} cheaper than ${escapeHtml(priciest.chain.name)}</span>`
      : '';

    this.setContent(`
      <div class="fc-container">
        <div class="fc-controls">
          <select class="fc-select" data-fc-type aria-label="Transaction type">${txOptions}</select>
          <label class="fc-count-label">×
            <input class="fc-count" data-fc-count type="number" min="1" max="10000" step="1" value="${this.txCount}" aria-label="Number of transactions"/>
          </label>
        </div>
        <div class="fc-table-wrap">
          <table class="fc-table">
            <thead><tr><th>Chain</th><th>USD</th><th>Native</th><th>Gas</th><th>Level</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        ${savings ? `<div class="fc-footer">${savings}</div>` : ''}
      </div>
    `);
    this.bindControls();
  }

  private bindControls(): void {
    const select = this.content.querySelector<HTMLSelectElement>('[data-fc-type]');
    select?.addEventListener('change', () => {
      this.txType = (select.value as TxType) || 'swap';
      this.renderPanel();
    });
    const count = this.content.querySelector<HTMLInputElement>('[data-fc-count]');
    count?.addEventListener('change', () => {
      const v = parseInt(count.value, 10);
      this.txCount = Number.isFinite(v) ? Math.min(Math.max(v, 1), 10000) : 1;
      this.renderPanel();
    });
  }
}
