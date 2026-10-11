import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { WhaleTransaction, WhaleAlert, WhaleMonitorResult } from '@/types';

/* ── helpers ── */

function fmtUSD(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtETH(v: number): string {
  if (v >= 1000) return `${v.toLocaleString('en', { maximumFractionDigits: 0 })} ETH`;
  return `${v.toFixed(2)} ETH`;
}

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function typeIcon(type: WhaleTransaction['type']): string {
  switch (type) {
    case 'exchange_deposit': return '<span class="whale-type-deposit" title="Exchange Deposit">↓</span>';
    case 'exchange_withdrawal': return '<span class="whale-type-withdrawal" title="Exchange Withdrawal">↑</span>';
    case 'bridge_deposit': return '<span class="whale-type-bridge" title="Bridge Deposit">⇄</span>';
    case 'whale_transfer': return '<span class="whale-type-transfer" title="Whale Transfer">↔</span>';
    default: return '<span class="whale-type-unknown" title="Unknown">•</span>';
  }
}

function sigBadge(sig: string): string {
  return `<span class="whale-sig-${sig}">${sig.toUpperCase()}</span>`;
}

function flowBarHTML(inflow: number, outflow: number): string {
  const total = inflow + outflow;
  if (total === 0) return '<div class="whale-flow-gauge"><div class="whale-flow-bar whale-flow-neutral" style="width:100%"></div></div>';
  const inflowPct = (inflow / total) * 100;
  const outflowPct = 100 - inflowPct;
  return `<div class="whale-flow-gauge">
    <div class="whale-flow-bar whale-flow-inflow" style="width:${inflowPct.toFixed(1)}%" title="Inflow ${fmtUSD(inflow)}"></div>
    <div class="whale-flow-bar whale-flow-outflow" style="width:${outflowPct.toFixed(1)}%" title="Outflow ${fmtUSD(outflow)}"></div>
  </div>`;
}

/* ── Panel ── */

export class WhaleMonitorPanel extends Panel {
  private data: WhaleMonitorResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'whale-monitor',
      title: 'Whale Monitor',
      showCount: true,
      infoTooltip: 'Large on-chain transactions and exchange flow tracking. Monitors whale wallets, exchange deposits/withdrawals, and bridge activity.',
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => void this.fetchData(), 5 * 60_000);
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
      const res = await fetch('/api/whale-monitor', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as WhaleMonitorResult;
      this.data = json;
      this.error = null;

      const cacheStatus = res.headers.get('X-Cache');
      this.setDataBadge(json.unavailable ? 'unavailable' : cacheStatus === 'HIT' ? 'cached' : 'live');
      this.setErrorState(false);
      if (json.transactions) this.setCount(json.transactions.length);
    } catch (err: unknown) {
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
    if (this.loading) { this.showLoading('Loading whale data…'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No data'); return; }

    const { summary, transactions, alerts } = this.data;
    const netFlow = summary.netExchangeFlow;
    const netLabel = netFlow >= 0 ? 'Net Inflow' : 'Net Outflow';
    const netClass = netFlow >= 0 ? 'whale-net-bearish' : 'whale-net-bullish';

    let html = '<div class="whale-container">';

    /* ── Section 1: Flow Summary ── */
    html += `<div class="whale-summary">
      <div class="whale-summary-item">
        <span class="whale-summary-label">Volume (1h)</span>
        <span class="whale-summary-value">${escapeHtml(fmtUSD(summary.totalVolume1h))}</span>
      </div>
      <div class="whale-summary-item">
        <span class="whale-summary-label">Inflows</span>
        <span class="whale-summary-value whale-val-inflow">${escapeHtml(fmtUSD(summary.exchangeInflows))}</span>
      </div>
      <div class="whale-summary-item">
        <span class="whale-summary-label">Outflows</span>
        <span class="whale-summary-value whale-val-outflow">${escapeHtml(fmtUSD(summary.exchangeOutflows))}</span>
      </div>
      <div class="whale-summary-item">
        <span class="whale-summary-label">${escapeHtml(netLabel)}</span>
        <span class="whale-summary-value ${netClass}">${escapeHtml(fmtUSD(Math.abs(netFlow)))}</span>
      </div>
    </div>`;

    /* Flow gauge bar */
    html += flowBarHTML(summary.exchangeInflows, summary.exchangeOutflows);

    /* ── Section 2: Alerts ── */
    if (alerts.length > 0) {
      html += '<div class="whale-section"><div class="whale-section-title">Alerts</div>';
      html += '<div class="whale-alerts-list">';
      for (const a of alerts.slice(0, 8)) {
        html += this.renderAlert(a);
      }
      html += '</div></div>';
    }

    /* ── Section 3: Transaction Feed ── */
    html += '<div class="whale-section"><div class="whale-section-title">Recent Transactions</div>';
    if (transactions.length === 0) {
      html += '<div class="whale-empty">No large transactions detected in the last 30 minutes</div>';
    } else {
      html += '<div class="whale-tx-list">';
      for (const tx of transactions.slice(0, 25)) {
        html += this.renderTransaction(tx);
      }
      html += '</div>';
    }
    html += '</div>';

    html += '</div>'; // .whale-container
    this.setContent(html);

    // Wire up tx row clicks to open Etherscan
    const rows = this.content.querySelectorAll<HTMLElement>('.whale-tx-row[data-hash]');
    for (const row of rows) {
      row.addEventListener('click', () => {
        const hash = row.dataset.hash;
        if (hash) window.open(`https://etherscan.io/tx/${hash}`, '_blank', 'noopener');
      });
    }
  }

  private renderTransaction(tx: WhaleTransaction): string {
    const borderClass = tx.type === 'exchange_deposit' ? 'whale-border-inflow'
      : tx.type === 'exchange_withdrawal' ? 'whale-border-outflow'
      : 'whale-border-transfer';

    return `<div class="whale-tx-row ${borderClass}" data-hash="${escapeHtml(tx.hash)}" title="Click to view on Etherscan">
      <div class="whale-tx-icon">${typeIcon(tx.type)}</div>
      <div class="whale-tx-info">
        <div class="whale-tx-labels">
          <span class="whale-label" title="${escapeHtml(tx.from.address)}">${escapeHtml(tx.from.label)}</span>
          <span class="whale-tx-arrow">→</span>
          <span class="whale-label" title="${escapeHtml(tx.to.address)}">${escapeHtml(tx.to.label)}</span>
        </div>
        <div class="whale-tx-meta">
          <span class="whale-value">${escapeHtml(fmtETH(tx.value))}</span>
          <span class="whale-value-usd">${escapeHtml(fmtUSD(tx.valueUSD))}</span>
          ${sigBadge(tx.significance)}
          <span class="whale-tx-time">${escapeHtml(timeAgo(tx.timestamp))}</span>
        </div>
      </div>
    </div>`;
  }

  private renderAlert(alert: WhaleAlert): string {
    const sigClass = alert.significance === 'high' ? 'whale-alert-high'
      : alert.significance === 'medium' ? 'whale-alert-medium' : 'whale-alert-low';

    return `<div class="whale-alert ${sigClass}">
      <div class="whale-alert-icon">⚠</div>
      <div class="whale-alert-content">
        <span class="whale-alert-msg">${escapeHtml(alert.message)}</span>
        <span class="whale-alert-time">${escapeHtml(timeAgo(alert.timestamp))}</span>
      </div>
    </div>`;
  }
}
