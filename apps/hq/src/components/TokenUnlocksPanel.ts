import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { TokenUnlock, TokenUnlocksResult } from '@/types';

/* ── Local helpers ── */

function formatTokenAmount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  if (n > 0) return `$${n.toFixed(0)}`;
  return '$0';
}

function daysLabel(d: number): string {
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `${d}d`;
}

function countdownClass(days: number): string {
  if (days <= 3) return 'unlock-countdown-urgent';
  if (days <= 7) return 'unlock-countdown-soon';
  return 'unlock-countdown-later';
}

function riskBadgeClass(risk: string): string {
  if (risk === 'high') return 'unlock-risk-high';
  if (risk === 'medium') return 'unlock-risk-medium';
  return 'unlock-risk-low';
}

function recipientColor(r: string): string {
  switch (r) {
    case 'team': return '#4a9eff';
    case 'investors': return '#a78bfa';
    case 'ecosystem': return '#34d399';
    case 'community': return '#fbbf24';
    case 'treasury': return '#f97316';
    case 'advisors': return '#f472b6';
    default: return '#94a3b8';
  }
}

type ViewMode = 'list' | 'calendar' | 'impact';

/* ── Panel ── */

export class TokenUnlocksPanel extends Panel {
  private data: TokenUnlocksResult | null = null;
  private loading = true;
  private error: string | null = null;
  private activeView: ViewMode = 'list';
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'token-unlocks',
      title: 'Token Unlocks',
      showCount: true,
      infoTooltip: 'Upcoming token vesting unlocks that may create sell pressure. Red = high-impact (>5% circ. supply), yellow = medium (1-5%), green = low (<1%).',
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60_000);
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

  /* ── Data fetching ── */

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const res = await fetch('/api/token-unlocks', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TokenUnlocksResult = await res.json();
      this.data = json;
      this.error = null;
      if (json.summary) this.setCount(json.summary.upcomingCount);
    } catch (err) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /* ── Views ── */

  private render(): void {
    if (this.loading) { this.showLoading('Loading token unlocks...'); return; }
    if (this.error || !this.data) { this.showError(this.error || 'No unlock data'); return; }
    if (this.data.unavailable || !this.data.upcoming.length) {
      this.setContent('<div class="panel-loading-text">No upcoming unlocks found</div>');
      return;
    }

    const tabs = this.buildTabs();
    let body = '';
    switch (this.activeView) {
      case 'list': body = this.buildListView(); break;
      case 'calendar': body = this.buildCalendarView(); break;
      case 'impact': body = this.buildImpactView(); break;
    }

    const summary = this.buildSummary();
    this.setContent(`<div class="token-unlocks-container">${summary}${tabs}${body}</div>`);
    this.bindEvents();
  }

  /* ── Summary strip ── */

  private buildSummary(): string {
    const s = this.data!.summary;
    const hiImpact = s.highestImpact
      ? `<span class="unlock-risk-high" style="font-size:10px;padding:1px 5px">${escapeHtml(s.highestImpact.token)} ${s.highestImpact.percentOfSupply.toFixed(2)}%</span>`
      : '-';

    return `
      <div class="unlock-summary">
        <div class="unlock-summary-item">
          <span class="unlock-summary-label">7d Value</span>
          <span class="unlock-summary-value">${formatUsd(s.totalValueNext7d)}</span>
        </div>
        <div class="unlock-summary-item">
          <span class="unlock-summary-label">30d Value</span>
          <span class="unlock-summary-value">${formatUsd(s.totalValueNext30d)}</span>
        </div>
        <div class="unlock-summary-item">
          <span class="unlock-summary-label">Biggest</span>
          <span class="unlock-summary-value">${hiImpact}</span>
        </div>
        <div class="unlock-summary-item">
          <span class="unlock-summary-label">Events</span>
          <span class="unlock-summary-value">${s.upcomingCount}</span>
        </div>
      </div>`;
  }

  /* ── Tab bar ── */

  private buildTabs(): string {
    const tabs: { key: ViewMode; label: string }[] = [
      { key: 'list', label: 'Upcoming' },
      { key: 'calendar', label: 'Calendar' },
      { key: 'impact', label: 'Impact' },
    ];
    const items = tabs.map(t =>
      `<button class="unlock-tab${this.activeView === t.key ? ' unlock-tab-active' : ''}" data-view="${t.key}">${t.label}</button>`
    ).join('');
    return `<div class="unlock-tabs">${items}</div>`;
  }

  /* ── List view (default) ── */

  private buildListView(): string {
    const unlocks = this.data!.upcoming.slice(0, 40);
    const rows = unlocks.map(u => this.buildUnlockRow(u)).join('');
    return `<div class="unlock-list">${rows}</div>`;
  }

  private buildUnlockRow(u: TokenUnlock): string {
    const riskCls = riskBadgeClass(u.priceImpactRisk);
    const cdCls = countdownClass(u.daysUntil);
    const recipStyle = `background:${recipientColor(u.recipient)}22;color:${recipientColor(u.recipient)}`;

    return `
      <div class="unlock-row unlock-row-${u.priceImpactRisk}" data-symbol="${escapeHtml(u.symbol)}">
        <div class="unlock-row-left">
          <span class="unlock-symbol">${escapeHtml(u.symbol)}</span>
          <span class="unlock-token-name">${escapeHtml(u.token)}</span>
          <span class="unlock-category-tag">${escapeHtml(u.category)}</span>
        </div>
        <div class="unlock-row-center">
          <span class="unlock-countdown ${cdCls}">${daysLabel(u.daysUntil)}</span>
          <span class="unlock-date">${escapeHtml(u.date)}</span>
        </div>
        <div class="unlock-row-right">
          <span class="unlock-amount">${formatTokenAmount(u.amount)} ${escapeHtml(u.symbol)}</span>
          <span class="unlock-value">${formatUsd(u.valueUSD)}</span>
        </div>
        <div class="unlock-row-badges">
          <span class="unlock-recipient" style="${recipStyle}">${escapeHtml(u.recipient)}</span>
          <span class="${riskCls}">${u.priceImpactRisk}</span>
        </div>
      </div>`;
  }

  /* ── Calendar view ── */

  private buildCalendarView(): string {
    // Build week-by-week bar chart for next 12 weeks
    const cal = this.data!.calendar;
    const allEvents = cal.next90Days;
    if (!allEvents.length) return '<div class="panel-loading-text">No upcoming events</div>';

    // Group by week
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weeks: { label: string; total: number; count: number }[] = [];
    for (let w = 0; w < 12; w++) {
      const weekStart = new Date(today.getTime() + w * 7 * 86_400_000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
      const weekEvents = allEvents.filter(e => {
        const d = new Date(e.date);
        return d >= weekStart && d < weekEnd;
      });
      const total = weekEvents.reduce((s, e) => s + e.valueUSD, 0);
      const startLabel = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
      weeks.push({ label: startLabel, total, count: weekEvents.length });
    }

    const maxVal = Math.max(...weeks.map(w => w.total), 1);

    const bars = weeks.map((w, i) => {
      const heightPct = Math.max((w.total / maxVal) * 100, 2);
      const isThisWeek = i === 0;
      return `
        <div class="unlock-cal-bar-wrap" title="Week of ${escapeHtml(w.label)}: ${formatUsd(w.total)} (${w.count} events)">
          <div class="unlock-cal-bar${isThisWeek ? ' unlock-cal-bar-current' : ''}" style="height:${heightPct}%"></div>
          <span class="unlock-cal-label">${escapeHtml(w.label)}</span>
        </div>`;
    }).join('');

    // Bucket summaries
    const sections = [
      { label: 'This Week', items: cal.thisWeek },
      { label: 'Next Week', items: cal.nextWeek },
    ];
    const buckets = sections.map(s => {
      const total = s.items.reduce((a, u) => a + u.valueUSD, 0);
      return `<div class="unlock-bucket">
        <span class="unlock-bucket-label">${s.label}</span>
        <span class="unlock-bucket-value">${formatUsd(total)}</span>
        <span class="unlock-bucket-count">${s.items.length} events</span>
      </div>`;
    }).join('');

    return `
      <div class="unlock-calendar">
        <div class="unlock-cal-chart">${bars}</div>
        <div class="unlock-buckets">${buckets}</div>
      </div>`;
  }

  /* ── Impact ranking view ── */

  private buildImpactView(): string {
    // Sort by % of circulating supply (proxy: percentOfSupply * value)
    const sorted = [...this.data!.upcoming]
      .sort((a, b) => b.percentOfSupply - a.percentOfSupply)
      .slice(0, 25);

    const maxPct = Math.max(...sorted.map(u => u.percentOfSupply), 0.01);

    const rows = sorted.map(u => {
      const barWidth = Math.max((u.percentOfSupply / maxPct) * 100, 3);
      const riskCls = riskBadgeClass(u.priceImpactRisk);
      return `
        <div class="unlock-impact-row" data-symbol="${escapeHtml(u.symbol)}">
          <div class="unlock-impact-header">
            <span class="unlock-symbol">${escapeHtml(u.symbol)}</span>
            <span class="unlock-impact-pct">${u.percentOfSupply.toFixed(2)}% of supply</span>
            <span class="${riskCls}" style="font-size:10px">${u.priceImpactRisk}</span>
            <span class="unlock-countdown ${countdownClass(u.daysUntil)}" style="margin-left:auto">${daysLabel(u.daysUntil)}</span>
          </div>
          <div class="unlock-impact-bar-bg">
            <div class="unlock-impact-bar unlock-impact-bar-${u.priceImpactRisk}" style="width:${barWidth}%"></div>
          </div>
          <div class="unlock-impact-meta">
            <span>${formatTokenAmount(u.amount)} tokens</span>
            <span>${formatUsd(u.valueUSD)}</span>
            <span class="unlock-recipient" style="background:${recipientColor(u.recipient)}22;color:${recipientColor(u.recipient)}">${escapeHtml(u.recipient)}</span>
          </div>
        </div>`;
    }).join('');

    return `<div class="unlock-impact-list">${rows}</div>`;
  }

  /* ── Event binding ── */

  private bindEvents(): void {
    // Tab switching
    this.content.querySelectorAll<HTMLElement>('.unlock-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view as ViewMode;
        if (view && view !== this.activeView) {
          this.activeView = view;
          this.render();
        }
      });
    });

    // Row click → open token detail
    this.content.querySelectorAll<HTMLElement>('[data-symbol]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const symbol = el.dataset.symbol ?? '';
        if (symbol) {
          window.dispatchEvent(new CustomEvent('detail:open', {
            detail: { type: 'token' as const, data: { symbol } },
          }));
        }
      });
    });
  }
}
