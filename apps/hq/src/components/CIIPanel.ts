import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { calculateRiskScores, type CountryScore } from '@/services/country-instability';

export class CIIPanel extends Panel {
  private scores: CountryScore[] = [];
  private focalPointsReady = false;
  private onShareStory?: (code: string, name: string) => void;

  constructor() {
    super({
      id: 'cri',
      title: 'Country Risk Index',
      showCount: true,
      trackActivity: true,
      infoTooltip: `<strong>PRI Methodology</strong>
        Score (0-100) per protocol based on:
        <ul>
          <li>40% baseline smart contract risk</li>
          <li><strong>G</strong>overnance: TVL changes, withdrawal spikes</li>
          <li><strong>S</strong>ecurity: audit status, exploit history</li>
          <li>Se<strong>n</strong>timent: news velocity and social sentiment</li>
          <li>Whale activity proximity boost</li>
        </ul>
        <em>G:E:S:N values show component scores.</em>
        On-chain analysis correlates transaction patterns with news signals for accurate scoring.`,
    });
    this.showLoading('Scanning DeFi protocols');
  }

  public setShareStoryHandler(handler: (code: string, name: string) => void): void {
    this.onShareStory = handler;
  }

  private getLevelColor(level: CountryScore['level']): string {
    switch (level) {
      case 'critical': return '#ff4444';
      case 'high': return '#ff8800';
      case 'elevated': return '#ffaa00';
      case 'normal': return '#88aa44';
      case 'low': return '#22aa88';
    }
  }

  private getLevelEmoji(level: CountryScore['level']): string {
    switch (level) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'elevated': return '🟡';
      case 'normal': return '🟢';
      case 'low': return '⚪';
    }
  }

  private getTrendArrow(trend: CountryScore['trend'], change: number): string {
    if (trend === 'rising') return `<span class="trend-up">↑${change > 0 ? change : ''}</span>`;
    if (trend === 'falling') return `<span class="trend-down">↓${Math.abs(change)}</span>`;
    return '<span class="trend-stable">→</span>';
  }

  private renderCountry(country: CountryScore): string {
    const barWidth = country.score;
    const color = this.getLevelColor(country.level);
    const emoji = this.getLevelEmoji(country.level);
    const trend = this.getTrendArrow(country.trend, country.change24h);

    return `
      <div class="cri-country" data-code="${escapeHtml(country.code)}">
        <div class="cri-header">
          <span class="cri-emoji">${emoji}</span>
          <span class="cri-name">${escapeHtml(country.name)}</span>
          <span class="cri-score">${country.score}</span>
          ${trend}
          <button class="cri-share-btn" data-code="${escapeHtml(country.code)}" data-name="${escapeHtml(country.name)}" title="Share story"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></button>
          <button class="detail-open-btn" data-detail-event='${escapeHtml(JSON.stringify({ title: country.name + ' Risk Index', description: 'Score: ' + country.score + '/100 (' + country.level + ') \u2022 G:' + country.components.unrest + ' E:' + country.components.conflict + ' S:' + country.components.security + ' N:' + country.components.information, category: 'risk-index' }))}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.6" title="View details">ℹ</button>
        </div>
        <div class="cri-bar-container">
          <div class="cri-bar" style="width: ${barWidth}%; background: ${color};"></div>
        </div>
        <div class="cri-components">
          <span title="Governance">G:${country.components.unrest}</span>
          <span title="Exploits">E:${country.components.conflict}</span>
          <span title="Security">S:${country.components.security}</span>
          <span title="Sentiment">N:${country.components.information}</span>
        </div>
      </div>
    `;
  }

  private bindShareButtons(): void {
    if (!this.onShareStory) return;
    this.content.querySelectorAll('.cri-share-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        const code = el.dataset.code || '';
        const name = el.dataset.name || '';
        if (code && name) this.onShareStory!(code, name);
      });
    });

    // Delegated click handler for detail:open buttons
    this.content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.detail-open-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const data = JSON.parse(btn.getAttribute('data-detail-event') || '{}');
        window.dispatchEvent(new CustomEvent('detail:open', { detail: { type: 'event', data } }));
      } catch { /* ignore parse errors */ }
    });
  }

  public async refresh(forceLocal = false): Promise<void> {
    if (!this.focalPointsReady && !forceLocal) {
      return;
    }

    if (forceLocal) {
      this.focalPointsReady = true;
    }

    this.showLoading();

    try {
      const localScores = calculateRiskScores();
      this.scores = localScores;

      const withData = this.scores.filter(s => s.score > 0);
      this.setCount(withData.length);

      if (withData.length === 0) {
        this.content.innerHTML = '<div class="empty-state">No risk signals detected</div>';
        return;
      }

      const html = withData.map(s => this.renderCountry(s)).join('');
      this.content.innerHTML = `<div class="cri-list">${html}</div>`;
      this.bindShareButtons();
    } catch (error) {
      console.error('[CIIPanel] Refresh error:', error);
      this.showError('Failed to calculate risk scores');
    }
  }

  public getScores(): CountryScore[] {
    return this.scores;
  }

  public destroy(): void {
    super.destroy();
  }
}
