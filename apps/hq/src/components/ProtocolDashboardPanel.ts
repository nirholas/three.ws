import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchPickerProtocols, fetchProtocolDashboard, type Block, type BlockOk, type PickerProtocol, type ProtocolDashboard } from '@/services/protocol-dashboard';
import { errorWithRetry, pct, pctClass, skeleton, sparkline, usd } from './pd-format';

const BLOCK_TITLES: Record<string, string> = {
  'tvl-history': 'TVL', 'tvl-chains': 'TVL by chain', fees: 'Fees and revenue', yields: 'Top yield pools', price: 'Token',
  'uniswap-lp': 'LP profitability: fees vs impermanent loss', 'lending-rates': 'Lending markets', 'aave-health': 'Account health',
  'lido-staking': 'Staking', 'token-breakdown': 'TVL by token', 'hyperliquid-markets': 'Perp markets',
};

type Row = Record<string, unknown>;
const rowsOf = (b: BlockOk, key = 'rows') => (b[key] as Row[]) || [];
const n = (v: unknown) => (typeof v === 'number' ? v : null);

export class ProtocolDashboardPanel extends Panel {
  private picker: PickerProtocol[] = [];
  private pickerState: 'loading' | 'ready' | 'error' = 'loading';
  private pickerError = '';
  private onlySolana = true;
  private slug: string | null = null;
  private windowDays = 30;
  private dash: ProtocolDashboard | null = null;
  private dashState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private dashError = '';
  private abort: AbortController | null = null;

  constructor() {
    super({
      id: 'protocol-dashboard',
      title: 'Protocol Dashboards',
      showCount: false,
      infoTooltip: `<strong>Protocol Dashboards</strong>
        <p>Pick a protocol for TVL, per-chain split, fees, yields and protocol-specific views (Uniswap LP economics, lending utilization, Lido staking, Hyperliquid markets).</p>
        <p>Sources: DeFiLlama, Lido and Hyperliquid public APIs. A block with no free data says so.</p>`,
    });
    void this.loadPicker();
  }

  public destroy(): void {
    this.abort?.abort();
    super.destroy();
  }

  private async loadPicker(): Promise<void> {
    this.pickerState = 'loading';
    this.render();
    this.abort?.abort();
    this.abort = new AbortController();
    try {
      this.picker = await fetchPickerProtocols(this.abort.signal);
      this.pickerState = 'ready';
      this.setDataBadge('live');
    } catch (err) {
      if (this.abort.signal.aborted) return;
      this.pickerState = 'error';
      this.pickerError = err instanceof Error ? err.message : 'Could not load protocols';
      this.setDataBadge('unavailable');
    }
    if (this.pickerState === 'ready' && !this.slug) {
      const first = this.pickerList()[0];
      if (first) { void this.select(first.slug); return; }
    }
    this.render();
  }

  private pickerList(): PickerProtocol[] {
    const list = this.onlySolana ? this.picker.filter((p) => p.solanaTvl > 0) : [...this.picker];
    return list.sort((a, b) => (this.onlySolana ? b.solanaTvl - a.solanaTvl : b.tvl - a.tvl)).slice(0, 60);
  }

  private async select(slug: string): Promise<void> {
    this.slug = slug;
    this.dashState = 'loading';
    this.render();
    this.abort?.abort();
    this.abort = new AbortController();
    const { signal } = this.abort;
    try {
      this.dash = await fetchProtocolDashboard(slug, this.windowDays, signal);
      this.dashState = 'ready';
    } catch (err) {
      if (signal.aborted) return;
      this.dashState = 'error';
      this.dashError = err instanceof Error ? err.message : 'Could not load this protocol';
    }
    this.render();
  }

