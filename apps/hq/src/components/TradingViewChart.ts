/**
 * TradingViewChart - Multi-pane chart manager.
 *
 * Features:
 * - 1 / 2 / 4 / 8 chart grid layout
 * - Minimize to a slim bar, hide entirely, restore
 * - Each pane has its own symbol + interval
 * - Symbol picker, timeframe selector, layout picker
 * - Input sanitization
 * - Scoped DOM - no global getElementById
 * - Full cleanup on destroy
 */

export type ChartLayout = 1 | 2 | 4 | 8;

export interface TradingViewChartOptions {
  defaultSymbol?: string;
  defaultInterval?: string;
  height?: string;
}

/* ── Constants ────────────────────────────────────────────────────── */

const KNOWN_EXCHANGES = [
  'BINANCE', 'GATEIO', 'COINBASE', 'KRAKEN', 'BYBIT', 'OKX',
  'BITFINEX', 'FTX', 'KUCOIN', 'HUOBI', 'BITSTAMP', 'GEMINI',
] as const;

const QUICK_SYMBOLS = [
  { label: 'BTC', symbol: 'BINANCE:BTCUSDT' },
  { label: 'ETH', symbol: 'BINANCE:ETHUSDT' },
  { label: 'SOL', symbol: 'BINANCE:SOLUSDT' },
  { label: 'SPA', symbol: 'GATEIO:SPAUSDT' },
  { label: 'ARB', symbol: 'BINANCE:ARBUSDT' },
  { label: 'BNB', symbol: 'BINANCE:BNBUSDT' },
  { label: 'DOGE', symbol: 'BINANCE:DOGEUSDT' },
  { label: 'AVAX', symbol: 'BINANCE:AVAXUSDT' },
];

const DEFAULT_PANE_SYMBOLS = [
  'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'GATEIO:SPAUSDT',
  'BINANCE:ARBUSDT', 'BINANCE:BNBUSDT', 'BINANCE:DOGEUSDT', 'BINANCE:AVAXUSDT',
];

const INTERVALS = [
  { label: '1m', value: '1' },
  { label: '5m', value: '5' },
  { label: '15m', value: '15' },
  { label: '1H', value: '60' },
  { label: '4H', value: '240' },
  { label: '1D', value: 'D' },
  { label: '1W', value: 'W' },
];

const VALID_INTERVAL_VALUES = new Set(INTERVALS.map(i => i.value));

const STORAGE_KEY_SYMBOL = 'hq-tv-symbol';
const STORAGE_KEY_INTERVAL = 'hq-tv-interval';
const STORAGE_KEY_LAYOUT = 'hq-tv-layout';
const STORAGE_KEY_PANES = 'hq-tv-panes';
const STORAGE_KEY_MINIMIZED = 'hq-tv-minimized';

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.:_-]{0,40}$/;

/* ── Pane state ───────────────────────────────────────────────────── */

interface PaneState {
  symbol: string;
  interval: string;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function sanitizeSymbol(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  if (!upper || !SYMBOL_PATTERN.test(upper)) return null;
  if (upper.includes(':')) {
    const [exchange, ticker] = upper.split(':');
    if (!exchange || !ticker) return null;
    if (!(KNOWN_EXCHANGES as readonly string[]).includes(exchange)) return null;
    return `${exchange}:${ticker}`;
  }
  return upper;
}

function shortSymbol(full: string): string {
  const parts = full.split(':');
  const sym = parts[parts.length - 1] ?? '';
  return sym.replace(/USDT$/, '');
}

/* ── TradingViewChart ─────────────────────────────────────────────── */

export class TradingViewChart {
  private container: HTMLElement;
  private layout: ChartLayout;
  private panes: PaneState[];
  private activePaneIndex = 0;
  private iframes: (HTMLIFrameElement | null)[] = [];
  private abortController: AbortController | null = null;
  private minimized = false;

  // DOM refs
  private toolbar: HTMLElement | null = null;
  private gridEl: HTMLElement | null = null;
  private minimizedBar: HTMLElement | null = null;
  private externalControls: HTMLElement | null = null;

  constructor(container: HTMLElement, options?: TradingViewChartOptions) {
    this.container = container;

    // Restore layout
    const savedLayout = localStorage.getItem(STORAGE_KEY_LAYOUT);
    this.layout = ([1, 2, 4, 8] as ChartLayout[]).includes(Number(savedLayout) as ChartLayout)
      ? (Number(savedLayout) as ChartLayout)
      : 1;

    // Restore panes
    this.panes = this.loadPanes(options);

    // Restore minimized state
    this.minimized = localStorage.getItem(STORAGE_KEY_MINIMIZED) === 'true';

    this.render();
  }

  /* ── Persistence ──────────────────────────────────────────────── */

