import { Panel } from './Panel';
import type { GeoHubActivity } from '@/services/geo-activity';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

const COUNTRY_FLAGS: Record<string, string> = {
  'USA': '🇺🇸', 'Russia': '🇷🇺', 'China': '🇨🇳', 'UK': '🇬🇧', 'Belgium': '🇧🇪',
  'Israel': '🇮🇱', 'Iran': '🇮🇷', 'Ukraine': '🇺🇦', 'Taiwan': '🇹🇼', 'Japan': '🇯🇵',
  'South Korea': '🇰🇷', 'North Korea': '🇰🇵', 'India': '🇮🇳', 'Saudi Arabia': '🇸🇦',
  'Turkey': '🇹🇷', 'France': '🇫🇷', 'Germany': '🇩🇪', 'Egypt': '🇪🇬', 'Pakistan': '🇵🇰',
  'Palestine': '🇵🇸', 'Yemen': '🇾🇪', 'Syria': '🇸🇾', 'Lebanon': '🇱🇧',
  'Sudan': '🇸🇩', 'Ethiopia': '🇪🇹', 'Myanmar': '🇲🇲', 'Austria': '🇦🇹',
  'International': '🌐',
};

const TYPE_ICONS: Record<string, string> = {
  capital: '🏛️',
  conflict: '⚔️',
  strategic: '🔗',
  organization: '🏢',
};

const TYPE_LABELS: Record<string, string> = {
  capital: 'L1 Chain',
  conflict: 'Exploit Zone',
  strategic: 'Liquidity Hub',
  organization: 'Protocol',
};

export class GeoHubsPanel extends Panel {
  private activities: GeoHubActivity[] = [];
  private onHubClick?: (hub: GeoHubActivity) => void;

  constructor() {
    super({
      id: 'geo-hubs',
      title: 'DeFi Hotspots',
      showCount: true,
      infoTooltip: `
        <strong>DeFi Activity Hubs</strong><br>
        Shows protocols and chains with the most activity.<br><br>
        <em>Hub types:</em><br>
        • 🏛️ L1 Chains - Major blockchain ecosystems<br>
        • ⚔️ Exploit Zones - Recent security incidents<br>
        • 🔗 Liquidity - Top liquidity pools and DEXs<br>
        • 🏢 Protocols - Aave, Uniswap, MakerDAO, etc.<br><br>
        <em>Activity levels:</em><br>
        • <span style="color: #ff4444">High</span> - Trending or 70+ TVL change<br>
        • <span style="color: #ff8844">Elevated</span> - Score 40-69<br>
        • <span style="color: #888">Low</span> - Score below 40<br><br>
        Click a hub to zoom to its location.
      `,
    });
  }

  public setOnHubClick(handler: (hub: GeoHubActivity) => void): void {
    this.onHubClick = handler;
  }

  public setActivities(activities: GeoHubActivity[]): void {
    this.activities = activities.slice(0, 10);
    this.setCount(this.activities.length);
    this.render();
  }

  private getFlag(country: string): string {
    return COUNTRY_FLAGS[country] || '🌐';
  }

  private getTypeIcon(type: string): string {
    return TYPE_ICONS[type] || '📍';
  }

  private getTypeLabel(type: string): string {
    return TYPE_LABELS[type] || type;
  }

  private render(): void {
    if (this.activities.length === 0) {
      this.showError('No active DeFi hubs');
      return;
    }

    const html = this.activities.map((hub, index) => {
      const trendIcon = hub.trend === 'rising' ? '↑' : hub.trend === 'falling' ? '↓' : '';
      const breakingTag = hub.hasBreaking ? '<span class="hub-breaking geo">ALERT</span>' : '';
      const topStory = hub.topStories[0];

      return `
        <div class="geo-hub-item ${hub.activityLevel}" data-hub-id="${escapeHtml(hub.hubId)}" data-index="${index}">
          <div class="hub-rank">${index + 1}</div>
          <span class="geo-hub-indicator ${hub.activityLevel}"></span>
          <div class="hub-info">
            <div class="hub-header">
              <span class="hub-name">${escapeHtml(hub.name)}</span>
              <span class="hub-flag">${this.getFlag(hub.country)}</span>
              ${breakingTag}
            </div>
            <div class="hub-meta">
              <span class="hub-news-count">${hub.newsCount} ${hub.newsCount === 1 ? 'story' : 'stories'}</span>
              ${trendIcon ? `<span class="hub-trend ${hub.trend}">${trendIcon}</span>` : ''}
              <span class="geo-hub-type">${this.getTypeIcon(hub.type)} ${this.getTypeLabel(hub.type)}</span>
            </div>
          </div>
          <div class="hub-score geo">${Math.round(hub.score)}</div>
        </div>
        ${topStory ? `
          <div style="display:flex;align-items:start;gap:4px">
            <a class="hub-top-story geo" href="${sanitizeUrl(topStory.link)}" target="_blank" rel="noopener" data-hub-id="${escapeHtml(hub.hubId)}" style="flex:1;min-width:0">
              ${escapeHtml(topStory.title.length > 80 ? topStory.title.slice(0, 77) + '...' : topStory.title)}
            </a>
            <button class="detail-open-btn" data-detail-event='${escapeHtml(JSON.stringify({ title: hub.name + ' - ' + topStory.title, description: hub.newsCount + ' stories, score: ' + Math.round(hub.score), category: 'geo-hub', url: topStory.link }))}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;margin-left:4px;opacity:0.6;flex-shrink:0" title="View details">ℹ</button>
          </div>
        ` : ''}
      `;
    }).join('');

    this.setContent(html);
    this.bindEvents();
  }

  private bindEvents(): void {
    const items = this.content.querySelectorAll<HTMLDivElement>('.geo-hub-item');
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
