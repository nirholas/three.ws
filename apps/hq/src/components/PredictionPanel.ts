import { Panel } from './Panel';
import type { PredictionMarket } from '@/types';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

export class PredictionPanel extends Panel {
  constructor() {
    super({
      id: 'polymarket',
      title: 'Prediction Markets',
      infoTooltip: `<strong>Prediction Markets</strong>
        Real-money forecasting markets:
        <ul>
          <li>Prices reflect crowd probability estimates</li>
          <li>Higher volume = more reliable signal</li>
          <li>Geopolitical and current events focus</li>
        </ul>
        Source: Polymarket (polymarket.com)`,
    });
  }

  private formatVolume(volume?: number): string {
    if (!volume) return '';
    if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
    if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
    return `$${volume.toFixed(0)}`;
  }

  public renderPredictions(data: PredictionMarket[]): void {
    if (data.length === 0) {
      this.showError('Failed to load predictions');
      return;
    }

    const html = data
      .map((p) => {
        const yesPercent = Math.round(p.yesPrice);
        const noPercent = 100 - yesPercent;
        const volumeStr = this.formatVolume(p.volume);

        const safeUrl = sanitizeUrl(p.url || '');
        const titleHtml = safeUrl
          ? `<a href="${safeUrl}" target="_blank" rel="noopener" class="prediction-question prediction-link">${escapeHtml(p.title)}</a>`
          : `<div class="prediction-question">${escapeHtml(p.title)}</div>`;

        const detailJson = escapeHtml(JSON.stringify({ title: p.title, description: `Yes: ${yesPercent}%, No: ${noPercent}%`, category: 'prediction', url: p.url || '' }));

        return `
      <div class="prediction-item">
        <div style="display:flex;align-items:start;gap:4px">
          ${titleHtml}
          <button class="detail-open-btn" data-detail-event='${detailJson}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;margin-left:4px;opacity:0.6;flex-shrink:0" title="View details">ℹ</button>
        </div>
        ${volumeStr ? `<div class="prediction-volume">Vol: ${volumeStr}</div>` : ''}
        <div class="prediction-bar">
          <div class="prediction-yes" style="width: ${yesPercent}%">
            <span class="prediction-label">Yes ${yesPercent}%</span>
          </div>
          <div class="prediction-no" style="width: ${noPercent}%">
            <span class="prediction-label">No ${noPercent}%</span>
          </div>
        </div>
      </div>
    `;
      })
      .join('');

    this.setContent(html);
    this.bindDetailButtons();
  }

  private bindDetailButtons(): void {
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

  public destroy(): void {
    super.destroy();
  }
}
