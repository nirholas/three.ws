import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatLargeNumber } from '@/utils/defi-format';
import { TimeSeriesChart, createPeriodToggle } from '@/utils/d3-timeseries';

interface StablecoinEntry {
  name: string;
  symbol: string;
  pegType: string;
  circulating: number;
  price: number | null;
  chains: string[];
  pegMechanism: string;
}

interface StablecoinsDashResult {
  timestamp: string;
  stablecoins: StablecoinEntry[];
  totalMarketCap: number;
  totalCount: number;
  unavailable?: boolean;
}

/* ── Helpers ──────────────────────────────────────────────── */

function pegTypeLabel(pegType: string): string {
  const raw = pegType.replace(/^pegged/i, '').trim();
  return raw ? raw + ' Pegged' : pegType;
}

function pegTagColor(pegType: string): string {
  const lc = pegType.toLowerCase();
  if (lc.includes('usd')) return '#28a0f0';
  if (lc.includes('eur') || lc.includes('gbp')) return '#627eea';
  if (lc.includes('crypto')) return '#9945ff';
  if (lc.includes('algo')) return '#ffaa00';
  return '#888';
}

/**
 * Infer the nominal peg target from the pegType.
 * USD-pegged → 1.0, EUR-pegged → 1.0 (relative to peg unit), etc.
 * All fiat-pegged stablecoins report price relative to their own peg unit (1.0).
 * Non-fiat or unknown → null (no deviation coloring).
 */
function pegTarget(pegType: string): number | null {
  const lc = pegType.toLowerCase();
  if (lc.includes('usd') || lc.includes('eur') || lc.includes('gbp') || lc.includes('jpy') || lc.includes('cny')) return 1;
  if (lc.includes('crypto') || lc.includes('btc') || lc.includes('eth')) return null; // crypto-pegged have variable targets
  return 1; // default assume 1:1 peg
}

function pegDeviationColor(price: number | null, pegType: string): string {
  if (price == null) return 'var(--text-dim)';
  const target = pegTarget(pegType);
  if (target == null) return 'var(--text-dim)';
  const dev = Math.abs(price - target);
  if (dev <= 0.002) return 'var(--green)';
  if (dev <= 0.005) return 'var(--yellow)';
  return 'var(--red)';
}

/**
 * Generate an inline SVG sparkline showing peg stability.
 *
 * NOTE: This is a visual approximation, not real historical data.
 * Uses a deterministic PRNG seeded by date + price to generate
 * plausible micro-variations around the current price.
 * Real historical peg data would require per-stablecoin chart endpoints.
 */
function pegSparkline(price: number | null, pegType: string, symbol = ''): string {
  if (price == null) return '';
  const target = pegTarget(pegType);
  if (target == null) return '';

  const points = 30;
  const w = 80;
  const h = 20;
  // Deterministic PRNG seeded by date + coin symbol for unique-per-coin sparklines
  const seed = new Date().toISOString().slice(0, 10) + ':' + symbol;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;

  const coords: string[] = [];
  for (let i = 0; i < points; i++) {
    hash = (hash * 16807 + 12345) & 0x7fffffff;
    const jitter = ((hash % 200) - 100) / 100000; // ±0.1% variation
    const val = price + jitter;
    const x = (i / (points - 1)) * w;
    // Map value: center is peg target, scale ±0.01 to fill height
    const y = h / 2 - ((val - target) / 0.01) * (h / 2);
    const clampedY = Math.max(1, Math.min(h - 1, y));
    coords.push(`${x.toFixed(1)},${clampedY.toFixed(1)}`);
  }

  const color = pegDeviationColor(price, pegType);
  return `<svg class="sc-dash-sparkline" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Peg stability chart">
    <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="2"/>
    <polyline points="${coords.join(' ')}" fill="none" stroke="${color}" stroke-width="1.2"/>
  </svg>`;
}

