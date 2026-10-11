import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

interface TechEventCoords {
  lat: number;
  lng: number;
  country: string;
  original: string;
  virtual?: boolean;
}

interface TechEvent {
  id: string;
  title: string;
  type: 'conference' | 'earnings' | 'ipo' | 'other';
  location: string | null;
  coords: TechEventCoords | null;
  startDate: string;
  endDate: string;
  url: string | null;
}

interface TechEventsResponse {
  success: boolean;
  count: number;
  conferenceCount: number;
  mappableCount: number;
  lastUpdated: string;
  events: TechEvent[];
  error?: string;
}

type ViewMode = 'upcoming' | 'conferences' | 'earnings' | 'all';

export class TechEventsPanel extends Panel {
  private viewMode: ViewMode = 'upcoming';
  private events: TechEvent[] = [];
  private loading = true;
  private error: string | null = null;
  private abortController: AbortController | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(id: string) {
    super({ id, title: 'Tech Events', showCount: true });
    this.element.classList.add('panel-tall');
    void this.fetchEvents();
    this.refreshInterval = setInterval(() => this.fetchEvents(), 10 * 60_000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.abortController?.abort();
    this.abortController = null;
    super.destroy();
  }

  private async fetchEvents(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await fetch('/api/tech-events?days=180&limit=100', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: TechEventsResponse = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');

      this.events = data.events;
      this.setCount(data.conferenceCount);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch events';
      console.error('[TechEvents] Fetch error:', err);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  protected render(): void {
    if (this.loading) {
      this.content.innerHTML = `
        <div class="tech-events-loading">
          <div class="loading-spinner"></div>
          <span>Loading tech events...</span>
        </div>
      `;
      return;
    }

    if (this.error) {
      this.content.innerHTML = `
        <div class="tech-events-error">
          <span class="error-icon">⚠️</span>
          <span class="error-text">${escapeHtml(this.error)}</span>
          <button class="retry-btn">Retry</button>
        </div>
      `;
      this.content.querySelector('.retry-btn')?.addEventListener('click', () => this.fetchEvents());
      return;
    }

    const filteredEvents = this.getFilteredEvents();
    const upcomingConferences = this.events.filter(e => e.type === 'conference' && new Date(e.startDate) >= new Date());
    const mappableCount = upcomingConferences.filter(e => e.coords && !e.coords.virtual).length;

    this.content.innerHTML = `
      <div class="tech-events-panel">
        <div class="tech-events-tabs">
          <button class="tab ${this.viewMode === 'upcoming' ? 'active' : ''}" data-view="upcoming">Upcoming</button>
          <button class="tab ${this.viewMode === 'conferences' ? 'active' : ''}" data-view="conferences">Conferences</button>
          <button class="tab ${this.viewMode === 'earnings' ? 'active' : ''}" data-view="earnings">Earnings</button>
          <button class="tab ${this.viewMode === 'all' ? 'active' : ''}" data-view="all">All</button>
        </div>
        <div class="tech-events-stats">
          <span class="stat">📅 ${upcomingConferences.length} conferences</span>
          <span class="stat">📍 ${mappableCount} on map</span>
          <a href="https://www.techmeme.com/events" target="_blank" rel="noopener" class="source-link">Techmeme Events ↗</a>
        </div>
        <div class="tech-events-list">
          ${filteredEvents.length > 0
            ? filteredEvents.map(e => this.renderEvent(e)).join('')
            : '<div class="empty-state">No events to display</div>'
          }
        </div>
      </div>
    `;

    // Add tab listeners
    this.content.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const view = (e.target as HTMLElement).dataset.view as ViewMode;
        if (view) {
          this.viewMode = view;
          this.render();
        }
      });
    });

