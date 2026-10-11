import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getFearGreedMeta } from '@/utils/defi-format';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FearGreedEntry {
  timestamp: string;
  value: string;
  value_classification: string;
}

interface FearGreedResponse {
  data: FearGreedEntry[];
  metadata?: { error?: string };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Delegate colour to the shared util, keeping a thin wrapper for templates. */
function fgColor(value: number): string {
  return getFearGreedMeta(value).color;
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export class FearGreedPanel extends Panel {
  private data: FearGreedResponse | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'fear-greed',
      title: 'Fear & Greed Index',
      infoTooltip: `<strong>Crypto Fear &amp; Greed Index</strong>
        <p>Composite sentiment index (0-100) from <em>alternative.me</em>.</p>
        <p>Factors: volatility, volume, social media, dominance, surveys, trends.</p>
        <p>Updates every 5 min. 30-day sparkline shows trend direction.</p>`,
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
      const res = await fetch('/api/fear-greed?limit=30', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: FearGreedResponse = await res.json();
      if (!json?.data?.length) throw new Error('Empty response');

      this.data = json;
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
        this.renderPanel();
      }
    }
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading Fear & Greed…'); return; }
    if (this.error || !this.data?.data?.[0]) {
      this.showError(this.error || 'No data available');
      return;
    }

    const current = this.data.data[0];
    const value = Number(current.value);
    if (Number.isNaN(value)) { this.showError('Invalid index value'); return; }

    const color = fgColor(value);
    const meta = getFearGreedMeta(value);
    const history = this.data.data.slice(1, 8).reverse();

    // SVG semicircle gauge - arc length = π × r
    const radius = 54;
    const totalArc = Math.PI * radius;
    const filledArc = totalArc * (value / 100);
    const offset = totalArc - filledArc;

    // 7-day history bars
    const historyBars = history.map(entry => {
      const v = Number(entry.value);
      if (Number.isNaN(v)) return '';
      const barH = Math.max(v * 0.48, 4);
      const barColor = fgColor(v);
      return `<div class="fg-bar-col" title="${v} - ${escapeHtml(entry.value_classification)}">
        <div class="fg-bar" style="height:${barH}px;background:${barColor}"></div>
        <span class="fg-bar-label">${v}</span>
      </div>`;
    }).join('');

    // 30-day sparkline (SVG polyline)
    const sparkData = this.data.data.slice(0, 30).reverse();
    let sparklineHtml = '';
    if (sparkData.length > 1) {
      const svgW = 220;
      const svgH = 36;
      const step = svgW / (sparkData.length - 1);
      const points = sparkData.map((e, idx) => {
        const v = Number(e.value);
        const y = svgH - (v / 100) * svgH;
        return `${(idx * step).toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      sparklineHtml = `
        <div class="fg-sparkline-section">
          <div class="fg-section-label">30-DAY TREND</div>
          <svg class="fg-sparkline-svg" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none"
               role="img" aria-label="30-day Fear and Greed trend">
            <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </div>`;
    }

    const html = `
      <div class="fg-panel">
        <div class="fg-gauge-wrap" role="meter" aria-valuenow="${value}" aria-valuemin="0"
             aria-valuemax="100" aria-label="Fear and Greed Index: ${value}">
          <svg class="fg-gauge" viewBox="0 0 120 70" aria-hidden="true">
            <path d="M 6,64 A 54,54 0 0,1 114,64" fill="none" stroke="var(--border)"
                  stroke-width="7" stroke-linecap="round"/>
            <path d="M 6,64 A 54,54 0 0,1 114,64" fill="none" stroke="${color}"
                  stroke-width="7" stroke-linecap="round"
                  stroke-dasharray="${totalArc.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>
          </svg>
          <div class="fg-value" style="color:${color}">${value}</div>
          <div class="fg-max">/100</div>
        </div>
        <div class="fg-classification" style="color:${color}">${escapeHtml(meta.label)}</div>
        <div class="fg-history-section">
          <div class="fg-section-label">7-DAY HISTORY</div>
          <div class="fg-history-bars">${historyBars}</div>
        </div>
        ${sparklineHtml}
        <div style="text-align:center;margin-top:12px">
          <span class="fg-btc-link" style="color:#4ecdc4;cursor:pointer;font-size:12px">View Bitcoin details →</span>
        </div>
      </div>`;

    this.setContent(html);

    // Bind click on the BTC link
    const btcLink = this.content.querySelector('.fg-btc-link');
    if (btcLink) {
      btcLink.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'token' as const, data: { symbol: 'BTC', name: 'Bitcoin' } },
        }));
      });
    }
  }
}
