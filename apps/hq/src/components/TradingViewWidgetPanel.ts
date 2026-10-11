/**
 * TradingViewWidgetPanel - A single TradingView chart as a grid widget panel.
 *
 * This allows placing TradingView charts anywhere in the panels grid,
 * not just in the dedicated chart section at the top.
 * Each instance is independent with its own symbol + interval.
 */

import { Panel } from './Panel';

const KNOWN_EXCHANGES = [
  'BINANCE', 'GATEIO', 'COINBASE', 'KRAKEN', 'BYBIT', 'OKX',
  'BITFINEX', 'KUCOIN', 'BITSTAMP', 'GEMINI',
] as const;

const QUICK_SYMBOLS = [
  { label: 'BTC', symbol: 'BINANCE:BTCUSDT' },
  { label: 'ETH', symbol: 'BINANCE:ETHUSDT' },
  { label: 'SOL', symbol: 'BINANCE:SOLUSDT' },
  { label: 'SPA', symbol: 'GATEIO:SPAUSDT' },
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

const VALID_INTERVALS = new Set(INTERVALS.map(i => i.value));
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.:_-]{0,40}$/;
const STORAGE_PREFIX = 'hq-tv-widget-';

function sanitizeSymbol(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  if (!upper || !SYMBOL_PATTERN.test(upper)) return null;
  if (upper.includes(':')) {
    const [exchange, ticker] = upper.split(':');
    if (!exchange || !ticker) return null;
    if (!(KNOWN_EXCHANGES as readonly string[]).includes(exchange)) return null;
  }
  return upper;
}

export class TradingViewWidgetPanel extends Panel {
  private iframe: HTMLIFrameElement | null = null;
  private symbol: string;
  private interval: string;
  private instanceId: string;
  private toolbar: HTMLElement | null = null;

  constructor(instanceId: string, defaultSymbol = 'BINANCE:BTCUSDT', defaultInterval = 'D') {
    super({
      id: `tv-widget-${instanceId}`,
      title: `📈 Chart`,
      showCount: false,
      className: 'tv-widget-panel',
      trackActivity: false,
    });

    this.instanceId = instanceId;

    // Load saved state
    const saved = this.loadState();
    this.symbol = saved?.symbol || defaultSymbol;
    this.interval = saved?.interval || defaultInterval;

    this.buildToolbar();
    this.renderChart();
  }

  private loadState(): { symbol: string; interval: string } | null {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${this.instanceId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private saveState(): void {
    localStorage.setItem(
      `${STORAGE_PREFIX}${this.instanceId}`,
      JSON.stringify({ symbol: this.symbol, interval: this.interval })
    );
  }

  private buildToolbar(): void {
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'tvw-toolbar';

    // Symbol input
    const symbolInput = document.createElement('input');
    symbolInput.type = 'text';
    symbolInput.className = 'tvw-symbol-input';
    symbolInput.value = this.symbol;
    symbolInput.placeholder = 'BINANCE:BTCUSDT';
    symbolInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const s = sanitizeSymbol(symbolInput.value);
        if (s) {
          this.symbol = s;
          symbolInput.value = s;
          this.saveState();
          this.renderChart();
          this.updateTitle();
          this.updateActiveStates();
        } else {
          symbolInput.classList.add('tvw-input-error');
          setTimeout(() => symbolInput.classList.remove('tvw-input-error'), 400);
        }
      }
    });
    this.toolbar.appendChild(symbolInput);

    // Quick symbol buttons
    const symGroup = document.createElement('div');
    symGroup.className = 'tvw-btn-group';
    QUICK_SYMBOLS.forEach(({ label, symbol }) => {
      const btn = document.createElement('button');
      btn.className = 'tvw-btn';
      btn.textContent = label;
      btn.dataset.symbol = symbol;
      if (this.symbol === symbol) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.symbol = symbol;
        symbolInput.value = symbol;
        this.saveState();
        this.renderChart();
        this.updateTitle();
        this.updateActiveStates();
      });
      symGroup.appendChild(btn);
    });
    this.toolbar.appendChild(symGroup);

    // Interval buttons
    const intGroup = document.createElement('div');
    intGroup.className = 'tvw-btn-group';
    INTERVALS.forEach(({ label, value }) => {
      const btn = document.createElement('button');
      btn.className = 'tvw-btn tvw-int-btn';
      btn.textContent = label;
      btn.dataset.interval = value;
      if (this.interval === value) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.interval = value;
        this.saveState();
        this.renderChart();
        this.updateActiveStates();
      });
      intGroup.appendChild(btn);
    });
    this.toolbar.appendChild(intGroup);

    // Insert toolbar before content
    this.element.insertBefore(this.toolbar, this.content);
    this.updateTitle();
  }

  private updateTitle(): void {
    const titleEl = this.header.querySelector('.panel-title');
    if (titleEl) {
      // Show short symbol (ticker only, no exchange prefix)
      const short = this.symbol.includes(':') ? this.symbol.split(':')[1] : this.symbol;
      titleEl.textContent = `📈 ${short}`;
    }
  }

  private updateActiveStates(): void {
    if (!this.toolbar) return;
    this.toolbar.querySelectorAll('.tvw-btn[data-symbol]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.symbol === this.symbol);
    });
    this.toolbar.querySelectorAll('.tvw-int-btn[data-interval]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.interval === this.interval);
    });
  }

  private renderChart(): void {
    this.content.innerHTML = '';

    const embedDiv = document.createElement('div');
    embedDiv.className = 'tvw-chart-embed';

    this.iframe = document.createElement('iframe');
    this.iframe.src = `https://s.tradingview.com/widgetembed/?` +
      `symbol=${encodeURIComponent(this.symbol)}` +
      `&interval=${encodeURIComponent(this.interval)}` +
      `&hidesidetoolbar=1&hidetoptoolbar=1&symboledit=0` +
      `&saveimage=0&toolbarbg=0a0e14&theme=dark` +
      `&style=1&timezone=Etc%2FUTC&withdateranges=0` +
      `&locale=en&allow_symbol_change=0`;
    this.iframe.style.cssText = 'width:100%;height:100%;border:none;';
    this.iframe.setAttribute('loading', 'lazy');
    this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');

    embedDiv.appendChild(this.iframe);
    this.content.appendChild(embedDiv);
  }

  public setSymbol(symbol: string): void {
    const s = sanitizeSymbol(symbol);
    if (!s) return;
    this.symbol = s;
    this.saveState();
    this.renderChart();
    this.updateTitle();
    this.updateActiveStates();
    const input = this.toolbar?.querySelector('.tvw-symbol-input') as HTMLInputElement;
    if (input) input.value = s;
  }

  public setInterval(interval: string): void {
    if (!VALID_INTERVALS.has(interval)) return;
    this.interval = interval;
    this.saveState();
    this.renderChart();
    this.updateActiveStates();
  }

  public destroy(): void {
    this.iframe?.remove();
    this.iframe = null;
    this.toolbar?.remove();
    this.toolbar = null;
    super.destroy();
  }
}
