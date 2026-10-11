import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { UnhcrSummary, CountryDisplacement } from '@/types';
import { formatPopulation } from '@/services/unhcr';

type DisplacementTab = 'origins' | 'hosts';

export class DisplacementPanel extends Panel {
  private data: UnhcrSummary | null = null;
  private activeTab: DisplacementTab = 'origins';
  private onCountryClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'flow-tracker',
      title: 'Flow Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip: `<strong>Capital Flow Data</strong>
        Cross-chain and cross-protocol fund movements.
        <ul>
          <li><strong>Outflows</strong>: Capital leaving protocols</li>
          <li><strong>Inflows</strong>: Capital entering protocols</li>
          <li>Alert badges: >$1B | High: >$500M flow</li>
        </ul>
        Data from on-chain analytics. Updated regularly.`,
    });
    this.showLoading('Loading capital flow data');
  }

  public setCountryClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onCountryClick = handler;
  }

  public setData(data: UnhcrSummary): void {
    this.data = data;
    this.setCount(data.countries.length);
    this.renderContent();
  }

  private renderContent(): void {
    if (!this.data) return;

    const g = this.data.globalTotals;

    const stats = [
      { label: 'Outflows', value: formatPopulation(g.refugees), cls: 'disp-stat-refugees' },
      { label: 'Pending', value: formatPopulation(g.asylumSeekers), cls: 'disp-stat-asylum' },
      { label: 'Locked', value: formatPopulation(g.idps), cls: 'disp-stat-idps' },
      { label: 'Total', value: formatPopulation(g.total), cls: 'disp-stat-total' },
    ];

    const statsHtml = stats.map(s =>
      `<div class="disp-stat-box ${s.cls}">
        <span class="disp-stat-value">${s.value}</span>
        <span class="disp-stat-label">${s.label}</span>
      </div>`
    ).join('');

    const tabsHtml = `
      <div class="disp-tabs">
        <button class="disp-tab ${this.activeTab === 'origins' ? 'disp-tab-active' : ''}" data-tab="origins">Origins</button>
        <button class="disp-tab ${this.activeTab === 'hosts' ? 'disp-tab-active' : ''}" data-tab="hosts">Hosts</button>
      </div>
    `;

    let countries: CountryDisplacement[];
    if (this.activeTab === 'origins') {
      countries = [...this.data.countries]
        .filter(c => c.refugees + c.asylumSeekers > 0)
        .sort((a, b) => (b.refugees + b.asylumSeekers) - (a.refugees + a.asylumSeekers));
    } else {
      countries = [...this.data.countries]
        .filter(c => (c.hostTotal || 0) > 0)
        .sort((a, b) => (b.hostTotal || 0) - (a.hostTotal || 0));
    }

    const displayed = countries.slice(0, 30);
    let tableHtml: string;

    if (displayed.length === 0) {
      tableHtml = '<div class="panel-empty">No data</div>';
    } else {
      const rows = displayed.map(c => {
        const hostTotal = c.hostTotal || 0;
        const count = this.activeTab === 'origins' ? c.refugees + c.asylumSeekers : hostTotal;
        const total = this.activeTab === 'origins' ? c.totalDisplaced : hostTotal;
        const badgeCls = total >= 1_000_000 ? 'disp-crisis'
          : total >= 500_000 ? 'disp-high'
          : total >= 100_000 ? 'disp-elevated'
          : '';
        const badgeLabel = total >= 1_000_000 ? 'CRISIS'
          : total >= 500_000 ? 'HIGH'
          : total >= 100_000 ? 'ELEVATED'
          : '';
        const badgeHtml = badgeLabel
          ? `<span class="disp-badge ${badgeCls}">${badgeLabel}</span>`
          : '';

        return `<tr class="disp-row" data-lat="${c.lat || ''}" data-lon="${c.lon || ''}">
          <td class="disp-name">${escapeHtml(c.name)}</td>
          <td class="disp-status">${badgeHtml}</td>
          <td class="disp-count">${formatPopulation(count)}</td>
          <td class="disp-detail"><button class="detail-open-btn" data-detail-event='${escapeHtml(JSON.stringify({ title: c.name, description: 'Outflows: ' + formatPopulation(c.refugees + c.asylumSeekers) + ' • Locked: ' + formatPopulation(c.idps) + ' • Total: ' + formatPopulation(c.totalDisplaced), category: 'displacement', lat: c.lat, lon: c.lon }))}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.6" title="View details">ℹ</button></td>
        </tr>`;
      }).join('');

      tableHtml = `
        <table class="disp-table">
          <thead>
            <tr>
              <th>Country</th>
              <th>Status</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    this.setContent(`
      <div class="disp-panel-content">
        <div class="disp-stats-grid">${statsHtml}</div>
        ${tabsHtml}
        ${tableHtml}
      </div>
      <style>
        .disp-panel-content { font-size: 12px; }
        .disp-stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px; }
        .disp-stat-box { background: rgba(255, 255, 255, 0.03); border: 1px solid #222; border-radius: 4px; padding: 8px 6px; text-align: center; }
        .disp-stat-value { display: block; font-size: 16px; font-weight: 700; color: #ccc; font-variant-numeric: tabular-nums; }
        .disp-stat-label { display: block; font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
        .disp-stat-refugees .disp-stat-value { color: #ef4444; }
        .disp-stat-asylum .disp-stat-value { color: #f97316; }
        .disp-stat-idps .disp-stat-value { color: #eab308; }
        .disp-stat-total .disp-stat-value { color: #fff; }
        .disp-tabs { display: flex; gap: 2px; margin-bottom: 6px; }
        .disp-tab { background: transparent; border: 1px solid #333; color: #888; padding: 4px 14px; font-size: 11px; cursor: pointer; border-radius: 3px; transition: all 0.15s; }
        .disp-tab:hover { border-color: #555; color: #ccc; }
        .disp-tab-active { background: rgba(239, 68, 68, 0.1); border-color: #ef4444; color: #ef4444; }
        .disp-table { width: 100%; border-collapse: collapse; }
        .disp-table th { text-align: left; color: #666; font-weight: 600; font-size: 10px; text-transform: uppercase; padding: 4px 8px; border-bottom: 1px solid #222; }
        .disp-table th:nth-child(3) { text-align: right; }
        .disp-table td { padding: 5px 8px; border-bottom: 1px solid #1a1a1a; color: #ccc; }
        .disp-row { cursor: pointer; }
        .disp-row:hover { background: #1a1a1a; }
        .disp-name { white-space: nowrap; }
        .disp-status { width: 70px; }
        .disp-badge { font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 3px; letter-spacing: 0.5px; }
        .disp-crisis { background: rgba(255, 50, 50, 0.2); color: #ff3232; }
        .disp-high { background: rgba(255, 150, 0, 0.15); color: #ff9600; }
        .disp-elevated { background: rgba(255, 220, 0, 0.12); color: #ffdc00; }
        .disp-count { text-align: right; font-variant-numeric: tabular-nums; }
      </style>
    `);

    this.content.querySelectorAll('.disp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = (btn as HTMLElement).dataset.tab as DisplacementTab;
        this.renderContent();
      });
    });

    this.content.querySelectorAll('.disp-row').forEach(el => {
      el.addEventListener('click', () => {
        const lat = Number((el as HTMLElement).dataset.lat);
        const lon = Number((el as HTMLElement).dataset.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) this.onCountryClick?.(lat, lon);
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
