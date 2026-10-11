import { Panel } from './Panel';
import type { TechHubActivity } from '@/services/tech-activity';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

const COUNTRY_FLAGS: Record<string, string> = {
  'USA': '🇺🇸', 'United States': '🇺🇸',
  'UK': '🇬🇧', 'United Kingdom': '🇬🇧',
  'China': '🇨🇳',
  'India': '🇮🇳',
  'Israel': '🇮🇱',
  'Germany': '🇩🇪',
  'France': '🇫🇷',
  'Canada': '🇨🇦',
  'Japan': '🇯🇵',
  'South Korea': '🇰🇷',
  'Singapore': '🇸🇬',
  'Australia': '🇦🇺',
  'Netherlands': '🇳🇱',
  'Sweden': '🇸🇪',
  'Switzerland': '🇨🇭',
  'Brazil': '🇧🇷',
  'Indonesia': '🇮🇩',
  'UAE': '🇦🇪',
  'Estonia': '🇪🇪',
  'Ireland': '🇮🇪',
  'Finland': '🇫🇮',
  'Spain': '🇪🇸',
  'Italy': '🇮🇹',
  'Poland': '🇵🇱',
  'Mexico': '🇲🇽',
  'Argentina': '🇦🇷',
  'Chile': '🇨🇱',
  'Colombia': '🇨🇴',
  'Nigeria': '🇳🇬',
  'Kenya': '🇰🇪',
  'South Africa': '🇿🇦',
  'Egypt': '🇪🇬',
  'Taiwan': '🇹🇼',
  'Vietnam': '🇻🇳',
  'Thailand': '🇹🇭',
  'Malaysia': '🇲🇾',
  'Philippines': '🇵🇭',
  'New Zealand': '🇳🇿',
  'Austria': '🇦🇹',
  'Belgium': '🇧🇪',
  'Denmark': '🇩🇰',
  'Norway': '🇳🇴',
  'Portugal': '🇵🇹',
  'Czech Republic': '🇨🇿',
  'Romania': '🇷🇴',
  'Ukraine': '🇺🇦',
  'Russia': '🇷🇺',
  'Turkey': '🇹🇷',
  'Saudi Arabia': '🇸🇦',
  'Qatar': '🇶🇦',
  'Pakistan': '🇵🇰',
  'Bangladesh': '🇧🇩',
};

export class TechHubsPanel extends Panel {
  private activities: TechHubActivity[] = [];
  private onHubClick?: (hub: TechHubActivity) => void;

  constructor() {
    super({
      id: 'tech-hubs',
      title: 'Hot Tech Hubs',
      showCount: true,
      infoTooltip: `
        <strong>Tech Hub Activity</strong><br>
        Shows tech hubs with the most news activity.<br><br>
        <em>Activity levels:</em><br>
        • <span style="color: #00ff88">High</span> - Breaking news or 50+ score<br>
        • <span style="color: #ffc800">Elevated</span> - Score 20-49<br>
        • <span style="color: #888">Low</span> - Score below 20<br><br>
        Click a hub to zoom to its location.
      `,
    });
  }

  public setOnHubClick(handler: (hub: TechHubActivity) => void): void {
    this.onHubClick = handler;
  }

  public setActivities(activities: TechHubActivity[]): void {
    this.activities = activities.slice(0, 10);
    this.setCount(this.activities.length);
    this.render();
  }

  private getFlag(country: string): string {
    return COUNTRY_FLAGS[country] || '🌐';
  }

  private render(): void {
    if (this.activities.length === 0) {
      this.showError('No active tech hubs');
      return;
    }

    const html = this.activities.map((hub, index) => {
      const trendIcon = hub.trend === 'rising' ? '↑' : hub.trend === 'falling' ? '↓' : '';
      const breakingTag = hub.hasBreaking ? '<span class="hub-breaking">ALERT</span>' : '';
      const topStory = hub.topStories[0];

      return `
        <div class="tech-hub-item ${hub.activityLevel}" data-hub-id="${escapeHtml(hub.hubId)}" data-index="${index}">
          <div class="hub-rank">${index + 1}</div>
          <span class="hub-indicator ${hub.activityLevel}"></span>
          <div class="hub-info">
            <div class="hub-header">
              <span class="hub-name">${escapeHtml(hub.city)}</span>
              <span class="hub-flag">${this.getFlag(hub.country)}</span>
              ${breakingTag}
            </div>
            <div class="hub-meta">
              <span class="hub-news-count">${hub.newsCount} ${hub.newsCount === 1 ? 'story' : 'stories'}</span>
              ${trendIcon ? `<span class="hub-trend ${hub.trend}">${trendIcon}</span>` : ''}
              <span class="hub-tier">${hub.tier}</span>
            </div>
          </div>
          <div class="hub-score">${Math.round(hub.score)}</div>
        </div>
        ${topStory ? `
          <div style="display:flex;align-items:start;gap:4px">
            <a class="hub-top-story" href="${sanitizeUrl(topStory.link)}" target="_blank" rel="noopener" data-hub-id="${escapeHtml(hub.hubId)}" style="flex:1;min-width:0">
              ${escapeHtml(topStory.title.length > 80 ? topStory.title.slice(0, 77) + '...' : topStory.title)}
            </a>
            <button class="detail-open-btn" data-detail-event='${escapeHtml(JSON.stringify({ title: hub.city + ' - ' + topStory.title, description: hub.newsCount + ' stories, score: ' + Math.round(hub.score), category: 'tech-hub', url: topStory.link }))}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;margin-left:4px;opacity:0.6;flex-shrink:0" title="View details">ℹ</button>
          </div>
        ` : ''}
      `;
    }).join('');

    this.setContent(html);
    this.bindEvents();
  }

  private bindEvents(): void {
    const items = this.content.querySelectorAll<HTMLDivElement>('.tech-hub-item');
    items.forEach((item) => {
      item.addEventListener('click', () => {
        const hubId = item.dataset.hubId;
        const hub = this.activities.find(a => a.hubId === hubId);
        if (hub && this.onHubClick) {
          this.onHubClick(hub);
        }
      });
    });

    // Delegated click handler for detail:open buttons
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
