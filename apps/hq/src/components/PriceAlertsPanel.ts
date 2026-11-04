import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { hqBridge } from '@/services/hq-bridge';
import {
  MAX_CLAUSES,
  describeClause,
  describeRule,
  evaluateRule,
  migrateLegacyAlerts,
  neededFeeds,
  proposalForRule,
  readingKey,
  validateRule,
  type AlertRule,
  type Join,
  type Metric,
  type Operator,
  type Readings,
} from '@/services/alert-rules';

interface CoinGeckoPrice {
  [coinId: string]: { usd: number };
}

interface FormClause {
  metric: Metric;
  symbol: string;
  op: Operator;
  value: string;
}

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'hq-alert-rules-v1';
const LEGACY_STORAGE_KEY = 'hq-price-alerts';
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

function newId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Load rules; on first run migrate the legacy single-condition alerts. The legacy key is left untouched as a backup. */
function loadRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map(r => validateRule(r, newId, nowIso)).filter((r): r is AlertRule => r !== null)
        : [];
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const migrated = migrateLegacyAlerts(JSON.parse(legacy), newId, nowIso);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // corrupt storage: start clean rather than crash the panel
  }
  return [];
}

function saveRules(rules: AlertRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // storage full or blocked: alerts keep working for this session
  }
}

function blankClause(): FormClause {
  return { metric: 'price', symbol: '', op: 'above', value: '' };
}

const METRIC_LABEL: Record<Metric, string> = { price: 'Price ($)', funding: 'Funding (%)', gas: 'ETH gas (gwei)' };

