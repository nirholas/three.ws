/**
 * Declarative table that decides which blocks each protocol dashboard shows.
 * api/protocol-dashboard.js reads this and nothing else: adding a protocol is a
 * data change here, not a code branch. `match` lists DeFiLlama slugs.
 *
 * Block ids (implemented in protocol-dashboard.js):
 *   tvl-chains, tvl-history, fees, yields, price, token-breakdown   generic, keyless DeFiLlama
 *   uniswap-lp          pool depth plus fees versus impermanent loss over a window
 *   lending-rates       supply and borrow rates and utilization per market
 *   aave-health         health-factor distribution (needs per-account positions)
 *   lido-staking        stake, holders and staking rate from Lido's public API
 *   hyperliquid-markets perp funding, open interest and volume from Hyperliquid's public info API
 */
export const GENERIC_BLOCKS = ['tvl-history', 'tvl-chains', 'fees', 'yields', 'price'];

export const DASHBOARDS = [
  { id: 'uniswap', label: 'Uniswap', match: ['uniswap-v3', 'uniswap-v2', 'uniswap-v4'], yieldsProjects: ['uniswap-v3'], extra: ['uniswap-lp'] },
  { id: 'aave', label: 'Aave', match: ['aave-v3', 'aave-v2', 'aave-v4'], yieldsProjects: ['aave-v3'], extra: ['lending-rates', 'aave-health'] },
  { id: 'sky', label: 'Maker / Sky', match: ['sky-lending', 'makerdao', 'maker'], yieldsProjects: ['sky-lending', 'maker-dsr', 'spark-savings'], extra: [] },
  { id: 'lido', label: 'Lido', match: ['lido'], yieldsProjects: ['lido'], extra: ['lido-staking'] },
  { id: 'eigenlayer', label: 'EigenLayer', match: ['eigenlayer', 'eigencloud'], yieldsProjects: ['eigenlayer'], extra: ['token-breakdown'] },
  { id: 'hyperliquid', label: 'Hyperliquid', match: ['hyperliquid-perps', 'hyperliquid', 'hyperliquid-spot-orderbook'], yieldsProjects: [], extra: ['hyperliquid-markets'] },
  { id: 'kamino', label: 'Kamino', match: ['kamino-lend', 'kamino-liquidity', 'kamino'], yieldsProjects: ['kamino-lend', 'kamino-liquidity'], extra: ['lending-rates'] },
];

/**
 * Resolve the dashboard definition for a slug. An unlisted protocol still gets
 * the generic blocks, with its own slug as the yields project.
 */
export function resolveDashboard(slug) {
  const entry = DASHBOARDS.find((d) => d.match.includes(slug));
  const generic = GENERIC_BLOCKS.filter((b) => !(entry && entry.yieldsProjects.length === 0 && b === 'yields'));
  return {
    id: entry?.id || 'generic',
    label: entry?.label || null,
    yieldsProjects: entry ? entry.yieldsProjects : [slug],
    blocks: [...generic, ...(entry?.extra || [])],
  };
}
