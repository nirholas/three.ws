/**
 * NewsDetail - renderer for news cluster / headline detail views.
 * Shows headline, sentiment, AI summary, extracted entities,
 * related coverage, and external article link.
 */

import { escapeHtml } from '@/utils/sanitize';

/* ── Interfaces ── */

interface RelatedHeadline {
  title: string;
  source: string;
  url?: string;
}

interface NewsDetailData {
  title: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  summary?: string;
  sentiment?: number;       // -1 to 1
  category?: string;
  relatedHeadlines?: RelatedHeadline[];
  entities?: string[];
}

/* ── Helpers ── */

function timeAgo(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return escapeHtml(iso);
    const secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return escapeHtml(iso);
  }
}

function sentimentLabel(v: number): string {
  if (v >= 0.3) return 'Positive';
  if (v <= -0.3) return 'Negative';
  return 'Neutral';
}

function sentimentColor(v: number): string {
  if (v >= 0.3) return '#22c55e';
  if (v <= -0.3) return '#ef4444';
  return '#eab308';
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

/* ── Public API ── */

export function getTitle(data: unknown): string {
  const d = data as NewsDetailData | null;
  if (!d) return 'News';
  if (d.title) return truncate(d.title, 40);
  const raw = d as unknown as Record<string, unknown>;
  if (typeof raw.headline === 'string') return truncate(raw.headline, 40);
  return 'News';
}

export function render(container: HTMLElement, data: unknown): void {
  const d = ((data ?? {}) as NewsDetailData);
  const parts: string[] = [];

  /* ── 1. Headline ── */
  {
    const timePart = d.publishedAt ? `<span style="color:#666;font-size:12px;margin-left:8px">${timeAgo(d.publishedAt)}</span>` : '';
    const sourceBadge = d.source
      ? `<span class="detail-chip" style="background:#1e293b;color:#94a3b8;font-size:11px;padding:2px 8px;border-radius:10px">${escapeHtml(d.source)}</span>`
      : '';
    parts.push(`
      <div class="detail-section">
        <div style="font-size:16px;font-weight:600;color:#eee;line-height:1.4;margin-bottom:8px">${escapeHtml(d.title || 'Untitled')}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${sourceBadge}
          ${timePart}
          ${d.category ? `<span style="color:#666;font-size:12px">${escapeHtml(d.category)}</span>` : ''}
        </div>
      </div>
    `);
  }

  /* ── 2. Sentiment bar ── */
  if (d.sentiment != null && !Number.isNaN(d.sentiment)) {
    const pct = Math.round((d.sentiment + 1) * 50); // -1→0%, 0→50%, 1→100%
    const color = sentimentColor(d.sentiment);
    const label = sentimentLabel(d.sentiment);
    parts.push(`
      <div class="detail-section">
        <div class="detail-section-title">Sentiment</div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="flex:1;height:6px;background:#1e293b;border-radius:3px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width .3s"></div>
          </div>
          <span style="color:${color};font-size:12px;font-weight:600;min-width:60px">${label} (${d.sentiment > 0 ? '+' : ''}${d.sentiment.toFixed(2)})</span>
        </div>
      </div>
    `);
  }

  /* ── 3. Summary ── */
  if (d.summary) {
    parts.push(`
      <div class="detail-section">
        <div class="detail-section-title">Summary</div>
        <p style="color:#bbb;font-size:13px;line-height:1.6;margin:0">${escapeHtml(d.summary)}</p>
      </div>
    `);
  }

  /* ── 4. Entities ── */
  if (d.entities && d.entities.length > 0) {
    const cryptoSymbols = ['BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX', 'MATIC', 'UNI', 'AAVE', 'LINK', 'ARB', 'OP', 'SUI', 'APT'];
    const chips = d.entities.map(e => {
      const isToken = cryptoSymbols.includes(e.toUpperCase());
      return `<span class="detail-chip" style="background:#1e293b;color:#94a3b8;font-size:11px;padding:3px 10px;border-radius:12px;cursor:pointer" data-entity="${escapeHtml(e)}" data-entity-type="${isToken ? 'token' : 'event'}">${escapeHtml(e)}</span>`;
    }).join('');
    parts.push(`
      <div class="detail-section">
        <div class="detail-section-title">Entities</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>
      </div>
    `);
  }

  /* ── 5. Related Coverage ── */
  if (d.relatedHeadlines && d.relatedHeadlines.length > 0) {
    const items = d.relatedHeadlines.map(h => {
      return `
        <div class="detail-news-item related-headline-row" style="cursor:pointer" data-title="${escapeHtml(h.title)}" data-url="${h.url ? escapeHtml(h.url) : ''}" data-source="${escapeHtml(h.source)}">
          <div class="detail-news-title" style="color:#60a5fa">${escapeHtml(truncate(h.title, 80))}</div>
          <div class="detail-news-meta">${escapeHtml(h.source)}</div>
        </div>
      `;
    }).join('');
    parts.push(`
      <div class="detail-section">
        <div class="detail-section-title">Related Coverage</div>
        ${items}
      </div>
    `);
  }

  /* ── 6. Actions ── */
  if (d.url) {
    parts.push(`
      <div class="detail-section">
        <a class="detail-link" href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer" style="font-size:14px">Read Full Article ↗</a>
      </div>
    `);
  }

  container.innerHTML = parts.join('');

  /* ── Wire entity chip clicks ── */
  container.querySelectorAll('[data-entity]').forEach(el => {
    (el as HTMLElement).addEventListener('click', () => {
      const entity = el.getAttribute('data-entity') || '';
      const entityType = el.getAttribute('data-entity-type') || 'event';
      if (entityType === 'token') {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'token', data: { symbol: entity.toUpperCase(), name: entity } }
        }));
      } else {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'event', data: { title: entity, category: 'entity' } }
        }));
      }
    });
  });

  /* ── Wire related headline clicks ── */
  container.querySelectorAll('.related-headline-row').forEach(el => {
    (el as HTMLElement).addEventListener('click', (e) => {
      e.preventDefault();
      const row = el as HTMLElement;
      window.dispatchEvent(new CustomEvent('detail:open', {
        detail: { type: 'news', data: {
          title: row.dataset.title || '',
          url: row.dataset.url || '',
          source: row.dataset.source || '',
        }}
      }));
    });
  });
}
