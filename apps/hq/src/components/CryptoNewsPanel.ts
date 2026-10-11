/**
 * CryptoNewsPanel - Aggregated crypto news with category filtering and trending sidebar.
 *
 * Consumes /api/crypto-news and /api/crypto-trending via the crypto-news service.
 * Extends the Panel base class following HQ conventions.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { timeAgo } from '@/utils/defi-format';
import {
  fetchCryptoNews,
  fetchCryptoTrending,
  type CryptoNewsArticle,
  type CryptoNewsResponse,
  type CryptoTrendingResponse,
} from '@/services/crypto-news';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  'all',
  'bitcoin',
  'defi',
  'ethereum',
  'solana',
  'regulation',
  'security',
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  bitcoin: '#f7931a',
  defi: '#8b5cf6',
  ethereum: '#627eea',
  solana: '#14f195',
  regulation: '#ef4444',
  security: '#f59e0b',
  research: '#06b6d4',
  institutional: '#6366f1',
  altcoins: '#a78bfa',
  general: '#6b7280',
};

/** Tier-1 sources get a gold indicator, Tier-2 blue, everything else gray. */
const TIER1_SOURCES = new Set([
  'CoinDesk',
  'The Block',
  'Bloomberg Crypto',
  'Reuters Crypto',
  'CoinTelegraph',
]);
const TIER2_SOURCES = new Set([
  'Decrypt',
  'DL News',
  'Blockworks',
  'The Defiant',
  'Unchained',
  'CryptoSlate',
]);

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export class CryptoNewsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private abortCtrl: AbortController | null = null;

  private activeCategory = 'all';
  private breakingOnly = false;
  private trendingKeyword: string | null = null;

  private newsData: CryptoNewsResponse | null = null;
  private trendingData: CryptoTrendingResponse | null = null;
  private error: string | null = null;

  constructor() {
    super({ id: 'crypto-news-feed', title: 'Crypto News', showCount: true });

    void this.loadData();

    this.refreshTimer = setInterval(() => {
      void this.loadData();
    }, REFRESH_MS);

    /* Listen for filter events from CryptoTrendingPanel */
    window.addEventListener('crypto-news:filter', ((e: CustomEvent<{ keyword: string }>) => {
      this.trendingKeyword = e.detail.keyword || null;
      this.render();
    }) as EventListener);
  }

  destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.abortCtrl?.abort();
    super.destroy();
  }

  /* ---------------------------------------------------------------- */
  /*  Data fetching                                                    */
  /* ---------------------------------------------------------------- */

  private async loadData(): Promise<void> {
    this.abortCtrl?.abort();
    this.abortCtrl = new AbortController();

    this.error = null;
    this.render(); // show loading state

    try {
      const [news, trending] = await Promise.all([
        fetchCryptoNews({
          limit: 40,
          category: this.activeCategory,
          breaking: this.breakingOnly,
        }),
        fetchCryptoTrending(),
      ]);

      if (this.abortCtrl.signal.aborted) return;

      this.newsData = news;
      this.trendingData = trending;
    } catch (err) {
      if (this.abortCtrl.signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[CryptoNewsPanel] fetch failed:', err);
    }

    this.render();
  }

  /* ---------------------------------------------------------------- */
  /*  Rendering                                                        */
  /* ---------------------------------------------------------------- */

  private render(): void {
    /* Loading */
    if (!this.newsData && !this.error) {
      this.showLoading('Loading crypto news…');
      return;
    }

    /* Error with no prior data */
    if (this.error && (!this.newsData || this.newsData.articles.length === 0)) {
      this.showError(this.error);
      return;
    }

    const articles = this.filteredArticles();
    this.setCount(articles.length);

    const html = `
      ${this.renderTrending()}
      ${this.renderCategoryTabs()}
      ${this.renderBreakingToggle()}
      <div class="crypto-news-list" style="overflow-y:auto;max-height:520px;padding:0 4px;">
        ${articles.length === 0
          ? '<div style="text-align:center;color:#6b7280;padding:24px 0;font-size:13px;">No articles match your filters</div>'
          : articles.map((a) => this.renderArticle(a)).join('')}
      </div>
    `;

    this.setContent(html);
    this.bindEvents();
  }

  /* ------------- Filtered articles ------------- */

  private filteredArticles(): CryptoNewsArticle[] {
    if (!this.newsData) return [];
    let items = this.newsData.articles;

    if (this.trendingKeyword) {
      const kw = this.trendingKeyword.toLowerCase();
      items = items.filter(
        (a) =>
          a.title.toLowerCase().includes(kw) ||
          a.category.toLowerCase().includes(kw) ||
          a.source.toLowerCase().includes(kw),
      );
    }

    return items;
  }

  /* ------------- Trending sidebar ------------- */

  private renderTrending(): string {
    if (!this.trendingData || this.trendingData.trending.length === 0) return '';

    const pills = this.trendingData.trending
      .slice(0, 8)
      .map((t) => {
        const sentColor =
          t.sentiment === 'bullish' ? '#22c55e' : t.sentiment === 'bearish' ? '#ef4444' : '#6b7280';

        const isActive = this.trendingKeyword === t.topic;
        const bg = isActive ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.06)';
        const border = isActive ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.08)';

        return `<button class="crypto-news-trending-pill" data-keyword="${escapeHtml(t.topic)}"
          style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;
            background:${bg};border:${border};color:#e0e0e0;font-size:11px;cursor:pointer;
            white-space:nowrap;font-family:monospace;">
          <span style="color:${sentColor};font-size:10px;">${
            t.sentiment === 'bullish' ? '▲' : t.sentiment === 'bearish' ? '▼' : '●'
          }</span>
          ${escapeHtml(t.topic)}
          <span style="color:#9ca3af;font-size:10px;">${t.count}</span>
        </button>`;
      })
      .join('');

    return `
      <div class="crypto-news-trending" style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 4px 8px;
        border-bottom:1px solid rgba(255,255,255,0.06);">
        ${pills}
        ${
          this.trendingKeyword
            ? `<button class="crypto-news-trending-clear" style="display:inline-flex;align-items:center;
                padding:3px 8px;border-radius:12px;background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.3);
                color:#fca5a5;font-size:11px;cursor:pointer;font-family:sans-serif;">✕ clear</button>`
            : ''
        }
      </div>
    `;
  }

  /* ------------- Category tabs ------------- */

  private renderCategoryTabs(): string {
    const tabs = CATEGORIES.map((cat) => {
      const isActive = this.activeCategory === cat;
      const bg = isActive ? 'rgba(139,92,246,0.3)' : 'transparent';
      const border = isActive ? '1px solid #8b5cf6' : '1px solid transparent';
      const color = isActive ? '#c4b5fd' : '#9ca3af';
      const label = cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1);

      return `<button class="crypto-news-cat-tab" data-category="${cat}"
        style="padding:3px 10px;border-radius:10px;background:${bg};border:${border};
          color:${color};font-size:11px;cursor:pointer;font-family:sans-serif;white-space:nowrap;">
        ${label}
      </button>`;
    }).join('');

    return `
      <div class="crypto-news-cats" style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 4px 4px;">
        ${tabs}
      </div>
    `;
  }

  /* ------------- Breaking toggle ------------- */

  private renderBreakingToggle(): string {
    const bg = this.breakingOnly ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.06)';
    const border = this.breakingOnly
      ? '1px solid rgba(239,68,68,0.5)'
      : '1px solid rgba(255,255,255,0.08)';
    const color = this.breakingOnly ? '#fca5a5' : '#9ca3af';

    return `
      <div style="padding:2px 4px 6px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <button class="crypto-news-breaking-btn"
          style="padding:3px 10px;border-radius:10px;background:${bg};border:${border};
            color:${color};font-size:11px;cursor:pointer;font-family:sans-serif;">
          ⚡ Breaking
        </button>
      </div>
    `;
  }

  /* ------------- Single article ------------- */

  private renderArticle(a: CryptoNewsArticle): string {
    const tierColor = TIER1_SOURCES.has(a.source)
      ? '#f59e0b'
      : TIER2_SOURCES.has(a.source)
        ? '#3b82f6'
        : '#6b7280';

    const catColor = CATEGORY_COLORS[a.category] ?? CATEGORY_COLORS.general;
    const ago = a.timeAgo || timeAgo(a.pubDate);

    const detailPayload = JSON.stringify({
      title: a.title,
      url: a.link,
      source: a.source,
      publishedAt: a.pubDate,
      category: a.category,
    });

    return `
      <div class="crypto-news-item" style="display:flex;align-items:flex-start;gap:6px;padding:7px 2px;
        border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="flex-shrink:0;width:6px;height:6px;margin-top:6px;border-radius:50%;
          background:${tierColor};" title="${escapeHtml(a.source)}"></span>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
            <span style="font-size:10px;color:#9ca3af;font-family:sans-serif;">${escapeHtml(a.source)}</span>
            <span style="font-size:10px;color:#6b7280;font-family:monospace;">${escapeHtml(ago)}</span>
            <span style="font-size:9px;padding:1px 5px;border-radius:6px;
              background:${catColor}22;color:${catColor};font-family:sans-serif;">
              ${escapeHtml(a.category)}
            </span>
          </div>
          <a href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer"
            style="color:#e0e0e0;text-decoration:none;font-size:12.5px;line-height:1.35;
              font-family:sans-serif;display:-webkit-box;-webkit-line-clamp:2;
              -webkit-box-orient:vertical;overflow:hidden;">
            ${escapeHtml(a.title)}
          </a>
        </div>
        <button class="detail-open-btn" data-detail-news='${escapeHtml(detailPayload)}'
          style="flex-shrink:0;background:none;border:1px solid rgba(255,255,255,0.1);
            border-radius:4px;color:#9ca3af;font-size:12px;cursor:pointer;padding:2px 5px;
            line-height:1;" title="Details">ℹ</button>
      </div>
    `;
  }

  /* ---------------------------------------------------------------- */
  /*  Event binding                                                    */
  /* ---------------------------------------------------------------- */

  private bindEvents(): void {
    /* Category tabs */
    this.content.querySelectorAll<HTMLButtonElement>('.crypto-news-cat-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.category ?? 'all';
        if (cat !== this.activeCategory) {
          this.activeCategory = cat;
          void this.loadData();
        }
      });
    });

    /* Breaking toggle */
    this.content.querySelector<HTMLButtonElement>('.crypto-news-breaking-btn')?.addEventListener('click', () => {
      this.breakingOnly = !this.breakingOnly;
      void this.loadData();
    });

    /* Trending pills */
    this.content.querySelectorAll<HTMLButtonElement>('.crypto-news-trending-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kw = btn.dataset.keyword ?? null;
        this.trendingKeyword = this.trendingKeyword === kw ? null : kw;
        this.render();
      });
    });

    /* Clear trending filter */
    this.content.querySelector<HTMLButtonElement>('.crypto-news-trending-clear')?.addEventListener('click', () => {
      this.trendingKeyword = null;
      this.render();
    });

    /* Detail buttons (ℹ) */
    this.content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.detail-open-btn');
      if (!btn) return;
      try {
        const raw = btn.dataset.detailNews;
        if (!raw) return;
        const data = JSON.parse(raw) as Record<string, unknown>;
        window.dispatchEvent(
          new CustomEvent('detail:open', { detail: { type: 'news', data } }),
        );
      } catch {
        /* ignore malformed payload */
      }
    });
  }
}
