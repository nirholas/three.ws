import type { CorrelationSignal } from '@/services/correlation';
import type { UnifiedAlert } from '@/services/cross-module-integration';
import { suppressTrendingTerm } from '@/services/trending-keywords';
import { escapeHtml } from '@/utils/sanitize';
import { getSignalContext, type SignalType } from '@/utils/analysis-constants';

export class SignalModal {
  private element: HTMLElement;
  private currentSignals: CorrelationSignal[] = [];
  private audioEnabled = true;
  private audio: HTMLAudioElement | null = null;
  private onLocationClick?: (lat: number, lon: number) => void;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'signal-modal-overlay';
    this.element.innerHTML = `
      <div class="signal-modal">
        <div class="signal-modal-header">
          <span class="signal-modal-title">🎯 INTELLIGENCE FINDING</span>
          <button class="signal-modal-close">×</button>
        </div>
        <div class="signal-modal-content"></div>
        <div class="signal-modal-footer">
          <label class="signal-audio-toggle">
            <input type="checkbox" checked>
            <span>Sound alerts</span>
          </label>
          <button class="signal-dismiss-btn">Dismiss</button>
        </div>
      </div>
    `;

    // Disabled - popup no longer used
  }

  /* @ts-expect-error disabled */
  private initAudio(): void {
    this.audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleQYjfKapmWswEjCJvuPQfSoXZZ+3qqBJESSP0unGaxMJVYiytrFeLhR6p8znrFUXRW+bs7V3Qx1hn8Xjp1cYPnegprhkMCFmoLi1k0sZTYGlqqlUIA==');
    this.audio.volume = 0.3;
  }

  /* @ts-expect-error disabled */
  private setupEventListeners(): void {
    this.element.querySelector('.signal-modal-close')?.addEventListener('click', () => {
      this.hide();
    });

    this.element.querySelector('.signal-dismiss-btn')?.addEventListener('click', () => {
      this.hide();
    });

    this.element.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('signal-modal-overlay')) {
        this.hide();
      }
    });

    const checkbox = this.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox?.addEventListener('change', () => {
      this.audioEnabled = checkbox.checked;
    });

    // Delegate click handler for location links
    this.element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('location-link')) {
        const lat = parseFloat(target.dataset.lat || '0');
        const lon = parseFloat(target.dataset.lon || '0');
        if (this.onLocationClick && !isNaN(lat) && !isNaN(lon)) {
          this.onLocationClick(lat, lon);
          this.hide();
        }
        return;
      }

      if (target.classList.contains('suppress-keyword-btn')) {
        const term = (target.dataset.term || '').trim();
        if (!term) return;
        suppressTrendingTerm(term);
        this.currentSignals = this.currentSignals.filter(signal => {
          const signalTerm = (signal.data as Record<string, unknown>).term;
          return typeof signalTerm !== 'string' || signalTerm.toLowerCase() !== term.toLowerCase();
        });
        this.renderSignals();
      }
    });
  }

  public setLocationClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onLocationClick = handler;
  }

  public show(_signals: CorrelationSignal[]): void {
    return; // disabled
  }

  public showSignal(_signal: CorrelationSignal): void {
    return; // disabled
    this.currentSignals = [_signal];
    this.renderSignals();
    this.element.classList.add('active');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public showAlert(_alert: UnifiedAlert): void {
    // disabled
  }

  public playSound(): void {
    if (this.audioEnabled && this.audio) {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
    }
  }

  public hide(): void {
    this.element.classList.remove('active');
  }

  private renderSignals(): void {
    const content = this.element.querySelector('.signal-modal-content')!;

    const signalTypeLabels: Record<string, string> = {
      'prediction_leads_news': '🔮 Prediction Leading',
      'news_leads_markets': '📰 News Leading',
      'silent_divergence': '🔇 Silent Divergence',
      'velocity_spike': '🔥 Velocity Spike',
      'keyword_spike': '📊 Keyword Spike',
      'convergence': '◉ Convergence',
      'triangulation': '△ Triangulation',
      'flow_drop': '🛢️ Flow Drop',
      'flow_price_divergence': '📈 Flow/Price Divergence',
      'geo_convergence': '🌐 Geographic Convergence',
      'explained_market_move': '✓ Market Move Explained',
      'sector_cascade': '📊 Sector Cascade',
      'military_surge': '🛩️ Whale Surge',
    };

    const html = this.currentSignals.map(signal => {
      const context = getSignalContext(signal.type as SignalType);
      // Military surge signals have additional properties in data
      const data = signal.data as Record<string, unknown>;
      const newsCorrelation = data?.newsCorrelation as string | null;
      const focalPoints = data?.focalPointContext as string[] | null;
      const locationData = { lat: data?.lat as number | undefined, lon: data?.lon as number | undefined, regionName: data?.regionName as string | undefined };

      return `
        <div class="signal-item ${escapeHtml(signal.type)}">
          <div class="signal-type">${signalTypeLabels[signal.type] || escapeHtml(signal.type)}</div>
          <div class="signal-title">${escapeHtml(signal.title)}</div>
          <div class="signal-description">${escapeHtml(signal.description)}</div>
          <div class="signal-meta">
            <span class="signal-confidence">Confidence: ${Math.round(signal.confidence * 100)}%</span>
            <span class="signal-time">${this.formatTime(signal.timestamp)}</span>
          </div>
          ${signal.data.explanation ? `
            <div class="signal-explanation">${escapeHtml(signal.data.explanation)}</div>
          ` : ''}
          ${focalPoints && focalPoints.length > 0 ? `
            <div class="signal-focal-points">
              <div class="focal-points-header">📡 CORRELATED FOCAL POINTS</div>
              ${focalPoints.map(fp => `<div class="focal-point-item">${escapeHtml(fp)}</div>`).join('')}
            </div>
          ` : ''}
          ${newsCorrelation ? `
            <div class="signal-news-correlation">
              <div class="news-correlation-header">📰 NEWS CORRELATION</div>
              <pre class="news-correlation-text">${escapeHtml(newsCorrelation)}</pre>
            </div>
          ` : ''}
          ${locationData.lat && locationData.lon ? `
            <div class="signal-location">
              <button class="location-link" data-lat="${locationData.lat}" data-lon="${locationData.lon}">
                📍 View on map: ${locationData.regionName || `${locationData.lat.toFixed(2)}°, ${locationData.lon.toFixed(2)}°`}
              </button>
            </div>
          ` : ''}
          <div class="signal-context">
            <div class="signal-context-item why-matters">
              <span class="context-label">Why it matters:</span>
              <span class="context-value">${escapeHtml(context.whyItMatters)}</span>
            </div>
            <div class="signal-context-item actionable">
              <span class="context-label">Action:</span>
              <span class="context-value">${escapeHtml(context.actionableInsight)}</span>
            </div>
            <div class="signal-context-item confidence-note">
              <span class="context-label">Note:</span>
              <span class="context-value">${escapeHtml(context.confidenceNote)}</span>
            </div>
          </div>
          ${signal.data.relatedTopics?.length ? `
            <div class="signal-topics">
              ${signal.data.relatedTopics.map(t => `<span class="signal-topic">${escapeHtml(t)}</span>`).join('')}
            </div>
          ` : ''}
          ${signal.type === 'keyword_spike' && typeof data?.term === 'string' ? `
            <div class="signal-actions">
              <button class="suppress-keyword-btn" data-term="${escapeHtml(data.term)}">Suppress this term</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    content.innerHTML = html;
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  public getElement(): HTMLElement {
    return this.element;
  }
}
