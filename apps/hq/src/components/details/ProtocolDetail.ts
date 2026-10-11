/**
 * ProtocolDetail - rich renderer for protocol / chain / category detail views.
 *
 * Sections:
 * 1. Header  - name, category chip, chain badges
 * 2. TVL     - large number + 24h / 7d change
 * 3. Metrics - 2-col grid
 * 4. Chains  - colored chain pills
 * 5. Top Pool - APY highlight
 * 6. Related Yields - fetched async from /api/defi-yields
 * 7. External links
 */

/* ── Data contract ────────────────────────────────────────── */

interface ProtocolDetailData {
  name: string;
  slug?: string;
  tvl?: number;
  change24h?: number;
  change7d?: number;
  chains?: string[];
  category?: string;
  revenue24h?: number;
  revenue7d?: number;
  fees24h?: number;
  fees7d?: number;
  topPool?: { pool: string; apy: number; tvl: number };
  mcapTvl?: number;
}

/* ── Helpers ───────────────────────────────────────────────── */

function formatTvl(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPercent(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '-';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function pctColor(v: number | null | undefined): string {
  if (v == null) return 'var(--text-dim, #888)';
  if (v > 0) return 'var(--green, #4ade80)';
  if (v < 0) return 'var(--red, #ef4444)';
  return 'var(--text-dim, #888)';
}

const CATEGORY_COLORS: Record<string, string> = {
  Lending: '#3b82f6',
  DEX: '#8b5cf6',
  Dexes: '#8b5cf6',
  Yield: '#22c55e',
  'Yield Aggregator': '#22c55e',
  Bridge: '#f97316',
  CDP: '#06b6d4',
  Chain: '#64748b',
  Derivatives: '#ec4899',
  Insurance: '#14b8a6',
  Staking: '#eab308',
  'Liquid Staking': '#eab308',
  RWA: '#a855f7',
  Options: '#f43f5e',
  Other: '#6b7280',
};

const CHAIN_COLORS: Record<string, string> = {
  Ethereum: '#627eea',
  Solana: '#9945ff',
  BSC: '#f0b90b',
  Polygon: '#8247e5',
  Arbitrum: '#28a0f0',
  Optimism: '#ff0420',
  Avalanche: '#e84142',
  Base: '#0052ff',
  Fantom: '#1969ff',
  Tron: '#ff0013',
  Sui: '#4da2ff',
  Aptos: '#2dd8a3',
  Cronos: '#002d74',
  TON: '#0098ea',
  Mantle: '#666',
  Blast: '#fcfc03',
  zkSync: '#4e529a',
  Manta: '#1d1f28',
  Sei: '#9b1c1c',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Public API ────────────────────────────────────────────── */

export function getTitle(data: unknown): string {
  const d = data as Partial<ProtocolDetailData> | null;
  if (!d) return 'Protocol';
  const name = d.name || 'Protocol';
  return d.category ? `${name} - ${d.category}` : name;
}

export function render(container: HTMLElement, data: unknown): void {
  const d = (data ?? {}) as Partial<ProtocolDetailData>;
  const name = d.name || 'Unknown';
  const slug = d.slug || name.toLowerCase().replace(/\s+/g, '-');
  const category = d.category || '';
  const catColor = CATEGORY_COLORS[category] || '#6b7280';

  /* ── 1. Header ── */
  let headerHtml = `<div class="detail-section" style="padding-bottom:8px">`;
  headerHtml += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">`;
  headerHtml += `<span style="font-size:20px;font-weight:700;color:#fff">${esc(name)}</span>`;
  if (category) {
    headerHtml += `<span class="detail-chip" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}44">${esc(category)}</span>`;
  }
  headerHtml += `</div>`;

  /* Chain badges in header */
  if (d.chains && d.chains.length) {
    headerHtml += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">`;
    for (const chain of d.chains) {
      const cc = CHAIN_COLORS[chain] || '#888';
      headerHtml += `<span class="detail-chip" style="background:${cc}22;color:${cc};border:1px solid ${cc}44;font-size:11px;cursor:pointer" data-chain-detail="${esc(chain)}">${esc(chain)}</span>`;
    }
    headerHtml += `</div>`;
  }
  headerHtml += `</div>`;

  /* ── 2. TVL display ── */
  let tvlHtml = '';
  if (d.tvl != null) {
    tvlHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Total Value Locked</div>
        <div style="font-size:28px;font-weight:700;color:#fff;letter-spacing:-0.5px">${formatTvl(d.tvl)}</div>
        <div style="display:flex;gap:12px;margin-top:4px">
          ${d.change24h != null ? `<span style="font-size:13px;color:${pctColor(d.change24h)}">24h ${formatPercent(d.change24h)}</span>` : ''}
          ${d.change7d != null ? `<span style="font-size:13px;color:${pctColor(d.change7d)}">7d ${formatPercent(d.change7d)}</span>` : ''}
        </div>
      </div>`;
  }

  /* ── 3. Metrics grid ── */
  const metrics: Array<{ label: string; value: string }> = [];
  if (d.tvl != null) metrics.push({ label: 'TVL', value: formatTvl(d.tvl) });
  if (d.revenue24h != null) metrics.push({ label: '24h Revenue', value: formatTvl(d.revenue24h) });
  if (d.revenue7d != null) metrics.push({ label: '7d Revenue', value: formatTvl(d.revenue7d) });
  if (d.fees24h != null) metrics.push({ label: '24h Fees', value: formatTvl(d.fees24h) });
  if (d.fees7d != null) metrics.push({ label: '7d Fees', value: formatTvl(d.fees7d) });
  if (d.mcapTvl != null) metrics.push({ label: 'Mcap / TVL', value: d.mcapTvl.toFixed(2) + 'x' });
  if (category) metrics.push({ label: 'Category', value: category });

  let metricsHtml = '';
  if (metrics.length) {
    metricsHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Key Metrics</div>
        <div class="detail-metric-grid">
          ${metrics.map(m => `
            <div class="detail-metric">
              <div class="detail-metric-label">${esc(m.label)}</div>
              <div class="detail-metric-value">${esc(m.value)}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  /* ── 4. Chain breakdown ── */
  let chainsHtml = '';
  if (d.chains && d.chains.length) {
    chainsHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Chains (${d.chains.length})</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${d.chains.map(c => {
            const cc = CHAIN_COLORS[c] || '#888';
            return `<span class="detail-chip" style="background:${cc}22;color:${cc};border:1px solid ${cc}44;cursor:pointer" data-chain-detail="${esc(c)}">${esc(c)}</span>`;
          }).join('')}
        </div>
      </div>`;
  }

  /* ── 5. Top yield pool ── */
  let poolHtml = '';
  if (d.topPool) {
    poolHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Top Yield Pool</div>
        <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px">
          <div style="font-size:13px;color:#ccc">${esc(d.topPool.pool)}</div>
          <div style="display:flex;gap:16px;margin-top:6px">
            <span style="font-size:18px;font-weight:600;color:var(--green, #4ade80)">${d.topPool.apy.toFixed(2)}% APY</span>
            <span style="font-size:13px;color:#888;align-self:center">TVL ${formatTvl(d.topPool.tvl)}</span>
          </div>
        </div>
      </div>`;
  }

  /* ── 6. Related yields placeholder (async fetch) ── */
  const yieldsId = `protocol-yields-${Date.now()}`;
  const yieldsHtml = `
    <div class="detail-section" id="${yieldsId}">
      <div class="detail-section-title">Related Yield Pools</div>
      <div class="detail-skeleton">
        <div class="detail-skeleton-bar" style="width:80%"></div>
        <div class="detail-skeleton-bar" style="width:60%"></div>
        <div class="detail-skeleton-bar" style="width:70%"></div>
      </div>
    </div>`;

  /* ── 7. External links ── */
  const llamaUrl = `https://defillama.com/protocol/${encodeURIComponent(slug)}`;
  let linksHtml = `
    <div class="detail-section">
      <div class="detail-section-title">External Links</div>
      <a class="detail-link" href="${llamaUrl}" target="_blank" rel="noopener noreferrer">DefiLlama ↗</a>`;
  if (category === 'DEX' || category === 'Dexes') {
    linksHtml += `\n      <a class="detail-link" href="https://dexscreener.com" target="_blank" rel="noopener noreferrer">DexScreener ↗</a>`;
  }
  /* ── Token cross-link ── */
  const PROTOCOL_TOKEN_MAP: Record<string, string> = {
    Uniswap: 'UNI', Aave: 'AAVE', Chainlink: 'LINK', Compound: 'COMP',
    Maker: 'MKR', Lido: 'LDO', Curve: 'CRV', Convex: 'CVX',
    SushiSwap: 'SUSHI', Synthetix: 'SNX', '1inch': '1INCH',
    PancakeSwap: 'CAKE', dYdX: 'DYDX', Balancer: 'BAL',
    Yearn: 'YFI', Frax: 'FXS', Rocket: 'RPL',
    Instadapp: 'INST', Pendle: 'PENDLE', Radiant: 'RDNT',
  };
  const tokenSymbol = PROTOCOL_TOKEN_MAP[name];
  if (tokenSymbol) {
    linksHtml += `\n      <span class="detail-link" style="cursor:pointer;color:#60a5fa" data-token-link="${esc(tokenSymbol)}">View ${esc(tokenSymbol)} Token Detail →</span>`;
  }
  linksHtml += `\n    </div>`;

  /* ── Assemble ── */
  container.innerHTML = headerHtml + tvlHtml + metricsHtml + chainsHtml + poolHtml + yieldsHtml + linksHtml;

  /* ── Wire chain badge clicks ── */
  container.querySelectorAll('[data-chain-detail]').forEach(el => {
    (el as HTMLElement).addEventListener('click', () => {
      const chain = el.getAttribute('data-chain-detail') || '';
      window.dispatchEvent(new CustomEvent('detail:open', {
        detail: { type: 'protocol', data: { name: chain, category: 'Chain', chains: [chain] } }
      }));
    });
  });

  /* ── Wire token link ── */
  const tokenLink = container.querySelector('[data-token-link]') as HTMLElement | null;
  if (tokenLink) {
    tokenLink.addEventListener('click', () => {
      const sym = tokenLink.getAttribute('data-token-link') || '';
      window.dispatchEvent(new CustomEvent('detail:open', {
        detail: { type: 'token', data: { symbol: sym, name: sym } }
      }));
    });
  }

  /* ── Async: fetch related yields ── */
  fetchRelatedYields(name, yieldsId);
}

/* ── Async yield fetcher ──────────────────────────────────── */

async function fetchRelatedYields(protocolName: string, containerId: string): Promise<void> {
  try {
    const res = await fetch('/api/defi-yields');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { pools?: Array<{ project: string; pool: string; apy: number; tvlUsd: number; chain: string; symbol: string }> };

    const nameLower = protocolName.toLowerCase();
    const pools = (json.pools || [])
      .filter((p: { project: string }) => p.project.toLowerCase() === nameLower)
      .sort((a: { apy: number }, b: { apy: number }) => b.apy - a.apy)
      .slice(0, 3);

    const el = document.getElementById(containerId);
    if (!el) return;

    if (pools.length === 0) {
      el.innerHTML = `
        <div class="detail-section-title">Related Yield Pools</div>
        <p style="color:#666;font-size:12px">No yield pools found for ${esc(protocolName)}</p>
      `;
      return;
    }

    el.innerHTML = `
      <div class="detail-section-title">Related Yield Pools</div>
      ${pools.map((p: { symbol: string; chain: string; apy: number; tvlUsd: number }) => `
        <div class="protocol-yield-row" data-yield-chain="${esc(p.chain)}" style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;cursor:pointer">
          <div>
            <div style="font-size:13px;color:#ccc">${esc(p.symbol)}</div>
            <div style="font-size:11px;color:#666">${esc(p.chain)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:14px;font-weight:600;color:var(--green, #4ade80)">${p.apy.toFixed(2)}%</div>
            <div style="font-size:11px;color:#888">TVL ${formatTvl(p.tvlUsd)}</div>
          </div>
        </div>
      `).join('')}
    `;

    /* Wire yield pool row clicks */
    el.querySelectorAll('.protocol-yield-row').forEach(row => {
      (row as HTMLElement).addEventListener('click', () => {
        const chain = row.getAttribute('data-yield-chain') || '';
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'protocol', data: { name: chain, category: 'Chain', chains: [chain] } }
        }));
      });
    });
  } catch {
    const el = document.getElementById(containerId);
    if (el) {
      el.innerHTML = `
        <div class="detail-section-title">Related Yield Pools</div>
        <p style="color:#666;font-size:12px">Could not load yield data</p>
      `;
    }
  }
}
