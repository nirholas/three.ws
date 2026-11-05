import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchRiskHeatmap, type RiskReport } from '@/services/protocol-dashboard';
import { errorWithRetry, skeleton, usd } from './pd-format';

const DIM_LABEL: Record<string, string> = { contract: 'Contract', oracle: 'Oracle', governance: 'Governance', liquidity: 'Liquidity', market: 'Market' };

export class RiskHeatmapPanel extends Panel {
  private report: RiskReport | null = null;
  private chain = 'Solana';
  private state: 'loading' | 'ready' | 'error' = 'loading';
  private error = '';
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'risk-heatmap',
      title: 'Protocol Risk Heatmap',
      showCount: true,
      infoTooltip: `<strong>Protocol Risk Heatmap</strong>
        <p>Five risk dimensions per protocol from public data: contract, oracle, governance, liquidity, market. Hatched cells are unknown: the free sources have nothing, so no score is invented.</p>
        <p>Heuristic, not financial advice or an audit.</p>`,
    });
    void this.load();
    this.timer = setInterval(() => void this.load(true), 10 * 60_000);
  }

  public destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.abort?.abort();
    super.destroy();
  }

  private async load(background = false): Promise<void> {
    this.abort?.abort();
    this.abort = new AbortController();
    const { signal } = this.abort;
    if (!background) { this.state = 'loading'; this.render(); }
    try {
      this.report = await fetchRiskHeatmap(this.chain === 'all' ? '' : this.chain, signal);
      this.state = 'ready';
      this.setDataBadge('live');
      this.setErrorState(false);
    } catch (err) {
      if (signal.aborted) return;
      if (this.report && background) { this.setDataBadge('cached'); return; }
      this.state = 'error';
      this.error = err instanceof Error ? err.message : 'Could not load the heatmap';
      this.setDataBadge('unavailable');
      this.setErrorState(true, this.error);
    }
    this.render();
  }

  private render(): void {
    if (this.state === 'loading') { this.setContent(skeleton(6)); return; }
    if (this.state === 'error' || !this.report) { this.setContent(errorWithRetry(this.error)); this.bind(); return; }
    const r = this.report;
    this.setCount(r.rows.length);
    const head = r.dimensions.map((d) => `<th scope="col">${escapeHtml(DIM_LABEL[d] || d)}</th>`).join('');
    const rows = r.rows.map((x) => {
      const cells = r.dimensions.map((d) => {
        const c = x.cells[d] ?? { risk: null, level: 'unknown' as const, reason: 'no data' };
        const label = c.risk == null ? 'unknown' : String(c.risk);
        return `<td><span class="rh-cell rh-${c.level}" tabindex="0" title="${escapeHtml(`${DIM_LABEL[d] || d}: ${c.reason}`)}" aria-label="${escapeHtml(`${x.name} ${DIM_LABEL[d] || d} risk ${label}. ${c.reason}`)}">${c.risk == null ? '?' : c.risk}</span></td>`;
      }).join('');
      return `<tr><th scope="row" class="rh-name">${escapeHtml(x.name)}<span class="pd-muted"> ${usd(x.tvl)}</span></th>${cells}<td><span class="rh-cell rh-${x.overall.level}" title="${x.overall.known} of ${r.dimensions.length} dimensions known">${x.overall.risk == null ? '?' : x.overall.risk}</span></td></tr>`;
    }).join('');
    const body = r.rows.length === 0
      ? '<div class="pd-empty"><p>No protocols came back for this chain.</p></div>'
      : `<div class="pd-tablewrap"><table class="pd-table rh-table"><thead><tr><th scope="col">Protocol</th>${head}<th scope="col">Overall</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    this.setContent(`<div class="pd-wrap">
      <div class="pd-controls"><select class="pd-select" data-rh-chain aria-label="Chain">
        <option value="Solana" ${this.chain === 'Solana' ? 'selected' : ''}>Solana</option><option value="all" ${this.chain === 'all' ? 'selected' : ''}>All chains</option>
      </select><span class="rh-legend"><span class="rh-cell rh-low">low</span><span class="rh-cell rh-medium">med</span><span class="rh-cell rh-high">high</span><span class="rh-cell rh-unknown">?</span></span></div>
      ${body}
      <details class="pd-method"><summary>Method and sources</summary><p>${escapeHtml(r.methodology)}</p><p>Sources: ${escapeHtml(r.sources.join(', '))}</p></details>
    </div>`);
    this.bind();
  }

  private bind(): void {
    this.content.querySelector<HTMLSelectElement>('[data-rh-chain]')?.addEventListener('change', (e) => { this.chain = (e.target as HTMLSelectElement).value; void this.load(); });
    this.content.querySelector<HTMLElement>('[data-pd-retry]')?.addEventListener('click', () => void this.load());
  }
}
