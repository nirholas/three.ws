import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import {
  MARKET_TOPICS,
  fetchTopicInsight,
  formatArticleDate,
  extractDomain,
  type GdeltArticle,
  type MarketTopic,
  type TopicInsight,
} from '@/services/gdelt-intel';

export class GdeltIntelPanel extends Panel {
  private activeTopic: MarketTopic = MARKET_TOPICS[0]!;
  private topicData = new Map<string, TopicInsight>();
  private tabsEl: HTMLElement | null = null;

  constructor() {
    super({
      id: 'news-insights',
      title: 'News Insights',
      showCount: true,
      trackActivity: true,
      infoTooltip: `<strong>Market Intelligence</strong>
        Real-time crypto and DeFi news monitoring:
        <ul>
          <li>Curated topic categories (DeFi, exploits, regulations, etc.)</li>
          <li>Articles from 100+ languages translated</li>
          <li>Updates every 15 minutes</li>
        </ul>
        Source: GDELT Project (gdeltproject.org)`,
    });
    this.createTabs();
    this.loadActiveTopic();
  }

  private createTabs(): void {
    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'news-insights-tabs';

    MARKET_TOPICS.forEach(topic => {
      const tab = document.createElement('button');
      tab.className = `news-insights-tab ${topic.id === this.activeTopic.id ? 'active' : ''}`;
      tab.dataset.topicId = topic.id;
      tab.title = topic.description;
      tab.innerHTML = `<span class="tab-icon">${topic.icon}</span><span class="tab-label">${escapeHtml(topic.name)}</span>`;

      tab.addEventListener('click', () => this.selectTopic(topic));
      this.tabsEl!.appendChild(tab);
    });

    this.element.insertBefore(this.tabsEl, this.content);
  }

  private selectTopic(topic: MarketTopic): void {
    if (topic.id === this.activeTopic.id) return;

    this.activeTopic = topic;

    this.tabsEl?.querySelectorAll('.news-insights-tab').forEach(tab => {
      tab.classList.toggle('active', (tab as HTMLElement).dataset.topicId === topic.id);
    });

    const cached = this.topicData.get(topic.id);
    if (cached && Date.now() - cached.fetchedAt.getTime() < 5 * 60 * 1000) {
      this.renderArticles(cached.articles);
    } else {
      this.loadActiveTopic();
    }
  }

  private async loadActiveTopic(): Promise<void> {
    this.showLoading();

    try {
      const data = await fetchTopicInsight(this.activeTopic);
      this.topicData.set(this.activeTopic.id, data);
      this.renderArticles(data.articles);
      this.setCount(data.articles.length);
    } catch (error) {
      console.error('[GdeltIntelPanel] Load error:', error);
      this.showError('Failed to load market intel feed');
    }
  }

  private renderArticles(articles: GdeltArticle[]): void {
    if (articles.length === 0) {
      this.content.innerHTML = '<div class="empty-state">No recent articles for this topic</div>';
      return;
    }

    const html = articles.map(article => this.renderArticle(article)).join('');
    this.content.innerHTML = `<div class="news-insights-articles">${html}</div>`;
    this.bindDetailButtons();
  }

  private bindDetailButtons(): void {
    this.content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.detail-open-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const data = JSON.parse(btn.getAttribute('data-detail-news') || '{}');
        window.dispatchEvent(new CustomEvent('detail:open', { detail: { type: 'news', data } }));
      } catch { /* ignore parse errors */ }
    });
  }

  private renderArticle(article: GdeltArticle): string {
    const domain = article.source || extractDomain(article.url);
    const timeAgo = formatArticleDate(article.date);
    const toneClass = article.tone ? (article.tone < -2 ? 'tone-negative' : article.tone > 2 ? 'tone-positive' : '') : '';
    const detailJson = escapeHtml(JSON.stringify({ title: article.title, url: article.url, source: domain, publishedAt: article.date }));

    return `
      <div class="news-insights-article-row" style="display:flex;align-items:start;gap:4px">
        <a href="${sanitizeUrl(article.url)}" target="_blank" rel="noopener" class="news-insights-article ${toneClass}" style="flex:1;min-width:0">
          <div class="article-header">
            <span class="article-source">${escapeHtml(domain)}</span>
            <span class="article-time">${escapeHtml(timeAgo)}</span>
          </div>
          <div class="article-title">${escapeHtml(article.title)}</div>
        </a>
        <button class="detail-open-btn" data-detail-news='${detailJson}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;margin-left:4px;opacity:0.6;flex-shrink:0" title="View details">ℹ</button>
      </div>
    `;
  }

  public async refresh(): Promise<void> {
    await this.loadActiveTopic();
  }

  public async refreshAll(): Promise<void> {
    this.topicData.clear();
    await this.loadActiveTopic();
  }

  public destroy(): void {
    super.destroy();
  }
}
