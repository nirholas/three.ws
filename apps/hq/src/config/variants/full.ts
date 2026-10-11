// Full geopolitical variant
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

// Re-export base config
export * from './base';

// Geopolitical-specific exports
export * from '../feeds';
export * from '../geo';
export * from '../irradiators';
export * from '../pipelines';
export * from '../ports';
export * from '../military';
export * from '../airports';
export * from '../entities';

// Panel configuration for DeFi command center
// NOTE: This is a SECONDARY reference. The ACTUAL runtime config
// lives in src/config/panels.ts (FULL_PANELS). Keep these in sync.
// App.ts imports DEFAULT_PANELS from src/config/panels.ts via src/config/index.ts.
export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Map', enabled: true, priority: 1 },
  'live-news': { name: 'Live News', enabled: true, priority: 1 },
  'defi-news': { name: 'DeFi News', enabled: true, priority: 1 },
  'defi-protocol-news': { name: 'DeFi Protocols', enabled: true, priority: 1 },
  'defi-yields': { name: 'DeFi Yields', enabled: true, priority: 1 },
  crypto: { name: 'Crypto', enabled: true, priority: 1 },
  polymarket: { name: 'Predictions', enabled: true, priority: 1 },
  'open-interest': { name: 'Open Interest', enabled: true, priority: 1 },
  ai: { name: 'AI/ML', enabled: true, priority: 1 },
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
  'dex-volume': { name: 'DEX Volume', enabled: true, priority: 1 },
  'hack-alerts': { name: 'Exploit Alerts', enabled: true, priority: 1 },
  markets: { name: 'Markets', enabled: true, priority: 1 },
  commodities: { name: 'Commodities', enabled: true, priority: 1 },
  finance: { name: 'Financial', enabled: true, priority: 1 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 1 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 1 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 2 },
  tech: { name: 'Technology', enabled: true, priority: 2 },
  heatmap: { name: 'Sector Heatmap', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

// Map layers for geopolitical view
export const DEFAULT_MAP_LAYERS: MapLayers = {
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
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // DeFi globe layers
  exchangeMap: true,
  tvlHeatmap: true,
  chainFlows: true,
  validatorNodes: true,
  whaleActivity: false,
  // Tech layers (disabled in full variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
};

// Mobile-specific defaults for geopolitical
export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = {
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
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // DeFi globe layers
  exchangeMap: false,
  tvlHeatmap: false,
  chainFlows: false,
  validatorNodes: false,
  whaleActivity: false,
  // Tech layers (disabled in full variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
};

export const VARIANT_CONFIG: VariantConfig = {
  name: 'full',
  description: 'Full DeFi & crypto intelligence dashboard',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
