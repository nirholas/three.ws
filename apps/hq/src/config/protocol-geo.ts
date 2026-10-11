/**
 * Protocol Geographic Registry
 * Maps top DeFi protocols to their headquarters/team base locations.
 * Used to create a TVL geographic heatmap on the 3D globe.
 *
 * Sources: DeFiLlama slugs, public company registrations, team disclosures.
 * "Remote" protocols are assigned their best-known operational hub.
 */

export interface ProtocolLocation {
  name: string;           // Must match DeFiLlama protocol name/slug
  slug: string;           // DeFiLlama slug
  lat: number;
  lon: number;
  city: string;
  country: string;
  region: 'north-america' | 'europe' | 'asia' | 'other';
}

export const PROTOCOL_LOCATIONS: ProtocolLocation[] = [
  // ─── North America ────────────────────────────────────────────
  { name: 'Uniswap', slug: 'uniswap', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Compound', slug: 'compound', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Convex Finance', slug: 'convex-finance', lat: 40.7128, lon: -74.0060, city: 'Remote/US', country: 'US', region: 'north-america' },
  { name: 'Eigenlayer', slug: 'eigenlayer', lat: 47.6062, lon: -122.3321, city: 'Seattle', country: 'US', region: 'north-america' },
  { name: 'Jito', slug: 'jito', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'dYdX', slug: 'dydx', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Ondo Finance', slug: 'ondo-finance', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Hyperliquid', slug: 'hyperliquid', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Coinbase Wrapped Staked ETH', slug: 'coinbase-wrapped-staked-eth', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Solana Marinade DeFi', slug: 'marinade-native', lat: 40.7128, lon: -74.0060, city: 'Remote/US', country: 'US', region: 'north-america' },
  { name: 'Drift Protocol', slug: 'drift-protocol', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Kamino', slug: 'kamino', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Maple', slug: 'maple', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Ribbon Finance', slug: 'ribbon-finance', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Radiant Capital', slug: 'radiant-capital', lat: 34.0522, lon: -118.2437, city: 'Los Angeles', country: 'US', region: 'north-america' },
  { name: 'Aptos DeFi', slug: 'thala', lat: 37.3382, lon: -121.8863, city: 'San Jose', country: 'US', region: 'north-america' },
  { name: 'Sky', slug: 'sky-ecosystem', lat: 55.6761, lon: 12.5683, city: 'Copenhagen', country: 'DK', region: 'europe' },
  { name: 'Solend', slug: 'solend', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Sanctum', slug: 'sanctum', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Tensor', slug: 'tensor', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Phantom', slug: 'phantom', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Polymarket', slug: 'polymarket', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Orca', slug: 'orca', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Zeta Markets', slug: 'zeta', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Parcl', slug: 'parcl', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'marginfi', slug: 'marginfi', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Meteora', slug: 'meteora', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Flashbots', slug: 'flashbots', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Across Protocol', slug: 'across', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Euler', slug: 'euler', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },

  // ─── Europe ───────────────────────────────────────────────────
  { name: 'Lido', slug: 'lido', lat: 50.0755, lon: 14.4378, city: 'Remote/EU', country: 'EU', region: 'europe' },
  { name: 'Aave', slug: 'aave', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'MakerDAO', slug: 'makerdao', lat: 55.6761, lon: 12.5683, city: 'Copenhagen', country: 'DK', region: 'europe' },
  { name: 'Curve Finance', slug: 'curve-dex', lat: 46.2044, lon: 6.1432, city: 'Remote/CH', country: 'CH', region: 'europe' },
  { name: 'Marinade', slug: 'marinade-finance', lat: 50.0755, lon: 14.4378, city: 'Prague', country: 'CZ', region: 'europe' },
  { name: 'Morpho', slug: 'morpho', lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  { name: 'Usual', slug: 'usual', lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  { name: 'Spark Protocol', slug: 'spark', lat: 55.6761, lon: 12.5683, city: 'Copenhagen', country: 'DK', region: 'europe' },
  { name: 'Balancer', slug: 'balancer', lat: 46.2044, lon: 6.1432, city: 'Remote/CH', country: 'CH', region: 'europe' },
  { name: 'Yearn Finance', slug: 'yearn-finance', lat: 51.5074, lon: -0.1278, city: 'Remote/Global', country: 'UK', region: 'europe' },
  { name: 'Frax Finance', slug: 'frax', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Gnosis', slug: 'gnosis', lat: 52.5200, lon: 13.4050, city: 'Berlin', country: 'DE', region: 'europe' },
  { name: 'SSV Network', slug: 'ssv-network', lat: 32.0853, lon: 34.7818, city: 'Tel Aviv', country: 'IL', region: 'europe' },
  { name: 'CoW Protocol', slug: 'cow-protocol', lat: 52.5200, lon: 13.4050, city: 'Berlin', country: 'DE', region: 'europe' },
  { name: 'Paraswap', slug: 'paraswap', lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  { name: 'StakeWise', slug: 'stakewise', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'Stargate Finance', slug: 'stargate', lat: 52.3676, lon: 4.9041, city: 'Amsterdam', country: 'NL', region: 'europe' },
  { name: 'Swell', slug: 'swell', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'EtherFi', slug: 'ether.fi', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'Kelp DAO', slug: 'kelp-dao', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'Renzo', slug: 'renzo', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'Puffer Finance', slug: 'puffer-finance', lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'CH', region: 'europe' },
  { name: 'Sommelier', slug: 'sommelier', lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'CH', region: 'europe' },
  { name: 'Nexus Mutual', slug: 'nexus-mutual', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'dForce', slug: 'dforce', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'Ampleforth', slug: 'ampleforth', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'mETH Protocol', slug: 'mantle-staked-ether', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Stader', slug: 'stader', lat: 12.9716, lon: 77.5946, city: 'Bangalore', country: 'IN', region: 'asia' },
  { name: 'Angle', slug: 'angle', lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },

  // ─── Asia ─────────────────────────────────────────────────────
  { name: 'Jupiter', slug: 'jupiter', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Raydium', slug: 'raydium', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Pendle', slug: 'pendle', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'GMX', slug: 'gmx', lat: 1.3521, lon: 103.8198, city: 'Remote/Asia', country: 'SG', region: 'asia' },
  { name: 'Ethena', slug: 'ethena', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'PancakeSwap', slug: 'pancakeswap', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'SushiSwap', slug: 'sushiswap', lat: 35.6762, lon: 139.6503, city: 'Remote/Global', country: 'JP', region: 'asia' },
  { name: 'Instadapp', slug: 'instadapp', lat: 19.0760, lon: 72.8777, city: 'Mumbai', country: 'IN', region: 'asia' },
  { name: 'Venus', slug: 'venus', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Alpaca Finance', slug: 'alpaca-finance', lat: 13.7563, lon: 100.5018, city: 'Bangkok', country: 'TH', region: 'asia' },
  { name: 'Benqi', slug: 'benqi', lat: 43.6532, lon: -79.3832, city: 'Toronto', country: 'CA', region: 'north-america' },
  { name: 'BakerySwap', slug: 'bakeryswap', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Wombat Exchange', slug: 'wombat-exchange', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Trader Joe', slug: 'trader-joe', lat: 49.2827, lon: -123.1207, city: 'Vancouver', country: 'CA', region: 'north-america' },
  { name: 'Biswap', slug: 'biswap', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'AAVE V3 (various)', slug: 'aave-v3', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'Mantle', slug: 'mantle', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'THORChain', slug: 'thorchain', lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'AU', region: 'other' },
  { name: 'Woo Network', slug: 'woofi', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'KyberSwap', slug: 'kyberswap', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Camelot', slug: 'camelot', lat: 1.3521, lon: 103.8198, city: 'Remote/Asia', country: 'SG', region: 'asia' },
  { name: 'Liquid Staking (Binance)', slug: 'binance-staked-eth', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Hashflow', slug: 'hashflow', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Aerodrome', slug: 'aerodrome', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Velodrome', slug: 'velodrome', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'LayerZero', slug: 'layerzero', lat: 49.2827, lon: -123.1207, city: 'Vancouver', country: 'CA', region: 'north-america' },
  { name: 'Wormhole', slug: 'wormhole', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Blast', slug: 'blast', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'ZKsync', slug: 'zksync-era', lat: 52.5200, lon: 13.4050, city: 'Berlin', country: 'DE', region: 'europe' },
  { name: 'Scroll', slug: 'scroll', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Linea', slug: 'linea', lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  { name: 'StarkNet', slug: 'starknet', lat: 32.0853, lon: 34.7818, city: 'Tel Aviv', country: 'IL', region: 'europe' },
  { name: 'Base', slug: 'base', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Optimism', slug: 'optimism', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Arbitrum', slug: 'arbitrum', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Polygon', slug: 'polygon', lat: 19.0760, lon: 72.8777, city: 'Mumbai', country: 'IN', region: 'asia' },

  // ─── Other ────────────────────────────────────────────────────
  { name: 'Rocket Pool', slug: 'rocket-pool', lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'AU', region: 'other' },
  { name: 'Synthetix', slug: 'synthetix', lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'AU', region: 'other' },
  { name: '1inch', slug: '1inch-network', lat: 25.2048, lon: 55.2708, city: 'Dubai', country: 'AE', region: 'other' },
  { name: 'Tron DeFi', slug: 'justlend', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Anchor Protocol', slug: 'anchor', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Maverick Protocol', slug: 'maverick-protocol', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'SpiritSwap', slug: 'spiritswap', lat: 25.2048, lon: 55.2708, city: 'Remote/Global', country: 'AE', region: 'other' },
  { name: 'SpookySwap', slug: 'spookyswap', lat: 40.7128, lon: -74.0060, city: 'Remote/US', country: 'US', region: 'north-america' },
  { name: 'Cream Finance', slug: 'cream-finance', lat: 25.0330, lon: 121.5654, city: 'Taipei', country: 'TW', region: 'asia' },
  { name: 'Celer', slug: 'celer-cbridge', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Synapse', slug: 'synapse', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Hop Protocol', slug: 'hop-protocol', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Abracadabra', slug: 'abracadabra', lat: 41.9028, lon: 12.4964, city: 'Remote/EU', country: 'IT', region: 'europe' },
  { name: 'Beefy', slug: 'beefy', lat: -33.8688, lon: 151.2093, city: 'Remote/Global', country: 'AU', region: 'other' },
  { name: 'Badger DAO', slug: 'badger-dao', lat: 40.7128, lon: -74.0060, city: 'Remote/US', country: 'US', region: 'north-america' },
  { name: 'Osmosis', slug: 'osmosis-dex', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Silo Finance', slug: 'silo-finance', lat: 48.2082, lon: 16.3738, city: 'Vienna', country: 'AT', region: 'europe' },
  { name: 'Harvest Finance', slug: 'harvest-finance', lat: 51.5074, lon: -0.1278, city: 'Remote/EU', country: 'UK', region: 'europe' },
  { name: 'BProtocol', slug: 'bprotocol', lat: 32.0853, lon: 34.7818, city: 'Tel Aviv', country: 'IL', region: 'europe' },
  { name: 'Tokemak', slug: 'tokemak', lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', region: 'north-america' },
  { name: 'Redacted Cartel', slug: 'redacted', lat: 40.7128, lon: -74.0060, city: 'Remote/US', country: 'US', region: 'north-america' },
  { name: 'Goldfinch', slug: 'goldfinch', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Clearpool', slug: 'clearpool', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'TrueFi', slug: 'truefi', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Centrifuge', slug: 'centrifuge', lat: 52.5200, lon: 13.4050, city: 'Berlin', country: 'DE', region: 'europe' },
  { name: 'Notional Finance', slug: 'notional', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Umami Finance', slug: 'umami-finance', lat: 40.7128, lon: -74.0060, city: 'Remote/US', country: 'US', region: 'north-america' },
  { name: 'Gains Network', slug: 'gains-network', lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  { name: 'Level Finance', slug: 'level-finance', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  { name: 'Vertex Protocol', slug: 'vertex-protocol', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Prisma Finance', slug: 'prisma-finance', lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'CH', region: 'europe' },
  { name: 'Liquity', slug: 'liquity', lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'CH', region: 'europe' },
  { name: 'Aura Finance', slug: 'aura', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'Origin Protocol', slug: 'origin-dollar', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Reflexer', slug: 'reflexer', lat: 41.9028, lon: 12.4964, city: 'Remote/EU', country: 'IT', region: 'europe' },
  { name: 'Idle Finance', slug: 'idle-finance', lat: 41.9028, lon: 12.4964, city: 'Rome', country: 'IT', region: 'europe' },
  { name: 'mStable', slug: 'mstable', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'Tempus Finance', slug: 'tempus-finance', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  { name: 'Opyn', slug: 'opyn', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  { name: 'Perpetual Protocol', slug: 'perpetual-protocol', lat: 25.0330, lon: 121.5654, city: 'Taipei', country: 'TW', region: 'asia' },
  { name: 'DODO', slug: 'dodo', lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
];

/**
 * Build a slug → location lookup for quick matching with DeFiLlama data.
 */
export function buildProtocolGeoLookup(): Map<string, ProtocolLocation> {
  const map = new Map<string, ProtocolLocation>();
  for (const p of PROTOCOL_LOCATIONS) {
    map.set(p.slug.toLowerCase(), p);
  }
  return map;
}