    // Add map link listeners
    this.content.querySelectorAll('.event-map-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const lat = parseFloat((link as HTMLElement).dataset.lat || '0');
        const lng = parseFloat((link as HTMLElement).dataset.lng || '0');
        this.panToLocation(lat, lng);
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

  private getFilteredEvents(): TechEvent[] {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    switch (this.viewMode) {
      case 'upcoming':
        return this.events.filter(e => {
          const start = new Date(e.startDate);
          return start >= now && start <= thirtyDaysFromNow;
        }).slice(0, 20);

      case 'conferences':
        return this.events.filter(e => e.type === 'conference' && new Date(e.startDate) >= now).slice(0, 30);

      case 'earnings':
        return this.events.filter(e => e.type === 'earnings' && new Date(e.startDate) >= now).slice(0, 30);

      case 'all':
        return this.events.filter(e => new Date(e.startDate) >= now).slice(0, 50);

      default:
        return [];
    }
  }

  private renderEvent(event: TechEvent): string {
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);
    const now = new Date();

    const isToday = startDate.toDateString() === now.toDateString();
    const isSoon = !isToday && startDate <= new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // Within 2 days
    const isThisWeek = startDate <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endDateStr = endDate > startDate && endDate.toDateString() !== startDate.toDateString()
      ? ` - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : '';

    const typeIcons: Record<string, string> = {
      conference: '🎤',
      earnings: '📊',
      ipo: '🔔',
      other: '📌',
    };

    const typeClasses: Record<string, string> = {
      conference: 'type-conference',
      earnings: 'type-earnings',
      ipo: 'type-ipo',
      other: 'type-other',
    };

    const mapLink = event.coords && !event.coords.virtual
      ? `<button class="event-map-link" data-lat="${event.coords.lat}" data-lng="${event.coords.lng}" title="Show on map">📍</button>`
      : '';

    const locationText = event.location
      ? `<span class="event-location">${escapeHtml(event.location)}</span>`
      : '';

    const safeEventUrl = sanitizeUrl(event.url || '');
    const urlLink = safeEventUrl
      ? `<a href="${safeEventUrl}" target="_blank" rel="noopener" class="event-url" title="More info">↗</a>`
      : '';

    const detailJson = escapeHtml(JSON.stringify({ title: event.title, description: `${event.type} • ${dateStr}${endDateStr}${event.location ? ' • ' + event.location : ''}`, category: 'tech-event', url: event.url || '' }));

    return `
      <div class="tech-event ${typeClasses[event.type]} ${isToday ? 'is-today' : ''} ${isSoon ? 'is-soon' : ''} ${isThisWeek ? 'is-this-week' : ''}">
        <div class="event-date">
          <span class="event-month">${startDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
          <span class="event-day">${startDate.getDate()}</span>
          ${isToday ? '<span class="today-badge">TODAY</span>' : ''}
          ${isSoon ? '<span class="soon-badge">SOON</span>' : ''}
        </div>
        <div class="event-content">
          <div class="event-header">
            <span class="event-icon">${typeIcons[event.type]}</span>
            <span class="event-title">${escapeHtml(event.title)}</span>
            ${urlLink}
            <button class="detail-open-btn" data-detail-event='${detailJson}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;margin-left:4px;opacity:0.6;flex-shrink:0" title="View details">ℹ</button>
          </div>
          <div class="event-meta">
            <span class="event-dates">${dateStr}${endDateStr}</span>
            ${locationText}
            ${mapLink}
          </div>
        </div>
      </div>
    `;
  }

  private panToLocation(lat: number, lng: number): void {
    // Dispatch event for map to handle
    window.dispatchEvent(new CustomEvent('tech-event-location', {
      detail: { lat, lng, zoom: 10 }
    }));
  }

  public refresh(): void {
    void this.fetchEvents();
  }

  public getConferencesForMap(): TechEvent[] {
    return this.events.filter(e =>
      e.type === 'conference' &&
      e.coords &&
      !e.coords.virtual &&
      new Date(e.startDate) >= new Date()
    );
  }
}