  private loadPanes(options?: TradingViewChartOptions): PaneState[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PANES);
      if (stored) {
        const parsed = JSON.parse(stored) as PaneState[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }

    // Legacy single-symbol migration
    const storedSymbol = localStorage.getItem(STORAGE_KEY_SYMBOL);
    const storedInterval = localStorage.getItem(STORAGE_KEY_INTERVAL);
    const sym = (storedSymbol && sanitizeSymbol(storedSymbol)) || options?.defaultSymbol || 'BINANCE:BTCUSDT';
    const intv = (storedInterval && VALID_INTERVAL_VALUES.has(storedInterval) ? storedInterval : null) || options?.defaultInterval || '15';

    // Create 8 default panes (only first N shown based on layout)
    return DEFAULT_PANE_SYMBOLS.map((s, i) => ({
      symbol: i === 0 ? sym : s,
      interval: intv,
    }));
  }

  private savePanes(): void {
    localStorage.setItem(STORAGE_KEY_PANES, JSON.stringify(this.panes));
    // Also save the active pane as legacy keys for backward compat
    const active = this.panes[this.activePaneIndex];
    if (active) {
      localStorage.setItem(STORAGE_KEY_SYMBOL, active.symbol);
      localStorage.setItem(STORAGE_KEY_INTERVAL, active.interval);
    }
  }

  private saveLayout(): void {
    localStorage.setItem(STORAGE_KEY_LAYOUT, String(this.layout));
  }

  private saveMinimized(): void {
    localStorage.setItem(STORAGE_KEY_MINIMIZED, String(this.minimized));
  }

  /* ── Render ───────────────────────────────────────────────────── */

  private render(): void {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Capture external chart controls (pin/hide/move) before clearing - they
    // live as a sibling in #chartSection on first render, but inside our
    // container on subsequent renders.  Holding a JS reference keeps them
    // alive even after innerHTML = '' removes them from the DOM.
    if (!this.externalControls) {
      this.externalControls = this.container
        .closest('.chart-section')
        ?.querySelector('#chartControls') as HTMLElement | null;
    }

    this.container.innerHTML = '';
    this.container.classList.add('tv-chart-wrapper');

    // --- Minimized bar (shown only when minimized) ---
    this.minimizedBar = document.createElement('div');
    this.minimizedBar.className = 'tv-minimized-bar';
    this.minimizedBar.style.display = this.minimized ? 'flex' : 'none';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'tv-minimized-restore';
    restoreBtn.textContent = `▲ Chart - ${shortSymbol(this.panes[0]?.symbol || 'BTC')}`;
    restoreBtn.title = 'Restore chart';
    restoreBtn.addEventListener('click', () => this.setMinimized(false), { signal });
    this.minimizedBar.appendChild(restoreBtn);
    this.container.appendChild(this.minimizedBar);

    // --- Toolbar ---
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'tv-toolbar';
    this.toolbar.style.display = this.minimized ? 'none' : '';
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Chart controls');
    this.renderToolbar(signal);
    this.container.appendChild(this.toolbar);

    // --- Chart grid ---
    this.gridEl = document.createElement('div');
    this.gridEl.className = `tv-chart-grid tv-layout-${this.layout}`;
    this.gridEl.style.display = this.minimized ? 'none' : '';
    this.container.appendChild(this.gridEl);

    this.renderPanes();
  }

