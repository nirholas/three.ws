import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { GovernanceProposal, GovernanceResult } from '@/types';

/* ── Helpers ── */

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function quorumPct(p: GovernanceProposal): number {
  if (!p.quorum || p.quorum === 0) return -1; // no quorum set
  return Math.min((p.scoresTotal / p.quorum) * 100, 100);
}

function quorumLabel(p: GovernanceProposal): string {
  const pct = quorumPct(p);
  if (pct < 0) return 'No quorum';
  if (p.quorumReached) return 'Quorum ✓';
  return `${pct.toFixed(0)}% quorum`;
}

function quorumClass(p: GovernanceProposal): string {
  const pct = quorumPct(p);
  if (pct < 0) return 'gov-quorum-none';
  if (p.quorumReached) return 'gov-quorum-reached';
  if (pct >= 60) return 'gov-quorum-close';
  return 'gov-quorum-far';
}

function timeClass(p: GovernanceProposal): string {
  if (p.state !== 'active') return '';
  const end = new Date(p.endDate).getTime();
  const diff = end - Date.now();
  if (diff < 24 * 3600 * 1000) return 'gov-time-urgent';
  if (diff < 3 * 24 * 3600 * 1000) return 'gov-time-soon';
  return 'gov-time-ok';
}

function voteBarHtml(p: GovernanceProposal): string {
  if (!p.choices.length || !p.scores.length) return '';
  const total = p.scoresTotal || 1;
  // Find "For" and "Against" indices (common pattern), fall back to first two
  const forIdx = p.choices.findIndex(c => /^(for|yes|yae)$/i.test(c));
  const againstIdx = p.choices.findIndex(c => /^(against|no|nay)$/i.test(c));

  const forPct = forIdx >= 0 ? ((p.scores[forIdx] || 0) / total) * 100 : ((p.scores[0] || 0) / total) * 100;
  const againstPct = againstIdx >= 0 ? ((p.scores[againstIdx] || 0) / total) * 100 : (p.scores.length > 1 ? ((p.scores[1] || 0) / total) * 100 : 0);
  const otherPct = Math.max(0, 100 - forPct - againstPct);

  return `<div class="gov-vote-bar">
    <div class="gov-vote-for" style="width:${forPct.toFixed(1)}%" title="For: ${forPct.toFixed(1)}%"></div>
    <div class="gov-vote-against" style="width:${againstPct.toFixed(1)}%" title="Against: ${againstPct.toFixed(1)}%"></div>
    ${otherPct > 0.5 ? `<div class="gov-vote-other" style="width:${otherPct.toFixed(1)}%" title="Other: ${otherPct.toFixed(1)}%"></div>` : ''}
  </div>`;
}

function outcomeClass(p: GovernanceProposal): string {
  if (!p.result) return '';
  const r = p.result.toLowerCase();
  if (r === 'for' || r === 'yes' || r === 'yae') return 'gov-status-passed';
  if (r === 'against' || r === 'no' || r === 'nay') return 'gov-status-failed';
  return 'gov-status-passed'; // default to passed for other results
}

function outcomeLabel(p: GovernanceProposal): string {
  if (!p.result) return '-';
  const r = p.result.toLowerCase();
  if (r === 'against' || r === 'no' || r === 'nay') return '✗ Failed';
  return '✓ Passed';
}

/* ── Panel ── */