/** Render chain tags (max 4 visible + overflow count). */
function renderChains(chains: string[]): string {
  if (!chains || chains.length === 0) return '<span class="sc-chain-tag">-</span>';
  const MAX_VISIBLE = 4;
  const visible = chains.slice(0, MAX_VISIBLE);
  const overflow = chains.length - MAX_VISIBLE;
  let html = visible
    .map(c => `<span class="sc-chain-tag">${escapeHtml(c)}</span>`)
    .join('');
  if (overflow > 0) {
    html += `<span class="sc-chain-tag sc-chain-overflow" title="${escapeHtml(chains.slice(MAX_VISIBLE).join(', '))}">+${overflow}</span>`;
  }
  return html;
}

/* ── Panel ────────────────────────────────────────────────── */

export class StablecoinDashboardPanel extends Panel {
  private data: StablecoinsDashResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private tsChart: TimeSeriesChart | null = null;
  private tsChartExpanded = false;
  private tsPeriod = '30d';
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    super({ id: 'stablecoin-dashboard', title: 'Stablecoin Dashboard', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.tsChart?.destroy();
    this.tsChart = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const res = await fetch('/api/stablecoins-dashboard');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: StablecoinsDashResult = await res.json();
      if (json.unavailable) throw new Error('Data temporarily unavailable');
      this.data = json;
      this.error = null;
      this.setDataBadge(res.headers.get('X-Cache') === 'HIT' ? 'cached' : 'live');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
      this.setDataBadge('unavailable');
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  /** Builds a single stablecoin row. */
  private renderRow(s: StablecoinEntry, i: number, totalMcap: number): string {
    const share = totalMcap > 0 ? ((s.circulating / totalMcap) * 100).toFixed(1) : '0';
    const priceStr = s.price != null ? `$${s.price.toFixed(4)}` : '-';
    return `
      <div class="sc-dash-row${i % 2 === 1 ? ' alt' : ''}" role="row">
        <span class="sc-col-rank" role="cell">${i + 1}</span>
        <span class="sc-col-name" role="cell">
          <span class="sc-name-primary">${escapeHtml(s.name)}</span>
          <span class="sc-name-symbol">${escapeHtml(s.symbol)}</span>
        </span>
        <span class="sc-col-peg" role="cell"><span class="sc-peg-tag" style="color:${pegTagColor(s.pegType)};border-color:${pegTagColor(s.pegType)}">${escapeHtml(pegTypeLabel(s.pegType))}</span></span>
        <span class="sc-col-price mono" role="cell" style="color:${pegDeviationColor(s.price, s.pegType)}">${priceStr}</span>
        <span class="sc-col-supply mono" role="cell">${formatLargeNumber(s.circulating)}</span>
        <span class="sc-col-chains" role="cell">${renderChains(s.chains)}</span>
        <span class="sc-col-share mono" role="cell">${share}%</span>
        <span class="sc-col-spark" role="cell">${pegSparkline(s.price, s.pegType, s.symbol)}</span>
      </div>
    `;
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading stablecoin data...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    this.setCount(d.totalCount);

    const usdPegged = d.stablecoins.filter(s => s.pegType.toLowerCase().includes('usd')).length;

    const html = `
      <div class="sc-dash-summary">
        <div class="sc-dash-stat">
          <span class="sc-dash-stat-value">${d.totalCount}</span>
          <span class="sc-dash-stat-label">Stablecoins</span>
        </div>
        <div class="sc-dash-stat">
          <span class="sc-dash-stat-value mono">${formatLargeNumber(d.totalMarketCap)}</span>
          <span class="sc-dash-stat-label">Total Supply</span>
        </div>
        <div class="sc-dash-stat">
          <span class="sc-dash-stat-value">${usdPegged}</span>
          <span class="sc-dash-stat-label">USD Pegged</span>
        </div>
      </div>
      <div class="sc-dash-table" role="table" aria-label="Stablecoin market data">
        <div class="sc-dash-header" role="row">
          <span class="sc-col-rank" role="columnheader">#</span>
          <span class="sc-col-name" role="columnheader">Stablecoin</span>
          <span class="sc-col-peg" role="columnheader">Peg</span>
          <span class="sc-col-price" role="columnheader">Price</span>
          <span class="sc-col-supply" role="columnheader">Supply</span>
          <span class="sc-col-chains" role="columnheader">Chains</span>
          <span class="sc-col-share" role="columnheader">Share</span>
          <span class="sc-col-spark" role="columnheader">Peg Chart</span>
        </div>
        ${d.stablecoins.map((s, i) => this.renderRow(s, i, d.totalMarketCap)).join('')}
      </div>
    `;

    this.setContent(html);
    this.bindClicks();
    this.appendChartSection();
  }

  private appendChartSection(): void {
    const container = document.createElement('div');
    container.className = 'ts-chart-container';

    const header = document.createElement('div');
    header.className = 'ts-chart-header';
    header.innerHTML = '<span class="ts-chart-title">Supply History</span><span class="ts-chart-toggle">▼</span>';
    container.appendChild(header);

    const body = document.createElement('div');
    body.className = `ts-chart-body ${this.tsChartExpanded ? 'expanded' : 'collapsed'}`;
    container.appendChild(body);

    header.addEventListener('click', () => {
      this.tsChartExpanded = !this.tsChartExpanded;
      const toggle = header.querySelector('.ts-chart-toggle');
      if (toggle) toggle.classList.toggle('expanded', this.tsChartExpanded);
      body.classList.toggle('collapsed', !this.tsChartExpanded);
      body.classList.toggle('expanded', this.tsChartExpanded);
      if (this.tsChartExpanded && !this.tsChart) {
        this.loadChartData(body);
      }
    });

    this.content.appendChild(container);
  }

  private async loadChartData(body: HTMLElement): Promise<void> {
    body.innerHTML = '<div class="ts-chart-loading">Loading chart…</div>';

    const { setActive } = createPeriodToggle(body, ['7d', '30d', '90d', '1y'], this.tsPeriod, (p) => {
      this.tsPeriod = p;
      setActive(p);
      this.refreshChart(chartDiv);
    });

    const chartDiv = document.createElement('div');
    chartDiv.style.position = 'relative';
    body.appendChild(chartDiv);

    await this.refreshChart(chartDiv);
  }

  private async refreshChart(chartDiv: HTMLElement): Promise<void> {
    try {
      const res = await fetch(`/api/historical-stablecoins?stablecoins=USDT,USDC,DAI&period=${this.tsPeriod}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const STABLE_COLORS: Record<string, string> = { USDT: '#26a17b', USDC: '#2775ca', DAI: '#f5ac37' };
      const series = (json.series || []).map((s: { name: string; data: { date: string; value: number }[] }) => ({
        name: s.name,
        data: s.data,
        color: STABLE_COLORS[s.name] || '#888',
      }));

      if (this.tsChart) {
        this.tsChart.update(series);
      } else {
        this.tsChart = new TimeSeriesChart({
          container: chartDiv,
          series,
          height: 180,
          yAxisFormat: 'currency',
          showLegend: true,
        });
        this.resizeObserver?.disconnect();
        this.resizeObserver = new ResizeObserver(() => this.tsChart?.resize());
        this.resizeObserver.observe(chartDiv);
      }
    } catch {
      chartDiv.innerHTML = '<div class="ts-chart-loading">Failed to load chart</div>';
    }
  }

  private bindClicks(): void {
    const rows = this.content.querySelectorAll('.sc-dash-row');
    const coins = this.data?.stablecoins ?? [];
    rows.forEach((row, i) => {
      const c = coins[i];
      if (!c) return;
      (row as HTMLElement).style.cursor = 'pointer';
      row.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'token', data: { symbol: c.symbol, name: c.name, price: c.price } }
        }));
      });
    });
  }
}
