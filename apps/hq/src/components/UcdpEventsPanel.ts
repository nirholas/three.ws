import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { UcdpGeoEvent, UcdpEventType } from '@/types';

export class UcdpEventsPanel extends Panel {
  private events: UcdpGeoEvent[] = [];
  private activeTab: UcdpEventType = 'state-based';
  private onEventClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'geo-events',
      title: 'Geo Events',
      showCount: true,
      trackActivity: true,
      infoTooltip: `<strong>DeFi Security Events</strong>
        Event-level exploit and rug pull data.
        <ul>
          <li><strong>Smart Contract</strong>: Code exploits and flash loans</li>
          <li><strong>Rug Pull</strong>: Developer exit scams</li>
          <li><strong>Oracle</strong>: Price manipulation attacks</li>
        </ul>
        Losses shown as best estimate (low-high range).
        Duplicates are filtered out automatically.`,
    });
    this.showLoading('Loading security events');
  }

  public setEventClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onEventClick = handler;
  }

  public setEvents(events: UcdpGeoEvent[]): void {
    this.events = events;
    this.setCount(events.length);
    this.renderContent();
  }

  public getEvents(): UcdpGeoEvent[] {
    return this.events;
  }

  private renderContent(): void {
    const filtered = this.events.filter(e => e.type_of_violence === this.activeTab);
    const tabs: { key: UcdpEventType; label: string }[] = [
      { key: 'state-based', label: 'State-Based' },
      { key: 'non-state', label: 'Non-State' },
      { key: 'one-sided', label: 'One-Sided' },
    ];

    const tabCounts: Record<UcdpEventType, number> = {
      'state-based': 0,
      'non-state': 0,
      'one-sided': 0,
    };
    for (const event of this.events) {
      tabCounts[event.type_of_violence] += 1;
    }

    const totalDeaths = filtered.reduce((sum, e) => sum + e.deaths_best, 0);

    const tabsHtml = tabs.map(t =>
      `<button class="ucdp-tab ${t.key === this.activeTab ? 'ucdp-tab-active' : ''}" data-tab="${t.key}">${t.label} <span class="ucdp-tab-count">${tabCounts[t.key]}</span></button>`
    ).join('');

    const displayed = filtered.slice(0, 50);
    let bodyHtml: string;

    if (displayed.length === 0) {
      bodyHtml = '<div class="panel-empty">No events in this category</div>';
    } else {
      const rows = displayed.map(e => {
        const deathsClass = e.type_of_violence === 'state-based' ? 'ucdp-deaths-state'
          : e.type_of_violence === 'non-state' ? 'ucdp-deaths-nonstate'
          : 'ucdp-deaths-onesided';
        const deathsHtml = e.deaths_best > 0
          ? `<span class="${deathsClass}">${e.deaths_best}</span> <small class="ucdp-range">(${e.deaths_low}-${e.deaths_high})</small>`
          : '<span class="ucdp-deaths-zero">0</span>';
        const actors = `${escapeHtml(e.side_a)} vs ${escapeHtml(e.side_b)}`;

        return `<tr class="ucdp-row" data-lat="${e.latitude}" data-lon="${e.longitude}">
          <td class="ucdp-country">${escapeHtml(e.country)}</td>
          <td class="ucdp-deaths">${deathsHtml}</td>
          <td class="ucdp-date">${e.date_start}</td>
          <td class="ucdp-actors">${actors}</td>
          <td class="ucdp-detail"><button class="detail-open-btn" data-detail-event='${escapeHtml(JSON.stringify({ title: e.country + ': ' + e.side_a + ' vs ' + e.side_b, description: 'Deaths: ' + e.deaths_best + ' (' + e.deaths_low + '-' + e.deaths_high + ') • Date: ' + e.date_start, category: e.type_of_violence, lat: e.latitude, lon: e.longitude }))}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.6" title="View details">ℹ</button></td>
        </tr>`;
      }).join('');

      bodyHtml = `
        <table class="ucdp-table">
          <thead>
            <tr>
              <th>Country</th>
              <th>Deaths</th>
              <th>Date</th>
              <th>Actors</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    const moreHtml = filtered.length > 50
      ? `<div class="panel-more">${filtered.length - 50} more events not shown</div>`
      : '';

    this.setContent(`
      <div class="ucdp-panel-content">
        <div class="ucdp-header">
          <div class="ucdp-tabs">${tabsHtml}</div>
          ${totalDeaths > 0 ? `<span class="ucdp-total-deaths">${totalDeaths.toLocaleString()} deaths</span>` : ''}
        </div>
        ${bodyHtml}
        ${moreHtml}
      </div>
      <style>
        .ucdp-panel-content { font-size: 12px; }
        .ucdp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 4px; }
        .ucdp-tabs { display: flex; gap: 2px; }
        .ucdp-tab { background: transparent; border: 1px solid #333; color: #888; padding: 4px 10px; font-size: 11px; cursor: pointer; border-radius: 3px; transition: all 0.15s; }
        .ucdp-tab:hover { border-color: #555; color: #ccc; }
        .ucdp-tab-active { background: rgba(239, 68, 68, 0.1); border-color: #ef4444; color: #ef4444; }
        .ucdp-tab-count { font-variant-numeric: tabular-nums; opacity: 0.7; margin-left: 2px; }
        .ucdp-total-deaths { color: #ef4444; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .ucdp-table { width: 100%; border-collapse: collapse; }
        .ucdp-table th { text-align: left; color: #666; font-weight: 600; font-size: 10px; text-transform: uppercase; padding: 4px 8px; border-bottom: 1px solid #222; }
        .ucdp-table th:nth-child(2) { text-align: right; }
        .ucdp-table td { padding: 5px 8px; border-bottom: 1px solid #1a1a1a; color: #ccc; }
        .ucdp-row { cursor: pointer; }
        .ucdp-row:hover { background: #1a1a1a; }
        .ucdp-date { color: #666; white-space: nowrap; }
        .ucdp-deaths { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .ucdp-deaths-state { color: #ff4444; font-weight: 600; }
        .ucdp-deaths-nonstate { color: #ff8800; font-weight: 600; }
        .ucdp-deaths-onesided { color: #ffcc00; font-weight: 600; }
        .ucdp-deaths-zero { color: #555; }
        .ucdp-range { color: #555; font-size: 10px; }
        .ucdp-actors { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #777; font-size: 11px; }
        .ucdp-country { white-space: nowrap; }
      </style>
    `);

    this.content.querySelectorAll('.ucdp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = (btn as HTMLElement).dataset.tab as UcdpEventType;
        this.renderContent();
      });
    });

    this.content.querySelectorAll('.ucdp-row').forEach(el => {
      el.addEventListener('click', () => {
        const lat = Number((el as HTMLElement).dataset.lat);
        const lon = Number((el as HTMLElement).dataset.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) this.onEventClick?.(lat, lon);
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

  public destroy(): void {
    super.destroy();
  }
}
