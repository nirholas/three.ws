import type { PanelConfig, MapLayers } from '@/types';
import { SITE_VARIANT } from './variant';

/** Gate productivity widgets (Notes, Calendar, etc.) behind a localStorage flag.
 *  Users can enable via Settings → "Show Productivity Widgets". */
const SHOW_PRODUCTIVITY_WIDGETS = typeof localStorage !== 'undefined'
  && localStorage.getItem('hq-show-productivity') === 'true';

// ============================================
// FULL VARIANT (DeFi Command Center)
// ============================================
// Panel order matters! First panels appear at top of grid.
// Priority 1 = core panels, Priority 2 = secondary/optional
const FULL_PANELS: Record<string, PanelConfig> = {
  chart: { name: 'TradingView Chart', enabled: true, priority: 1 },
  'live-news': { name: 'Live News', enabled: true, priority: 1 },

  // === Tier 1: "I will lose money if I miss this" ===
  'defi-news': { name: 'DeFi News', enabled: true, priority: 1 },
  'defi-protocol-news': { name: 'DeFi Protocols', enabled: true, priority: 1 },
  'defi-yields': { name: 'DeFi Yields', enabled: true, priority: 1 },
  'lending-rates': { name: 'Lending Rates', enabled: true, priority: 1 },
  crypto: { name: 'Crypto', enabled: true, priority: 1 },
  polymarket: { name: 'Predictions', enabled: true, priority: 1 },
  'open-interest': { name: 'Open Interest', enabled: true, priority: 1 },
  ai: { name: 'AI/ML', enabled: true, priority: 1 },

  // === Tier 2: "This gives me edge" ===
  'governance': { name: 'Governance', enabled: true, priority: 1 },
  'bitcoin-news': { name: 'Bitcoin News', enabled: true, priority: 1 },
  'ethereum-news': { name: 'Ethereum News', enabled: true, priority: 1 },
  'solana-news': { name: 'Solana News', enabled: true, priority: 1 },
  'funding-rates': { name: 'Funding Rates', enabled: true, priority: 1 },
  'gas-tracker': { name: 'Gas Tracker', enabled: true, priority: 1 },
  'fee-compare': { name: 'Fee Compare', enabled: true, priority: 1 },
  'protocol-health': { name: 'Protocol Health', enabled: true, priority: 1 },
  'venue-spread': { name: 'Venue Spread', enabled: true, priority: 1 },
  'dex-trending': { name: 'DEX Trending', enabled: true, priority: 1 },
  'liquidations': { name: 'Liquidations', enabled: true, priority: 1 },
  'long-short': { name: 'Long/Short Ratio', enabled: true, priority: 1 },
  'protocol-revenue': { name: 'Protocol Revenue', enabled: true, priority: 1 },
  'chain-tvl': { name: 'Chain TVL', enabled: true, priority: 1 },
  'on-chain': { name: 'On-Chain Data', enabled: true, priority: 1 },
  'dex-volume': { name: 'DEX Volume', enabled: true, priority: 1 },
  'exchange-flow': { name: 'Exchange Flow', enabled: true, priority: 1 },
  'chain-activity': { name: 'Chain Activity', enabled: true, priority: 2 },
  'bridge-monitor': { name: 'Bridge Monitor', enabled: true, priority: 1 },
  'hack-alerts': { name: 'Exploit Alerts', enabled: true, priority: 1 },
  'exploit-ledger': { name: 'Exploit Ledger', enabled: true, priority: 2 },
  'mev-monitor': { name: 'MEV Monitor', enabled: true, priority: 1 },
  'token-unlocks': { name: 'Token Unlocks', enabled: true, priority: 1 },
  'btc-network': { name: 'Bitcoin Network', enabled: true, priority: 2 },
  'sector-rotation': { name: 'Sector Rotation', enabled: true, priority: 2 },

  // === Tier 3: Markets & Finance ===
  markets: { name: 'Markets', enabled: true, priority: 1 },
  commodities: { name: 'Commodities', enabled: true, priority: 1 },
  finance: { name: 'Financial', enabled: true, priority: 1 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 1 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 1 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 2 },

  // === Tier 4: News feeds ===
  'crypto-research': { name: 'Crypto Research', enabled: true, priority: 2 },
  'crypto-security': { name: 'Crypto Security', enabled: true, priority: 2 },
  'l1l2-news': { name: 'L1/L2 Ecosystems', enabled: true, priority: 2 },
  'institutional-crypto': { name: 'Institutional Crypto', enabled: true, priority: 2 },
  'crypto-dev': { name: 'Crypto Dev', enabled: true, priority: 2 },
  tech: { name: 'Technology', enabled: true, priority: 2 },
  heatmap: { name: 'Sector Heatmap', enabled: true, priority: 2 },

  // === Analytics & Price widgets ===
  'fear-greed': { name: 'Fear & Greed Index', enabled: true, priority: 2 },
  'market-movers': { name: 'Market Movers', enabled: true, priority: 2 },
  'token-ticker': { name: 'Token Ticker', enabled: true, priority: 2 },
  'trending-tokens': { name: 'Trending Tokens', enabled: true, priority: 2 },
  'morning-briefing': { name: 'Morning Briefing', enabled: true, priority: 2 },

  // === DeFi Markets widgets ===
  'global-stats': { name: 'DeFi Global Stats', enabled: true, priority: 2 },
  'top-protocols': { name: 'Top Protocols', enabled: true, priority: 2 },
  'category-breakdown': { name: 'Category Breakdown', enabled: true, priority: 2 },
  'revenue-earners': { name: 'Revenue Earners', enabled: true, priority: 2 },
  'stablecoin-dashboard': { name: 'Stablecoin Dashboard', enabled: true, priority: 2 },
  'wallet-tracker': { name: 'Wallet Tracker', enabled: true, priority: 1 },
  'top-yields': { name: 'Top Yields', enabled: true, priority: 2 },
  'compare-protocols': { name: 'Compare Protocols', enabled: true, priority: 2 },
  'price-alerts': { name: 'Price Alerts', enabled: true, priority: 2 },

  // === Scanner, Sentiment & Tools ===
  'defi-scanner': { name: 'DeFi Scanner', enabled: true, priority: 2 },
  'social-sentiment': { name: 'Social Sentiment', enabled: true, priority: 2 },

  // === Productivity & Tools (gated behind localStorage flag) ===
  ...(SHOW_PRODUCTIVITY_WIDGETS ? {
    'notes': { name: 'Notes', enabled: true, priority: 2 },
    'calendar': { name: 'Calendar', enabled: true, priority: 2 },
    'reminders': { name: 'Reminders', enabled: true, priority: 2 },
    'alarm': { name: 'Alarm & Timer', enabled: true, priority: 2 },
    'activity-streak': { name: 'Activity Streak', enabled: true, priority: 2 },
    'weather': { name: 'Weather', enabled: true, priority: 2 },
    'calculator': { name: 'Calculator', enabled: true, priority: 2 },
    'notepad': { name: 'Notepad', enabled: true, priority: 2 },
    'photo-gallery': { name: 'Photo Gallery', enabled: true, priority: 2 },
  } : {}),
  'portfolio-dna': { name: 'Portfolio DNA', enabled: true, priority: 2 },


  // === $THREE ===
  'three-signal': { name: '$THREE', enabled: true, priority: 1 },

  // === Aggregated Crypto News ===
  'crypto-news-feed': { name: 'Crypto News Feed', enabled: true, priority: 1 },
  'crypto-trending': { name: 'Trending Topics', enabled: true, priority: 2 },

  // === Always last ===
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const FULL_MAP_LAYERS: MapLayers = {
  conflicts: true,
  bases: true,
  cables: false,
  pipelines: false,
  hotspots: true,
  ais: false,
  nuclear: true,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: true,
  waterways: true,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: true,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  exchangeMap: true,
  // DeFi globe layers
  tvlHeatmap: true,
  chainFlows: true,
  // Tech layers (disabled in full variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // DeFi globe layers
  validatorNodes: true,
  whaleActivity: false,
};

const FULL_MOBILE_MAP_LAYERS: MapLayers = {
  conflicts: true,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: true,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: false,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  exchangeMap: false,
  // DeFi globe layers
  tvlHeatmap: false,
  chainFlows: false,
  // Tech layers (disabled in full variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // DeFi globe layers
  validatorNodes: false,
  whaleActivity: false,
};

// ============================================
// TECH VARIANT (Tech/AI/Startups)
// ============================================
const TECH_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Tech Map', enabled: true, priority: 1 },
  'live-news': { name: 'Tech Headlines', enabled: true, priority: 1 },
  insights: { name: 'AI Insights', enabled: true, priority: 1 },
  ai: { name: 'AI/ML News', enabled: true, priority: 1 },
  tech: { name: 'Technology', enabled: true, priority: 1 },
  startups: { name: 'Startups & VC', enabled: true, priority: 1 },
  vcblogs: { name: 'VC Insights & Essays', enabled: true, priority: 1 },
  regionalStartups: { name: 'Global Startup News', enabled: true, priority: 1 },
  unicorns: { name: 'Unicorn Tracker', enabled: true, priority: 1 },
  accelerators: { name: 'Accelerators & Demo Days', enabled: true, priority: 1 },
  security: { name: 'Cybersecurity', enabled: true, priority: 1 },
  policy: { name: 'AI Policy & Regulation', enabled: true, priority: 1 },
  regulation: { name: 'AI Regulation Dashboard', enabled: true, priority: 1 },
  layoffs: { name: 'Layoffs Tracker', enabled: true, priority: 1 },
  markets: { name: 'Tech Stocks', enabled: true, priority: 2 },
  finance: { name: 'Financial News', enabled: true, priority: 2 },
  crypto: { name: 'Crypto', enabled: true, priority: 2 },
  hardware: { name: 'Semiconductors & Hardware', enabled: true, priority: 2 },
  cloud: { name: 'Cloud & Infrastructure', enabled: true, priority: 2 },
  dev: { name: 'Developer Community', enabled: true, priority: 2 },
  github: { name: 'GitHub Trending', enabled: true, priority: 1 },
  ipo: { name: 'IPO & SPAC', enabled: true, priority: 2 },
  polymarket: { name: 'Tech Predictions', enabled: true, priority: 2 },
  funding: { name: 'Funding & VC', enabled: true, priority: 1 },
  producthunt: { name: 'Product Hunt', enabled: true, priority: 1 },
  events: { name: 'Tech Events', enabled: true, priority: 1 },
  'service-status': { name: 'Service Status', enabled: true, priority: 2 },
  'tech-readiness': { name: 'Tech Readiness Index', enabled: true, priority: 1 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 2 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const TECH_MAP_LAYERS: MapLayers = {
  conflicts: false,
  bases: false,
  cables: true,
  pipelines: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: false,
  weather: true,
  economic: true,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: true,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  exchangeMap: false,
  // DeFi globe layers
  tvlHeatmap: false,
  chainFlows: false,
  // Tech layers (enabled in tech variant)
  startupHubs: true,
  cloudRegions: true,
  accelerators: false,
  techHQs: true,
  techEvents: true,
  // DeFi globe layers
  validatorNodes: false,
  whaleActivity: false,
};

const TECH_MOBILE_MAP_LAYERS: MapLayers = {
  conflicts: false,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: false,
  weather: false,
  economic: false,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: true,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  exchangeMap: false,
  // DeFi globe layers
  tvlHeatmap: false,
  chainFlows: false,
  // Tech layers (limited on mobile)
  startupHubs: true,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: true,
  // DeFi globe layers
  validatorNodes: false,
  whaleActivity: false,
};

// ============================================
// VARIANT-AWARE EXPORTS
// ============================================
export const DEFAULT_PANELS = SITE_VARIANT === 'tech' ? TECH_PANELS : FULL_PANELS;
export const DEFAULT_MAP_LAYERS = SITE_VARIANT === 'tech' ? TECH_MAP_LAYERS : FULL_MAP_LAYERS;
export const MOBILE_DEFAULT_MAP_LAYERS = SITE_VARIANT === 'tech' ? TECH_MOBILE_MAP_LAYERS : FULL_MOBILE_MAP_LAYERS;

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

export const STORAGE_KEYS = {
  panels: 'hq-panels',
  monitors: 'hq-monitors',
  mapLayers: 'hq-layers',
  disabledFeeds: 'hq-disabled-feeds',
  activeTemplate: 'hq-active-template',
  customTemplates: 'hq-custom-templates',
} as const;

/* ── Dashboard Templates ──────────────────────────────────────── */

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** true = chart-section visible at top */
  chartVisible: boolean;
  /** Ordered panel keys to show (all others hidden) */
  panelOrder: string[];
  /** Panel keys that include a TV widget chart in the grid */
  tvWidgetSlots?: Array<{ afterPanel: string; symbol: string; interval: string }>;
  /** Is this a user-created custom template? */
  custom?: boolean;
}

/**
 * The "wow" template - clean dashboard, no top chart, just widgets.
 * Based on the user's screenshot.
 */
const WOW_TEMPLATE: DashboardTemplate = {
  id: 'wow',
  name: 'Clean Dashboard',
  description: 'No chart - pure widget grid. News, crypto, DeFi, predictions.',
  icon: '✨',
  chartVisible: false,
  panelOrder: [
    'live-news',
    'defi-news', 'defi-protocol-news',
    'trending-tokens', 'crypto', 'polymarket',
    'open-interest',
    'ai',
    'bitcoin-news', 'ethereum-news', 'solana-news',
    'funding-rates',
    'gas-tracker', 'dex-trending',
    'liquidations', 'long-short', 'protocol-revenue',
  ],
};

/**
 * The "trader" template - replaces bottom-row panels with TV chart widgets.
 * Solana News, Funding Rates, Long/Short, Protocol Revenue → 4 chart widgets.
 */
const TRADER_TEMPLATE: DashboardTemplate = {
  id: 'trader',
  name: 'Trader View',
  description: 'Top chart + 4 chart widgets replacing bottom panels.',
  icon: '📊',
  chartVisible: true,
  panelOrder: [
    'live-news',
    'defi-news', 'defi-protocol-news',
    'trending-tokens', 'crypto', 'polymarket',
    'open-interest',
    'ai',
    'bitcoin-news', 'ethereum-news',
    'gas-tracker', 'dex-trending', 'liquidations',
    'tv-widget-t1', 'tv-widget-t2', 'tv-widget-t3', 'tv-widget-t4',
  ],
  tvWidgetSlots: [
    { afterPanel: 'liquidations', symbol: 'BINANCE:SOLUSDT', interval: 'D' },
    { afterPanel: 'tv-widget-t1', symbol: 'BINANCE:ETHUSDT', interval: '240' },
    { afterPanel: 'tv-widget-t2', symbol: 'BINANCE:ARBUSDT', interval: 'D' },
    { afterPanel: 'tv-widget-t3', symbol: 'GATEIO:SPAUSDT', interval: 'D' },
  ],
};

/**
 * Default template - everything on, standard layout.
 */
const DEFAULT_TEMPLATE: DashboardTemplate = {
  id: 'default',
  name: 'Full Dashboard',
  description: 'All panels enabled, chart on top. The original layout.',
  icon: '🏠',
  chartVisible: true,
  panelOrder: [], // empty = use default panel order, all enabled
};

/**
 * DeFi Focus template.
 */
const DEFI_TEMPLATE: DashboardTemplate = {
  id: 'defi',
  name: 'DeFi Focus',
  description: 'DeFi yields, protocols, TVL, fees - everything DeFi.',
  icon: '🏦',
  chartVisible: true,
  panelOrder: [
    'live-news',
    'defi-news', 'defi-protocol-news', 'defi-yields',
    'crypto', 'chain-tvl', 'dex-volume',
    'protocol-revenue', 'top-protocols', 'global-stats',
    'category-breakdown', 'revenue-earners',
    'stablecoin-dashboard', 'stablecoins',
    'protocol-health',
    'gas-tracker', 'fee-compare', 'hack-alerts', 'mev-monitor',
  ],
};

/**
 * News & Intel template.
 */
const NEWS_TEMPLATE: DashboardTemplate = {
  id: 'news',
  name: 'News & Intel',
  description: 'All news feeds, prediction markets, AI analysis.',
  icon: '📰',
  chartVisible: false,
  panelOrder: [
    'live-news',
    'defi-news', 'defi-protocol-news',
    'ai',
    'bitcoin-news', 'ethereum-news', 'solana-news',
    'crypto-research', 'crypto-security',
    'l1l2-news', 'institutional-crypto', 'crypto-dev',
    'tech', 'polymarket',
    'morning-briefing', 'social-sentiment',
  ],
};

/**
 * Markets template - markets-focused panels, charts, and crypto data.
 */
const MARKETS_TEMPLATE: DashboardTemplate = {
  id: 'markets',
  name: 'Markets',
  description: 'Stock indices, crypto, commodities, heatmap, ETFs, fear & greed.',
  icon: '💹',
  chartVisible: true,
  panelOrder: [
    'crypto', 'markets', 'heatmap', 'commodities',
    'trending-tokens', 'market-movers', 'token-ticker',
    'fear-greed', 'etf-flows',
    'open-interest', 'funding-rates', 'long-short',
    'liquidations', 'dex-trending', 'dex-volume',
    'stablecoins', 'gas-tracker', 'fee-compare', 'mev-monitor',
  ],
};

/**
 * Minimal template - bare essentials for a quick overview.
 */
const MINIMAL_TEMPLATE: DashboardTemplate = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Just the essentials - live news, crypto prices, and a chart.',
  icon: '🧘',
  chartVisible: true,
  panelOrder: [
    'live-news',
    'crypto',
    'fear-greed',
    'polymarket',
  ],
};

export const BUILTIN_TEMPLATES: DashboardTemplate[] = [
  DEFAULT_TEMPLATE,
  WOW_TEMPLATE,
  TRADER_TEMPLATE,
  DEFI_TEMPLATE,
  NEWS_TEMPLATE,
  MARKETS_TEMPLATE,
  MINIMAL_TEMPLATE,
];
