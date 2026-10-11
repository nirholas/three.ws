/**
 * TokenDetail - rich detail view for a cryptocurrency token.
 *
 * Renders price header, TradingView Lightweight Chart (with SVG fallback),
 * action buttons, key metrics + extended CoinGecko data, related data
 * (fear & greed, funding rates, open interest, ETF flows), real related
 * news via GDELT, and external links.
 */

/* ── Ambient type for TradingView Lightweight Charts (CDN) ── */

declare global {
  interface Window {
    LightweightCharts?: {
      createChart(container: HTMLElement, options: Record<string, unknown>): {
        addAreaSeries(options: Record<string, unknown>): {
          setData(data: Array<{ time: string; value: number }>): void;
        };
        applyOptions(options: Record<string, unknown>): void;
        remove(): void;
        resize(w: number, h: number): void;
      };
    };
  }
}

/* ── Types ── */

export interface TokenDetailData {
  symbol: string;
  name?: string;
  price?: number;
  change24h?: number;
  change7d?: number;
  marketCap?: number;
  volume24h?: number;
  rank?: number;
  image?: string;
  sparkline?: number[];
  id?: string;
}

/* ── Formatting helpers ── */

function formatCurrency(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  if (abs >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function formatLargePrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '-';
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function formatPercent(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '-';
  const sign = n >= 0 ? '+' : '−';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function formatSupply(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function esc(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  try {
    // GDELT dates can be "YYYYMMDDTHHmmSS" or ISO
    let d: Date;
    if (/^\d{8}T\d{6}/.test(dateStr)) {
      const y = dateStr.slice(0, 4);
      const mo = dateStr.slice(4, 6);
      const da = dateStr.slice(6, 8);
      const h = dateStr.slice(9, 11);
      const mi = dateStr.slice(11, 13);
      const se = dateStr.slice(13, 15);
      d = new Date(`${y}-${mo}-${da}T${h}:${mi}:${se}Z`);
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d ago`;
    return `${Math.floor(diffD / 30)}mo ago`;
  } catch {
    return '';
  }
}

/* ── TradingView Lightweight Charts CDN loader ── */

let _lwcLoadPromise: Promise<void> | null = null;

function ensureLightweightCharts(): Promise<void> {
  if (window.LightweightCharts) return Promise.resolve();
  if (_lwcLoadPromise) return _lwcLoadPromise;
  _lwcLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      'https://unpkg.com/lightweight-charts@4.1.1/dist/lightweight-charts.standalone.production.js';
    script.onload = () => resolve();
    script.onerror = () => {
      _lwcLoadPromise = null;
      reject(new Error('Failed to load LightweightCharts'));
    };
    document.head.appendChild(script);
  });
  return _lwcLoadPromise;
}

/* ── SVG sparkline fallback renderer ── */

function renderSparklineSVGFallback(data: number[], width = 380, height = 160): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padY = 8;
  const effH = height - padY * 2;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = padY + effH - ((v - min) / range) * effH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const trendUp = (data[data.length - 1] ?? 0) >= (data[0] ?? 0);
  const color = trendUp ? '#4caf50' : '#f44336';

  const lastX = width;
  const firstPt = points.split(' ')[0];
  const areaPoints = `${points} ${lastX.toFixed(1)},${height} 0,${height} ${firstPt}`;

  return `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"
         role="img" aria-label="7-day price chart" style="display:block">
      <defs>
        <linearGradient id="td-sparkGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <polygon points="${areaPoints}" fill="url(#td-sparkGrad)"/>
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}

/* ── TradingView Lightweight Chart renderer ── */

async function renderLightweightChart(
  chartContainer: HTMLElement,
  sparkline: number[],
): Promise<void> {
  await ensureLightweightCharts();
  const LWC = window.LightweightCharts;
  if (!LWC) throw new Error('LightweightCharts not available');

  chartContainer.innerHTML = '';

  const chart = LWC.createChart(chartContainer, {
    width: chartContainer.clientWidth,
    height: 200,
    layout: { background: { color: 'transparent' }, textColor: '#888' },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.04)' },
      horzLines: { color: 'rgba(255,255,255,0.04)' },
    },
    crosshair: { mode: 0 },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
  });

  // Build time series - sparkline is ~7d of data points, generate timestamps
  const now = new Date();
  const totalPoints = sparkline.length;
  // Assume sparkline covers 7 days
  const msPerPoint = (7 * 24 * 60 * 60 * 1000) / (totalPoints - 1);
  const startMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  const trendUp = (sparkline[sparkline.length - 1] ?? 0) >= (sparkline[0] ?? 0);
  const lineColor = trendUp ? '#4caf50' : '#f44336';
  const topFill = trendUp ? 'rgba(76,175,80,0.25)' : 'rgba(244,67,54,0.25)';
  const bottomFill = trendUp ? 'rgba(76,175,80,0.02)' : 'rgba(244,67,54,0.02)';

  const seriesData = sparkline.map((value, i) => {
    const d = new Date(startMs + i * msPerPoint);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return { time: `${yyyy}-${mm}-${dd}`, value };
  });

  // Deduplicate by date (keep last value per date)
  const byDate = new Map<string, { time: string; value: number }>();
  for (const pt of seriesData) byDate.set(pt.time, pt);
  const dedupedData = Array.from(byDate.values());

  const series = chart.addAreaSeries({
    lineColor,
    topColor: topFill,
    bottomColor: bottomFill,
    lineWidth: 2,
  });
  series.setData(dedupedData);

  // ResizeObserver for responsive width
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const w = entry.contentRect.width;
      if (w > 0) chart.resize(w, 200);
    }
  });
  ro.observe(chartContainer);

  // Store cleanup references on the container for potential future disposal
  (chartContainer as HTMLElement & { _lwcCleanup?: () => void })._lwcCleanup = () => {
    ro.disconnect();
    chart.remove();
  };
}

/* ── Section builders ── */

function buildPriceHeader(d: TokenDetailData): string {
  const symbol = esc(d.symbol?.toUpperCase() ?? '???');
  const name = d.name ? esc(d.name) : '';
  const priceStr = formatLargePrice(d.price);

  let changeBadge = '';
  if (d.change24h != null && !Number.isNaN(d.change24h)) {
    const isPos = d.change24h >= 0;
    const arrow = isPos ? '▲' : '▼';
    const color = isPos ? '#4caf50' : '#f44336';
    changeBadge = `<span class="detail-chip" style="background:${color}22;color:${color};font-weight:600;font-size:13px;margin-left:8px">${arrow} ${formatPercent(d.change24h)}</span>`;
  }

  const iconHtml = d.image
    ? `<img src="${esc(d.image)}" alt="${symbol}" width="36" height="36" style="border-radius:50%;margin-right:10px;vertical-align:middle" data-hide-on-error/>`
    : '';

  return `
    <div class="detail-section" style="text-align:center;padding-bottom:4px">
      <div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-bottom:6px">
        ${iconHtml}
        <span style="font-size:14px;color:#888">${name ? `${name} · ` : ''}${symbol}</span>
      </div>
      <div style="font-size:28px;font-weight:700;color:#e0e0e0;letter-spacing:-0.5px">
        ${priceStr}${changeBadge}
      </div>
    </div>`;
}

function buildChartSection(d: TokenDetailData, chartId: string): string {
  if (!d.sparkline || d.sparkline.length < 2) {
    return `
      <div class="detail-section">
        <div class="detail-section-title">7-Day Price Chart</div>
        <div class="detail-chart-container" id="${chartId}" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.02);min-height:200px">
          <span style="color:#555;font-size:13px">Chart unavailable</span>
        </div>
      </div>`;
  }

  // Start with SVG fallback; async code will replace with LWC
  return `
    <div class="detail-section">
      <div class="detail-section-title">7-Day Price Chart</div>
      <div class="detail-chart-container" id="${chartId}" style="background:rgba(255,255,255,0.02);min-height:200px">
        ${renderSparklineSVGFallback(d.sparkline)}
      </div>
    </div>`;
}

function buildActionButtons(d: TokenDetailData): string {
  const symbol = d.symbol?.toUpperCase() ?? '';
  const slug =
    d.name?.toLowerCase().replace(/\s+/g, '-') ?? d.id ?? symbol.toLowerCase();

  return `
    <div class="detail-section" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="detail-action-btn" data-action="tradingview"
              data-tv-url="https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}USDT"
              style="flex:1;padding:8px 16px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#60a5fa;font-size:13px;font-weight:600;cursor:pointer;transition:background 0.2s">
        📈 Open Chart in TradingView
      </button>
      <button class="detail-action-btn" data-action="coingecko"
              data-cg-url="https://www.coingecko.com/en/coins/${encodeURIComponent(slug)}"
              style="flex:1;padding:8px 16px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#4ade80;font-size:13px;font-weight:600;cursor:pointer;transition:background 0.2s">
        🦎 View on CoinGecko
      </button>
    </div>`;
}

function buildMetricsGrid(d: TokenDetailData): string {
  const cells = [
    { label: 'Market Cap', value: formatCurrency(d.marketCap) },
    { label: '24h Volume', value: formatCurrency(d.volume24h) },
    { label: 'Rank', value: d.rank != null ? `#${d.rank}` : '-' },
    { label: '7d Change', value: formatPercent(d.change7d) },
  ];

  const grid = cells
    .map(
      (c) => `
    <div class="detail-metric">
      <div class="detail-metric-label">${c.label}</div>
      <div class="detail-metric-value">${c.value}</div>
    </div>`,
    )
    .join('');

  return `
    <div class="detail-section detail-key-metrics">
      <div class="detail-section-title">Key Metrics</div>
      <div class="detail-metric-grid">${grid}</div>
    </div>`;
}

function buildExtendedMetricsPlaceholder(): string {
  return `
    <div class="detail-section detail-extended-metrics" style="display:none">
      <div class="detail-section-title">Extended Metrics</div>
      <div class="detail-metric-grid"></div>
    </div>`;
}

function buildRelatedDataPlaceholder(): string {
  return `
    <div class="detail-section detail-related-data">
      <div class="detail-section-title">Related Data</div>
      <div class="detail-metric-grid">
        <div class="detail-metric">
          <div class="detail-metric-label">Fear & Greed</div>
          <div class="detail-metric-value detail-skeleton-bar" style="width:60%;height:18px;margin-top:4px"></div>
        </div>
        <div class="detail-metric">
          <div class="detail-metric-label">Funding Rate</div>
          <div class="detail-metric-value detail-skeleton-bar" style="width:50%;height:18px;margin-top:4px"></div>
        </div>
        <div class="detail-metric">
          <div class="detail-metric-label">Open Interest</div>
          <div class="detail-metric-value detail-skeleton-bar" style="width:70%;height:18px;margin-top:4px"></div>
        </div>
        <div class="detail-metric">
          <div class="detail-metric-label">ETF Flow</div>
          <div class="detail-metric-value detail-skeleton-bar" style="width:55%;height:18px;margin-top:4px"></div>
        </div>
      </div>
    </div>`;
}

function buildRelatedNewsPlaceholder(): string {
  return `
    <div class="detail-section token-related-news">
      <div class="detail-section-title">Related News</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="detail-skeleton-bar" style="width:90%;height:14px"></div>
        <div class="detail-skeleton-bar" style="width:70%;height:14px"></div>
        <div class="detail-skeleton-bar" style="width:80%;height:14px"></div>
      </div>
    </div>`;
}

function buildExternalLinks(d: TokenDetailData): string {
  const symbol = d.symbol?.toUpperCase() ?? '';
  const slug =
    d.name?.toLowerCase().replace(/\s+/g, '-') ?? d.id ?? symbol.toLowerCase();

  return `
    <div class="detail-section">
      <div class="detail-section-title">External Links</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <a class="detail-link" href="https://www.coingecko.com/en/coins/${encodeURIComponent(slug)}" target="_blank" rel="noopener noreferrer">
          CoinGecko → ${esc(d.name || symbol)}
        </a>
        <a class="detail-link" href="https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}USDT" target="_blank" rel="noopener noreferrer">
          TradingView → ${esc(symbol)}/USDT
        </a>
      </div>
    </div>`;
}

/* ── Async: upgrade chart to TradingView Lightweight Charts ── */

async function upgradeChart(
  container: HTMLElement,
  chartId: string,
  d: TokenDetailData,
): Promise<void> {
  if (!d.sparkline || d.sparkline.length < 2) return;
  const chartEl = container.querySelector(`#${chartId}`) as HTMLElement | null;
  if (!chartEl) return;
  try {
    await renderLightweightChart(chartEl, d.sparkline);
  } catch {
    // CDN failed - SVG fallback is already rendered, do nothing
  }
}

/* ── Async: CoinGecko deep data fetch ── */

async function fetchDeepTokenData(
  container: HTMLElement,
  d: TokenDetailData,
): Promise<void> {
  try {
    const res = await fetch('/api/coingecko-markets');
    if (!res.ok) return;
    const json = await res.json();
    const coins = json.coins || json.data || json;
    if (!Array.isArray(coins)) return;
    const sym = d.symbol?.toUpperCase();
    const match = coins.find(
      (c: Record<string, unknown>) =>
        (c.symbol as string)?.toUpperCase() === sym || c.id === d.id,
    );
    if (!match) return;
    updateMetricsWithDeepData(container, match);
  } catch {
    /* silent */
  }
}

function updateMetricsWithDeepData(
  container: HTMLElement,
  coin: Record<string, unknown>,
): void {
  const section = container.querySelector(
    '.detail-extended-metrics',
  ) as HTMLElement | null;
  if (!section) return;

  const cells: Array<{ label: string; value: string }> = [];

  // ATH
  const ath = coin.ath as number | undefined;
  const athPct = coin.ath_change_percentage as number | undefined;
  if (ath != null) {
    const pctStr =
      athPct != null
        ? ` <span style="color:#f44336;font-size:11px">${formatPercent(athPct)}</span>`
        : '';
    cells.push({ label: 'ATH', value: `${formatLargePrice(ath)}${pctStr}` });
  }

  // Circulating / Total Supply
  const circulating = coin.circulating_supply as number | undefined;
  const totalSupply = coin.total_supply as number | undefined;
  if (circulating != null) {
    const pct =
      totalSupply && totalSupply > 0
        ? ` <span style="color:#888;font-size:11px">(${((circulating / totalSupply) * 100).toFixed(1)}%)</span>`
        : '';
    cells.push({
      label: 'Circulating Supply',
      value: `${formatSupply(circulating)}${pct}`,
    });
  }

  // 24h High / Low
  const high24 = coin.high_24h as number | undefined;
  const low24 = coin.low_24h as number | undefined;
  if (high24 != null && low24 != null) {
    cells.push({
      label: '24h High / Low',
      value: `${formatLargePrice(high24)} / ${formatLargePrice(low24)}`,
    });
  }

  // Market Cap Rank
  const mcRank = coin.market_cap_rank as number | undefined;
  if (mcRank != null) {
    cells.push({ label: 'MC Rank', value: `#${mcRank}` });
  }

  if (cells.length === 0) return;

  const grid = section.querySelector('.detail-metric-grid');
  if (!grid) return;

  grid.innerHTML = cells
    .map(
      (c) => `
    <div class="detail-metric">
      <div class="detail-metric-label">${c.label}</div>
      <div class="detail-metric-value">${c.value}</div>
    </div>`,
    )
    .join('');
  section.style.display = '';
}

/* ── Async: related news via GDELT ── */

async function fetchRelatedNews(
  container: HTMLElement,
  symbol: string,
  name?: string,
): Promise<void> {
  const section = container.querySelector(
    '.token-related-news',
  ) as HTMLElement | null;
  if (!section) return;

  try {
    const query = encodeURIComponent(name || symbol);
    const res = await fetch(`/api/gdelt-doc?query=${query}&maxrecords=5`);
    if (!res.ok) throw new Error('GDELT failed');
    const json = await res.json();
    const articles = (json.articles || []) as Array<{
      title?: string;
      url?: string;
      source?: string;
      date?: string;
    }>;

    if (articles.length === 0) {
      section.innerHTML = `<div class="detail-section-title">Related News</div>
        <p style="color:#666;font-size:12px;margin:8px 0 0">No recent news found for ${esc(symbol)}</p>`;
      return;
    }

    section.innerHTML =
      `<div class="detail-section-title">Related News</div>` +
      articles
        .slice(0, 5)
        .map(
          (a) => `
        <div class="detail-news-item" style="cursor:pointer"
             data-news-title="${esc(a.title || '')}"
             data-news-url="${esc(a.url || '')}"
             data-news-source="${esc(a.source || '')}">
          <div class="detail-news-title">${esc(a.title || 'Untitled')}</div>
          <div class="detail-news-meta">${esc(a.source || '')}${a.date ? ` · ${timeAgo(a.date)}` : ''}</div>
        </div>`,
        )
        .join('');

    // Make news items clickable → open NewsDetail via detail:open event
    section.querySelectorAll('[data-news-title]').forEach((el) => {
      (el as HTMLElement).addEventListener('click', () => {
        window.dispatchEvent(
          new CustomEvent('detail:open', {
            detail: {
              type: 'news',
              data: {
                title: el.getAttribute('data-news-title'),
                url: el.getAttribute('data-news-url'),
                source: el.getAttribute('data-news-source'),
              },
            },
          }),
        );
      });
    });
  } catch {
    section.innerHTML = `<div class="detail-section-title">Related News</div>
      <p style="color:#666;font-size:12px;margin:8px 0 0">Could not load related news</p>`;
  }
}

/* ── Async related data fetch (fear-greed, funding, OI, ETF) ── */

async function fetchRelatedData(
  container: HTMLElement,
  d: TokenDetailData,
): Promise<void> {
  const section = container.querySelector(
    '.detail-related-data',
  ) as HTMLElement | null;
  if (!section) return;

  const symbol = d.symbol?.toUpperCase() ?? '';

  const results: {
    fearGreed?: string;
    funding?: string;
    oi?: string;
    etf?: string;
  } = {};

  const tasks: Promise<void>[] = [];

  // Fear & Greed
  tasks.push(
    fetch('/api/fear-greed?limit=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.data?.[0]) {
          const val = Number(json.data[0].value);
          const label = json.data[0].value_classification ?? '';
          const color =
            val >= 60 ? '#4caf50' : val >= 40 ? '#ff9800' : '#f44336';
          results.fearGreed = `<span style="color:${color};font-weight:600">${val}</span> <span style="color:#888;font-size:11px">${esc(label)}</span>`;
        } else {
          results.fearGreed = '-';
        }
      })
      .catch(() => {
        results.fearGreed = '-';
      }),
  );

  // Funding rate
  tasks.push(
    fetch('/api/funding-rates')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.rates) {
          const match = (
            json.rates as Array<{ symbol: string; avgFunding: number }>
          ).find(
            (r) => r.symbol === symbol || r.symbol === `${symbol}USDT`,
          );
          if (match) {
            const rate = match.avgFunding;
            const color =
              Math.abs(rate) >= 0.05 ? '#ff9800' : '#4caf50';
            results.funding = `<span style="color:${color};font-weight:600">${rate > 0 ? '+' : ''}${rate.toFixed(4)}%</span>`;
          } else {
            results.funding = '-';
          }
        } else {
          results.funding = '-';
        }
      })
      .catch(() => {
        results.funding = '-';
      }),
  );

  // Open Interest
  tasks.push(
    fetch('/api/open-interest')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.entries) {
          const match = (
            json.entries as Array<{
              symbol: string;
              totalOiValue: number;
              changePct: number;
            }>
          ).find(
            (e) => e.symbol === symbol || e.symbol === `${symbol}USDT`,
          );
          if (match) {
            const color =
              match.changePct > 0
                ? '#4caf50'
                : match.changePct < 0
                  ? '#f44336'
                  : '#888';
            results.oi = `<span style="font-weight:600">${formatCurrency(match.totalOiValue)}</span> <span style="color:${color};font-size:11px">${match.changePct > 0 ? '+' : ''}${match.changePct.toFixed(1)}%</span>`;
          } else {
            results.oi = '-';
          }
        } else {
          results.oi = '-';
        }
      })
      .catch(() => {
        results.oi = '-';
      }),
  );

  // ETF Flows (only for BTC / ETH)
  const upperSym = symbol.toUpperCase();
  if (upperSym === 'BTC' || upperSym === 'ETH') {
    tasks.push(
      fetch('/api/etf-flows')
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (json?.summary) {
            const dir = json.summary.netDirection ?? '';
            const flow = json.summary.totalEstFlow ?? 0;
            const color = dir.includes('INFLOW')
              ? '#4caf50'
              : dir.includes('OUTFLOW')
                ? '#f44336'
                : '#888';
            results.etf = `<span style="color:${color};font-weight:600">${esc(dir)}</span> <span style="font-size:11px;color:#aaa">${formatCurrency(Math.abs(flow))}</span>`;
          } else {
            results.etf = '-';
          }
        })
        .catch(() => {
          results.etf = '-';
        }),
    );
  } else {
    results.etf =
      '<span style="color:#555;font-size:11px">N/A (BTC/ETH only)</span>';
  }

  await Promise.allSettled(tasks);

  const grid = section.querySelector('.detail-metric-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="detail-metric">
      <div class="detail-metric-label">Fear & Greed</div>
      <div class="detail-metric-value">${results.fearGreed ?? '-'}</div>
    </div>
    <div class="detail-metric">
      <div class="detail-metric-label">Funding Rate</div>
      <div class="detail-metric-value">${results.funding ?? '-'}</div>
    </div>
    <div class="detail-metric">
      <div class="detail-metric-label">Open Interest</div>
      <div class="detail-metric-value">${results.oi ?? '-'}</div>
    </div>
    <div class="detail-metric">
      <div class="detail-metric-label">ETF Flow</div>
      <div class="detail-metric-value">${results.etf ?? '-'}</div>
    </div>`;
}

/* ── Wire action buttons (hover + click) ── */

function wireActionButtons(container: HTMLElement): void {
  container.querySelectorAll('.detail-action-btn').forEach((btn) => {
    const el = btn as HTMLElement;
    el.addEventListener('mouseenter', () => {
      el.style.background = '#334155';
    });
    el.addEventListener('mouseleave', () => {
      el.style.background = '#1e293b';
    });
    el.addEventListener('click', () => {
      const action = el.dataset.action;
      if (action === 'tradingview') {
        const url = el.dataset.tvUrl;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      } else if (action === 'coingecko') {
        const url = el.dataset.cgUrl;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      }
    });
  });
}

/* ── Exported renderer API ── */

export function getTitle(data: unknown): string {
  const d = data as TokenDetailData;
  const sym = d.symbol?.toUpperCase() ?? '???';
  if (d.name && d.price != null)
    return `${d.name} (${sym}) - ${formatLargePrice(d.price)}`;
  if (d.name) return `${d.name} (${sym})`;
  return sym;
}

export function render(container: HTMLElement, data: unknown): void {
  const d = data as TokenDetailData;
  const chartId = `td-chart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  container.innerHTML = [
    buildPriceHeader(d),
    buildChartSection(d, chartId),
    buildActionButtons(d),
    buildMetricsGrid(d),
    buildExtendedMetricsPlaceholder(),
    buildRelatedDataPlaceholder(),
    buildRelatedNewsPlaceholder(),
    buildExternalLinks(d),
  ].join('');

  // Wire action button interactions
  wireActionButtons(container);

  // Kick off async enhancements in parallel
  void upgradeChart(container, chartId, d);
  void fetchRelatedData(container, d);
  void fetchDeepTokenData(container, d);
  void fetchRelatedNews(container, d.symbol?.toUpperCase() ?? '', d.name);
}