export class GovernancePanel extends Panel {
  private data: GovernanceResult | null = null;
  private showRecent = false;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({
      id: 'governance',
      title: 'Governance',
      showCount: true,
      infoTooltip: 'Active DAO proposals from Snapshot across major DeFi protocols',
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

  private async fetchData(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const res = await fetch('/api/governance', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;
    } catch (err) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private renderPanel(): void {
    if (this.loading) {
      this.showLoading('Loading governance data...');
      return;
    }
    if (this.error || !this.data) {
      this.showError(this.error || 'No data');
      return;
    }

    const d = this.data;
    if (d.unavailable) {
      this.setContent('<div class="panel-loading-text">Snapshot data temporarily unavailable</div>');
      return;
    }

    // Update count badge
    if (this.countEl) {
      this.countEl.textContent = String(d.summary.activeProposals);
    }

    const summaryHtml = `
      <div class="gov-summary">
        <div class="gov-summary-item">
          <span class="gov-summary-label">Active</span>
          <span class="gov-summary-value">${d.summary.activeProposals}</span>
        </div>
        <div class="gov-summary-item">
          <span class="gov-summary-label">DAOs</span>
          <span class="gov-summary-value">${d.summary.spacesTracked}</span>
        </div>
        <div class="gov-summary-item">
          <span class="gov-summary-label">Total Votes</span>
          <span class="gov-summary-value">${formatNumber(d.summary.totalVotesActive)}</span>
        </div>
        ${d.summary.highestParticipation.votes > 0 ? `
        <div class="gov-summary-item">
          <span class="gov-summary-label">Top DAO</span>
          <span class="gov-summary-value">${escapeHtml(d.summary.highestParticipation.space)}</span>
        </div>` : ''}
      </div>`;

    const activeHtml = d.active.length
      ? d.active.map(p => this.proposalCard(p)).join('')
      : '<div class="gov-empty">No active proposals right now</div>';

    const recentHtml = d.recent.length
      ? d.recent.map(p => this.proposalCard(p, true)).join('')
      : '<div class="gov-empty">No recent proposals</div>';

    const daoGridHtml = d.spaces.length
      ? d.spaces.map(s => `
        <div class="gov-dao-chip" title="${escapeHtml(s.name)}: ${s.activeCount} active, ${formatNumber(s.memberCount)} members">
          <span class="gov-dao-name">${escapeHtml(s.name)}</span>
          ${s.activeCount > 0 ? `<span class="gov-dao-badge">${s.activeCount}</span>` : ''}
        </div>
      `).join('')
      : '';

    const html = `
      <div class="gov-container">
        ${summaryHtml}

        <div class="gov-section">
          <div class="gov-section-title">Active Proposals</div>
          <div class="gov-proposals-list">${activeHtml}</div>
        </div>

        <div class="gov-section">
          <button class="gov-toggle-recent" data-gov-toggle>
            ${this.showRecent ? '▾' : '▸'} Recently Closed (${d.recent.length})
          </button>
          <div class="gov-proposals-list gov-recent-list" style="display:${this.showRecent ? 'block' : 'none'}">
            ${recentHtml}
          </div>
        </div>

        ${daoGridHtml ? `
        <div class="gov-section">
          <div class="gov-section-title">Tracked DAOs</div>
          <div class="gov-dao-grid">${daoGridHtml}</div>
        </div>` : ''}
      </div>`;

    this.setContent(html);
    this.attachListeners();
  }

  private proposalCard(p: GovernanceProposal, isClosed = false): string {
    const avatar = p.space.avatar
      ? `<img class="gov-space-avatar" src="${escapeHtml(p.space.avatar)}" alt="" data-hide-on-error>`
      : '';

    const titleTruncated = p.title.length > 80 ? p.title.slice(0, 77) + '…' : p.title;

    return `
      <a class="gov-proposal${isClosed ? ' gov-closed' : ''}" href="${escapeHtml(p.link)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(p.title)}">
        <div class="gov-proposal-header">
          <div class="gov-proposal-space">
            ${avatar}
            <span class="gov-space-name">${escapeHtml(p.space.name)}</span>
          </div>
          <div class="gov-proposal-meta">
            ${isClosed
              ? `<span class="gov-outcome ${outcomeClass(p)}">${outcomeLabel(p)}</span>`
              : `<span class="gov-time-left ${timeClass(p)}">${escapeHtml(p.timeLeft)}</span>`
            }
          </div>
        </div>
        <div class="gov-proposal-title">${escapeHtml(titleTruncated)}</div>
        ${voteBarHtml(p)}
        <div class="gov-proposal-footer">
          <span class="gov-votes">${formatNumber(p.votes)} votes</span>
          <span class="gov-quorum-badge ${quorumClass(p)}">${quorumLabel(p)}</span>
        </div>
      </a>`;
  }

  private attachListeners(): void {
    const toggle = this.content.querySelector('[data-gov-toggle]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        this.showRecent = !this.showRecent;
        const list = this.content.querySelector('.gov-recent-list') as HTMLElement | null;
        if (list) list.style.display = this.showRecent ? 'block' : 'none';
        toggle.textContent = `${this.showRecent ? '▾' : '▸'} Recently Closed (${this.data?.recent.length ?? 0})`;
      });
    }
  }
}
