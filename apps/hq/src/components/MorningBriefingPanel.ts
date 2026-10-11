import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatLargeNumber, formatPct, pctColor, getFearGreedMeta } from '@/utils/defi-format';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MarketData {
  btcPrice?: number;
  ethPrice?: number;
  totalMarketCap?: number;
  totalMarketCapChange24h?: number;
  btcDominance?: number;
  fearGreed?: { value: number; classification: string };
}

interface TopMover {
  name: string;
  symbol: string;
  change24h: number;
}

interface BriefingData {
  market: MarketData;
  topGainers: TopMover[];
  topLosers: TopMover[];
  lastUpdated: string;
}

interface CoinRow {
  id: string;
  name: string;
  symbol: string;
  current_price: number;
  price_change_percentage_24h: number | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCurrency(v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return '-';
  return `$${formatLargeNumber(v)}`;
}

function changeArrow(v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return '';
  if (v > 0) return '<span class="mb-arrow-up" aria-label="up">▲</span>';
  if (v < 0) return '<span class="mb-arrow-down" aria-label="down">▼</span>';
  return '';
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export class MorningBriefingPanel extends Panel {
  private data: BriefingData | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'morning-briefing',
      title: 'Morning Briefing',
      infoTooltip: `<strong>Morning Briefing</strong>
        <p>Daily snapshot: total market cap, BTC/ETH prices, BTC dominance,
        Fear &amp; Greed index, and the top 3 gainers &amp; losers.</p>
        <p>Updates every 10 minutes.</p>`,
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 10 * 60_000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.abortController?.abort();
    this.abortController = null;
    super.destroy();
  }

  /* ---------------------------------------------------------------- */
  /*  Data                                                             */
  /* ---------------------------------------------------------------- */

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      // All three fetches in parallel - fear-greed is non-critical
      const [globalRes, marketsRes, fgRes] = await Promise.all([
        fetch('/api/coingecko-global', { signal }),
        fetch('/api/coingecko-markets?per_page=50&vs_currency=usd', { signal }),
        fetch('/api/fear-greed?limit=1', { signal }).catch(() => null),
      ]);

      if (!globalRes.ok) throw new Error(`Global HTTP ${globalRes.status}`);
      if (!marketsRes.ok) throw new Error(`Markets HTTP ${marketsRes.status}`);

      const globalData = await globalRes.json();
      const coins: CoinRow[] = await marketsRes.json();

      // Determine cache badge from primary endpoint
      const cacheHdr = globalRes.headers.get('X-Cache');

      // Non-critical Fear & Greed
      let fearGreed: MarketData['fearGreed'];
      if (fgRes?.ok) {
        try {
          const fgData = await fgRes.json();
          if (fgData?.data?.[0]) {
            const raw = Number(fgData.data[0].value);
            if (!Number.isNaN(raw)) {
              fearGreed = {
                value: raw,
                classification: String(fgData.data[0].value_classification ?? ''),
              };
            }
          }
        } catch { /* graceful degradation */ }
      }

      const gd = globalData?.data;

      // Sort for gainers / losers
      const sorted = [...coins]
        .filter(c => c.price_change_percentage_24h != null && !Number.isNaN(c.price_change_percentage_24h))
        .sort((a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0));

      const mapMover = (c: CoinRow): TopMover => ({
        name: c.name ?? 'Unknown',
        symbol: c.symbol ? c.symbol.toUpperCase() : '???',
        change24h: c.price_change_percentage_24h ?? 0,
      });

      const topGainers = sorted.slice(0, 3).map(mapMover);
      const topLosers  = sorted.slice(-3).reverse().map(mapMover);

      const btcCoin = coins.find(c => c.id === 'bitcoin');
      const ethCoin = coins.find(c => c.id === 'ethereum');

      this.data = {
        market: {
          totalMarketCap: gd?.total_market_cap?.usd,
          totalMarketCapChange24h: gd?.market_cap_change_percentage_24h_usd,
          btcPrice: btcCoin?.current_price,
          ethPrice: ethCoin?.current_price,
          btcDominance: gd?.market_cap_percentage?.btc,
          fearGreed,
        },
        topGainers,
        topLosers,
        lastUpdated: new Date().toISOString(),
      };
      this.error = null;
      this.setDataBadge(cacheHdr === 'HIT' ? 'cached' : 'live');
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

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading briefing…'); return; }
    if (this.error || !this.data) {
      this.showError(this.error || 'No data available');
      return;
    }

    const m = this.data.market;

    // Fear & Greed row (omitted gracefully when unavailable)
    let fgRow = '';
    if (m.fearGreed) {
      const meta = getFearGreedMeta(m.fearGreed.value);
      fgRow = `
      <div class="mb-row">
        <span class="mb-label">Fear &amp; Greed</span>
        <span class="mb-value">
          <span class="mb-mono" style="color:${meta.color}">${m.fearGreed.value}</span>
          <span class="mb-dim">${escapeHtml(m.fearGreed.classification)}</span>
        </span>
      </div>`;
    }

    const renderChips = (movers: TopMover[], positive: boolean) =>
      movers.map(mv => {
        const cls = positive ? 'mb-chip-pos' : 'mb-chip-neg';
        return `<span class="mb-chip" style="cursor:pointer" data-symbol="${escapeHtml(mv.symbol)}" data-name="${escapeHtml(mv.name)}" data-change="${mv.change24h}">
          <span class="mb-chip-sym">${escapeHtml(mv.symbol)}</span>
          <span class="${cls}" style="color:${pctColor(mv.change24h)}">${formatPct(mv.change24h)}</span>
        </span>`;
      }).join('');

    const html = `
      <div class="mb-panel" role="region" aria-label="Morning Briefing">
        <div class="mb-section">
          <div class="mb-row">
            <span class="mb-label">Total Market Cap</span>
            <span class="mb-value">
              ${changeArrow(m.totalMarketCapChange24h)}
              <span class="mb-mono">${formatCurrency(m.totalMarketCap)}</span>
            </span>
          </div>
          <div class="mb-row">
            <span class="mb-label">BTC</span>
            <span class="mb-value mb-mono">${formatCurrency(m.btcPrice)}</span>
          </div>
          <div class="mb-row">
            <span class="mb-label">ETH</span>
            <span class="mb-value mb-mono">${formatCurrency(m.ethPrice)}</span>
          </div>
          <div class="mb-row">
            <span class="mb-label">BTC Dominance</span>
            <span class="mb-value mb-mono">${m.btcDominance != null && !Number.isNaN(m.btcDominance) ? `${m.btcDominance.toFixed(1)}%` : '-'}</span>
          </div>
          ${fgRow}
        </div>
        <div class="mb-movers-section">
          <div class="mb-movers-group">
            <div class="mb-movers-header"><span class="mb-arrow-up" aria-hidden="true">▲</span> TOP GAINERS</div>
            <div class="mb-chips mb-chips-gainers">${renderChips(this.data.topGainers, true)}</div>
          </div>
          <div class="mb-movers-group">
            <div class="mb-movers-header"><span class="mb-arrow-down" aria-hidden="true">▼</span> TOP LOSERS</div>
            <div class="mb-chips mb-chips-losers">${renderChips(this.data.topLosers, false)}</div>
          </div>
        </div>
      </div>`;

    this.setContent(html);

    // Wire click handlers on market rows
    const mbRows = this.content.querySelectorAll('.mb-row');
    mbRows.forEach(row => {
      (row as HTMLElement).style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const label = row.querySelector('.mb-label')?.textContent || '';
        const value = row.querySelector('.mb-value')?.textContent?.trim() || '';
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: {
            type: 'news',
            data: {
              title: `Morning Briefing - ${label}`,
              summary: `${label}: ${value}`,
            },
          },
        }));
      });
    });

    // Wire chip click handlers (gainers & losers)
    const chips = this.content.querySelectorAll('.mb-chip[data-symbol]');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const el = chip as HTMLElement;
        const symbol = el.dataset.symbol || '';
        const name = el.dataset.name || symbol;
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: {
            type: 'token',
            data: { symbol, name },
          },
        }));
      });
    });
  }
}
