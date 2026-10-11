/**
 * CountryIntelModal - Shows AI-generated intelligence brief when user clicks a country
 */
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import type { CountryScore } from '@/services/country-instability';
import type { PredictionMarket } from '@/types';

interface CountryIntelData {
  brief: string;
  country: string;
  code: string;
  cached?: boolean;
  generatedAt?: string;
  error?: string;
}

export interface StockIndexData {
  available: boolean;
  code: string;
  symbol: string;
  indexName: string;
  price: string;
  weekChangePercent: string;
  currency: string;
  cached?: boolean;
}

interface ActiveSignals {
  protests: number;
  trackedFlights: number;
  trackedVessels: number;
  outages: number;
  earthquakes: number;
}

export class CountryIntelModal {
  private overlay: HTMLElement;
  private contentEl: HTMLElement;
  private headerEl: HTMLElement;
  private onCloseCallback?: () => void;
  private onShareStory?: (code: string, name: string) => void;
  private currentCode: string | null = null;
  private currentName: string | null = null;
  private boundKeydownHandler: (e: KeyboardEvent) => void;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'country-analysis-overlay';
    this.overlay.innerHTML = `
      <div class="country-analysis-modal">
        <div class="country-analysis-header">
          <div class="country-analysis-title"></div>
          <button class="country-analysis-close">×</button>
        </div>
        <div class="country-analysis-content"></div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.headerEl = this.overlay.querySelector('.country-analysis-title')!;
    this.contentEl = this.overlay.querySelector('.country-analysis-content')!;

    this.overlay.querySelector('.country-analysis-close')?.addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('country-analysis-overlay')) this.hide();
    });
    this.boundKeydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.overlay.classList.contains('active')) this.hide();
    };
    document.addEventListener('keydown', this.boundKeydownHandler);
  }

  public destroy(): void {
    document.removeEventListener('keydown', this.boundKeydownHandler);
    this.overlay.remove();
  }

  private countryFlag(code: string): string {
    try {
      return code
        .toUpperCase()
        .split('')
        .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
        .join('');
    } catch {
      return '🌍';
    }
  }

  private levelBadge(level: string): string {
    const colors: Record<string, string> = {
      critical: '#ff4444',
      high: '#ff8800',
      elevated: '#ffaa00',
      normal: '#44aa44',
      low: '#3388ff',
    };
    const color = colors[level] || '#888';
    return `<span class="cri-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${level.toUpperCase()}</span>`;
  }

  private scoreBar(score: number): string {
    const pct = Math.min(100, Math.max(0, score));
    const color = pct >= 70 ? '#ff4444' : pct >= 50 ? '#ff8800' : pct >= 30 ? '#ffaa00' : '#44aa44';
    return `
      <div class="cri-score-bar">
        <div class="cri-score-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="cri-score-value">${score}/100</span>
    `;
  }

  public showLoading(): void {
    this.currentCode = '__loading__';
    this.headerEl.innerHTML = `
      <span class="country-flag">🌍</span>
      <span class="country-name">Identifying country...</span>
    `;
    this.contentEl.innerHTML = `
      <div class="intel-brief-section">
        <div class="intel-brief-loading">
          <div class="intel-skeleton"></div>
          <div class="intel-skeleton short"></div>
          <span class="intel-loading-text">Locating region...</span>
        </div>
      </div>
    `;
    this.overlay.classList.add('active');
  }

  public setShareStoryHandler(handler: (code: string, name: string) => void): void {
    this.onShareStory = handler;
  }

  public show(country: string, code: string, score: CountryScore | null, signals?: ActiveSignals): void {
    this.currentCode = code;
    this.currentName = country;
    const flag = this.countryFlag(code);
    this.headerEl.innerHTML = `
      <span class="country-flag">${flag}</span>
      <span class="country-name">${escapeHtml(country)}</span>
      ${score ? this.levelBadge(score.level) : ''}
      <button class="country-analysis-share-btn" title="Share story"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></button>
    `;
    this.headerEl.querySelector('.country-analysis-share-btn')?.addEventListener('click', () => {
      if (this.onShareStory && this.currentCode && this.currentName) {
        this.onShareStory(this.currentCode, this.currentName);
      }
    });

    // Show loading state + any immediate data
    let html = '';

    if (score) {
      html += `
        <div class="cri-section">
          <div class="cri-label">Risk Index ${this.scoreBar(score.score)}</div>
          <div class="cri-components">
            <span title="Governance">📢 ${score.components.unrest.toFixed(0)}</span>
            <span title="Exploits">⚔ ${score.components.conflict.toFixed(0)}</span>
            <span title="Security">🛡️ ${score.components.security.toFixed(0)}</span>
            <span title="Sentiment">📡 ${score.components.information.toFixed(0)}</span>
            <span class="cri-trend ${score.trend}">${score.trend === 'rising' ? '↗' : score.trend === 'falling' ? '↘' : '→'} ${score.trend}</span>
          </div>
        </div>
      `;
    }

    const chips: string[] = [];
    if (signals) {
      if (signals.protests > 0) chips.push(`<span class="signal-chip protest">📢 ${signals.protests} governance proposals</span>`);
      if (signals.trackedFlights > 0) chips.push(`<span class="signal-chip military">💸 ${signals.trackedFlights} whale txns</span>`);
      if (signals.trackedVessels > 0) chips.push(`<span class="signal-chip military">🔗 ${signals.trackedVessels} protocol exploits</span>`);
      if (signals.outages > 0) chips.push(`<span class="signal-chip outage">🌐 ${signals.outages} outages</span>`);
      if (signals.earthquakes > 0) chips.push(`<span class="signal-chip quake">🌍 ${signals.earthquakes} market events</span>`);
    }
    chips.push(`<span class="signal-chip stock-loading">📈 Loading index...</span>`);
    html += `<div class="active-signals">${chips.join('')}</div>`;

    html += `<div class="country-markets-section"><span class="intel-loading-text">Loading prediction markets...</span></div>`;

    html += `
      <div class="intel-brief-section">
        <div class="intel-brief-loading">
          <div class="intel-skeleton"></div>
          <div class="intel-skeleton short"></div>
          <div class="intel-skeleton"></div>
          <div class="intel-skeleton short"></div>
          <span class="intel-loading-text">Generating DeFi brief...</span>
        </div>
      </div>
    `;

    this.contentEl.innerHTML = html;
    this.overlay.classList.add('active');
  }

  public updateBrief(data: CountryIntelData & { skipped?: boolean; reason?: string; fallback?: boolean }): void {
    if (data.code !== this.currentCode) return;

    const briefSection = this.contentEl.querySelector('.intel-brief-section');
    if (!briefSection) return;

    if (data.error || data.skipped || !data.brief) {
      const msg = data.error || data.reason || 'AI brief unavailable - configure GROQ_API_KEY in Settings.';
      briefSection.innerHTML = `<div class="intel-error">${escapeHtml(msg)}</div>`;
      return;
    }

    // Convert markdown-like formatting to HTML
    const formatted = this.formatBrief(data.brief);

    briefSection.innerHTML = `
      <div class="intel-brief">${formatted}</div>
      <div class="intel-footer">
        ${data.cached ? '<span class="intel-cached">📋 Cached</span>' : '<span class="intel-fresh">✨ Fresh</span>'}
        <span class="intel-timestamp">${data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : ''}</span>
      </div>
    `;
  }

  public updateMarkets(markets: PredictionMarket[]): void {
    const section = this.contentEl.querySelector('.country-markets-section');
    if (!section) return;

    if (markets.length === 0) {
      section.innerHTML = '<span class="intel-loading-text" style="opacity:0.5">No prediction markets found</span>';
      return;
    }

    const items = markets.map(m => {
      const pct = Math.round(m.yesPrice);
      const noPct = 100 - pct;
      const vol = m.volume ? `$${(m.volume / 1000).toFixed(0)}k vol` : '';
      const safeUrl = sanitizeUrl(m.url || '');
      const link = safeUrl ? ` <a href="${safeUrl}" target="_blank" rel="noopener" class="market-link">↗</a>` : '';
      return `
        <div class="market-item">
          <div class="market-title">${escapeHtml(m.title.slice(0, 80))}${link}</div>
          <div class="market-bar">
            <div class="market-yes" style="width:${pct}%">${pct}%</div>
            <div class="market-no" style="width:${noPct}%">${noPct > 15 ? noPct + '%' : ''}</div>
          </div>
          ${vol ? `<div class="market-vol">${vol}</div>` : ''}
        </div>
      `;
    }).join('');

    section.innerHTML = `<div class="markets-label">📊 Prediction Markets</div>${items}`;
  }

  public updateStock(data: StockIndexData): void {
    const el = this.contentEl.querySelector('.stock-loading');
    if (!el) return;

    if (!data.available) {
      el.remove();
      return;
    }

    const pct = parseFloat(data.weekChangePercent);
    const sign = pct >= 0 ? '+' : '';
    const cls = pct >= 0 ? 'stock-up' : 'stock-down';
    const arrow = pct >= 0 ? '📈' : '📉';
    el.className = `signal-chip stock ${cls}`;
    el.innerHTML = `${arrow} ${escapeHtml(data.indexName)}: ${sign}${escapeHtml(data.weekChangePercent)}% (1W)`;
  }

  private formatBrief(text: string): string {
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  }

  public hide(): void {
    this.overlay.classList.remove('active');
    this.currentCode = null;
    this.onCloseCallback?.();
  }

  public onClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  public isVisible(): boolean {
    return this.overlay.classList.contains('active');
  }
}