  private renderToolbar(signal: AbortSignal): void {
    if (!this.toolbar) return;
    this.toolbar.innerHTML = '';

    /* ─ Left: symbol group for active pane ─ */
    const symbolGroup = document.createElement('div');
    symbolGroup.className = 'tv-symbol-group';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tv-symbol-input';
    input.placeholder = 'Symbol…';
    input.value = shortSymbol(this.panes[this.activePaneIndex]?.symbol || 'BTC');
    input.setAttribute('aria-label', 'Trading pair symbol');
    input.setAttribute('maxlength', '20');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = input.value.trim().toUpperCase();
        if (!val) return;
        const match = QUICK_SYMBOLS.find(s => s.label === val);
        if (match) {
          this.setPaneSymbol(this.activePaneIndex, match.symbol);
          return;
        }
        const sanitized = sanitizeSymbol(val) || sanitizeSymbol(`BINANCE:${val}USDT`);
        if (sanitized) {
          this.setPaneSymbol(this.activePaneIndex, sanitized);
        } else {
          input.classList.add('tv-input-error');
          setTimeout(() => input.classList.remove('tv-input-error'), 1000);
        }
      }
    }, { signal });
    symbolGroup.appendChild(input);

    QUICK_SYMBOLS.forEach(({ label, symbol }) => {
      const btn = document.createElement('button');
      const activeSymbol = this.panes[this.activePaneIndex]?.symbol;
      btn.className = 'tv-quick-btn' + (symbol === activeSymbol ? ' active' : '');
      btn.textContent = label;
      btn.setAttribute('aria-pressed', String(symbol === activeSymbol));
      btn.addEventListener('click', () => this.setPaneSymbol(this.activePaneIndex, symbol), { signal });
      symbolGroup.appendChild(btn);
    });
    this.toolbar.appendChild(symbolGroup);

    /* ─ Center: interval group ─ */
    const intervalGroup = document.createElement('div');
    intervalGroup.className = 'tv-interval-group';
    const activeInterval = this.panes[this.activePaneIndex]?.interval || '15';
    INTERVALS.forEach(({ label, value }) => {
      const btn = document.createElement('button');
      btn.className = 'tv-interval-btn' + (value === activeInterval ? ' active' : '');
      btn.textContent = label;
      btn.setAttribute('aria-pressed', String(value === activeInterval));
      btn.addEventListener('click', () => this.setPaneInterval(this.activePaneIndex, value), { signal });
      intervalGroup.appendChild(btn);
    });
    this.toolbar.appendChild(intervalGroup);

    /* ─ Right: layout picker + minimize ─ */
    const controlsGroup = document.createElement('div');
    controlsGroup.className = 'tv-controls-group';

    // Layout picker
    ([1, 2, 4, 8] as ChartLayout[]).forEach(n => {
      const btn = document.createElement('button');
      btn.className = 'tv-layout-btn' + (this.layout === n ? ' active' : '');
      btn.textContent = n === 1 ? '▣' : n === 2 ? '◫' : n === 4 ? '⊞' : '⊞⊞';
      btn.title = `${n} chart${n > 1 ? 's' : ''}`;
      btn.setAttribute('aria-pressed', String(this.layout === n));
      btn.addEventListener('click', () => this.setLayout(n), { signal });
      controlsGroup.appendChild(btn);
    });

    // Minimize button
    const minBtn = document.createElement('button');
    minBtn.className = 'tv-minimize-btn';
    minBtn.textContent = '▼';
    minBtn.title = 'Minimize chart';
    minBtn.addEventListener('click', () => this.setMinimized(true), { signal });
    controlsGroup.appendChild(minBtn);

    // Adopt external chart-section controls (move / pin / hide) into toolbar
    if (this.externalControls) {
      controlsGroup.appendChild(this.externalControls);
    }

    this.toolbar.appendChild(controlsGroup);
  }

  private renderPanes(): void {
    if (!this.gridEl) return;

    // Destroy existing iframes
    this.iframes.forEach(iframe => {
      if (iframe) { iframe.src = 'about:blank'; iframe.remove(); }
    });
    this.iframes = [];
    this.gridEl.innerHTML = '';

    const count = this.layout;
    for (let i = 0; i < count; i++) {
      const pane = this.panes[i];
      if (!pane) continue;

      const cell = document.createElement('div');
      cell.className = 'tv-pane' + (i === this.activePaneIndex ? ' tv-pane-active' : '');
      cell.dataset.paneIndex = String(i);

      // Click to make active (for toolbar symbol/interval controls)
      cell.addEventListener('click', () => {
        if (this.activePaneIndex !== i) {
          this.activePaneIndex = i;
          this.gridEl?.querySelectorAll('.tv-pane').forEach((el, idx) => {
            el.classList.toggle('tv-pane-active', idx === i);
          });
          // Re-render toolbar for new active pane
          if (this.abortController) {
            this.renderToolbar(this.abortController.signal);
          }
        }
      });

      // Pane label (only in multi-pane mode)
      if (count > 1) {
        const label = document.createElement('div');
        label.className = 'tv-pane-label';
        label.textContent = shortSymbol(pane.symbol);
        cell.appendChild(label);
      }

      // iframe
      const embedDiv = document.createElement('div');
      embedDiv.className = 'tv-chart-embed';

      const loader = document.createElement('div');
      loader.className = 'tv-loading';
      loader.textContent = 'Loading chart…';
      embedDiv.appendChild(loader);

      const iframe = this.createIframe(pane, count > 4);
      iframe.addEventListener('load', () => loader.remove(), { once: true });
      embedDiv.appendChild(iframe);
      this.iframes.push(iframe);

      cell.appendChild(embedDiv);
      this.gridEl.appendChild(cell);
    }
  }

  private createIframe(pane: PaneState, compact: boolean): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    const params = new URLSearchParams({
      symbol: pane.symbol,
      interval: pane.interval,
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbar_bg: '#0a0e14',
      enable_publishing: 'false',
      hide_side_toolbar: compact ? 'true' : 'false',
      allow_symbol_change: 'true',
      save_image: 'false',
      hide_volume: compact ? 'true' : 'false',
      backgroundColor: 'rgba(10, 14, 20, 1)',
      gridColor: 'rgba(30, 40, 55, 0.5)',
      withdateranges: compact ? 'false' : 'true',
      details: compact ? 'false' : 'true',
      hotlist: compact ? 'false' : 'true',
      calendar: 'false',
    });

    iframe.src = `https://s.tradingview.com/widgetembed/?${params.toString()}`;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms');
    iframe.setAttribute('title', `TradingView chart - ${shortSymbol(pane.symbol)}`);
    return iframe;
  }

  /* ── Public API ───────────────────────────────────────────────── */

  /** Change the active pane's symbol */
  public setSymbol(symbol: string): void {
    this.setPaneSymbol(this.activePaneIndex, symbol);
  }

  /** Change the active pane's interval */
  public setInterval(interval: string): void {
    this.setPaneInterval(this.activePaneIndex, interval);
  }

  /** Switch layout (1, 2, 4, or 8 charts) */
  public setLayout(layout: ChartLayout): void {
    if (this.layout === layout) return;
    this.layout = layout;
    this.saveLayout();
    // Ensure active pane is in range
    if (this.activePaneIndex >= layout) this.activePaneIndex = 0;
    // Re-render grid + toolbar
    if (this.gridEl) {
      this.gridEl.className = `tv-chart-grid tv-layout-${layout}`;
      this.renderPanes();
    }
    // Update layout button active states
    this.container.querySelectorAll('.tv-layout-btn').forEach((btn, idx) => {
      const n = [1, 2, 4, 8][idx];
      btn.classList.toggle('active', n === layout);
      btn.setAttribute('aria-pressed', String(n === layout));
    });
  }

  /** Minimize chart to a slim bar */
  public setMinimized(min: boolean): void {
    this.minimized = min;
    this.saveMinimized();
    if (this.minimizedBar) this.minimizedBar.style.display = min ? 'flex' : 'none';
    if (this.toolbar) this.toolbar.style.display = min ? 'none' : '';
    if (this.gridEl) this.gridEl.style.display = min ? 'none' : '';

    // Update the minimized bar text
    if (this.minimizedBar && min) {
      const restore = this.minimizedBar.querySelector('.tv-minimized-restore');
      if (restore) {
        const symbols = this.panes.slice(0, this.layout).map(p => shortSymbol(p.symbol)).join(' · ');
        restore.textContent = `▲ Chart - ${symbols}`;
      }
    }

    // Notify parent (chart-section) to adjust height
    this.container.closest('.chart-section')?.classList.toggle('chart-minimized', min);
  }

  /** Check if chart is minimized */
  public isMinimized(): boolean {
    return this.minimized;
  }

  /** Get current layout */
  public getLayout(): ChartLayout {
    return this.layout;
  }

  public destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.iframes.forEach(iframe => {
      if (iframe) { iframe.src = 'about:blank'; }
    });
    this.iframes = [];
    this.toolbar = null;
    this.gridEl = null;
    this.minimizedBar = null;
    this.container.innerHTML = '';
  }

  /* ── Private ──────────────────────────────────────────────────── */

  private setPaneSymbol(index: number, symbol: string): void {
    const sanitized = sanitizeSymbol(symbol);
    if (!sanitized || !this.panes[index]) return;
    this.panes[index].symbol = sanitized;
    this.savePanes();
    // Re-render just this pane's iframe
    this.reloadPane(index);
    // Update toolbar if this is the active pane
    if (index === this.activePaneIndex && this.abortController) {
      this.renderToolbar(this.abortController.signal);
    }
  }

  private setPaneInterval(index: number, interval: string): void {
    if (!VALID_INTERVAL_VALUES.has(interval) || !this.panes[index]) return;
    this.panes[index].interval = interval;
    this.savePanes();
    this.reloadPane(index);
    if (index === this.activePaneIndex && this.abortController) {
      this.renderToolbar(this.abortController.signal);
    }
  }

  private reloadPane(index: number): void {
    const pane = this.panes[index];
    const old = this.iframes[index];
    if (!pane || !old || !this.gridEl) return;

    const cell = this.gridEl.children[index] as HTMLElement | undefined;
    if (!cell) return;

    const embedDiv = cell.querySelector('.tv-chart-embed');
    if (!embedDiv) return;

    old.src = 'about:blank';
    old.remove();

    const loader = document.createElement('div');
    loader.className = 'tv-loading';
    loader.textContent = 'Loading chart…';
    embedDiv.appendChild(loader);

    const iframe = this.createIframe(pane, this.layout > 4);
    iframe.addEventListener('load', () => loader.remove(), { once: true });
    embedDiv.appendChild(iframe);
    this.iframes[index] = iframe;

    // Update pane label
    const label = cell.querySelector('.tv-pane-label');
    if (label) label.textContent = shortSymbol(pane.symbol);
  }
}
