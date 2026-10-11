import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatTvl } from '@/utils/defi-format';

// =============================================================================
// Types
// =============================================================================

interface Protocol {
  name: string;
  slug: string;
  category: string;
  tvl: number;
  change24h: number | null;
  change7d: number | null;
  chains: string[];
  logo: string;
}

interface ProtocolsResult {
  timestamp: string;
  protocols: Protocol[];
  unavailable?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================



function formatChange(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function changeClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (value > 0) return 'cp-change-pos';
  if (value < 0) return 'cp-change-neg';
  return '';
}

const MAX_COMPARE = 4;

// =============================================================================
// CompareProtocolsPanel
// =============================================================================

export class CompareProtocolsPanel extends Panel {
  private allProtocols: Protocol[] = [];
  private selectedSlugs: string[] = [];
  private loading = true;
  private error: string | null = null;
  private pickerSearch = '';
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private pickerOverlay: HTMLElement | null = null;

  constructor() {
    super({ id: 'compare-protocols', title: 'Compare Protocols', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 5 * 60_000);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.closePicker();
  }

  private async fetchData(): Promise<void> {
    try {
      const res = await fetch('/api/top-protocols?limit=100');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ProtocolsResult = await res.json();
      this.allProtocols = json.protocols || [];
      this.error = null;

      const cacheHeader = res.headers.get('X-Cache');
      if (cacheHeader === 'HIT') this.setDataBadge('cached');
      else this.setDataBadge('live');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
      if (!this.allProtocols.length) this.setDataBadge('unavailable');
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private get selectedProtocols(): Protocol[] {
    return this.selectedSlugs
      .map(slug => this.allProtocols.find(p => p.slug === slug))
      .filter(Boolean) as Protocol[];
  }

  // ---- Render ----

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading protocols...'); return; }
    if (this.error && !this.allProtocols.length) { this.showError(this.error); return; }

    const selected = this.selectedProtocols;
    this.setCount(selected.length);

    const winnerSlug = selected.length >= 2
      ? [...selected].sort((a, b) => b.tvl - a.tvl)[0]?.slug ?? null
      : null;

    // Cards
    const cards = selected.map(p => {
      const isWinner = p.slug === winnerSlug;
      return `
        <div class="cp-card${isWinner ? ' cp-card-winner' : ''}">
          <button class="cp-card-remove" data-remove="${p.slug}" title="Remove">✕</button>
          <div class="cp-card-header">
            ${p.logo ? `<img class="cp-card-logo" src="${escapeHtml(p.logo)}" alt="" data-hide-on-error />` : ''}
            <div class="cp-card-info">
              <span class="cp-card-name">${escapeHtml(p.name)}</span>
              <span class="cp-card-cat">${escapeHtml(p.category)}</span>
            </div>
          </div>
          <div class="cp-card-stats">
            <div class="cp-card-stat">
              <span class="cp-card-stat-label">TVL</span>
              <span class="cp-card-stat-value">${formatTvl(p.tvl)}</span>
            </div>
            <div class="cp-card-stat">
              <span class="cp-card-stat-label">24h</span>
              <span class="cp-card-stat-value ${changeClass(p.change24h)}">${formatChange(p.change24h)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Comparison table (shown when 2+ selected)
    let table = '';
    if (selected.length >= 2) {
      const totalTvl = selected.reduce((s, p) => s + p.tvl, 0);
      const maxTvl = Math.max(...selected.map(p => p.tvl));
      const bestChange24 = Math.max(...selected.map(p => p.change24h ?? -Infinity));
      const bestChange7d = Math.max(...selected.map(p => p.change7d ?? -Infinity));
      const maxChains = Math.max(...selected.map(p => p.chains.length));

      const metrics = [
        {
          label: 'Total Value Locked',
          values: selected.map(p =>
            `<span class="cp-metric-val">${formatTvl(p.tvl)}${p.tvl === maxTvl ? ' <span class="cp-badge-best">Highest</span>' : ''}</span>`
          ),
        },
        {
          label: '24h Change',
          values: selected.map(p =>
            `<span class="cp-metric-val ${changeClass(p.change24h)}">${formatChange(p.change24h)}${p.change24h === bestChange24 && (p.change24h ?? 0) > 0 ? ' <span class="cp-badge-best">Best</span>' : ''}</span>`
          ),
        },
        {
          label: '7d Change',
          values: selected.map(p =>
            `<span class="cp-metric-val ${changeClass(p.change7d)}">${formatChange(p.change7d)}${p.change7d === bestChange7d && (p.change7d ?? 0) > 0 ? ' <span class="cp-badge-best">Best</span>' : ''}</span>`
          ),
        },
        {
          label: 'Relative Share',
          values: selected.map(p =>
            `<span class="cp-metric-val">${totalTvl > 0 ? ((p.tvl / totalTvl) * 100).toFixed(1) : '0'}%</span>`
          ),
        },
        {
          label: 'Category',
          values: selected.map(p =>
            `<span class="cp-metric-tag">${escapeHtml(p.category)}</span>`
          ),
        },
        {
          label: 'Chains',
          values: selected.map(p => {
            const tags = p.chains.slice(0, 5).map(c => `<span class="cp-chain-tag">${escapeHtml(c)}</span>`).join('');
            const more = p.chains.length > 5 ? `<span class="cp-chain-tag">+${p.chains.length - 5}</span>` : '';
            const best = p.chains.length === maxChains ? ` <span class="cp-badge-info">${p.chains.length} chains</span>` : '';
            return `<span class="cp-metric-chains">${tags}${more}${best}</span>`;
          }),
        },
      ];

      table = `
        <div class="cp-table">
          <div class="cp-table-header">
            <div class="cp-table-cell cp-table-label">Metric</div>
            ${selected.map(p => `
              <div class="cp-table-cell cp-table-proto">
                ${p.logo ? `<img class="cp-table-logo" src="${escapeHtml(p.logo)}" alt="" data-hide-on-error />` : ''}
                <span>${escapeHtml(p.name)}</span>
              </div>
            `).join('')}
          </div>
          ${metrics.map(m => `
            <div class="cp-table-row">
              <div class="cp-table-cell cp-table-label">${m.label}</div>
              ${m.values.map(v => `<div class="cp-table-cell">${v}</div>`).join('')}
            </div>
          `).join('')}
        </div>
      `;
    }

    const emptyState = selected.length === 0 ? `
      <div class="cp-empty">
        <div class="cp-empty-icon">⇄</div>
        <div>No protocols selected</div>
        <div style="font-size:11px;color:var(--text-dim)">Click "Select" to start comparing</div>
      </div>
    ` : selected.length === 1 ? `
      <div class="cp-empty">
        <div style="color:var(--text-dim)">Select at least 1 more protocol to compare</div>
      </div>
    ` : '';

    const html = `
      <div class="cp-container">
        <div class="cp-actions">
          <span class="cp-subtitle">Compare up to ${MAX_COMPARE} DeFi protocols side-by-side</span>
          <button class="cp-select-btn" id="cp-open-picker">
            ⇄ ${this.selectedSlugs.length === 0 ? 'Select Protocols' : 'Manage'}
          </button>
        </div>
        ${cards ? `<div class="cp-cards">${cards}</div>` : ''}
        ${table}
        ${emptyState}
      </div>
    `;

    this.setContent(html);
    this.bindEvents();
  }

  // ---- Picker ----

  private openPicker(): void {
    this.pickerSearch = '';
    this.renderPicker();
  }

  private closePicker(): void {
    if (this.pickerOverlay) {
      this.pickerOverlay.remove();
      this.pickerOverlay = null;
    }
  }

  private renderPicker(): void {
    if (this.pickerOverlay) this.pickerOverlay.remove();

    const query = this.pickerSearch.toLowerCase();
    const filtered = query
      ? this.allProtocols.filter(p =>
          p.name.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query) ||
          p.chains.some(c => c.toLowerCase().includes(query))
        )
      : this.allProtocols;

    const overlay = document.createElement('div');
    overlay.className = 'cp-picker-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closePicker();
    });

    overlay.innerHTML = `
      <div class="cp-picker-panel">
        <div class="cp-picker-header">
          <span class="cp-picker-title">Select Protocols to Compare</span>
          <button class="cp-picker-close" id="cp-picker-close">✕</button>
        </div>
        <input class="cp-picker-search" type="text" placeholder="Search protocols..." value="${escapeHtml(this.pickerSearch)}" id="cp-picker-search" />
        <div class="cp-picker-info">${this.selectedSlugs.length}/${MAX_COMPARE} selected</div>
        <div class="cp-picker-list">
          ${filtered.length === 0 ? '<div class="cp-picker-empty">No protocols match your search</div>' : ''}
          ${filtered.map(p => {
            const isSelected = this.selectedSlugs.includes(p.slug);
            const disabled = this.selectedSlugs.length >= MAX_COMPARE && !isSelected;
            return `
              <div class="cp-picker-row${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}" data-slug="${escapeHtml(p.slug)}">
                <span class="cp-picker-check">${isSelected ? '☑' : '☐'}</span>
                ${p.logo ? `<img class="cp-picker-logo" src="${escapeHtml(p.logo)}" alt="" data-hide-on-error />` : ''}
                <div class="cp-picker-info-col">
                  <span class="cp-picker-name">${escapeHtml(p.name)}</span>
                  <span class="cp-picker-cat">${escapeHtml(p.category)}</span>
                </div>
                <span class="cp-picker-tvl">${formatTvl(p.tvl)}</span>
              </div>
            `;
          }).join('')}
        </div>
        <div class="cp-picker-footer">
          <button class="cp-picker-done" id="cp-picker-done">Done</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.pickerOverlay = overlay;

    // Bind picker events
    overlay.querySelector('#cp-picker-close')?.addEventListener('click', () => this.closePicker());
    overlay.querySelector('#cp-picker-done')?.addEventListener('click', () => {
      this.closePicker();
      this.renderPanel();
    });

    const searchInput = overlay.querySelector('#cp-picker-search') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
      this.pickerSearch = searchInput.value;
      this.renderPicker();
    });
    searchInput?.focus();

    overlay.querySelectorAll('.cp-picker-row:not(.disabled)').forEach(row => {
      row.addEventListener('click', () => {
        const slug = (row as HTMLElement).dataset.slug!;
        if (this.selectedSlugs.includes(slug)) {
          this.selectedSlugs = this.selectedSlugs.filter(s => s !== slug);
        } else if (this.selectedSlugs.length < MAX_COMPARE) {
          this.selectedSlugs.push(slug);
        }
        this.renderPicker();
      });
    });
  }

  // ---- Events ----

  private bindEvents(): void {
    this.content.querySelector('#cp-open-picker')?.addEventListener('click', () => this.openPicker());

    this.content.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const slug = (btn as HTMLElement).dataset.remove!;
        this.selectedSlugs = this.selectedSlugs.filter(s => s !== slug);
        this.renderPanel();
      });
    });
  }
}
