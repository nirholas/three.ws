import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatPct, pctColor } from '@/utils/defi-format';
import type { PriceUpdate } from '@/types';

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

export class TokenTickerPanel extends Panel {
  private data: MarketCoin[] | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  /** Bound listener refs for cleanup. */
  private hoverPauseHandler: (() => void) | null = null;
  private hoverResumeHandler: (() => void) | null = null;
  private scrollTrackEl: HTMLElement | null = null;
  private priceListener: ((e: Event) => void) | null = null;

  constructor() {
    super({
      id: 'token-ticker',
      title: 'Token Ticker',
      showCount: true,
      infoTooltip: `<strong>Top Tokens by Market Cap</strong>
        <p>Auto-scrolling ticker of the top 12 cryptocurrencies by market capitalisation.</p>
        <p>Source: CoinGecko. Hover to pause scrolling.</p>
        <p>Updates every 2 minutes.</p>`,
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 2 * 60_000);

    // Listen for real-time price updates from WebSocket
    this.priceListener = ((e: Event) => {
      this.handlePriceUpdate((e as CustomEvent<PriceUpdate>).detail);
    });
    window.addEventListener('price:update', this.priceListener);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.abortController?.abort();
    this.abortController = null;
    this.removeScrollListeners();
    if (this.priceListener) {
      window.removeEventListener('price:update', this.priceListener);
      this.priceListener = null;
    }
    super.destroy();
  }

  private removeScrollListeners(): void {
    if (this.scrollTrackEl && this.hoverPauseHandler && this.hoverResumeHandler) {
      this.scrollTrackEl.removeEventListener('mouseenter', this.hoverPauseHandler);
      this.scrollTrackEl.removeEventListener('mouseleave', this.hoverResumeHandler);
    }
    this.scrollTrackEl = null;
    this.hoverPauseHandler = null;
    this.hoverResumeHandler = null;
  }

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const res = await fetch('/api/coingecko-markets?per_page=12&vs_currency=usd', { signal });
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
    // Clean up existing listeners before re-render
    this.removeScrollListeners();

    if (this.loading) { this.showLoading('Loading token prices…'); return; }
    if (this.error || !Array.isArray(this.data) || this.data.length === 0) {
      this.showError(this.error || 'No data available');
      return;
    }

    const coins = this.data.slice(0, 12);
    this.setCount(coins.length);

    const items = coins.map((coin) => {
      const pctVal = coin.price_change_percentage_24h ?? 0;
      const isPos = pctVal >= 0;
      const cls = isPos ? 'tt-change-pos' : 'tt-change-neg';
      const symbol = coin.symbol ? escapeHtml(coin.symbol.toUpperCase()) : '???';
      return `
        <div class="tt-coin" style="cursor:pointer" data-detail-symbol="${symbol}" data-detail-name="${escapeHtml(coin.name || 'Unknown')}" data-detail-price="${coin.current_price ?? ''}" data-detail-change="${pctVal}" data-detail-image="${escapeHtml(coin.image || '')}" data-detail-rank="${coin.market_cap_rank ?? ''}">
          <div class="tt-coin-left">
            <img class="tt-thumb" src="${escapeHtml(coin.image || '')}" alt="${symbol}"
                 loading="lazy" width="20" height="20" data-hide-on-error/>
            <div class="tt-coin-name-wrap">
              <span class="tt-name">${escapeHtml(coin.name || 'Unknown')}</span>
              <span class="tt-symbol">${symbol}</span>
            </div>
          </div>
          <div class="tt-coin-right">
            <span class="tt-price">${formatPrice(coin.current_price)}</span>
            <span class="${cls}" style="color:${pctColor(pctVal)}">${formatPct(pctVal)}</span>
          </div>
        </div>`;
    }).join('');

    // Duplicate items for seamless infinite scroll
    const html = `
      <div class="tt-panel">
        <div class="tt-scroll-track">
          <div class="tt-scroll-inner">
            ${items}${items}
          </div>
        </div>
      </div>`;

    this.setContent(html);

    // Bind click-to-detail on ticker items
    this.content.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-detail-symbol]');
      if (!item) return;
      const sym = item.dataset.detailSymbol || '';
      const name = item.dataset.detailName || '';
      const price = item.dataset.detailPrice ? Number(item.dataset.detailPrice) : undefined;
      const change24h = item.dataset.detailChange ? Number(item.dataset.detailChange) : undefined;
      const image = item.dataset.detailImage || undefined;
      const rank = item.dataset.detailRank ? Number(item.dataset.detailRank) : undefined;
      window.dispatchEvent(new CustomEvent('detail:open', {
        detail: { type: 'token' as const, data: { symbol: sym, name, price, change24h, image, rank } }
      }));
    });

    // Bind hover-to-pause with proper cleanup refs
    const inner = this.content.querySelector('.tt-scroll-inner') as HTMLElement | null;
    const track = this.content.querySelector('.tt-scroll-track') as HTMLElement | null;
    if (inner && track) {
      this.scrollTrackEl = track;
      this.hoverPauseHandler = () => { inner.style.animationPlayState = 'paused'; };
      this.hoverResumeHandler = () => { inner.style.animationPlayState = 'running'; };
      track.addEventListener('mouseenter', this.hoverPauseHandler);
      track.addEventListener('mouseleave', this.hoverResumeHandler);
    }

  }

  /* ── Real-time WebSocket price handler ── */

  private handlePriceUpdate(update: PriceUpdate): void {
    // Update ALL matching elements (ticker duplicates items for infinite scroll)
    const items = this.content.querySelectorAll(`[data-detail-symbol="${update.symbol}"]`);
    if (items.length === 0) return;

    items.forEach(item => {
      const priceEl = item.querySelector('.tt-price');
      const changeEl = item.querySelector('.tt-change-pos, .tt-change-neg');

      if (priceEl) {
        const oldPrice = parseFloat(priceEl.textContent?.replace(/[$,]/g, '') || '0');
        priceEl.textContent = formatPrice(update.price);

        // Update data attribute for detail click
        (item as HTMLElement).dataset.detailPrice = String(update.price);

        // Flash animation
        const flashClass = update.price > oldPrice ? 'flash-green' : update.price < oldPrice ? 'flash-red' : '';
        if (flashClass) {
          priceEl.classList.remove('flash-green', 'flash-red');
          void (priceEl as HTMLElement).offsetWidth; // reflow to restart animation
          priceEl.classList.add(flashClass);
          setTimeout(() => priceEl.classList.remove(flashClass), 600);
        }
      }

      if (changeEl) {
        const pctVal = update.change24h;
        const isPos = pctVal >= 0;
        changeEl.textContent = formatPct(pctVal);
        changeEl.className = isPos ? 'tt-change-pos' : 'tt-change-neg';
        (changeEl as HTMLElement).style.color = pctColor(pctVal);
        (item as HTMLElement).dataset.detailChange = String(pctVal);
      }
    });
  }
}
