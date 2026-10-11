import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { AirdropTrackerResult, Airdrop } from '@/types';
import { AIRDROP_REGISTRY } from '@/config/airdrops';

type TabKey = 'claimable' | 'upcoming' | 'rumored';

const CHAIN_COLORS: Record<string, string> = {
  Ethereum: '#627eea',
  Solana: '#9945ff',
  'zkSync Era': '#4e529a',
  Starknet: '#ec796b',
  Scroll: '#ffeeda',
  Linea: '#61dfff',
  Berachain: '#b68b4e',
  Monad: '#836ef9',
  Eclipse: '#ff6b35',
  'Multi-chain': '#00d395',
};

function chainColor(chain: string): string {
  return CHAIN_COLORS[chain] ?? '#888';
}

function daysLeftLabel(days: number | undefined): string {
  if (days === undefined) return '';
  if (days <= 0) return 'Expired';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

function urgencyClass(days: number | undefined): string {
  if (days === undefined) return '';
  if (days <= 7) return 'airdrop-urgent';
  if (days <= 30) return 'airdrop-soon';
  return '';
}

/**
 * Build static fallback data from the local registry when the API is unreachable.
 */
function buildFallbackData(): AirdropTrackerResult {
  const now = new Date();
  const enriched = AIRDROP_REGISTRY.map((entry) => {
    let daysLeft: number | undefined;
    if (entry.claimDeadline) {
      const diff = new Date(entry.claimDeadline).getTime() - now.getTime();
      daysLeft = diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
    }
    return { ...entry, daysLeft } as Airdrop;
  });

  const claimable = enriched.filter((a) => a.status === 'claimable');
  const upcoming = enriched.filter((a) => a.status === 'upcoming');
  const rumored = enriched.filter((a) => a.status === 'rumored');
  const recentlyEnded = enriched.filter((a) => a.status === 'ended');

  return {
    timestamp: now.toISOString(),
    airdrops: { claimable, upcoming, rumored, recentlyEnded },
    summary: {
      claimableCount: claimable.length,
      upcomingCount: upcoming.length,
      rumoredCount: rumored.length,
      totalEstimatedValue: 'Speculative - not financial advice',
      urgentDeadlines: claimable.filter((a) => a.daysLeft !== undefined && a.daysLeft <= 7).length,
    },
  };
}

export class AirdropTrackerPanel extends Panel {
  private data: AirdropTrackerResult | null = null;
  private activeTab: TabKey = 'claimable';
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'airdrop-tracker',
      title: 'Airdrop Tracker',
      showCount: true,
      infoTooltip: 'Track upcoming, claimable, and rumored DeFi airdrops. Estimated values are speculative - not financial advice.',
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 15 * 60_000);
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

  /* ── Data fetching ─────────────────────────────────────── */

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const res = await fetch('/api/airdrops', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;
    } catch (err) {
      if (signal.aborted) return;
      // Use local static data as graceful fallback
      this.data = buildFallbackData();
      this.error = null; // Fallback succeeded - don't show error
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  /* ── Rendering ─────────────────────────────────────────── */

  private renderPanel(): void {
    if (this.loading) {
      this.showLoading('Loading airdrops…');
      return;
    }
    if (this.error || !this.data) {
      this.showError(this.error || 'No airdrop data');
      return;
    }

    const d = this.data;
    const counts: Record<TabKey, number> = {
      claimable: d.summary.claimableCount,
      upcoming: d.summary.upcomingCount,
      rumored: d.summary.rumoredCount,
    };

    const totalCount = counts.claimable + counts.upcoming + counts.rumored;
    this.setCount(totalCount);

    // If active tab has 0 items, fall back to one that has data
    if (counts[this.activeTab] === 0) {
      if (counts.claimable > 0) this.activeTab = 'claimable';
      else if (counts.upcoming > 0) this.activeTab = 'upcoming';
      else this.activeTab = 'rumored';
    }

    const tabHtml = (['claimable', 'upcoming', 'rumored'] as TabKey[])
      .map(
        (tab) => `
      <button class="airdrop-tab ${tab === this.activeTab ? 'active' : ''}" data-tab="${tab}">
        ${tab === 'claimable' ? '🎁' : tab === 'upcoming' ? '📅' : '🔮'} ${this.tabLabel(tab)}
        <span class="airdrop-tab-count">${counts[tab]}</span>
      </button>`
      )
      .join('');

    let listHtml = '';
    if (this.activeTab === 'claimable') {
      listHtml = this.renderClaimable(d.airdrops.claimable);
    } else if (this.activeTab === 'upcoming') {
      listHtml = this.renderUpcoming(d.airdrops.upcoming);
    } else {
      listHtml = this.renderRumored(d.airdrops.rumored);
    }

    // Summary footer
    const urgentNote =
      d.summary.urgentDeadlines > 0
        ? `<span class="airdrop-urgent-note">⚠ ${d.summary.urgentDeadlines} deadline${d.summary.urgentDeadlines > 1 ? 's' : ''} within 7 days</span>`
        : '';

    const html = `
      <div class="airdrop-tracker-container">
        <div class="airdrop-tabs">${tabHtml}</div>
        <div class="airdrop-list">${listHtml}</div>
        <div class="airdrop-footer">
          ${urgentNote}
          <span class="airdrop-disclaimer">Estimated values are speculative - not financial advice</span>
        </div>
      </div>
    `;

    this.setContent(html);
    this.bindEvents();
  }

  /* ── Tab helpers ────────────────────────────────────────── */

  private tabLabel(tab: TabKey): string {
    switch (tab) {
      case 'claimable':
        return 'Claimable';
      case 'upcoming':
        return 'Upcoming';
      case 'rumored':
        return 'Rumored';
    }
  }

  /* ── List renderers ────────────────────────────────────── */

  private renderClaimable(items: Airdrop[]): string {
    if (items.length === 0) return '<div class="airdrop-empty">No active claims right now</div>';
    return items
      .map((a) => {
        const dl = daysLeftLabel(a.daysLeft);
        const urg = urgencyClass(a.daysLeft);
        return `
        <div class="airdrop-claim-card ${urg}">
          <div class="airdrop-card-header">
            <span class="airdrop-protocol">${escapeHtml(a.protocol)}</span>
            <span class="airdrop-chain" style="--chain-color:${chainColor(a.chain)}">${escapeHtml(a.chain)}</span>
            <span class="airdrop-confirmed">✓ Confirmed</span>
          </div>
          <div class="airdrop-card-body">
            <div class="airdrop-desc">${escapeHtml(a.description)}</div>
            ${a.estimatedValue ? `<div class="airdrop-value">${escapeHtml(a.estimatedValue)}</div>` : ''}
            ${dl ? `<div class="airdrop-countdown ${urg}">${escapeHtml(dl)}</div>` : ''}
          </div>
          <div class="airdrop-eligibility">
            ${a.eligibility.map((e) => `<div class="airdrop-eligibility-item">✓ ${escapeHtml(e)}</div>`).join('')}
          </div>
          ${a.claimUrl ? `<a class="airdrop-claim-btn" href="${escapeHtml(a.claimUrl)}" target="_blank" rel="noopener">Claim Now →</a>` : ''}
        </div>`;
      })
      .join('');
  }

  private renderUpcoming(items: Airdrop[]): string {
    if (items.length === 0) return '<div class="airdrop-empty">No confirmed upcoming airdrops</div>';
    return items
      .map(
        (a) => `
        <div class="airdrop-upcoming-card">
          <div class="airdrop-card-header">
            <span class="airdrop-protocol">${escapeHtml(a.protocol)}</span>
            <span class="airdrop-chain" style="--chain-color:${chainColor(a.chain)}">${escapeHtml(a.chain)}</span>
            <span class="airdrop-confirmed">✓ Confirmed</span>
          </div>
          <div class="airdrop-card-body">
            <div class="airdrop-desc">${escapeHtml(a.description)}</div>
            ${a.estimatedValue ? `<div class="airdrop-value">${escapeHtml(a.estimatedValue)}</div>` : ''}
          </div>
          <div class="airdrop-eligibility">
            ${a.eligibility.map((e) => `<div class="airdrop-eligibility-item">✓ ${escapeHtml(e)}</div>`).join('')}
          </div>
          ${
            a.tasks && a.tasks.length
              ? `<div class="airdrop-tasks"><div class="airdrop-tasks-label">How to qualify:</div>${a.tasks
                  .map((t, i) => `<div class="airdrop-task">${i + 1}. ${escapeHtml(t)}</div>`)
                  .join('')}</div>`
              : ''
          }
          ${a.links?.website ? `<a class="airdrop-link" href="${escapeHtml(a.links.website)}" target="_blank" rel="noopener">Visit Protocol →</a>` : ''}
        </div>`
      )
      .join('');
  }

  private renderRumored(items: Airdrop[]): string {
    if (items.length === 0) return '<div class="airdrop-empty">No rumored airdrops tracked</div>';
    return items
      .map(
        (a) => `
        <div class="airdrop-rumored-card" data-airdrop-id="${escapeHtml(a.id)}">
          <div class="airdrop-card-header">
            <span class="airdrop-protocol">${escapeHtml(a.protocol)}</span>
            <span class="airdrop-chain" style="--chain-color:${chainColor(a.chain)}">${escapeHtml(a.chain)}</span>
            <span class="airdrop-rumored-badge">? Rumored</span>
          </div>
          <div class="airdrop-card-body airdrop-collapsible" style="display:none">
            <div class="airdrop-desc">${escapeHtml(a.description)}</div>
            ${a.estimatedValue ? `<div class="airdrop-value">${escapeHtml(a.estimatedValue)}</div>` : ''}
            <div class="airdrop-eligibility">
              ${a.eligibility.map((e) => `<div class="airdrop-eligibility-item">• ${escapeHtml(e)}</div>`).join('')}
            </div>
            ${
              a.tasks && a.tasks.length
                ? `<div class="airdrop-tasks"><div class="airdrop-tasks-label">Potential qualifying actions:</div>${a.tasks
                    .map((t, i) => `<div class="airdrop-task">${i + 1}. ${escapeHtml(t)}</div>`)
                    .join('')}</div>`
                : ''
            }
            ${a.links?.website ? `<a class="airdrop-link" href="${escapeHtml(a.links.website)}" target="_blank" rel="noopener">Visit Protocol →</a>` : ''}
          </div>
          <button class="airdrop-expand-btn" data-expand="${escapeHtml(a.id)}">Show details ▾</button>
        </div>`
      )
      .join('');
  }

  /* ── Event binding ─────────────────────────────────────── */

  private bindEvents(): void {
    // Tab switching
    this.content.querySelectorAll<HTMLButtonElement>('.airdrop-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as TabKey | undefined;
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;
          this.renderPanel();
        }
      });
    });

    // Collapsible rumored cards
    this.content.querySelectorAll<HTMLButtonElement>('.airdrop-expand-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.airdrop-rumored-card');
        if (!card) return;
        const body = card.querySelector<HTMLElement>('.airdrop-collapsible');
        if (!body) return;
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        btn.textContent = isHidden ? 'Hide details ▴' : 'Show details ▾';
      });
    });
  }
}
