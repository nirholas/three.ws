/**
 * Chain Geographic Centers - maps blockchain networks to representative
 * coordinates based on founding team / ecosystem center locations.
 * Used by the Chain Flows ArcLayer on the 3D globe.
 */

export interface ChainLocation {
  chainId: string;        // DeFiLlama chain name lowercase
  name: string;
  lat: number;
  lon: number;
  city: string;
  color: [number, number, number]; // RGB for arc coloring
}

// Chains co-located in the same city are offset ±0.3-0.5° so arcs are visually distinct
export const CHAIN_LOCATIONS: Record<string, ChainLocation> = {
  // L1s
  ethereum:  { chainId: 'ethereum',  name: 'Ethereum',     lat: 47.3769,  lon: 8.5417,    city: 'Zug',           color: [98, 126, 234]  },
  solana:    { chainId: 'solana',    name: 'Solana',        lat: 37.7749,  lon: -122.4194, city: 'San Francisco', color: [153, 69, 255]  },
  bsc:       { chainId: 'bsc',       name: 'BNB Chain',     lat: 1.3521,   lon: 103.8198,  city: 'Singapore',     color: [243, 186, 47]  },
  tron:      { chainId: 'tron',      name: 'Tron',          lat: 37.5665,  lon: 126.978,   city: 'Seoul',         color: [255, 6, 10]    },
  avalanche: { chainId: 'avalanche', name: 'Avalanche',     lat: 40.7128,  lon: -74.006,   city: 'New York',      color: [232, 65, 66]   },
  fantom:    { chainId: 'fantom',    name: 'Fantom',        lat: -33.8688, lon: 151.2093,  city: 'Sydney',        color: [19, 181, 236]  },
  cardano:   { chainId: 'cardano',   name: 'Cardano',       lat: 47.0707,  lon: 15.4395,   city: 'Graz',          color: [0, 51, 173]    },
  polkadot:  { chainId: 'polkadot',  name: 'Polkadot',      lat: 47.42,    lon: 8.58,      city: 'Zug',           color: [230, 0, 122]   },
  cosmos:    { chainId: 'cosmos',    name: 'Cosmos',        lat: 52.52,    lon: 13.405,    city: 'Berlin',        color: [111, 111, 218] },
  near:      { chainId: 'near',      name: 'NEAR',          lat: 37.82,    lon: -122.47,   city: 'San Francisco', color: [0, 236, 151]   },
  algorand:  { chainId: 'algorand',  name: 'Algorand',      lat: 42.3601,  lon: -71.0589,  city: 'Boston',        color: [0, 0, 0]       },
  ton:       { chainId: 'ton',       name: 'TON',           lat: 25.2048,  lon: 55.2708,   city: 'Dubai',         color: [0, 136, 204]   },

  // L2s - Ethereum rollups
  arbitrum:  { chainId: 'arbitrum',  name: 'Arbitrum',      lat: 40.76,    lon: -73.96,    city: 'New York',      color: [40, 160, 240]  },
  optimism:  { chainId: 'optimism',  name: 'Optimism',      lat: 37.73,    lon: -122.38,   city: 'San Francisco', color: [255, 4, 32]    },
  base:      { chainId: 'base',      name: 'Base',          lat: 37.82,    lon: -122.36,   city: 'San Francisco', color: [0, 82, 255]    },
  polygon:   { chainId: 'polygon',   name: 'Polygon',       lat: 19.076,   lon: 72.8777,   city: 'Mumbai',        color: [130, 71, 229]  },
  zksync:    { chainId: 'zksync era', name: 'zkSync Era',   lat: 52.52,    lon: 13.45,     city: 'Berlin',        color: [69, 100, 230]  },
  starknet:  { chainId: 'starknet',  name: 'Starknet',      lat: 32.0853,  lon: 34.7818,   city: 'Tel Aviv',      color: [0, 0, 128]     },
  linea:     { chainId: 'linea',     name: 'Linea',         lat: 48.8566,  lon: 2.3522,    city: 'Paris',         color: [97, 223, 255]  },
  scroll:    { chainId: 'scroll',    name: 'Scroll',        lat: 31.2304,  lon: 121.4737,  city: 'Shanghai',      color: [255, 228, 180] },
  mantle:    { chainId: 'mantle',    name: 'Mantle',        lat: 22.3193,  lon: 114.1694,  city: 'Hong Kong',     color: [0, 0, 0]       },
  blast:     { chainId: 'blast',     name: 'Blast',         lat: 37.39,    lon: -122.08,   city: 'Mountain View', color: [252, 252, 3]   },
  manta:     { chainId: 'manta',     name: 'Manta Pacific', lat: 1.40,     lon: 103.87,    city: 'Singapore',     color: [0, 179, 255]   },
  mode:      { chainId: 'mode',      name: 'Mode',          lat: 37.44,    lon: -122.16,   city: 'Palo Alto',     color: [223, 254, 0]   },

  // Alt L1s / side-chains
  sui:       { chainId: 'sui',       name: 'Sui',           lat: 37.4419,  lon: -122.143,  city: 'Palo Alto',     color: [77, 162, 255]  },
  aptos:     { chainId: 'aptos',     name: 'Aptos',         lat: 37.49,    lon: -122.18,   city: 'Palo Alto',     color: [0, 191, 165]   },
  sei:       { chainId: 'sei',       name: 'Sei',           lat: 37.80,    lon: -122.41,   city: 'San Francisco', color: [129, 29, 29]   },
  celo:      { chainId: 'celo',      name: 'Celo',          lat: 37.79,    lon: -122.44,   city: 'San Francisco', color: [53, 208, 127]  },
  gnosis:    { chainId: 'gnosis',    name: 'Gnosis',        lat: 52.47,    lon: 13.36,     city: 'Berlin',        color: [3, 135, 113]   },
  moonbeam:  { chainId: 'moonbeam',  name: 'Moonbeam',      lat: 42.36,    lon: -71.10,    city: 'Boston',        color: [83, 203, 195]  },
  cronos:    { chainId: 'cronos',    name: 'Cronos',        lat: 1.30,     lon: 103.78,    city: 'Singapore',     color: [0, 45, 114]    },
  klaytn:    { chainId: 'klaytn',    name: 'Klaytn',        lat: 37.52,    lon: 127.02,    city: 'Seoul',         color: [76, 26, 0]     },
  harmony:   { chainId: 'harmony',   name: 'Harmony',       lat: 37.38,    lon: -122.08,   city: 'Mountain View', color: [0, 174, 233]   },
};

/**
 * Normalize a chain name from DeFiLlama to a CHAIN_LOCATIONS key.
 * Handles common variations like "BSC" → "bsc", "Polygon" → "polygon", etc.
 */
export function normalizeChainName(name: string): string {
  const lower = name.toLowerCase().replace(/\s+/g, ' ').trim();
  const ALIASES: Record<string, string> = {
    'binance': 'bsc',
    'binance smart chain': 'bsc',
    'bnb chain': 'bsc',
    'polygon pos': 'polygon',
    'polygon zkevm': 'polygon',
    'zksync era': 'zksync',
    'zksync': 'zksync',
    'op mainnet': 'optimism',
    'avalanche c-chain': 'avalanche',
    'avax': 'avalanche',
    'ftm': 'fantom',
    'manta pacific': 'manta',
  };
  return ALIASES[lower] ?? lower;
}