function formatPrice(price: number): string {
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  return price.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** PriceAlertsPanel: compound alert rules. */

export class PriceAlertsPanel extends Panel {
  private rules: AlertRule[] = [];
  private readings: Readings = {};
  private showForm = false;
  private formName = '';
  private formJoin: Join = 'all';
  private formHandoff = false;
  private formClauses: FormClause[] = [blankClause()];
  private formError = '';
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'price-alerts', title: 'Alerts', showCount: true });
    this.rules = loadRules();
    this.render();
    void this.checkRules();
    this.checkTimer = setInterval(() => this.checkRules(), CHECK_INTERVAL);
  }

  public destroy(): void {
    super.destroy();
    if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = null; }
  }

  // ---- Live readings ----

  private async fetchPrices(symbols: string[]): Promise<void> {
    const symbolToId: Record<string, string> = {};
    for (const sym of symbols) symbolToId[sym] = SYMBOL_TO_COINGECKO[sym] || sym.toLowerCase();
    const ids = [...new Set(Object.values(symbolToId))].join(',');
    const res = await fetch(`/api/coingecko?endpoint=simple/price&ids=${encodeURIComponent(ids)}&vs_currencies=usd`);
    if (!res.ok) return;
    const prices: CoinGeckoPrice = await res.json();
    for (const sym of symbols) {
      const coinId = symbolToId[sym];
      const usd = coinId ? prices[coinId]?.usd : undefined;
      if (typeof usd === 'number') this.readings[readingKey('price', sym)] = usd;
    }
  }

  private async fetchFunding(): Promise<void> {
    const res = await fetch('/api/funding-rates');
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data.rates)) return;
    for (const r of data.rates as Array<{ symbol: string; avgFunding: number }>) {
      this.readings[readingKey('funding', r.symbol)] = r.avgFunding;
    }
  }

  private async fetchGas(): Promise<void> {
    const res = await fetch('/api/gas-tracker');
    if (!res.ok) return;
    const data = await res.json();
    const gwei = data?.summary?.ethGas;
    if (typeof gwei === 'number') this.readings[readingKey('gas', 'ETH')] = gwei;
  }

  private async checkRules(): Promise<void> {
    const feeds = neededFeeds(this.rules);
    if (feeds.prices.length === 0 && !feeds.funding && !feeds.gas) return;

    await Promise.allSettled([
      feeds.prices.length > 0 ? this.fetchPrices(feeds.prices) : Promise.resolve(),
      feeds.funding ? this.fetchFunding() : Promise.resolve(),
      feeds.gas ? this.fetchGas() : Promise.resolve(),
    ]);

    let changed = false;
    for (const rule of this.rules) {
      if (!rule.enabled || rule.triggered) continue;
      if (evaluateRule(rule, this.readings) === true) {
        rule.triggered = true;
        changed = true;
        this.announce(rule);
      }
    }
    if (changed) saveRules(this.rules);
    this.render();
  }

  /** Tell an embedding host the rule fired; the host decides what (if anything) to do with it. */
  private announce(rule: AlertRule): void {
    const proposal = proposalForRule(rule);
    hqBridge.emit('hq:alert-triggered', {
      ruleId: rule.id,
      name: rule.name,
      description: describeRule(rule),
      handoff: rule.handoff,
      proposal,
    });
    hqBridge.emitNotification({ title: rule.name || 'HQ alert', body: describeRule(rule), level: 'info' });
  }

  // ---- Rule operations ----

  private addRule(): void {
    const clauses = this.formClauses.map(c => ({
      metric: c.metric,
      symbol: c.symbol,
      op: c.op,
      value: Number.parseFloat(c.value),
    }));
    const rule = validateRule(
      { name: this.formName, join: this.formJoin, clauses, handoff: this.formHandoff },
      newId,
      nowIso,
    );
    if (!rule) {
      this.formError = 'Each condition needs a valid symbol and a number. Price and gas must be above zero.';
      this.render();
      return;
    }
    this.rules.push(rule);
    saveRules(this.rules);
    this.formName = '';
    this.formJoin = 'all';
    this.formHandoff = false;
    this.formClauses = [blankClause()];
    this.formError = '';
    this.showForm = false;
    this.render();
    void this.checkRules();
  }

  private removeRule(id: string): void {
    this.rules = this.rules.filter(r => r.id !== id);
    saveRules(this.rules);
    this.render();
  }

  private toggleRule(id: string, enabled: boolean): void {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return;
    rule.enabled = enabled;
    if (enabled) rule.triggered = false; // re-arm
    saveRules(this.rules);
    this.render();
  }

  private toggleHandoff(id: string, handoff: boolean): void {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return;
    rule.handoff = handoff;
    saveRules(this.rules);
    this.render();
  }

  // ---- Render ----

  private clauseFormHtml(c: FormClause, i: number): string {
    const sym = c.metric === 'gas' ? '' : `<input class="pa-input pa-clause-symbol" data-ci="${i}" data-f="symbol" type="text" placeholder="Symbol" value="${escapeHtml(c.symbol)}" aria-label="Symbol" />`;
    return `
      <div class="pa-clause">
        <select class="pa-input pa-clause-metric" data-ci="${i}" data-f="metric" aria-label="Metric">
          ${(Object.keys(METRIC_LABEL) as Metric[]).map(m => `<option value="${m}"${m === c.metric ? ' selected' : ''}>${METRIC_LABEL[m]}</option>`).join('')}
        </select>
        ${sym}
        <select class="pa-input pa-clause-op" data-ci="${i}" data-f="op" aria-label="Condition">
          <option value="above"${c.op === 'above' ? ' selected' : ''}>at or above</option>
          <option value="below"${c.op === 'below' ? ' selected' : ''}>at or below</option>
        </select>
        <input class="pa-input pa-clause-value" data-ci="${i}" data-f="value" type="number" step="any" placeholder="Value" value="${escapeHtml(c.value)}" aria-label="Threshold" />
        ${this.formClauses.length > 1 ? `<button class="pa-delete-btn" data-clause-remove="${i}" title="Remove condition" aria-label="Remove condition">✕</button>` : ''}
      </div>`;
  }

  private render(): void {
    const triggeredCount = this.rules.filter(r => r.triggered).length;
    this.setCount(this.rules.length);
    if (triggeredCount > 0) this.setNewBadge(triggeredCount, true);
    else this.clearNewBadge();

    const formHtml = this.showForm ? `
      <div class="pa-form">
        <input class="pa-input" type="text" maxlength="60" placeholder="Name (optional)" id="pa-name" value="${escapeHtml(this.formName)}" />
        ${this.formClauses.map((c, i) => this.clauseFormHtml(c, i)).join('')}
        <div class="pa-form-row">
          ${this.formClauses.length < MAX_CLAUSES ? '<button class="pa-cond-btn" id="pa-add-clause">+ Condition</button>' : ''}
          ${this.formClauses.length > 1 ? `
            <div class="pa-condition-toggle" role="group" aria-label="Combine conditions">
              <button class="pa-cond-btn${this.formJoin === 'all' ? ' active' : ''}" data-join="all">All</button>
              <button class="pa-cond-btn${this.formJoin === 'any' ? ' active' : ''}" data-join="any">Any</button>
            </div>` : ''}
        </div>
        <label class="pa-handoff-label">
          <input type="checkbox" id="pa-handoff" ${this.formHandoff ? 'checked' : ''} />
          Offer to my agent when this fires (opt-in)
        </label>
        ${this.formError ? `<div class="pa-form-error" role="alert">${escapeHtml(this.formError)}</div>` : ''}
        <button class="pa-submit-btn" id="pa-submit">Create Alert</button>
      </div>
    ` : '';

    const ruleRows = this.rules.map(rule => `
      <div class="pa-alert-row${rule.triggered ? ' pa-triggered' : ''}${!rule.enabled ? ' pa-disabled' : ''}">
        <div class="pa-alert-left">
          <span class="pa-alert-icon">${rule.enabled || rule.triggered ? '🔔' : '🔕'}</span>
          <span class="pa-alert-rule">
            ${rule.name ? `<strong>${escapeHtml(rule.name)}</strong> ` : ''}
            ${escapeHtml(rule.clauses.map(describeClause).join(rule.join === 'all' ? ' AND ' : ' OR '))}
          </span>
        </div>
        <div class="pa-alert-right">
          ${rule.clauses.map(c => {
            const v = this.readings[readingKey(c.metric, c.symbol)];
            return typeof v === 'number' ? `<span class="pa-alert-current">${escapeHtml(c.symbol)} ${formatPrice(v)}</span>` : '';
          }).join('')}
          <label class="pa-handoff-label" title="Offer this alert to your agent when it fires">
            <input type="checkbox" data-handoff="${rule.id}" ${rule.handoff ? 'checked' : ''} /> Agent
          </label>
          ${!rule.triggered ? `
            <label class="pa-toggle-wrap">
              <input type="checkbox" class="pa-toggle" data-toggle="${rule.id}" ${rule.enabled ? 'checked' : ''} aria-label="Enabled" />
              <span class="pa-toggle-slider"></span>
            </label>
          ` : `<button class="pa-cond-btn" data-rearm="${rule.id}">Re-arm</button><span class="pa-triggered-badge">Triggered!</span>`}
          <button class="pa-delete-btn" data-delete="${rule.id}" title="Delete" aria-label="Delete alert">✕</button>
        </div>
      </div>
    `).join('');

    this.setContent(`
      <div class="pa-container">
        <div class="pa-header-row">
          <span class="pa-triggered-count">${triggeredCount > 0 ? `${triggeredCount} triggered` : ''}</span>
          <button class="pa-add-btn" id="pa-toggle-form">${this.showForm ? 'Cancel' : '+ Add'}</button>
        </div>
        ${formHtml}
        ${this.rules.length === 0 ? `
          <div class="pa-empty">
            <span class="pa-empty-icon">🔔</span>
            <div>No alerts yet</div>
            <div style="font-size:11px;color:var(--text-dim)">Combine price, funding and gas conditions, for example BTC above a level AND funding crowded. Press + Add to start.</div>
          </div>
        ` : `<div class="pa-alert-list">${ruleRows}</div>`}
      </div>
    `);
    this.bindEvents();
  }

  private bindEvents(): void {
    const q = (sel: string) => this.content.querySelector(sel);
    const qa = (sel: string) => this.content.querySelectorAll(sel);

    q('#pa-toggle-form')?.addEventListener('click', () => {
      this.showForm = !this.showForm;
      this.formError = '';
      this.render();
    });

    (q('#pa-name') as HTMLInputElement | null)?.addEventListener('input', e => { this.formName = (e.target as HTMLInputElement).value; });
    (q('#pa-handoff') as HTMLInputElement | null)?.addEventListener('change', e => { this.formHandoff = (e.target as HTMLInputElement).checked; });

    qa('[data-ci]').forEach(el => {
      const input = el as HTMLInputElement | HTMLSelectElement;
      const i = Number(input.dataset.ci);
      const field = input.dataset.f as keyof FormClause;
      if (!field) return;
      const apply = () => {
        const clause = this.formClauses[i];
        if (!clause) return;
        (clause as unknown as Record<string, string>)[field] = input.value;
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', () => { apply(); if (field === 'metric') this.render(); });
      input.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') { apply(); this.addRule(); } });
    });

    q('#pa-add-clause')?.addEventListener('click', () => {
      if (this.formClauses.length < MAX_CLAUSES) this.formClauses.push(blankClause());
      this.render();
    });
    qa('[data-clause-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.formClauses.splice(Number((btn as HTMLElement).dataset.clauseRemove), 1);
        this.render();
      });
    });
    qa('[data-join]').forEach(btn => {
      btn.addEventListener('click', () => { this.formJoin = (btn as HTMLElement).dataset.join as Join; this.render(); });
    });

    q('#pa-submit')?.addEventListener('click', () => this.addRule());

    qa('[data-toggle]').forEach(input => {
      input.addEventListener('change', () => this.toggleRule((input as HTMLElement).dataset.toggle!, (input as HTMLInputElement).checked));
    });
    qa('[data-handoff]').forEach(input => {
      input.addEventListener('change', () => this.toggleHandoff((input as HTMLElement).dataset.handoff!, (input as HTMLInputElement).checked));
    });
    qa('[data-rearm]').forEach(btn => {
      btn.addEventListener('click', () => this.toggleRule((btn as HTMLElement).dataset.rearm!, true));
    });
    qa('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => this.removeRule((btn as HTMLElement).dataset.delete!));
    });
  }
}
