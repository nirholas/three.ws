import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatTvl, pctColor, formatLargeNumber } from '@/utils/defi-format';
import type { BridgeMonitorResult, BridgeData, BridgeChainSummary, BridgeAlert } from '@/types';

type SortColumn = 'name' | 'volume24h' | 'volume7d' | 'netFlow' | 'txCount24h' | 'status';

export class BridgeMonitorPanel extends Panel {
  private data: BridgeMonitorResult | null = null;
  private loading = true;
  private error: string | null = null;
  private sortColumn: SortColumn = 'volume24h';
  private sortDirection: 'asc' | 'desc' = 'desc';
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'bridge-monitor',
      title: 'Bridge Monitor',
      showCount: true,
      infoTooltip: 'Cross-chain bridge volumes, net flows, and health alerts. Data from DeFiLlama bridges API.',
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60_000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.abortController?.abort();
    this.abortController = null;
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const res = await fetch('/api/bridge-monitor', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;

      const cacheStatus = res.headers.get('X-Cache');
      this.setDataBadge(cacheStatus === 'HIT' ? 'cached' : 'live');
      this.setErrorState(false);
    } catch (err) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
      this.setDataBadge('unavailable');
      this.setErrorState(true, this.error);
    } finally {
      if (!signal.aborted) {
        this.loading = false;
        this.render();
      }
    }
  }

  private sortBridges(bridges: BridgeData[]): BridgeData[] {
    const col = this.sortColumn;
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    return [...bridges].sort((a, b) => {
      if (col === 'name') return dir * a.name.localeCompare(b.name);
      if (col === 'status') return dir * a.status.localeCompare(b.status);
      const aVal = a[col] as number;
      const bVal = b[col] as number;
      return dir * (aVal - bVal);
    });
  }

  private onSortClick(col: SortColumn): void {
    if (this.sortColumn === col) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = col;
      this.sortDirection = 'desc';
    }
    this.render();
  }

  private sortArrow(col: SortColumn): string {
    if (this.sortColumn !== col) return '';
    return this.sortDirection === 'asc' ? ' ↑' : ' ↓';
  }

  private render(): void {
    if (this.loading) { this.showLoading('Loading bridge data...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    if (d.unavailable) { this.showError('Bridge data temporarily unavailable'); return; }
    if (!d.bridges.length) {
      this.setContent('<div class="panel-loading-text">No bridge data available</div>');
      return;
    }

    this.setCount(d.bridges.length);

    let html = '';

    // Section 1: Overview Stats
    html += this.renderOverview(d);

    // Section 2: Bridge Rankings Table
    html += this.renderBridgeTable(d.bridges);

    // Section 3: Chain Net Flows
    if (d.chainSummary.length > 0) {
      html += this.renderChainFlows(d.chainSummary);
    }

    // Section 4: Alerts
    if (d.alerts.length > 0) {
      html += this.renderAlerts(d.alerts);
    }

    this.setContent(html);
    this.wireEvents();
  }

  private renderOverview(d: BridgeMonitorResult): string {
    const s = d.summary;
    const totalVol = formatTvl(s.totalVolume24h);
    const volChange = s.totalVolume7d > 0
      ? (((s.totalVolume24h * 7) - s.totalVolume7d) / s.totalVolume7d * 100).toFixed(1)
      : '0';
    const volChangeNum = parseFloat(volChange);
    const volChangeColor = pctColor(volChangeNum);

    const netFlowTotal = d.bridges.reduce((sum, b) => sum + b.netFlow, 0);
    const netDir = netFlowTotal > 1_000_000 ? '↑ Net Inflow' : netFlowTotal < -1_000_000 ? '↓ Net Outflow' : '→ Balanced';
    const netDirColor = netFlowTotal > 1_000_000 ? '#4ade80' : netFlowTotal < -1_000_000 ? '#f87171' : '#fbbf24';

    return `
      <div class="bridge-overview">
        <div class="bridge-stat">
          <div class="bridge-stat-label">24h Volume</div>
          <div class="bridge-stat-value">${totalVol}</div>
        </div>
        <div class="bridge-stat">
          <div class="bridge-stat-label">Net Flow</div>
          <div class="bridge-stat-value" style="color:${netDirColor}">${netDir}</div>
        </div>
        <div class="bridge-stat">
          <div class="bridge-stat-label">Active Bridges</div>
          <div class="bridge-stat-value">${s.activeBridges}</div>
        </div>
        <div class="bridge-stat">
          <div class="bridge-stat-label">vs 7d Avg</div>
          <div class="bridge-stat-value bridge-vol-change ${volChangeNum >= 0 ? 'positive' : 'negative'}" style="color:${volChangeColor}">${volChangeNum > 0 ? '+' : ''}${volChange}%</div>
        </div>
      </div>
    `;
  }

  private renderBridgeTable(bridges: BridgeData[]): string {
    const sorted = this.sortBridges(bridges);
    const cols: { key: SortColumn; label: string }[] = [
      { key: 'name', label: 'Name' },
      { key: 'volume24h', label: '24h Vol' },
      { key: 'volume7d', label: '7d Vol' },
      { key: 'netFlow', label: 'Net Flow' },
      { key: 'txCount24h', label: 'Txns' },
      { key: 'status', label: 'Status' },
    ];

    let html = '<div class="bridge-table-wrapper"><table class="bridge-table"><thead><tr>';
    for (const c of cols) {
      html += `<th class="bridge-sort-header" data-sort="${c.key}">${escapeHtml(c.label)}${this.sortArrow(c.key)}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (const b of sorted.slice(0, 25)) {
      const flowColor = b.netFlow > 1_000_000 ? '#4ade80' : b.netFlow < -1_000_000 ? '#f87171' : '#888';
      const flowArrow = b.netFlow > 1_000_000 ? '↑' : b.netFlow < -1_000_000 ? '↓' : '→';
      const statusClass = `bridge-status-${b.status}`;

      html += `<tr class="bridge-row" data-bridge="${escapeHtml(b.name)}">
        <td class="bridge-name">${escapeHtml(b.displayName)}</td>
        <td>${formatTvl(b.volume24h)}</td>
        <td>${formatTvl(b.volume7d)}</td>
        <td style="color:${flowColor}">${flowArrow} ${formatTvl(Math.abs(b.netFlow))}</td>
        <td>${b.txCount24h > 0 ? formatLargeNumber(b.txCount24h) : '-'}</td>
        <td><span class="${statusClass}">●</span> ${escapeHtml(b.status)}</td>
      </tr>`;
    }

    html += '</tbody></table></div>';
    return html;
  }

  private renderChainFlows(chains: BridgeChainSummary[]): string {
    const maxAbs = Math.max(...chains.map(c => Math.abs(c.netFlow)), 1);

    let html = '<div class="bridge-section-title">Chain Net Flows</div>';
    html += '<div class="bridge-chain-flow">';

    for (const c of chains.slice(0, 12)) {
      const pct = Math.round((Math.abs(c.netFlow) / maxAbs) * 100);
      const isInflow = c.netFlow >= 0;
      const barColor = isInflow ? '#4ade80' : '#f87171';
      const flowLabel = isInflow ? '+' : '-';
      const formattedFlow = formatTvl(Math.abs(c.netFlow));

      html += `
        <div class="bridge-chain-row">
          <span class="bridge-chain-name">${escapeHtml(c.chain)}</span>
          <div class="bridge-flow-track">
            <div class="bridge-flow-bar ${isInflow ? 'inflow' : 'outflow'}" style="width:${Math.max(pct, 2)}%;background:${barColor}"></div>
          </div>
          <span class="bridge-chain-value" style="color:${barColor}">${flowLabel}${formattedFlow}</span>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  private renderAlerts(alerts: BridgeAlert[]): string {
    let html = '<div class="bridge-section-title">Alerts</div>';
    html += '<div class="bridge-alerts">';

    for (const a of alerts.slice(0, 8)) {
      const severityColor = a.severity === 'critical' ? '#ef4444' : a.severity === 'warning' ? '#f59e0b' : '#3b82f6';
      const severityIcon = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵';

      html += `
        <div class="bridge-alert" style="border-left-color:${severityColor}">
          <span class="bridge-alert-icon">${severityIcon}</span>
          <div class="bridge-alert-content">
            <span class="bridge-alert-bridge">${escapeHtml(a.bridge)}</span>
            <span class="bridge-alert-msg">${escapeHtml(a.message)}</span>
          </div>
          <span class="bridge-alert-type">${escapeHtml(a.type)}</span>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  private wireEvents(): void {
    // Sort header clicks
    this.content.querySelectorAll<HTMLElement>('.bridge-sort-header').forEach(el => {
      el.addEventListener('click', () => {
        const col = el.dataset.sort as SortColumn;
        if (col) this.onSortClick(col);
      });
    });
  }
}
