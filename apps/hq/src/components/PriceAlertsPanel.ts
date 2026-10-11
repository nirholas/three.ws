import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

// =============================================================================
// Types
// =============================================================================

interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: 'above' | 'below';
  enabled: boolean;
  triggered: boolean;
  currentPrice: number | null;
  createdAt: string;
}

interface CoinGeckoPrice {
  [coinId: string]: { usd: number };
}

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'hq-price-alerts';
const CHECK_INTERVAL = 60_000; // 1 minute

// Simple mapping of common symbols to CoinGecko IDs
const SYMBOL_TO_COINGECKO: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', DOT: 'polkadot',
  AVAX: 'avalanche-2', MATIC: 'matic-network', LINK: 'chainlink',
  UNI: 'uniswap', AAVE: 'aave', CRV: 'curve-dao-token', LDO: 'lido-dao',
  ARB: 'arbitrum', OP: 'optimism', ATOM: 'cosmos', NEAR: 'near',
  FTM: 'fantom', APT: 'aptos', SUI: 'sui', SEI: 'sei-network',
  INJ: 'injective-protocol', TIA: 'celestia', STX: 'blockstack',
  PEPE: 'pepe', SHIB: 'shiba-inu', WIF: 'dogwifcoin',
  MKR: 'maker', COMP: 'compound-governance-token', SNX: 'havven',
  USDT: 'tether', USDC: 'usd-coin', DAI: 'dai',
  RENDER: 'render-token', FET: 'fetch-ai', ONDO: 'ondo-finance',
};

// =============================================================================
// Helpers
// =============================================================================

function loadAlerts(): PriceAlert[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PriceAlert[]) : [];
  } catch {
    return [];
  }
}

