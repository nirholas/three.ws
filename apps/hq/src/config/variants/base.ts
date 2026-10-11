// Base configuration shared across all variants
import type { PanelConfig, MapLayers } from '@/types';

// Shared exports (re-exported by all variants)
export { SECTORS, COMMODITIES, MARKET_SYMBOLS } from '../markets';
export { UNDERSEA_CABLES } from '../geo';
export { AI_DATA_CENTERS } from '../ai-datacenters';

// API URLs - shared across all variants
export const API_URLS = {
  finnhub: (symbols: string[]) =>
    `/api/finnhub?symbols=${symbols.map(s => encodeURIComponent(s)).join(',')}`,
  yahooFinance: (symbol: string) =>
    `/api/yahoo-finance?symbol=${encodeURIComponent(symbol)}`,
  coingecko:
    '/api/coingecko?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
  polymarket: '/api/polymarket?closed=false&order=volume&ascending=false&limit=100',
  earthquakes: '/api/earthquakes',
  // Tech variant APIs
  arxiv: (category: string = 'cs.AI', maxResults: number = 50) =>
    `/api/arxiv?category=${encodeURIComponent(category)}&max_results=${maxResults}`,
  githubTrending: (language: string = 'python', since: string = 'daily') =>
    `/api/github-trending?language=${encodeURIComponent(language)}&since=${since}`,
  hackernews: (type: string = 'top', limit: number = 30) =>
    `/api/hackernews?type=${type}&limit=${limit}`,
  // Crypto news aggregation
  cryptoNews: (options?: { limit?: number; category?: string; breaking?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.category && options.category !== 'all') params.set('category', options.category);
    if (options?.breaking) params.set('breaking', 'true');
    const qs = params.toString();
    return `/api/crypto-news${qs ? `?${qs}` : ''}`;
  },
  cryptoTrending: '/api/crypto-trending',
};

// Refresh intervals - shared across all variants
export const REFRESH_INTERVALS = {
  feeds: 5 * 60 * 1000,
  markets: 2 * 60 * 1000,
  crypto: 2 * 60 * 1000,
  predictions: 5 * 60 * 1000,
  ais: 10 * 60 * 1000,
  arxiv: 60 * 60 * 1000,
  githubTrending: 30 * 60 * 1000,
  hackernews: 5 * 60 * 1000,
};

// Monitor colors - shared
export const MONITOR_COLORS = [
  '#44ff88',
  '#ff8844',
  '#4488ff',
  '#ff44ff',
  '#ffff44',
  '#ff4444',
  '#44ffff',
  '#88ff44',
  '#ff88ff',
  '#88ffff',
];

// Storage keys - shared
export const STORAGE_KEYS = {
  panels: 'hq-panels',
  monitors: 'hq-monitors',
  mapLayers: 'hq-layers',
  disabledFeeds: 'hq-disabled-feeds',
  activeTemplate: 'hq-active-template',
  customTemplates: 'hq-custom-templates',
} as const;

// Type definitions for variant configs
export interface VariantConfig {
  name: string;
  description: string;
  panels: Record<string, PanelConfig>;
  mapLayers: MapLayers;
  mobileMapLayers: MapLayers;
}
