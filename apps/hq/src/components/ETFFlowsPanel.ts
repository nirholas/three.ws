import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface ETFData {
  ticker: string;
  issuer: string;
  price: number;
  priceChange: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  direction: 'inflow' | 'outflow' | 'neutral';
  estFlow: number;
}

interface ETFFlowsResult {
  timestamp: string;
  summary: {
    etfCount: number;
    totalVolume: number;
    totalEstFlow: number;
    netDirection: string;
    inflowCount: number;
    outflowCount: number;
  };
  etfs: ETFData[];
  unavailable?: boolean;
}

function formatVolume(v: number): string {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toLocaleString();
}

function flowClass(direction: string): string {
  if (direction === 'inflow') return 'flow-inflow';
  if (direction === 'outflow') return 'flow-outflow';
  return 'flow-neutral';
}

function changeClass(val: number): string {
  if (val > 0.1) return 'change-positive';
  if (val < -0.1) return 'change-negative';
  return 'change-neutral';
}

export class ETFFlowsPanel extends Panel {
  private data: ETFFlowsResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({ id: 'etf-flows', title: 'BTC ETF Tracker', showCount: false });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 3 * 60000);
  }

  public destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const res = await fetch('/api/etf-flows', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;
    } catch (err) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private renderPanel(): void {
    if (this.loading) {
      this.showLoading('Loading ETF data...');
      return;
    }

    if (this.error || !this.data) {
      this.showError(this.error || 'No data');
      return;
    }

    const d = this.data;
    if (!d.etfs.length) {
      this.setContent('<div class="panel-loading-text">ETF data temporarily unavailable</div>');
      return;
    }

    const s = d.summary;
    const dirClass = s.netDirection.includes('INFLOW') ? 'flow-inflow' : s.netDirection.includes('OUTFLOW') ? 'flow-outflow' : 'flow-neutral';

    const rows = d.etfs.map(etf => `
      <tr class="etf-row ${flowClass(etf.direction)}" data-etf-ticker="${escapeHtml(etf.ticker)}" style="cursor:pointer">
        <td class="etf-ticker">${escapeHtml(etf.ticker)}</td>
        <td class="etf-issuer">${escapeHtml(etf.issuer)}</td>
        <td class="etf-flow ${flowClass(etf.direction)}">${etf.direction === 'inflow' ? '+' : etf.direction === 'outflow' ? '-' : ''}$${formatVolume(Math.abs(etf.estFlow))}</td>
        <td class="etf-volume">${formatVolume(etf.volume)}</td>
        <td class="etf-change ${changeClass(etf.priceChange)}">${etf.priceChange > 0 ? '+' : ''}${etf.priceChange.toFixed(2)}%</td>
      </tr>
    `).join('');

    const html = `
      <div class="etf-flows-container">
        <div class="etf-summary ${dirClass}">
          <div class="etf-summary-item">
            <span class="etf-summary-label">Net Flow</span>
            <span class="etf-summary-value ${dirClass}">${escapeHtml(s.netDirection)}</span>
          </div>
          <div class="etf-summary-item">
            <span class="etf-summary-label">Est. Flow</span>
            <span class="etf-summary-value">$${formatVolume(Math.abs(s.totalEstFlow))}</span>
          </div>
          <div class="etf-summary-item">
            <span class="etf-summary-label">Total Vol</span>
            <span class="etf-summary-value">${formatVolume(s.totalVolume)}</span>
          </div>
          <div class="etf-summary-item">
            <span class="etf-summary-label">ETFs</span>
            <span class="etf-summary-value">${s.inflowCount}↑ ${s.outflowCount}↓</span>
          </div>
        </div>
        <div class="etf-table-wrap">
          <table class="etf-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Issuer</th>
                <th>Est. Flow</th>
                <th>Volume</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;

    this.setContent(html);

    // Bind click handlers on ETF rows → open BTC token detail
    this.content.querySelectorAll<HTMLElement>('.etf-row[data-etf-ticker]').forEach((el) => {
      el.addEventListener('click', () => {
        const ticker = el.dataset.etfTicker ?? '';
        // Most BTC ETFs contain 'BTC' or 'BIT' in ticker; ETH ETFs contain 'ETH'
        const isEth = /ETH/i.test(ticker);
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'token' as const, data: {
            symbol: isEth ? 'ETH' : 'BTC',
            name: isEth ? 'Ethereum' : 'Bitcoin',
          }},
        }));
      });
    });
  }
}