  private render(): void {
    if (this.pickerState === 'loading') { this.setContent(skeleton(5)); return; }
    if (this.pickerState === 'error') { this.setContent(errorWithRetry(this.pickerError)); this.bind(); return; }
    const list = this.pickerList();
    if (list.length === 0) {
      this.setContent(`<div class="pd-empty"><p>No protocols with ${this.onlySolana ? 'Solana ' : ''}TVL came back.</p><button type="button" class="pd-btn" data-pd-toggle-solana>${this.onlySolana ? 'Show all chains' : 'Show Solana only'}</button></div>`);
      this.bind();
      return;
    }
    const options = list.map((p) => `<option value="${escapeHtml(p.slug)}" ${p.slug === this.slug ? 'selected' : ''}>${escapeHtml(p.name)} - ${usd(this.onlySolana ? p.solanaTvl : p.tvl)}</option>`).join('');
    const head = `<div class="pd-controls">
      <select class="pd-select" data-pd-picker aria-label="Protocol">${options}</select>
      <label class="pd-check"><input type="checkbox" data-pd-solana ${this.onlySolana ? 'checked' : ''}/> Solana first</label>
    </div>`;
    let body = '';
    if (this.dashState === 'loading') body = skeleton(5);
    else if (this.dashState === 'error') body = errorWithRetry(this.dashError);
    else if (this.dash) body = this.renderDash(this.dash);
    this.setContent(`<div class="pd-wrap">${head}${body}</div>`);
    this.bind();
  }

  private renderDash(d: ProtocolDashboard): string {
    const p = d.protocol;
    const header = `<div class="pd-head">
      ${p.logo ? `<img class="pd-logo" src="${escapeHtml(p.logo)}" alt="" width="20" height="20" data-hide-on-error/>` : ''}
      <strong>${escapeHtml(p.name)}</strong><span class="pd-muted">${escapeHtml(p.category || '')} · ${escapeHtml(p.chains.slice(0, 4).join(', '))}</span>
    </div>`;
    const blocks = d.blockOrder.map((id) => this.renderBlock(id, d.blocks[id])).join('');
    return `${header}<div class="pd-grid">${blocks}</div>
      <details class="pd-method"><summary>Method and sources</summary><p>${escapeHtml(d.methodology)}</p><p>Sources: ${escapeHtml(d.sources.join(', '))}</p></details>`;
  }

  private renderBlock(id: string, b: Block | undefined): string {
    const title = BLOCK_TITLES[id] || id;
    if (!b || b.status !== 'ok') {
      return `<section class="pd-block pd-block-na"><h4>${escapeHtml(title)}</h4><p class="pd-muted">Not available: ${escapeHtml(b && 'reason' in b ? String(b.reason) : 'no data')}</p></section>`;
    }
    return `<section class="pd-block"><h4>${escapeHtml(title)}</h4>${this.blockBody(id, b)}</section>`;
  }

