export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 min
let cachedResponse = null;
let cacheTimestamp = 0;

/**
 * Condensed protocol-geo lookup: slug → { lat, lon, city, country, region }
 * Must be inline because Edge Functions can't import from src/.
 */
const PROTOCOL_GEO = {
  // North America
  'uniswap': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'compound': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'convex-finance': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'eigenlayer': { lat: 47.6062, lon: -122.3321, city: 'Seattle', country: 'US', region: 'north-america' },
  'jito': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'dydx': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'ondo-finance': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'hyperliquid': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'coinbase-wrapped-staked-eth': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'marinade-native': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'drift-protocol': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'kamino': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'maple': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'ribbon-finance': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'radiant-capital': { lat: 34.0522, lon: -118.2437, city: 'Los Angeles', country: 'US', region: 'north-america' },
  'thala': { lat: 37.3382, lon: -121.8863, city: 'San Jose', country: 'US', region: 'north-america' },
  'solend': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'sanctum': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'tensor': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'phantom': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'polymarket': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'orca': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'zeta': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'parcl': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'marginfi': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'meteora': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'flashbots': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'across': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'frax': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'hashflow': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'aerodrome': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'velodrome': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'layerzero': { lat: 49.2827, lon: -123.1207, city: 'Vancouver', country: 'CA', region: 'north-america' },
  'wormhole': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'blast': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'scroll': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'base': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'optimism': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'arbitrum': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'benqi': { lat: 43.6532, lon: -79.3832, city: 'Toronto', country: 'CA', region: 'north-america' },
  'trader-joe': { lat: 49.2827, lon: -123.1207, city: 'Vancouver', country: 'CA', region: 'north-america' },
  'spookyswap': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'celer-cbridge': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'synapse': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'hop-protocol': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'badger-dao': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'osmosis-dex': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'maverick-protocol': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'goldfinch': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'truefi': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'notional': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'umami-finance': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'vertex-protocol': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'ampleforth': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'origin-dollar': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'opyn': { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', region: 'north-america' },
  'tokemak': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },
  'redacted': { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', region: 'north-america' },

  // Europe
  'lido': { lat: 50.0755, lon: 14.4378, city: 'Remote/EU', country: 'EU', region: 'europe' },
  'aave': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'aave-v3': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'makerdao': { lat: 55.6761, lon: 12.5683, city: 'Copenhagen', country: 'DK', region: 'europe' },
  'curve-dex': { lat: 46.2044, lon: 6.1432, city: 'Geneva', country: 'CH', region: 'europe' },
  'marinade-finance': { lat: 50.0755, lon: 14.4378, city: 'Prague', country: 'CZ', region: 'europe' },
  'morpho': { lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  'usual': { lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  'spark': { lat: 55.6761, lon: 12.5683, city: 'Copenhagen', country: 'DK', region: 'europe' },
  'sky-ecosystem': { lat: 55.6761, lon: 12.5683, city: 'Copenhagen', country: 'DK', region: 'europe' },
  'balancer': { lat: 46.2044, lon: 6.1432, city: 'Geneva', country: 'CH', region: 'europe' },
  'yearn-finance': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'gnosis': { lat: 52.52, lon: 13.405, city: 'Berlin', country: 'DE', region: 'europe' },
  'ssv-network': { lat: 32.0853, lon: 34.7818, city: 'Tel Aviv', country: 'IL', region: 'europe' },
  'cow-protocol': { lat: 52.52, lon: 13.405, city: 'Berlin', country: 'DE', region: 'europe' },
  'paraswap': { lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  'stakewise': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'stargate': { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', country: 'NL', region: 'europe' },
  'swell': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'ether.fi': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'kelp-dao': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'renzo': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'puffer-finance': { lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'CH', region: 'europe' },
  'sommelier': { lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'CH', region: 'europe' },
  'nexus-mutual': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'dforce': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'angle': { lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  'euler': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'zksync-era': { lat: 52.52, lon: 13.405, city: 'Berlin', country: 'DE', region: 'europe' },
  'linea': { lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  'starknet': { lat: 32.0853, lon: 34.7818, city: 'Tel Aviv', country: 'IL', region: 'europe' },
  'abracadabra': { lat: 41.9028, lon: 12.4964, city: 'Rome', country: 'IT', region: 'europe' },
  'silo-finance': { lat: 48.2082, lon: 16.3738, city: 'Vienna', country: 'AT', region: 'europe' },
  'harvest-finance': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'bprotocol': { lat: 32.0853, lon: 34.7818, city: 'Tel Aviv', country: 'IL', region: 'europe' },
  'centrifuge': { lat: 52.52, lon: 13.405, city: 'Berlin', country: 'DE', region: 'europe' },
  'gains-network': { lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', region: 'europe' },
  'prisma-finance': { lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'CH', region: 'europe' },
  'liquity': { lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'CH', region: 'europe' },
  'aura': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'reflexer': { lat: 41.9028, lon: 12.4964, city: 'Rome', country: 'IT', region: 'europe' },
  'idle-finance': { lat: 41.9028, lon: 12.4964, city: 'Rome', country: 'IT', region: 'europe' },
  'mstable': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },
  'tempus-finance': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', region: 'europe' },

  // Asia
  'jupiter': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'raydium': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'pendle': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'gmx': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'ethena': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'pancakeswap': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'sushiswap': { lat: 35.6762, lon: 139.6503, city: 'Tokyo', country: 'JP', region: 'asia' },
  'instadapp': { lat: 19.076, lon: 72.8777, city: 'Mumbai', country: 'IN', region: 'asia' },
  'venus': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'alpaca-finance': { lat: 13.7563, lon: 100.5018, city: 'Bangkok', country: 'TH', region: 'asia' },
  'bakeryswap': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'wombat-exchange': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'biswap': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'mantle': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'mantle-staked-ether': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'woofi': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'kyberswap': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'camelot': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'binance-staked-eth': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'polygon': { lat: 19.076, lon: 72.8777, city: 'Mumbai', country: 'IN', region: 'asia' },
  'justlend': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'anchor': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'stader': { lat: 12.9716, lon: 77.5946, city: 'Bangalore', country: 'IN', region: 'asia' },
  'cream-finance': { lat: 25.033, lon: 121.5654, city: 'Taipei', country: 'TW', region: 'asia' },
  'clearpool': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'level-finance': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'dodo': { lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'SG', region: 'asia' },
  'perpetual-protocol': { lat: 25.033, lon: 121.5654, city: 'Taipei', country: 'TW', region: 'asia' },

  // Other
  'rocket-pool': { lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'AU', region: 'other' },
  'synthetix': { lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'AU', region: 'other' },
  '1inch-network': { lat: 25.2048, lon: 55.2708, city: 'Dubai', country: 'AE', region: 'other' },
  'thorchain': { lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'AU', region: 'other' },
  'spiritswap': { lat: 25.2048, lon: 55.2708, city: 'Dubai', country: 'AE', region: 'other' },
  'beefy': { lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'AU', region: 'other' },
};

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    points: [],
    summary: { totalMappedTvl: 0, totalGlobalTvl: 0, coveragePercent: 0, topRegion: 'unknown', pointCount: 0 },
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
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
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

  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);

    const res = await fetch('https://api.llama.fi/protocols', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);

    const json = await res.json();
    const rawProtocols = Array.isArray(json) ? json : [];

    // Filter valid protocols with TVL > 0
    const protocols = rawProtocols
      .filter(p => typeof p === 'object' && p !== null && Number(p.tvl) > 0)
      .sort((a, b) => Number(b.tvl) - Number(a.tvl));

    const totalGlobalTvl = protocols.reduce((sum, p) => sum + Number(p.tvl || 0), 0);

    // Group by city location using the geo lookup
    const cityMap = new Map(); // key = "lat,lon" → { lat, lon, tvl, city, country, region, protocols[] }
    let totalMappedTvl = 0;
    const regionTvl = {};

    for (const p of protocols) {
      const slug = String(p.slug || '').toLowerCase();
      const geo = PROTOCOL_GEO[slug];
      if (!geo) continue;

      const tvl = Number(p.tvl) || 0;
      totalMappedTvl += tvl;

      const key = `${geo.lat},${geo.lon}`;
      if (!cityMap.has(key)) {
        cityMap.set(key, {
          lat: geo.lat,
          lon: geo.lon,
          tvl: 0,
          city: geo.city,
          country: geo.country,
          protocols: [],
        });
      }
      const city = cityMap.get(key);
      city.tvl += tvl;
      city.protocols.push({ name: String(p.name || 'Unknown'), tvl });

      regionTvl[geo.region] = (regionTvl[geo.region] || 0) + tvl;
    }

    // Sort protocols within each city by TVL descending
    const points = [];
    for (const city of cityMap.values()) {
      city.protocols.sort((a, b) => b.tvl - a.tvl);
      // Limit to top 20 protocols per city for payload size
      if (city.protocols.length > 20) {
        city.protocols = city.protocols.slice(0, 20);
      }
      points.push(city);
    }

    // Sort points by TVL descending
    points.sort((a, b) => b.tvl - a.tvl);

    // Determine top region
    const topRegion = Object.entries(regionTvl).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    const result = {
      timestamp: new Date().toISOString(),
      points,
      summary: {
        totalMappedTvl,
        totalGlobalTvl,
        coveragePercent: totalGlobalTvl > 0 ? Math.round((totalMappedTvl / totalGlobalTvl) * 1000) / 10 : 0,
        topRegion,
        pointCount: points.length,
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  } catch (err) {
    console.error('[tvl-geo]', err?.message || err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
