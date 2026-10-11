import { Panel } from './Panel';
import type { AIRegulation, RegulatoryAction, CountryRegulationProfile } from '@/types';
import {
  AI_REGULATIONS,
  COUNTRY_REGULATION_PROFILES,
  getUpcomingDeadlines,
  getRecentActions,
} from '@/config/ai-regulations';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

export class RegulationPanel extends Panel {
  private viewMode: 'timeline' | 'deadlines' | 'regulations' | 'countries' = 'timeline';

  constructor(id: string) {
    super({ id, title: 'AI Regulation Dashboard' });
    this.render();
  }

  protected render(): void {
    this.content.innerHTML = `
      <div class="regulation-panel">
        <div class="regulation-header">
          <h3>AI Regulation Dashboard</h3>
          <div class="regulation-tabs">
            <button class="tab ${this.viewMode === 'timeline' ? 'active' : ''}" data-view="timeline">Timeline</button>
            <button class="tab ${this.viewMode === 'deadlines' ? 'active' : ''}" data-view="deadlines">Deadlines</button>
            <button class="tab ${this.viewMode === 'regulations' ? 'active' : ''}" data-view="regulations">Regulations</button>
            <button class="tab ${this.viewMode === 'countries' ? 'active' : ''}" data-view="countries">Countries</button>
          </div>
        </div>
        <div class="regulation-content">
          ${this.renderContent()}
        </div>
      </div>
    `;

    // Add event listeners for tabs
    this.content.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const view = target.dataset.view as typeof this.viewMode;
        if (view) {
          this.viewMode = view;
          this.render();
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

  private renderContent(): string {
    switch (this.viewMode) {
      case 'timeline':
        return this.renderTimeline();
      case 'deadlines':
        return this.renderDeadlines();
      case 'regulations':
        return this.renderRegulations();
      case 'countries':
        return this.renderCountries();
      default:
        return '';
    }
  }

  private renderTimeline(): string {
    const recentActions = getRecentActions(12); // Last 12 months

    if (recentActions.length === 0) {
      return '<div class="empty-state">No recent regulatory actions</div>';
    }

    return `
      <div class="timeline-view">
        <div class="timeline-header">
          <h4>Recent Regulatory Actions (Last 12 Months)</h4>
          <span class="count">${recentActions.length} actions</span>
        </div>
        <div class="timeline-list">
          ${recentActions.map(action => this.renderTimelineItem(action)).join('')}
        </div>
      </div>
    `;
  }

  private renderTimelineItem(action: RegulatoryAction): string {
    const date = new Date(action.date);
    const formattedDate = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    const typeIcons: Record<RegulatoryAction['type'], string> = {
      'law-passed': '📜',
      'executive-order': '🏛️',
      'guideline': '📋',
      'enforcement': '⚖️',
      'consultation': '💬',
    };

    const impactColors: Record<RegulatoryAction['impact'], string> = {
      high: '#ff4444',
      medium: '#ffaa00',
      low: '#44ff88',
    };

    return `
      <div class="timeline-item impact-${action.impact}">
        <div class="timeline-marker">
          <span class="timeline-icon">${typeIcons[action.type]}</span>
          <div class="timeline-line"></div>
        </div>
        <div class="timeline-content">
          <div class="timeline-header-row">
            <span class="timeline-date">${formattedDate}</span>
            <span class="timeline-country">${escapeHtml(action.country)}</span>
            <span class="timeline-impact" style="color: ${impactColors[action.impact]}">${action.impact.toUpperCase()}</span>
          </div>
          <h5>${escapeHtml(action.title)}</h5>
          <p>${escapeHtml(action.description)}</p>
          ${action.source ? `<span class="timeline-source">Source: ${escapeHtml(action.source)}</span>` : ''}
        </div>
      </div>
    `;
  }

  private renderDeadlines(): string {
    const upcomingDeadlines = getUpcomingDeadlines();

    if (upcomingDeadlines.length === 0) {
      return '<div class="empty-state">No upcoming compliance deadlines in the next 12 months</div>';
    }

    return `
      <div class="deadlines-view">
        <div class="deadlines-header">
          <h4>Upcoming Compliance Deadlines</h4>
          <span class="count">${upcomingDeadlines.length} deadlines</span>
        </div>
        <div class="deadlines-list">
          ${upcomingDeadlines.map(reg => this.renderDeadlineItem(reg)).join('')}
        </div>
      </div>
    `;
  }

  private renderDeadlineItem(regulation: AIRegulation): string {
    const deadline = new Date(regulation.complianceDeadline!);
    const now = new Date();
    const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    const formattedDate = deadline.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const urgencyClass = daysUntil < 90 ? 'urgent' : daysUntil < 180 ? 'warning' : 'normal';

    return `
      <div class="deadline-item ${urgencyClass}">
        <div class="deadline-countdown">
          <div class="days-until">${daysUntil}</div>
          <div class="days-label">days</div>
        </div>
        <div class="deadline-content">
          <h5>${escapeHtml(regulation.shortName)}</h5>
          <p class="deadline-name">${escapeHtml(regulation.name)}</p>
          <div class="deadline-meta">
            <span class="deadline-date">📅 ${formattedDate}</span>
            <span class="deadline-country">🌍 ${escapeHtml(regulation.country)}</span>
          </div>
          ${regulation.penalties ? `<p class="deadline-penalties">⚠️ Penalties: ${escapeHtml(regulation.penalties)}</p>` : ''}
          <div class="deadline-scope">
            ${regulation.scope.map(s => `<span class="scope-tag">${escapeHtml(s)}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private renderRegulations(): string {
    const activeRegulations = AI_REGULATIONS.filter(r => r.status === 'active');
    const proposedRegulations = AI_REGULATIONS.filter(r => r.status === 'proposed');

    return `
      <div class="regulations-view">
        <div class="regulations-section">
          <h4>Active Regulations (${activeRegulations.length})</h4>
          <div class="regulations-list">
            ${activeRegulations.map(reg => this.renderRegulationCard(reg)).join('')}
          </div>
        </div>
        <div class="regulations-section">
          <h4>Proposed Regulations (${proposedRegulations.length})</h4>
          <div class="regulations-list">
            ${proposedRegulations.map(reg => this.renderRegulationCard(reg)).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private renderRegulationCard(regulation: AIRegulation): string {
    const typeColors: Record<AIRegulation['type'], string> = {
      comprehensive: '#4488ff',
      sectoral: '#ff8844',
      voluntary: '#44ff88',
      proposed: '#ffaa00',
    };

    const effectiveDate = regulation.effectiveDate
      ? new Date(regulation.effectiveDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
      : 'TBD';
    const regulationLink = regulation.link ? sanitizeUrl(regulation.link) : '';

    return `
      <div class="regulation-card">
        <div class="regulation-card-header">
          <h5>${escapeHtml(regulation.shortName)}</h5>
          <span class="regulation-type" style="background-color: ${typeColors[regulation.type]}">${regulation.type}</span>
        </div>
        <p class="regulation-full-name">${escapeHtml(regulation.name)}</p>
        <div class="regulation-meta">
          <span>🌍 ${escapeHtml(regulation.country)}</span>
          <span>📅 ${effectiveDate}</span>
          <span class="status-badge status-${regulation.status}">${regulation.status}</span>
        </div>
        ${regulation.description ? `<p class="regulation-description">${escapeHtml(regulation.description)}</p>` : ''}
        <div class="regulation-provisions">
          <strong>Key Provisions:</strong>
          <ul>
            ${regulation.keyProvisions.slice(0, 3).map(p => `<li>${escapeHtml(p)}</li>`).join('')}
            ${regulation.keyProvisions.length > 3 ? `<li class="more-provisions">+${regulation.keyProvisions.length - 3} more...</li>` : ''}
          </ul>
        </div>
        <div class="regulation-scope">
          ${regulation.scope.map(s => `<span class="scope-tag">${escapeHtml(s)}</span>`).join('')}
        </div>
        ${regulationLink ? `<a href="${regulationLink}" target="_blank" rel="noopener noreferrer" class="regulation-link">Learn More →</a>` : ''}
        <button class="detail-open-btn" data-detail-event='${escapeHtml(JSON.stringify({ title: regulation.shortName + ' - ' + regulation.name, description: regulation.description || regulation.keyProvisions.join('; '), category: 'regulation', url: regulation.link || '' }))}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;margin-left:4px;opacity:0.6" title="View details">ℹ</button>
      </div>
    `;
  }

  private renderCountries(): string {
    const profiles = COUNTRY_REGULATION_PROFILES.sort((a, b) => {
      const stanceOrder: Record<CountryRegulationProfile['stance'], number> = {
        strict: 0,
        moderate: 1,
        permissive: 2,
        undefined: 3,
      };
      return stanceOrder[a.stance] - stanceOrder[b.stance];
    });

    return `
      <div class="countries-view">
        <div class="countries-header">
          <h4>Global Regulatory Landscape</h4>
          <div class="stance-legend">
            <span class="legend-item"><span class="color-box strict"></span> Strict</span>
            <span class="legend-item"><span class="color-box moderate"></span> Moderate</span>
            <span class="legend-item"><span class="color-box permissive"></span> Permissive</span>
            <span class="legend-item"><span class="color-box undefined"></span> Undefined</span>
          </div>
        </div>
        <div class="countries-list">
          ${profiles.map(profile => this.renderCountryCard(profile)).join('')}
        </div>
      </div>
    `;
  }

  private renderCountryCard(profile: CountryRegulationProfile): string {
    const stanceColors: Record<CountryRegulationProfile['stance'], string> = {
      strict: '#ff4444',
      moderate: '#ffaa00',
      permissive: '#44ff88',
      undefined: '#666666',
    };

    const activeCount = profile.activeRegulations.length;
    const proposedCount = profile.proposedRegulations.length;

    return `
      <div class="country-card stance-${profile.stance}">
        <div class="country-card-header" style="border-left: 4px solid ${stanceColors[profile.stance]}">
          <h5>${escapeHtml(profile.country)}</h5>
          <span class="stance-badge" style="background-color: ${stanceColors[profile.stance]}">${profile.stance.toUpperCase()}</span>
        </div>
        <p class="country-summary">${escapeHtml(profile.summary)}</p>
        <div class="country-stats">
          <div class="stat">
            <span class="stat-value">${activeCount}</span>
            <span class="stat-label">Active</span>
          </div>
          <div class="stat">
            <span class="stat-value">${proposedCount}</span>
            <span class="stat-label">Proposed</span>
          </div>
          <div class="stat">
            <span class="stat-value">${new Date(profile.lastUpdated).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
            <span class="stat-label">Updated</span>
          </div>
        </div>
      </div>
    `;
  }

  public updateData(): void {
    this.render();
  }

  public setView(view: 'timeline' | 'deadlines' | 'regulations' | 'countries'): void {
    this.viewMode = view;
    this.render();
  }

  public destroy(): void {
    super.destroy();
  }
}
