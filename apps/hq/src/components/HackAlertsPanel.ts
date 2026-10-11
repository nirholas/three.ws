import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { timeAgo } from '@/utils/defi-format';

const HACK_RSS_FEEDS = [
  { name: 'Rekt News', url: '/api/rss-proxy?url=' + encodeURIComponent('https://news.google.com/rss/search?q=site:rekt.news+when:7d&hl=en-US&gl=US&ceid=US:en') },
  { name: 'PeckShield', url: '/api/rss-proxy?url=' + encodeURIComponent('https://news.google.com/rss/search?q=PeckShield+exploit+OR+hack+crypto+when:7d&hl=en-US&gl=US&ceid=US:en') },
  { name: 'CertiK Alert', url: '/api/rss-proxy?url=' + encodeURIComponent('https://news.google.com/rss/search?q=CertiK+alert+OR+exploit+OR+hack+crypto+when:7d&hl=en-US&gl=US&ceid=US:en') },
  { name: 'DeFi Exploits', url: '/api/rss-proxy?url=' + encodeURIComponent('https://news.google.com/rss/search?q=(defi+exploit+OR+defi+hack+OR+crypto+hack+OR+bridge+hack+OR+smart+contract+vulnerability+OR+rug+pull+OR+flash+loan+attack)when:7d&hl=en-US&gl=US&ceid=US:en') },
  { name: 'Blockchain Security', url: '/api/rss-proxy?url=' + encodeURIComponent('https://news.google.com/rss/search?q=(blockchain+security+OR+protocol+exploit+OR+MEV+attack+OR+sandwich+attack)when:7d&hl=en-US&gl=US&ceid=US:en') },
];

const SEVERITY_KEYWORDS: Record<string, string[]> = {
  CRITICAL: ['exploit', 'hack', 'stolen', 'drained', 'million', 'bridge', 'vulnerability', 'compromised', 'emergency'],
  WARNING: ['suspicious', 'alert', 'unusual', 'rug', 'flash loan', 'manipulation', 'depeg'],
  INFO: ['audit', 'security', 'patch', 'update', 'bounty', 'fix'],
};

function classifySeverity(title: string): string {
  const lower = title.toLowerCase();
  for (const [severity, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return severity;
  }
  return 'INFO';
}

function severityClass(severity: string): string {
  if (severity === 'CRITICAL') return 'severity-critical';
  if (severity === 'WARNING') return 'severity-warning';
  return 'severity-info';
}

function severityIcon(severity: string): string {
  if (severity === 'CRITICAL') return '🚨';
  if (severity === 'WARNING') return '⚠️';
  return 'ℹ️';
}



interface HackItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  severity: string;
}

export class HackAlertsPanel extends Panel {
  private items: HackItem[] = [];
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({ id: 'hack-alerts', title: 'Exploit Alerts', showCount: true });
    void this.fetchAll();
    this.refreshInterval = setInterval(() => this.fetchAll(), 3 * 60000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.abortController?.abort();
    this.abortController = null;
    super.destroy();
  }

  private async fetchAll(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const results = await Promise.allSettled(
        HACK_RSS_FEEDS.map(async feed => {
          const res = await fetch(feed.url, { signal });
          if (!res.ok) return [];
          const text = await res.text();
          return this.parseRss(text, feed.name);
        })
      );

      const allItems: HackItem[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') allItems.push(...r.value);
      }

      // Sort: critical first, then by date
      allItems.sort((a, b) => {
        const severityOrder: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
        const sDiff = (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2);
        if (sDiff !== 0) return sDiff;
        return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
      });

      this.items = allItems.slice(0, 25);
      this.error = null;
    } catch (err) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private parseRss(xml: string, sourceName: string): HackItem[] {
    const items: HackItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const itemStr = itemXml ?? '';
      const title = itemStr.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)?.[1] || itemStr.match(/<title>(.*?)<\/title>/)?.[1] || '';
      const link = itemStr.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const pubDate = itemStr.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

      if (title && link) {
        const cleanTitle = title.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        items.push({
          title: cleanTitle,
          link: link.trim(),
          pubDate: pubDate || new Date().toISOString(),
          source: sourceName,
          severity: classifySeverity(cleanTitle),
        });
      }
    }
    return items.slice(0, 10);
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Scanning for exploits...'); return; }
    if (this.error) { this.showError(this.error); return; }

    const criticalCount = this.items.filter(i => i.severity === 'CRITICAL').length;
    const warningCount = this.items.filter(i => i.severity === 'WARNING').length;

    if (this.items.length === 0) {
      this.setContent(`
        <div class="hack-clear">
          <span class="hack-clear-icon">🛡️</span>
          <span class="hack-clear-text">No active exploit alerts</span>
        </div>
      `);
      this.setCount(0);
      return;
    }

    this.setCount(this.items.length);

    const html = `
      <div class="hack-summary">
        ${criticalCount > 0 ? `<span class="hack-badge severity-critical">🚨 ${criticalCount} CRITICAL</span>` : ''}
        ${warningCount > 0 ? `<span class="hack-badge severity-warning">⚠️ ${warningCount} WARNING</span>` : ''}
        <span class="hack-badge severity-info">Total: ${this.items.length}</span>
      </div>
      <div class="hack-list">
        ${this.items.map(item => {
          const detailJson = escapeHtml(JSON.stringify({ title: item.title, url: item.link, source: item.source, publishedAt: item.pubDate, category: 'security', severity: item.severity }));
          return `
          <div class="hack-item-row" style="display:flex;align-items:start;gap:4px">
            <a class="hack-item ${severityClass(item.severity)}" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" style="flex:1;min-width:0">
              <div class="hack-header">
                <span class="hack-severity">${severityIcon(item.severity)} ${item.severity}</span>
                <span class="hack-time">${timeAgo(item.pubDate)}</span>
              </div>
              <div class="hack-title">${escapeHtml(item.title)}</div>
              <span class="hack-source">${escapeHtml(item.source)}</span>
            </a>
            <button class="detail-open-btn" data-detail-event='${detailJson}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;margin-left:4px;opacity:0.6;flex-shrink:0" title="View details">ℹ</button>
          </div>
        `;
        }).join('')}
      </div>
    `;

    this.setContent(html);
    this.bindDetailButtons();
  }

  private bindDetailButtons(): void {
    this.content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.detail-open-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const data = JSON.parse(btn.getAttribute('data-detail-event') || '{}');
        window.dispatchEvent(new CustomEvent('detail:open', { detail: { type: 'event', data } }));
      } catch { /* ignore parse errors */ }
    });
  }
}
