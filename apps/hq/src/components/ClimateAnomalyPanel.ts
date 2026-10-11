import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { ClimateAnomaly } from '@/types';
import { getSeverityIcon, formatDelta } from '@/services/climate';

export class ClimateAnomalyPanel extends Panel {
  private anomalies: ClimateAnomaly[] = [];
  private onZoneClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'climate',
      title: 'Climate Anomalies',
      showCount: true,
      trackActivity: true,
      infoTooltip: `<strong>Climate Anomaly Monitor</strong>
        Temperature and precipitation deviations from 30-day baseline.
        Data from Open-Meteo (ERA5 reanalysis).
        <ul>
          <li><strong>Extreme</strong>: >5°C or >80mm/day deviation</li>
          <li><strong>Moderate</strong>: >3°C or >40mm/day deviation</li>
        </ul>
        Monitors 15 conflict/disaster-prone zones.`,
    });
    this.showLoading('Loading climate data');
  }

  public setZoneClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onZoneClick = handler;
  }

  public setAnomalies(anomalies: ClimateAnomaly[]): void {
    this.anomalies = anomalies;
    this.setCount(anomalies.length);
    this.renderContent();
  }

  private renderContent(): void {
    if (this.anomalies.length === 0) {
      this.setContent('<div class="panel-empty">No significant anomalies detected</div>');
      return;
    }

    const sorted = [...this.anomalies].sort((a, b) => {
      const severityOrder = { extreme: 0, moderate: 1, normal: 2 };
      return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
    });

    const rows = sorted.map(a => {
      const icon = getSeverityIcon(a);
      const tempClass = a.tempDelta > 0 ? 'climate-warm' : 'climate-cold';
      const precipClass = a.precipDelta > 0 ? 'climate-wet' : 'climate-dry';
      const sevClass = `severity-${a.severity}`;
      const rowClass = a.severity === 'extreme' ? ' climate-extreme-row' : '';

      return `<tr class="climate-row${rowClass}" data-lat="${a.lat}" data-lon="${a.lon}">
        <td class="climate-zone"><span class="climate-icon">${icon}</span>${escapeHtml(a.zone)}</td>
        <td class="climate-num ${tempClass}">${formatDelta(a.tempDelta, '°C')}</td>
        <td class="climate-num ${precipClass}">${formatDelta(a.precipDelta, 'mm')}</td>
        <td><span class="climate-badge ${sevClass}">${a.severity.toUpperCase()}</span></td>
        <td class="climate-detail"><button class="detail-open-btn" data-detail-event='${escapeHtml(JSON.stringify({ title: a.zone + ' Climate Anomaly', description: 'Temp: ' + formatDelta(a.tempDelta, '°C') + ' • Precip: ' + formatDelta(a.precipDelta, 'mm') + ' • Severity: ' + a.severity, category: 'climate', lat: a.lat, lon: a.lon }))}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.6" title="View details">ℹ</button></td>
      </tr>`;
    }).join('');

    this.setContent(`
      <div class="climate-panel-content">
        <table class="climate-table">
          <thead>
            <tr>
              <th>Zone</th>
              <th>Temp</th>
              <th>Precip</th>
              <th>Severity</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <style>
        .climate-panel-content { font-size: 12px; }
        .climate-table { width: 100%; border-collapse: collapse; }
        .climate-table th { text-align: left; color: #666; font-weight: 600; font-size: 10px; text-transform: uppercase; padding: 4px 8px; border-bottom: 1px solid #222; }
        .climate-table th:nth-child(2), .climate-table th:nth-child(3) { text-align: right; }
        .climate-table td { padding: 5px 8px; border-bottom: 1px solid #1a1a1a; color: #ccc; }
        .climate-row { cursor: pointer; }
        .climate-row:hover { background: #1a1a1a; }
        .climate-extreme-row { background: rgba(255, 68, 68, 0.05); }
        .climate-extreme-row:hover { background: rgba(255, 68, 68, 0.1); }
        .climate-zone { white-space: nowrap; }
        .climate-icon { margin-right: 6px; }
        .climate-num { text-align: right; font-variant-numeric: tabular-nums; }
        .climate-warm { color: #ff6644; }
        .climate-cold { color: #4488ff; }
        .climate-wet { color: #4488ff; }
        .climate-dry { color: #ff8844; }
        .climate-badge { font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 3px; letter-spacing: 0.5px; }
        .severity-extreme { background: rgba(255, 68, 68, 0.2); color: #ff4444; }
        .severity-moderate { background: rgba(255, 136, 68, 0.15); color: #ff8844; }
        .severity-normal { background: rgba(136, 136, 136, 0.1); color: #888; }
      </style>
    `);

    this.content.querySelectorAll('.climate-row').forEach(el => {
      el.addEventListener('click', () => {
        const lat = Number((el as HTMLElement).dataset.lat);
        const lon = Number((el as HTMLElement).dataset.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) this.onZoneClick?.(lat, lon);
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
