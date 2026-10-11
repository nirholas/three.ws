import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatPct, pctColor } from '@/utils/defi-format';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MarketCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number | null;
  image: string;
  market_cap_rank: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatPrice(price: number | null | undefined): string {
  if (price == null || Number.isNaN(price)) return '-';
  if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export class MarketMoversPanel extends Panel {
  private data: MarketCoin[] | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'market-movers',
      title: 'Market Movers',
      showCount: true,
      infoTooltip: `<strong>Market Movers (24h)</strong>
        <p>Top 5 gainers and losers from the top 100 coins by market cap.</p>
        <p>Source: CoinGecko. Sorted by 24-hour price change percentage.</p>
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
      const res = await fetch('/api/coingecko-markets?per_page=100&vs_currency=usd', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: MarketCoin[] = await res.json();
      if (!Array.isArray(json) || json.length === 0) throw new Error('Empty response');

      this.data = json;
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
    if (this.loading) { this.showLoading('Loading market movers…'); return; }
    if (this.error || !Array.isArray(this.data) || this.data.length === 0) {
      this.showError(this.error || 'No data available');
      return;
    }

    const valid = this.data.filter(
      c => c.price_change_percentage_24h != null && !Number.isNaN(c.price_change_percentage_24h)
    );
    const sorted = [...valid].sort(
      (a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0)
    );

    const gainers = sorted.slice(0, 5);
    const losers = sorted.slice(-5).reverse();
    this.setCount(valid.length);

    const renderCoin = (coin: MarketCoin, isGainer: boolean, idx: number): string => {
      const pct = coin.price_change_percentage_24h ?? 0;
      const arrow = isGainer ? '▲' : '▼';
      const cls = isGainer ? 'mm-change-pos' : 'mm-change-neg';
      const symbol = coin.symbol ? escapeHtml(coin.symbol.toUpperCase()) : '???';
      return `
        <div class="mm-item" data-mm-id="${escapeHtml(coin.id)}" data-mm-idx="${idx}" style="cursor:pointer">
          <div class="mm-coin-info">
            <span class="mm-name">${escapeHtml(coin.name || 'Unknown')}</span>
            <span class="mm-meta">
              <span class="mm-symbol">${symbol}</span>
              <span class="mm-price">${formatPrice(coin.current_price)}</span>
            </span>
          </div>
          <div class="${cls}">
            <span class="mm-arrow">${arrow}</span>
            <span style="color:${pctColor(pct)}">${formatPct(pct)}</span>
          </div>
        </div>`;
    };

    const html = `
      <div class="mm-panel">
        <div class="mm-columns">
          <div class="mm-column">
            <div class="mm-col-header mm-col-header-gain">▲ Top Gainers</div>
            ${gainers.map((c, i) => renderCoin(c, true, i)).join('')}
          </div>
          <div class="mm-column">
            <div class="mm-col-header mm-col-header-loss">▼ Top Losers</div>
            ${losers.map((c, i) => renderCoin(c, false, i + 100)).join('')}
          </div>
        </div>
      </div>`;

    this.setContent(html);

    // Bind click handlers
    const allCoins = [...gainers, ...losers];
    this.content.querySelectorAll<HTMLElement>('.mm-item[data-mm-id]').forEach((el) => {
      const coinId = el.dataset.mmId;
      const coin = allCoins.find(c => c.id === coinId);
      if (!coin) return;
      el.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'token' as const, data: {
            symbol: coin.symbol?.toUpperCase() ?? '',
            name: coin.name,
            price: coin.current_price,
            change24h: coin.price_change_percentage_24h ?? undefined,
            rank: coin.market_cap_rank,
            image: coin.image,
            id: coin.id,
          }},
        }));
      });
    });
  }
}
