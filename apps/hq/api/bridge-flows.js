export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 min
let cachedResponse = null;
let cacheTimestamp = 0;

// Chain locations (inline - Edge Functions can't import from src/)
const CHAIN_LOCATIONS = {
  ethereum:  { name: 'Ethereum',     lat: 47.3769,  lon: 8.5417    },
  solana:    { name: 'Solana',        lat: 37.7749,  lon: -122.4194 },
  bsc:       { name: 'BNB Chain',     lat: 1.3521,   lon: 103.8198  },
  tron:      { name: 'Tron',          lat: 37.5665,  lon: 126.978   },
  avalanche: { name: 'Avalanche',     lat: 40.7128,  lon: -74.006   },
  fantom:    { name: 'Fantom',        lat: -33.8688, lon: 151.2093  },
  cardano:   { name: 'Cardano',       lat: 47.0707,  lon: 15.4395   },
  polkadot:  { name: 'Polkadot',      lat: 47.42,    lon: 8.58      },
  cosmos:    { name: 'Cosmos',        lat: 52.52,    lon: 13.405    },
  near:      { name: 'NEAR',          lat: 37.82,    lon: -122.47   },
  algorand:  { name: 'Algorand',      lat: 42.3601,  lon: -71.0589  },
  ton:       { name: 'TON',           lat: 25.2048,  lon: 55.2708   },
  arbitrum:  { name: 'Arbitrum',      lat: 40.76,    lon: -73.96    },
  optimism:  { name: 'Optimism',      lat: 37.73,    lon: -122.38   },
  base:      { name: 'Base',          lat: 37.82,    lon: -122.36   },
  polygon:   { name: 'Polygon',       lat: 19.076,   lon: 72.8777   },
  zksync:    { name: 'zkSync Era',    lat: 52.52,    lon: 13.45     },
  starknet:  { name: 'Starknet',      lat: 32.0853,  lon: 34.7818   },
  linea:     { name: 'Linea',         lat: 48.8566,  lon: 2.3522    },
  scroll:    { name: 'Scroll',        lat: 31.2304,  lon: 121.4737  },
  mantle:    { name: 'Mantle',        lat: 22.3193,  lon: 114.1694  },
  blast:     { name: 'Blast',         lat: 37.39,    lon: -122.08   },
  manta:     { name: 'Manta Pacific', lat: 1.40,     lon: 103.87    },
  mode:      { name: 'Mode',          lat: 37.44,    lon: -122.16   },
  sui:       { name: 'Sui',           lat: 37.4419,  lon: -122.143  },
  aptos:     { name: 'Aptos',         lat: 37.49,    lon: -122.18   },
  sei:       { name: 'Sei',           lat: 37.80,    lon: -122.41   },
  celo:      { name: 'Celo',          lat: 37.79,    lon: -122.44   },
  gnosis:    { name: 'Gnosis',        lat: 52.47,    lon: 13.36     },
  moonbeam:  { name: 'Moonbeam',      lat: 42.36,    lon: -71.10    },
  cronos:    { name: 'Cronos',        lat: 1.30,     lon: 103.78    },
  klaytn:    { name: 'Klaytn',        lat: 37.52,    lon: 127.02    },
  harmony:   { name: 'Harmony',       lat: 37.38,    lon: -122.08   },
};

const NAME_ALIASES = {
  'binance': 'bsc',
  'binance smart chain': 'bsc',
  'bnb chain': 'bsc',
  'polygon pos': 'polygon',
  'polygon zkevm': 'polygon',
  'zksync era': 'zksync',
  'op mainnet': 'optimism',
  'avalanche c-chain': 'avalanche',
  'avax': 'avalanche',
  'ftm': 'fantom',
  'manta pacific': 'manta',
};

function normalizeChain(name) {
  const lower = (name || '').toLowerCase().trim();
  return NAME_ALIASES[lower] ?? lower;
}

function lookupChain(name) {
  const key = normalizeChain(name);
  return CHAIN_LOCATIONS[key] || null;
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    flows: [],
    bridges: [],
    summary: { totalVolume24h: 0, activeBridges: 0, topFlow: null, flowCount: 0 },
    unavailable: true,
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) return new Response(null, { status: 403, headers: cors });
    return new Response(null, { status: 204, headers: cors });
  }
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json', Allow: 'GET, OPTIONS' },
    });
  }

  const clientIp = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (!limiter.check(clientIp)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  // Serve from in-memory cache
  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12_000);

    // Fetch bridges list with chain breakdown
    const res = await fetch('https://bridges.llama.fi/bridges?includeChains=true', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`DeFiLlama bridges HTTP ${res.status}`);

    const data = await res.json();
    const bridgesList = data?.bridges || data || [];

    // Build flow arcs from bridge data
    const flowMap = new Map(); // "src-dst" → aggregated flow
    const bridgeSummaries = [];

    for (const bridge of bridgesList) {
      const name = bridge.displayName || bridge.name || 'Unknown Bridge';
      const vol24h = bridge.currentDayVolume ?? bridge.lastDayVolume ?? 0;
      const chains = bridge.chains || bridge.destinationChain
        ? [bridge.sourceChain, bridge.destinationChain].filter(Boolean)
        : [];

      // Skip bridges with negligible volume
      if (vol24h < 10_000) continue;

      bridgeSummaries.push({
        name,
        volume24h: vol24h,
        chains: chains.map(c => normalizeChain(c)),
      });

      // Generate pairwise flows between chains this bridge connects
      const resolvedChains = chains
        .map(c => ({ orig: c, key: normalizeChain(c), loc: lookupChain(c) }))
        .filter(c => c.loc);

      for (let i = 0; i < resolvedChains.length; i++) {
        for (let j = i + 1; j < resolvedChains.length; j++) {
          const src = resolvedChains[i];
          const dst = resolvedChains[j];

          // Sort alphabetically for consistent dedup key
          const [a, b] = src.key < dst.key ? [src, dst] : [dst, src];
          const flowKey = `${a.key}-${b.key}`;

          if (!flowMap.has(flowKey)) {
            flowMap.set(flowKey, {
              id: flowKey,
              sourceChain: a.key,
              targetChain: b.key,
              sourceLat: a.loc.lat,
              sourceLon: a.loc.lon,
              targetLat: b.loc.lat,
              targetLon: b.loc.lon,
              volume24h: 0,
              bridgeName: name,
              txCount: 0,
            });
          }

          const flow = flowMap.get(flowKey);
          flow.volume24h += vol24h / Math.max(1, resolvedChains.length - 1);
          flow.txCount += bridge.currentDayTxs ?? bridge.lastDayTxs ?? 0;
          // Keep the bridge name of the highest volume contributor
          if (vol24h > flow.volume24h * 0.5) {
            flow.bridgeName = name;
          }
        }
      }
    }

    // Sort flows by volume, keep top 60
    const flows = Array.from(flowMap.values())
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 60);

    const totalVolume24h = flows.reduce((s, f) => s + f.volume24h, 0);
    const topFlow = flows[0] ? { from: flows[0].sourceChain, to: flows[0].targetChain } : null;

    const result = {
      timestamp: new Date().toISOString(),
      flows,
      bridges: bridgeSummaries.sort((a, b) => b.volume24h - a.volume24h).slice(0, 30),
      summary: {
        totalVolume24h,
        activeBridges: bridgeSummaries.length,
        topFlow,
        flowCount: flows.length,
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  } catch (err) {
    console.error('[bridge-flows] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
