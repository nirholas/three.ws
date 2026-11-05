import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchOracleDeviation, type OracleReport } from '@/services/protocol-dashboard';
import { ageLabel, errorWithRetry, skeleton, usd } from './pd-format';

const THRESHOLDS = [10, 25, 50, 100, 250];
const STATUS_LABEL: Record<string, string> = { ok: 'OK', deviation: 'Deviating', stale: 'Stale', unknown: 'Unknown' };

export class OracleMonitorPanel extends Panel {
  private report: OracleReport | null = null;
  private threshold = 50;
  private state: 'loading' | 'ready' | 'error' = 'loading';
  private error = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private abort: AbortController | null = null;

  constructor() {
    super({
      id: 'oracle-monitor',
      title: 'Oracle Monitor',
      showCount: true,
      infoTooltip: `<strong>Oracle Monitor</strong>
        <p>Pyth prices read from the Solana price accounts programs use, and Chainlink latestRoundData over Ethereum RPC, compared with the median of Coinbase and Kraken mids.</p>
        <p>Stale means the last round is older than its heartbeat. Refreshes every 30 seconds.</p>`,
    });
    void this.load();
    this.timer = setInterval(() => void this.load(true), 30_000);
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
      this.report = await fetchOracleDeviation(this.threshold, signal);
      this.state = 'ready';
      this.setDataBadge('live');
      this.setErrorState(false);
    } catch (err) {
      if (signal.aborted) return;
      if (this.report && background) { this.setDataBadge('cached'); return; }
      this.state = 'error';
      this.error = err instanceof Error ? err.message : 'Could not load oracle prices';
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
    const lanes = Object.entries(r.lanes).filter(([, l]) => l.status !== 'ok')
      .map(([name, l]) => `<p class="pd-warn" role="status">${escapeHtml(name)} lane unavailable: ${escapeHtml(l.reason || 'no answer')}</p>`).join('');
    const rows = [...r.rows].sort((a, b) => (a.chain === b.chain ? 0 : a.chain === 'Solana' ? -1 : 1)).map((x) => `
      <tr class="om-${x.status}">
        <td>${escapeHtml(x.oracle)}<span class="pd-muted"> ${escapeHtml(x.chain)}</span></td>
        <td>${escapeHtml(x.symbol)}</td>
        <td>${usd(x.price)}</td>
        <td>${usd(x.reference)}</td>
        <td>${x.deviationBps == null ? '-' : `${x.deviationBps > 0 ? '+' : ''}${x.deviationBps.toFixed(1)} bps`}</td>
        <td>${ageLabel(x.ageSec)} / ${ageLabel(x.heartbeatSec)}</td>
        <td><span class="pd-pill pd-pill-${x.status}">${STATUS_LABEL[x.status]}</span></td>
      </tr>`).join('');
    const opts = THRESHOLDS.map((t) => `<option value="${t}" ${t === this.threshold ? 'selected' : ''}>${t} bps</option>`).join('');
    this.setContent(`<div class="pd-wrap">
      <div class="pd-controls"><label class="pd-check">Alert above <select class="pd-select" data-om-threshold aria-label="Deviation threshold">${opts}</select></label></div>
      ${lanes}
      <div class="pd-tablewrap"><table class="pd-table"><thead><tr><th>Oracle</th><th>Pair</th><th>Oracle price</th><th>Exchange mid</th><th>Deviation</th><th>Age / heartbeat</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      <details class="pd-method"><summary>Method and sources</summary><p>${escapeHtml(r.methodology)}</p><p>Sources: ${escapeHtml(r.sources.join(', '))}</p></details>
    </div>`);
    this.bind();
  }

  private bind(): void {
    this.content.querySelector<HTMLSelectElement>('[data-om-threshold]')?.addEventListener('change', (e) => { this.threshold = Number((e.target as HTMLSelectElement).value); void this.load(); });
    this.content.querySelector<HTMLElement>('[data-pd-retry]')?.addEventListener('click', () => void this.load());
  }
}
