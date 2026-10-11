import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TrendingCoinItem {
  id: string;
  coin_id: number;
  name: string;
  symbol: string;
  market_cap_rank: number | null;
  thumb: string;
  small: string;
  large: string;
  slug: string;
  price_btc: number;
  score: number;
}

interface TrendingCoin {
  item: TrendingCoinItem;
}

interface TrendingResponse {
  coins: TrendingCoin[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MEDAL_EMOJIS = ['🥇', '🥈', '🥉'] as const;

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export class TrendingTokensPanel extends Panel {
  private data: TrendingResponse | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'trending-tokens',
      title: 'Trending Tokens',
      showCount: true,
      infoTooltip: `<strong>Trending Tokens</strong>
        <p>Top 7 trending coins on CoinGecko based on user search activity.</p>
        <p>Medal emojis mark the top 3. Market cap rank badge shows relative size.</p>
        <p>Updates every 5 minutes.</p>`,
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
      const res = await fetch('/api/coingecko-trending', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TrendingResponse = await res.json();
      if (!json?.coins?.length) throw new Error('Empty response');

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
    if (this.loading) { this.showLoading('Loading trending tokens…'); return; }
    if (this.error || !this.data?.coins?.length) {
      this.showError(this.error || 'No data available');
      return;
    }

    const coins = this.data.coins.slice(0, 7);
    this.setCount(coins.length);

    const items = coins.map((coin, i) => {
      const c = coin.item;
      const rank = i < 3 ? MEDAL_EMOJIS[i] : `${i + 1}`;
      const mcapRank = c.market_cap_rank != null ? `#${c.market_cap_rank}` : '-';
      const symbol = c.symbol ? escapeHtml(c.symbol.toUpperCase()) : '???';

      return `
        <div class="trt-item" style="cursor:pointer" data-detail-symbol="${symbol}" data-detail-name="${escapeHtml(c.name || 'Unknown')}" data-detail-image="${escapeHtml(c.thumb || '')}" data-detail-rank="${c.market_cap_rank ?? ''}">
          <div class="trt-left">
            <span class="trt-rank">${rank}</span>
            <img class="trt-thumb" src="${escapeHtml(c.thumb || '')}" alt="${symbol}"
                 loading="lazy" width="24" height="24" data-hide-on-error/>
            <div class="trt-name-wrap">
              <span class="trt-name">${escapeHtml(c.name || 'Unknown')}</span>
              <span class="trt-symbol">${symbol}</span>
            </div>
          </div>
          <div class="trt-right">
            <span class="trt-mcap-badge">${escapeHtml(mcapRank)}</span>
            <span class="trt-mcap-label">MCap Rank</span>
          </div>
        </div>`;
    }).join('');

    const html = `<div class="trt-panel">${items}</div>`;
    this.setContent(html);
    this.content.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-detail-symbol]');
      if (!item) return;
      const sym = item.dataset.detailSymbol || '';
      const name = item.dataset.detailName || '';
      const image = item.dataset.detailImage || undefined;
      const rank = item.dataset.detailRank ? Number(item.dataset.detailRank) : undefined;
      window.dispatchEvent(new CustomEvent('detail:open', {
        detail: { type: 'token' as const, data: { symbol: sym, name, image, rank } }
      }));
    });
  }
}
