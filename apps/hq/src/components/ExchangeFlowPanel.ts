import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface FlowEntry {
  symbol: string;
  score: number;
  direction: string;
  label: string;
  signals: Record<string, unknown>;
}

interface FlowSummary {
  inflows: number;
  outflows: number;
  neutral: number;
  avgScore: number;
  marketDirection: string;
}

interface FlowResult {
  timestamp: string;
  flows: FlowEntry[];
  summary: FlowSummary;
  unavailable?: boolean;
}

function scoreColor(score: number): string {
  if (score > 15) return '#4ade80';
  if (score < -15) return '#f87171';
  return '#fbbf24';
}

function dirArrow(dir: string): string {
  if (dir === 'INFLOW') return '↑';
  if (dir === 'OUTFLOW') return '↓';
  return '→';
}

export class ExchangeFlowPanel extends Panel {
  private data: FlowResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'exchange-flow',
      title: 'Exchange Flow',
      showCount: true,
      infoTooltip: 'Composite signal showing net exchange flow direction. Positive = accumulation (tokens leaving exchanges). Negative = distribution (tokens entering exchanges to sell).',
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
      const res = await fetch('/api/exchange-flow', { signal });
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
        this.renderPanel();
      }
    }
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading exchange flows...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const d = this.data;
    if (d.unavailable) { this.showError('Exchange flow data temporarily unavailable'); return; }
    if (!d.flows.length) {
      this.setContent('<div class="panel-loading-text">Exchange flow data temporarily unavailable</div>');
      return;
    }

    this.setCount(d.flows.length);

    const s = d.summary;
    const bannerColor = s.avgScore > 10 ? '#166534' : s.avgScore < -10 ? '#991b1b' : '#854d0e';
    const bannerBg = s.avgScore > 10 ? 'rgba(34,197,94,0.08)' : s.avgScore < -10 ? 'rgba(239,68,68,0.08)' : 'rgba(234,179,8,0.08)';
    const arrow = dirArrow(s.avgScore > 10 ? 'INFLOW' : s.avgScore < -10 ? 'OUTFLOW' : 'NEUTRAL');
    const dirColor = scoreColor(s.avgScore);

    let html = `
      <div style="background:${bannerBg};border:1px solid ${bannerColor}44;border-radius:8px;padding:10px 12px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px;font-weight:600;color:${dirColor}">${arrow} ${escapeHtml(s.marketDirection)}</span>
          <span style="font-size:12px;color:#888">Score: ${s.avgScore > 0 ? '+' : ''}${s.avgScore}</span>
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;font-size:11px;color:#888">
          <span style="color:#4ade80">▲ ${s.inflows} inflow</span>
          <span style="color:#f87171">▼ ${s.outflows} outflow</span>
          <span>● ${s.neutral} neutral</span>
        </div>
      </div>
    `;

    html += d.flows.map((f) => {
      const pct = Math.round((f.score + 100) / 2); // map -100..+100 → 0..100
      const color = scoreColor(f.score);
      const dir = dirArrow(f.direction);

      return `
        <div class="ef-row" style="display:flex;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer" data-symbol="${escapeHtml(f.symbol)}">
          <span style="width:44px;font-size:12px;font-weight:600;color:#ccc">${escapeHtml(f.symbol)}</span>
          <div style="flex:1;height:6px;background:#1e293b;border-radius:3px;margin:0 8px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width 0.5s"></div>
          </div>
          <span style="width:36px;text-align:right;font-size:12px;font-weight:600;color:${color}">${f.score > 0 ? '+' : ''}${f.score}</span>
          <span style="width:16px;text-align:center;font-size:11px;color:${color};margin-left:4px">${dir}</span>
        </div>
      `;
    }).join('');

    this.setContent(html);

    // Wire click handlers to open token detail
    this.content.querySelectorAll<HTMLElement>('.ef-row[data-symbol]').forEach((el) => {
      el.addEventListener('click', () => {
        const symbol = el.dataset.symbol || '';
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'token' as const, data: { symbol, name: symbol } },
        }));
      });
    });
  }
}
