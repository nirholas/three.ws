/**
 * CryptoTrendingPanel - Focused widget showing trending crypto topics.
 *
 * Consumes /api/crypto-trending via the crypto-news service.
 * Clicking a topic dispatches `crypto-news:filter` so CryptoNewsPanel can react.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  fetchCryptoTrending,
  type CryptoTrendingResponse,
  type TrendingTopic,
} from '@/services/crypto-news';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const REFRESH_MS = 10 * 60 * 1000; // 10 minutes

const SENTIMENT_META: Record<string, { icon: string; color: string }> = {
  bullish: { icon: '▲', color: '#22c55e' },
  bearish: { icon: '▼', color: '#ef4444' },
  neutral: { icon: '●', color: '#6b7280' },
};

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export class CryptoTrendingPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private abortCtrl: AbortController | null = null;

  private data: CryptoTrendingResponse | null = null;
  private error: string | null = null;

  constructor() {
    super({ id: 'crypto-trending', title: 'Trending Topics', showCount: true });

    void this.loadData();

    this.refreshTimer = setInterval(() => {
      void this.loadData();
    }, REFRESH_MS);
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
    this.render();

    try {
      this.data = await fetchCryptoTrending();
      if (this.abortCtrl.signal.aborted) return;
    } catch (err) {
      if (this.abortCtrl.signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[CryptoTrendingPanel] fetch failed:', err);
    }

    this.render();
  }

  /* ---------------------------------------------------------------- */
  /*  Rendering                                                        */
  /* ---------------------------------------------------------------- */

  private render(): void {
    /* Loading */
    if (!this.data && !this.error) {
      this.showLoading('Loading trending topics…');
      return;
    }

    /* Error with no data */
    if (this.error && (!this.data || this.data.trending.length === 0)) {
      this.showError(this.error);
      return;
    }

    const topics = this.data?.trending ?? [];
    this.setCount(topics.length);

    if (topics.length === 0) {
      this.setContent(
        '<div style="text-align:center;color:#6b7280;padding:24px 0;font-size:13px;">No trending topics available</div>',
      );
      return;
    }

    const rows = topics.map((t) => this.renderTopic(t)).join('');
    const meta = this.data
      ? `<div style="font-size:10px;color:#6b7280;padding:4px 6px;font-family:monospace;">
           ${this.data.totalArticlesAnalyzed} articles · ${escapeHtml(this.data.timeWindow)}
         </div>`
      : '';

    this.setContent(`
      <div class="crypto-trending-list" style="overflow-y:auto;max-height:420px;">
        ${rows}
      </div>
      ${meta}
    `);

    this.bindEvents();
  }

  /* ------------- Single topic row ------------- */

  private renderTopic(t: TrendingTopic): string {
    const fallback = { icon: '●', color: '#6b7280' };
    const meta = SENTIMENT_META[t.sentiment] ?? fallback;
    const icon = meta.icon;
    const color = meta.color;

    const headlines = t.sampleHeadlines
      .slice(0, 2)
      .map(
        (h) =>
          `<div style="font-size:11px;color:#9ca3af;line-height:1.3;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap;max-width:100%;font-family:sans-serif;">
            ${escapeHtml(h)}
          </div>`,
      )
      .join('');

    return `
      <button class="crypto-trending-row" data-topic="${escapeHtml(t.topic)}"
        style="display:block;width:100%;text-align:left;background:rgba(255,255,255,0.03);
          border:none;border-bottom:1px solid rgba(255,255,255,0.04);padding:8px 6px;
          cursor:pointer;transition:background 0.15s;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
          <span style="color:${color};font-size:13px;font-family:monospace;">${icon}</span>
          <span style="color:#e0e0e0;font-size:13px;font-weight:600;font-family:sans-serif;">
            ${escapeHtml(t.topic)}
          </span>
          <span style="margin-left:auto;color:#9ca3af;font-size:11px;font-family:monospace;">
            ${t.count} article${t.count !== 1 ? 's' : ''}
          </span>
        </div>
        ${headlines ? `<div style="padding-left:21px;display:flex;flex-direction:column;gap:2px;">${headlines}</div>` : ''}
      </button>
    `;
  }

  /* ---------------------------------------------------------------- */
  /*  Event binding                                                    */
  /* ---------------------------------------------------------------- */

  private bindEvents(): void {
    this.content.querySelectorAll<HTMLButtonElement>('.crypto-trending-row').forEach((btn) => {
      /* Hover effect */
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(139,92,246,0.12)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(255,255,255,0.03)';
      });

      /* Click → dispatch filter event */
      btn.addEventListener('click', () => {
        const topic = btn.dataset.topic;
        if (!topic) return;
        window.dispatchEvent(
          new CustomEvent('crypto-news:filter', { detail: { keyword: topic } }),
        );
      });
    });
  }
}