  private table(head: string[], rows: string[][]): string {
    return `<div class="pd-tablewrap"><table class="pd-table"><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  private blockBody(id: string, b: BlockOk): string {
    const e = escapeHtml;
    switch (id) {
      case 'tvl-history':
        return `<div class="pd-stat"><span class="pd-big">${usd(b.current)}</span>
          <span class="${pctClass(b.change1d)}">1d ${pct(n(b.change1d))}</span> <span class="${pctClass(b.change7d)}">7d ${pct(n(b.change7d))}</span> <span class="${pctClass(b.change30d)}">30d ${pct(n(b.change30d))}</span></div>${sparkline(b.series, 'TVL history')}`;
      case 'tvl-chains':
        return this.table(['Chain', 'TVL', 'Share'], rowsOf(b).map((r) => [e(String(r.chain)), usd(r.tvl), pct(typeof r.share === 'number' ? r.share * 100 : null)]));
      case 'fees': {
        const f = b.fees as Row | null; const r = b.revenue as Row | null;
        const line = (label: string, x: Row | null) => x ? `<div class="pd-kv"><span>${label}</span><span>24h ${usd(x.total24h)} · 7d ${usd(x.total7d)} · 30d ${usd(x.total30d)}</span></div>` : '';
        return `${line('Fees', f)}${line('Revenue', r)}${sparkline((f || r)?.series, 'Daily fees')}`;
      }
      case 'yields':
        return this.table(['Pool', 'Chain', 'TVL', 'Base APY', '30d avg'], rowsOf(b).map((r) => [e(String(r.symbol)), e(String(r.chain)), usd(r.tvlUsd), pct(n(r.apyBase)), pct(n(r.apyMean30d))]));
      case 'price':
        return `<div class="pd-stat"><span class="pd-big">${usd(b.price)}</span><span class="pd-muted">${e(String(b.symbol || ''))} · mcap ${usd(b.mcap)}</span></div>`;
      case 'token-breakdown':
        return this.table(['Token', 'TVL', 'Share'], rowsOf(b).map((r) => [e(String(r.token)), usd(r.usd), pct(typeof r.share === 'number' ? r.share * 100 : null)]));
      case 'uniswap-lp':
        return `<div class="pd-seg" role="group" aria-label="Window">${[7, 30, 90].map((w) => `<button type="button" class="pd-btn ${w === this.windowDays ? 'active' : ''}" data-pd-window="${w}" aria-pressed="${w === this.windowDays}">${w}d</button>`).join('')}</div>`
          + this.table(['Pool', 'Chain', 'Depth', 'Fee APY', 'Fees', 'IL', 'Net'], rowsOf(b).map((r) => {
            const pr = r.profitability as Row | null;
            return [e(String(r.pool)), e(String(r.chain)), usd(r.tvlUsd), pct(n(r.feeApyPct)), pr ? pct(n(pr.feePct), 2) : '-', pr ? pct(n(pr.ilPct), 2) : '-',
              pr ? `<span class="${pctClass(pr.netPct)}">${pct(n(pr.netPct), 2)}</span>` : '<span class="pd-muted">no price history</span>'];
          }));
      case 'lending-rates':
        return this.table(['Market', 'Chain', 'Supplied', 'Utilization', 'Supply APY', 'Borrow APY'], rowsOf(b).map((r) => [e(String(r.symbol)), e(String(r.chain)), usd(r.supplyUsd), pct(typeof r.utilization === 'number' ? r.utilization * 100 : null, 0), pct(n(r.supplyApy)), pct(n(r.borrowApy))]));
      case 'lido-staking':
        return `<div class="pd-kv"><span>Staked</span><span>${typeof b.totalStakedEth === 'number' ? Math.round(b.totalStakedEth).toLocaleString() : '-'} ETH</span></div>
          <div class="pd-kv"><span>stETH APR (7d SMA)</span><span>${pct(n(b.smaAprPct), 2)}</span></div>
          <div class="pd-kv"><span>Holders</span><span>${typeof b.holders === 'number' ? b.holders.toLocaleString() : '-'}</span></div>
          <p class="pd-muted">${e(String(b.validatorsNote || ''))}</p>`;
      case 'hyperliquid-markets':
        return `<div class="pd-kv"><span>Open interest</span><span>${usd(b.totalOpenInterestUsd)}</span></div><div class="pd-kv"><span>24h volume</span><span>${usd(b.totalVolume24hUsd)}</span></div>`
          + this.table(['Market', 'Mark', 'Funding', 'OI'], rowsOf(b).map((r) => [e(String(r.coin)), usd(r.markPx), pct(n(r.fundingPct), 4), usd(r.openInterestUsd)]));
      default:
        return '<p class="pd-muted">No renderer for this block.</p>';
    }
  }

  private bind(): void {
    const c = this.content;
    c.querySelector<HTMLSelectElement>('[data-pd-picker]')?.addEventListener('change', (ev) => void this.select((ev.target as HTMLSelectElement).value));
    c.querySelector<HTMLInputElement>('[data-pd-solana]')?.addEventListener('change', (ev) => { this.onlySolana = (ev.target as HTMLInputElement).checked; this.slug = null; this.dash = null; this.dashState = 'idle'; void this.afterToggle(); });
    c.querySelector<HTMLElement>('[data-pd-toggle-solana]')?.addEventListener('click', () => { this.onlySolana = !this.onlySolana; void this.afterToggle(); });
    c.querySelectorAll<HTMLElement>('[data-pd-window]').forEach((btn) => btn.addEventListener('click', () => { this.windowDays = Number(btn.dataset.pdWindow); if (this.slug) void this.select(this.slug); }));
    c.querySelector<HTMLElement>('[data-pd-retry]')?.addEventListener('click', () => {
      if (this.pickerState === 'error') void this.loadPicker();
      else if (this.slug) void this.select(this.slug);
    });
  }

  private async afterToggle(): Promise<void> {
    const first = this.pickerList()[0];
    if (first) await this.select(first.slug); else this.render();
  }
}
