import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchDune, type DuneResult } from '@/services/protocol-dashboard';
import { errorWithRetry, skeleton } from './pd-format';

const STORAGE_KEY = 'hq-dune-query-id';

function savedId(): string {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

export class DuneQueryPanel extends Panel {
  private state: 'loading' | 'disabled' | 'ready' | 'error' = 'loading';
  private reason = '';
  private result: DuneResult | null = null;
  private queryId = savedId();
  private abort: AbortController | null = null;

  constructor() {
    super({
      id: 'dune-query',
      title: 'Dune Analytics',
      showCount: false,
      infoTooltip: `<strong>Dune Analytics (opt-in)</strong>
        <p>Shows the latest saved result of a Dune query by id. It never executes a query, so it spends no execution credits. Requires DUNE_API_KEY.</p>`,
    });
    void this.load();
  }

  public destroy(): void {
    this.abort?.abort();
    super.destroy();
  }

  private async load(): Promise<void> {
    this.abort?.abort();
    this.abort = new AbortController();
    const { signal } = this.abort;
    this.state = 'loading';
    this.render();
    try {
      const probe = await fetchDune(null, signal);
      if (!probe.enabled) { this.state = 'disabled'; this.reason = probe.reason || 'DUNE_API_KEY is not set.'; this.setDataBadge('unavailable'); this.render(); return; }
      if (!this.queryId) { this.result = null; this.state = 'ready'; this.setDataBadge('live'); this.render(); return; }
      this.result = await fetchDune(this.queryId, signal);
      this.state = 'ready';
      this.setDataBadge('live');
    } catch (err) {
      if (signal.aborted) return;
      this.state = 'error';
      this.reason = err instanceof Error ? err.message : 'Dune did not answer';
      this.setDataBadge('unavailable');
    }
    this.render();
  }

  private render(): void {
    if (this.state === 'loading') { this.setContent(skeleton(3)); return; }
    if (this.state === 'disabled') {
      this.setContent(`<div class="pd-empty"><p><strong>Dune is off.</strong></p><p>${escapeHtml(this.reason)}</p><p class="pd-muted">Every other panel uses keyless sources and works without it.</p></div>`);
      return;
    }
    if (this.state === 'error') { this.setContent(errorWithRetry(this.reason)); this.bind(); return; }
    const res = this.result;
    const form = `<form class="pd-controls" data-dune-form><input class="pd-input" name="id" inputmode="numeric" pattern="[0-9]{1,12}" placeholder="Dune query id" aria-label="Dune query id" value="${escapeHtml(this.queryId)}"/><button type="submit" class="pd-btn">Load</button></form>`;
    if (!res) { this.setContent(`<div class="pd-wrap">${form}<div class="pd-empty"><p>Enter the id of a saved Dune query to see its latest result.</p></div></div>`); this.bind(); return; }
    if (res.error) { this.setContent(`<div class="pd-wrap">${form}<div class="pd-error" role="alert"><p>${escapeHtml(res.error)}</p></div></div>`); this.bind(); return; }
    const cols = res.columns || [];
    const rows = (res.rows || []).map((r) => `<tr>${cols.map((c) => `<td>${escapeHtml(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('');
    this.setContent(`<div class="pd-wrap">${form}<div class="pd-tablewrap"><table class="pd-table"><thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="pd-muted">Latest saved result${res.executedAt ? `, executed ${escapeHtml(res.executedAt)}` : ''}.</p></div>`);
    this.bind();
  }

  private bind(): void {
    this.content.querySelector<HTMLFormElement>('[data-dune-form]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = String(new FormData(e.target as HTMLFormElement).get('id') || '').trim();
      this.queryId = id;
      try { localStorage.setItem(STORAGE_KEY, id); } catch { /* storage unavailable */ }
      void this.load();
    });
    this.content.querySelector<HTMLElement>('[data-pd-retry]')?.addEventListener('click', () => void this.load());
  }
}
