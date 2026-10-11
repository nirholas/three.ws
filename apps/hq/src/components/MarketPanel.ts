import { Panel } from './Panel';
import type { MarketData, CryptoData, PriceUpdate } from '@/types';
import { formatPrice, formatChange, getChangeClass, getHeatmapClass } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';

function miniSparkline(data: number[] | undefined, change: number | null, w = 50, h = 16): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const color = change != null && change >= 0 ? 'var(--green)' : 'var(--red)';
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="mini-sparkline"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export class MarketPanel extends Panel {
  constructor() {
    super({ id: 'markets', title: 'Markets' });
  }

  public renderMarkets(data: MarketData[]): void {
    if (data.length === 0) {
      this.showError('Failed to load market data');
      return;
    }

    const html = data
      .map(
        (stock) => `
      <div class="market-item" style="cursor:pointer" data-detail-symbol="${escapeHtml(stock.symbol)}" data-detail-name="${escapeHtml(stock.name)}" data-detail-price="${stock.price ?? ''}" data-detail-change="${stock.change ?? ''}">
        <div class="market-info">
          <span class="market-name">${escapeHtml(stock.name)}</span>
          <span class="market-symbol">${escapeHtml(stock.display)}</span>
        </div>
        <div class="market-data">
          ${miniSparkline(stock.sparkline, stock.change)}
          <span class="market-price">${formatPrice(stock.price!)}</span>
          <span class="market-change ${getChangeClass(stock.change!)}">${formatChange(stock.change!)}</span>
        </div>
      </div>
    `
      )
      .join('');

    this.setContent(html);
    this.content.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-detail-symbol]');
      if (!item) return;
      const symbol = item.dataset.detailSymbol || '';
      const name = item.dataset.detailName || '';
      const price = item.dataset.detailPrice ? Number(item.dataset.detailPrice) : undefined;
      const change24h = item.dataset.detailChange ? Number(item.dataset.detailChange) : undefined;
      window.dispatchEvent(new CustomEvent('detail:open', {
        detail: { type: 'token' as const, data: { symbol, name, price, change24h } }
      }));
    });
  }
}

export class HeatmapPanel extends Panel {
  constructor() {
    super({ id: 'heatmap', title: 'Sector Heatmap' });
  }

  public renderHeatmap(data: Array<{ name: string; change: number | null }>): void {
    const validData = data.filter((d) => d.change !== null);

    if (validData.length === 0) {
      this.showError('Failed to load sector data');
      return;
    }

    const html =
      '<div class="heatmap">' +
      validData
        .map(
          (sector) => `
        <div class="heatmap-cell ${getHeatmapClass(sector.change!)}">
          <div class="sector-name">${escapeHtml(sector.name)}</div>
          <div class="sector-change ${getChangeClass(sector.change!)}">${formatChange(sector.change!)}</div>
        </div>
      `
        )
        .join('') +
      '</div>';

    this.setContent(html);
  }
}

export class CommoditiesPanel extends Panel {
  constructor() {
    super({ id: 'commodities', title: 'Commodities / VIX' });
  }

  public renderCommodities(data: Array<{ display: string; price: number | null; change: number | null; sparkline?: number[] }>): void {
    const validData = data.filter((d) => d.price !== null);

    if (validData.length === 0) {
      this.showError('Failed to load commodities');
      return;
    }

    const html =
      '<div class="commodities-grid">' +
      validData
        .map(
          (c) => `
        <div class="commodity-item">
          <div class="commodity-name">${escapeHtml(c.display)}</div>
          ${miniSparkline(c.sparkline, c.change, 60, 18)}
          <div class="commodity-price">${formatPrice(c.price!)}</div>
          <div class="commodity-change ${getChangeClass(c.change!)}">${formatChange(c.change!)}</div>
        </div>
      `
        )
        .join('') +
      '</div>';

    this.setContent(html);
  }
}

export class CryptoPanel extends Panel {
  private priceListener: ((e: Event) => void) | null = null;

  constructor() {
    super({ id: 'crypto', title: 'Crypto' });
    this.priceListener = ((e: Event) => {
      this.handlePriceUpdate((e as CustomEvent<PriceUpdate>).detail);
    });
    window.addEventListener('price:update', this.priceListener);
  }

  public destroy(): void {
    if (this.priceListener) {
      window.removeEventListener('price:update', this.priceListener);
      this.priceListener = null;
    }
    super.destroy();
  }

  private handlePriceUpdate(update: PriceUpdate): void {
    const row = this.content.querySelector(`[data-detail-symbol="${update.symbol}"]`);
    if (!row) return;

    const priceEl = row.querySelector('.market-price');
    const changeEl = row.querySelector('.market-change');

    if (priceEl) {
      const oldPrice = parseFloat(priceEl.textContent?.replace(/[$,]/g, '') || '0');
      priceEl.textContent = `$${update.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Update data attribute for detail view
      row.setAttribute('data-detail-price', String(update.price));

      // Flash animation
      const flashClass = update.price > oldPrice ? 'flash-green' : update.price < oldPrice ? 'flash-red' : '';
      if (flashClass) {
        priceEl.classList.remove('flash-green', 'flash-red');
        // Force reflow to restart animation
        void (priceEl as HTMLElement).offsetWidth;
        priceEl.classList.add(flashClass);
        setTimeout(() => priceEl.classList.remove(flashClass), 600);
      }
    }

    if (changeEl) {
      changeEl.textContent = `${update.change24h >= 0 ? '+' : ''}${update.change24h.toFixed(2)}%`;
      changeEl.className = `market-change ${update.change24h >= 0 ? 'positive' : 'negative'}`;
      row.setAttribute('data-detail-change', String(update.change24h));
    }
  }

  public renderCrypto(data: CryptoData[]): void {
    if (data.length === 0) {
      this.showError('Failed to load crypto data');
      return;
    }

    const html = data
      .map(
        (coin) => `
      <div class="market-item" style="cursor:pointer" data-detail-symbol="${escapeHtml(coin.symbol)}" data-detail-name="${escapeHtml(coin.name)}" data-detail-price="${coin.price}" data-detail-change="${coin.change}">
        <div class="market-info">
          <span class="market-name">${escapeHtml(coin.name)}</span>
          <span class="market-symbol">${escapeHtml(coin.symbol)}</span>
        </div>
        <div class="market-data">
          ${miniSparkline(coin.sparkline, coin.change)}
          <span class="market-price">$${coin.price.toLocaleString()}</span>
          <span class="market-change ${getChangeClass(coin.change)}">${formatChange(coin.change)}</span>
        </div>
      </div>
    `
      )
      .join('');

    this.setContent(html);
    this.content.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-detail-symbol]');
      if (!item) return;
      const symbol = item.dataset.detailSymbol || '';
      const name = item.dataset.detailName || '';
      const price = item.dataset.detailPrice ? Number(item.dataset.detailPrice) : undefined;
      const change24h = item.dataset.detailChange ? Number(item.dataset.detailChange) : undefined;
      window.dispatchEvent(new CustomEvent('detail:open', {
        detail: { type: 'token' as const, data: { symbol, name, price, change24h } }
      }));
    });
  }
}
