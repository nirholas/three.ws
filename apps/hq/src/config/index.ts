// Configuration exports
// For variant-specific builds, set VITE_VARIANT environment variable
// VITE_VARIANT=tech → tech-focused
// VITE_VARIANT=full → geopolitical

export { SITE_VARIANT } from './variant';

// Shared base configuration (always included)
export {
  API_URLS,
  REFRESH_INTERVALS,
  MONITOR_COLORS,
  STORAGE_KEYS,
} from './variants/base';

// Market data (shared)
export { SECTORS, COMMODITIES, MARKET_SYMBOLS, CRYPTO_MAP } from './markets';

// Geo data (shared base)
export { UNDERSEA_CABLES, MAP_URLS } from './geo';

// AI Datacenters (shared)
export { AI_DATA_CENTERS } from './ai-datacenters';

// Feeds configuration (shared functions, variant-specific data)
export {
  getSourceTier,
} from './feeds';

// Panel configuration - imported from panels.ts
export {
  DEFAULT_PANELS,
  DEFAULT_MAP_LAYERS,
  MOBILE_DEFAULT_MAP_LAYERS,
} from './panels';

// ============================================
// VARIANT-SPECIFIC EXPORTS
// Only import what's needed for each variant
// ============================================

// Full variant (geopolitical) - only included in full builds
// These are large data files that should be tree-shaken in tech builds
export {
  FEEDS,
  RESEARCH_SOURCES,
} from './feeds';

export {
  FOCUS_AREAS,
  RISK_REGIONS,
  TRACKED_FACILITIES,
  ENERGY_FACILITIES,
  APT_GROUPS,
  KEY_WATERWAYS,
  ECONOMIC_CENTERS,
  FLAGGED_COUNTRIES,
  SPACEPORTS,
  CRITICAL_MINERALS,
} from './geo';

export { GAMMA_IRRADIATORS } from './irradiators';
export { PIPELINES, PIPELINE_COLORS } from './pipelines';
export { PORTS } from './ports';


// Tech variant - these are included in tech builds
export {
  STARTUP_HUBS,
  ACCELERATORS,
  TECH_HQS,
  CLOUD_REGIONS,
} from './tech-geo';

// Crypto exchange & regulatory data (DeFi globe layers)
export { CRYPTO_EXCHANGES } from './crypto-exchanges';
export { REGULATION_BY_COUNTRY, REGULATION_COLORS } from './crypto-regulation';