function saveAlerts(alerts: PriceAlert[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
}

function formatPrice(price: number): string {
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  return price.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

// =============================================================================
// PriceAlertsPanel
// =============================================================================

export class PriceAlertsPanel extends Panel {
  private alerts: PriceAlert[] = [];
  private showForm = false;
  private formSymbol = '';
  private formPrice = '';
  private formCondition: 'above' | 'below' = 'above';
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'price-alerts', title: 'Price Alerts', showCount: true });
    this.alerts = loadAlerts();
    this.render();
    void this.checkPrices();
    this.checkTimer = setInterval(() => this.checkPrices(), CHECK_INTERVAL);
  }

  public destroy(): void {
    super.destroy();
    if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = null; }
  }

  // ---- Price checking ----

  private async checkPrices(): Promise<void> {
    const enabledAlerts = this.alerts.filter(a => a.enabled && !a.triggered);
    if (enabledAlerts.length === 0) return;

    // Collect unique symbols and their CoinGecko IDs
    const symbolSet = new Set(enabledAlerts.map(a => a.symbol));
    const coinIds: string[] = [];
    const symbolToId: Record<string, string> = {};

    for (const sym of symbolSet) {
      const id = SYMBOL_TO_COINGECKO[sym] || sym.toLowerCase();
      coinIds.push(id);
      symbolToId[sym] = id;
    }

    try {
      const idsParam = coinIds.join(',');
      const res = await fetch(`/api/coingecko?endpoint=simple/price&ids=${encodeURIComponent(idsParam)}&vs_currencies=usd`);
      if (!res.ok) return;

      const prices: CoinGeckoPrice = await res.json();
      let changed = false;

      for (const alert of this.alerts) {
        const id = symbolToId[alert.symbol];
        if (!id) continue;
        const priceData = prices[id];
        if (!priceData) continue;

        alert.currentPrice = priceData.usd;

        if (alert.enabled && !alert.triggered) {
          const met = alert.condition === 'above'
            ? priceData.usd >= alert.targetPrice
            : priceData.usd <= alert.targetPrice;
          if (met) {
            alert.triggered = true;
            changed = true;
          }
        }
      }

      if (changed) {
        saveAlerts(this.alerts);
      }
      this.render();
    } catch {
      // silently fail on price check
    }
  }

  // ---- Alert operations ----

  private addAlert(): void {
    const symbol = this.formSymbol.trim().toUpperCase();
    const price = parseFloat(this.formPrice);
    if (!symbol || !price || price <= 0) return;

    const alert: PriceAlert = {
      id: crypto.randomUUID(),
      symbol,
      targetPrice: price,
      condition: this.formCondition,
      enabled: true,
      triggered: false,
      currentPrice: null,
      createdAt: new Date().toISOString(),
    };

    this.alerts.push(alert);
    saveAlerts(this.alerts);
    this.formSymbol = '';
    this.formPrice = '';
    this.showForm = false;
    this.render();
    void this.checkPrices();
  }

  private removeAlert(id: string): void {
    this.alerts = this.alerts.filter(a => a.id !== id);
    saveAlerts(this.alerts);
    this.render();
  }

  private toggleAlert(id: string, enabled: boolean): void {
    const alert = this.alerts.find(a => a.id === id);
    if (alert) {
      alert.enabled = enabled;
      if (enabled) alert.triggered = false; // re-arm
      saveAlerts(this.alerts);
      this.render();
    }
  }

  // ---- Render ----

  private render(): void {
    const triggeredCount = this.alerts.filter(a => a.triggered).length;
    this.setCount(this.alerts.length);
    if (triggeredCount > 0) {
      this.setNewBadge(triggeredCount, true);
    } else {
      this.clearNewBadge();
    }

    const formHtml = this.showForm ? `
      <div class="pa-form">
        <input class="pa-input" type="text" placeholder="Symbol (e.g. BTC, ETH)" id="pa-symbol" value="${escapeHtml(this.formSymbol)}" />
        <div class="pa-form-row">
          <div class="pa-price-wrap">
            <span class="pa-price-prefix">$</span>
            <input class="pa-input pa-input-price" type="number" placeholder="Target price" id="pa-price" min="0" step="0.01" value="${escapeHtml(this.formPrice)}" />
          </div>
          <div class="pa-condition-toggle">
            <button class="pa-cond-btn${this.formCondition === 'above' ? ' active' : ''}" data-cond="above">Above</button>
            <button class="pa-cond-btn${this.formCondition === 'below' ? ' active' : ''}" data-cond="below">Below</button>
          </div>
        </div>
        <button class="pa-submit-btn" id="pa-submit">Create Alert</button>
      </div>
    ` : '';

    const alertRows = this.alerts.map(alert => {
      const isAbove = alert.condition === 'above';
      return `
        <div class="pa-alert-row${alert.triggered ? ' pa-triggered' : ''}${!alert.enabled ? ' pa-disabled' : ''}">
          <div class="pa-alert-left">
            <span class="pa-alert-icon">${alert.triggered ? '🔔' : alert.enabled ? '🔔' : '🔕'}</span>
            <span class="pa-alert-symbol">${escapeHtml(alert.symbol)}</span>
            <span class="pa-alert-cond ${isAbove ? 'pa-cond-above' : 'pa-cond-below'}">
              ${isAbove ? '↑' : '↓'} ${isAbove ? 'Above' : 'Below'}
            </span>
            <span class="pa-alert-target">$${formatPrice(alert.targetPrice)}</span>
          </div>
          <div class="pa-alert-right">
            ${alert.currentPrice != null && alert.currentPrice > 0 ? `
              <span class="pa-alert-current">Now $${formatPrice(alert.currentPrice)}</span>
            ` : ''}
            ${!alert.triggered ? `
              <label class="pa-toggle-wrap">
                <input type="checkbox" class="pa-toggle" data-toggle="${alert.id}" ${alert.enabled ? 'checked' : ''} />
                <span class="pa-toggle-slider"></span>
              </label>
            ` : '<span class="pa-triggered-badge">Triggered!</span>'}
            <button class="pa-delete-btn" data-delete="${alert.id}" title="Delete">✕</button>
          </div>
        </div>
      `;
    }).join('');

    const html = `
      <div class="pa-container">
        <div class="pa-header-row">
          <span class="pa-triggered-count">${triggeredCount > 0 ? `${triggeredCount} triggered` : ''}</span>
          <button class="pa-add-btn" id="pa-toggle-form">${this.showForm ? 'Cancel' : '+ Add'}</button>
        </div>
        ${formHtml}
        ${this.alerts.length === 0 ? `
          <div class="pa-empty">
            <span class="pa-empty-icon">🔔</span>
            <div>No price alerts yet</div>
            <div style="font-size:11px;color:var(--text-dim)">Create alerts to get notified when prices hit your targets</div>
          </div>
        ` : `
          <div class="pa-alert-list">${alertRows}</div>
        `}
      </div>
    `;

    this.setContent(html);
    this.bindEvents();
  }

  private bindEvents(): void {
    // Toggle form
    this.content.querySelector('#pa-toggle-form')?.addEventListener('click', () => {
      this.showForm = !this.showForm;
      this.render();
    });

    // Condition toggle
    this.content.querySelectorAll('[data-cond]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.formCondition = (btn as HTMLElement).dataset.cond as 'above' | 'below';
        this.render();
      });
    });

    // Capture form values before submit
    const symbolInput = this.content.querySelector('#pa-symbol') as HTMLInputElement | null;
    const priceInput = this.content.querySelector('#pa-price') as HTMLInputElement | null;

    symbolInput?.addEventListener('input', () => { this.formSymbol = symbolInput.value; });
    priceInput?.addEventListener('input', () => { this.formPrice = priceInput.value; });

    // Submit
    this.content.querySelector('#pa-submit')?.addEventListener('click', () => {
      // Re-read values in case 'input' event didn't fire
      if (symbolInput) this.formSymbol = symbolInput.value;
      if (priceInput) this.formPrice = priceInput.value;
      this.addAlert();
    });

    // Enter key
    const handleEnter = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        if (symbolInput) this.formSymbol = symbolInput.value;
        if (priceInput) this.formPrice = priceInput.value;
        this.addAlert();
      }
    };
    symbolInput?.addEventListener('keydown', handleEnter);
    priceInput?.addEventListener('keydown', handleEnter);

    // Toggle alerts
    this.content.querySelectorAll('[data-toggle]').forEach(input => {
      input.addEventListener('change', () => {
        const id = (input as HTMLElement).dataset.toggle!;
        const checked = (input as HTMLInputElement).checked;
        this.toggleAlert(id, checked);
      });
    });

    // Delete alerts
    this.content.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.delete!;
        this.removeAlert(id);
      });
    });
  }
}
