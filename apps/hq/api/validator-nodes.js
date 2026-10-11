export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const CACHE_TTL = 900; // 15 min - node data changes slowly
let cachedResponse = null;
let cacheTimestamp = 0;

// Country centroids for geo-positioning node data
const COUNTRY_COORDS = {
  US: { lat: 37.09, lon: -95.71, name: 'United States' },
  DE: { lat: 51.17, lon: 10.45, name: 'Germany' },
  FR: { lat: 46.23, lon: 2.21, name: 'France' },
  GB: { lat: 55.38, lon: -3.44, name: 'United Kingdom' },
  CA: { lat: 56.13, lon: -106.35, name: 'Canada' },
  SG: { lat: 1.35, lon: 103.82, name: 'Singapore' },
  JP: { lat: 36.20, lon: 138.25, name: 'Japan' },
  NL: { lat: 52.13, lon: 5.29, name: 'Netherlands' },
  FI: { lat: 61.92, lon: 25.75, name: 'Finland' },
  AU: { lat: -25.27, lon: 133.78, name: 'Australia' },
  KR: { lat: 35.91, lon: 127.77, name: 'South Korea' },
  CH: { lat: 46.82, lon: 8.23, name: 'Switzerland' },
  SE: { lat: 60.13, lon: 18.64, name: 'Sweden' },
  IE: { lat: 53.14, lon: -7.69, name: 'Ireland' },
  PL: { lat: 51.92, lon: 19.15, name: 'Poland' },
  AT: { lat: 47.52, lon: 14.55, name: 'Austria' },
  BR: { lat: -14.24, lon: -51.93, name: 'Brazil' },
  ES: { lat: 40.46, lon: -3.75, name: 'Spain' },
  IN: { lat: 20.59, lon: 78.96, name: 'India' },
  IT: { lat: 41.87, lon: 12.57, name: 'Italy' },
  RU: { lat: 61.52, lon: 105.32, name: 'Russia' },
  UA: { lat: 48.38, lon: 31.17, name: 'Ukraine' },
  HK: { lat: 22.32, lon: 114.17, name: 'Hong Kong' },
  CN: { lat: 35.86, lon: 104.20, name: 'China' },
  TR: { lat: 38.96, lon: 35.24, name: 'Turkey' },
  RO: { lat: 45.94, lon: 24.97, name: 'Romania' },
  CZ: { lat: 49.82, lon: 15.47, name: 'Czech Republic' },
  NO: { lat: 60.47, lon: 8.47, name: 'Norway' },
  ID: { lat: -0.79, lon: 113.92, name: 'Indonesia' },
  AR: { lat: -38.42, lon: -63.62, name: 'Argentina' },
};

// Fallback: hardcoded Ethereum node distribution based on ethernodes.org public data
const ETHEREUM_FALLBACK = [
  { country: 'US', nodeCount: 1842, percentage: 34.2, client: { geth: 62, nethermind: 18, besu: 8, erigon: 7, other: 5 } },
  { country: 'DE', nodeCount: 892, percentage: 16.6, client: { geth: 55, nethermind: 22, besu: 10, erigon: 8, other: 5 } },
  { country: 'FR', nodeCount: 321, percentage: 6.0, client: { geth: 60, nethermind: 20, besu: 9, erigon: 6, other: 5 } },
  { country: 'GB', nodeCount: 285, percentage: 5.3, client: { geth: 58, nethermind: 21, besu: 9, erigon: 7, other: 5 } },
  { country: 'CA', nodeCount: 215, percentage: 4.0, client: { geth: 65, nethermind: 16, besu: 8, erigon: 6, other: 5 } },
  { country: 'SG', nodeCount: 196, percentage: 3.6, client: { geth: 70, nethermind: 14, besu: 7, erigon: 5, other: 4 } },
  { country: 'JP', nodeCount: 175, percentage: 3.3, client: { geth: 68, nethermind: 15, besu: 7, erigon: 6, other: 4 } },
  { country: 'NL', nodeCount: 168, percentage: 3.1, client: { geth: 57, nethermind: 22, besu: 9, erigon: 7, other: 5 } },
  { country: 'FI', nodeCount: 140, percentage: 2.6, client: { geth: 54, nethermind: 24, besu: 10, erigon: 7, other: 5 } },
  { country: 'AU', nodeCount: 112, percentage: 2.1, client: { geth: 63, nethermind: 17, besu: 8, erigon: 7, other: 5 } },
  { country: 'KR', nodeCount: 98, percentage: 1.8, client: { geth: 72, nethermind: 13, besu: 6, erigon: 5, other: 4 } },
  { country: 'CH', nodeCount: 88, percentage: 1.6, client: { geth: 56, nethermind: 23, besu: 9, erigon: 7, other: 5 } },
  { country: 'SE', nodeCount: 75, percentage: 1.4, client: { geth: 58, nethermind: 20, besu: 10, erigon: 7, other: 5 } },
  { country: 'IE', nodeCount: 72, percentage: 1.3, client: { geth: 60, nethermind: 19, besu: 9, erigon: 7, other: 5 } },
  { country: 'PL', nodeCount: 65, percentage: 1.2, client: { geth: 61, nethermind: 18, besu: 9, erigon: 7, other: 5 } },
  { country: 'AT', nodeCount: 55, percentage: 1.0, client: { geth: 59, nethermind: 20, besu: 9, erigon: 7, other: 5 } },
  { country: 'BR', nodeCount: 52, percentage: 1.0, client: { geth: 66, nethermind: 15, besu: 8, erigon: 6, other: 5 } },
  { country: 'ES', nodeCount: 48, percentage: 0.9, client: { geth: 62, nethermind: 18, besu: 8, erigon: 7, other: 5 } },
  { country: 'IN', nodeCount: 45, percentage: 0.8, client: { geth: 70, nethermind: 14, besu: 7, erigon: 5, other: 4 } },
  { country: 'IT', nodeCount: 42, percentage: 0.8, client: { geth: 63, nethermind: 17, besu: 8, erigon: 7, other: 5 } },
];

// Solana validator distribution (approximate from validators.app patterns)
const SOLANA_NODES = [
  { country: 'US', nodeCount: 720, percentage: 38.5 },
  { country: 'DE', nodeCount: 320, percentage: 17.1 },
  { country: 'GB', nodeCount: 95, percentage: 5.1 },
  { country: 'CA', nodeCount: 82, percentage: 4.4 },
  { country: 'JP', nodeCount: 68, percentage: 3.6 },
  { country: 'NL', nodeCount: 62, percentage: 3.3 },
  { country: 'FR', nodeCount: 55, percentage: 2.9 },
  { country: 'FI', nodeCount: 48, percentage: 2.6 },
  { country: 'SG', nodeCount: 45, percentage: 2.4 },
  { country: 'RU', nodeCount: 40, percentage: 2.1 },
  { country: 'UA', nodeCount: 35, percentage: 1.9 },
  { country: 'KR', nodeCount: 30, percentage: 1.6 },
  { country: 'PL', nodeCount: 28, percentage: 1.5 },
  { country: 'AU', nodeCount: 25, percentage: 1.3 },
  { country: 'CH', nodeCount: 22, percentage: 1.2 },
];

// L2 node locations (known sequencer/node infrastructure)
const L2_NODES = [
  // Arbitrum
  { chain: 'arbitrum', country: 'US', nodeCount: 85, percentage: 42.5 },
  { chain: 'arbitrum', country: 'DE', nodeCount: 38, percentage: 19.0 },
  { chain: 'arbitrum', country: 'GB', nodeCount: 18, percentage: 9.0 },
  { chain: 'arbitrum', country: 'SG', nodeCount: 15, percentage: 7.5 },
  { chain: 'arbitrum', country: 'JP', nodeCount: 12, percentage: 6.0 },
  { chain: 'arbitrum', country: 'NL', nodeCount: 10, percentage: 5.0 },
  { chain: 'arbitrum', country: 'CA', nodeCount: 8, percentage: 4.0 },
  { chain: 'arbitrum', country: 'FR', nodeCount: 7, percentage: 3.5 },
  { chain: 'arbitrum', country: 'KR', nodeCount: 4, percentage: 2.0 },
  { chain: 'arbitrum', country: 'AU', nodeCount: 3, percentage: 1.5 },
  // Base
  { chain: 'base', country: 'US', nodeCount: 65, percentage: 50.0 },
  { chain: 'base', country: 'DE', nodeCount: 22, percentage: 16.9 },
  { chain: 'base', country: 'GB', nodeCount: 12, percentage: 9.2 },
  { chain: 'base', country: 'SG', nodeCount: 10, percentage: 7.7 },
  { chain: 'base', country: 'JP', nodeCount: 8, percentage: 6.2 },
  { chain: 'base', country: 'NL', nodeCount: 6, percentage: 4.6 },
  { chain: 'base', country: 'CA', nodeCount: 4, percentage: 3.1 },
  { chain: 'base', country: 'FR', nodeCount: 3, percentage: 2.3 },
  // Optimism
  { chain: 'optimism', country: 'US', nodeCount: 55, percentage: 45.8 },
  { chain: 'optimism', country: 'DE', nodeCount: 20, percentage: 16.7 },
  { chain: 'optimism', country: 'GB', nodeCount: 12, percentage: 10.0 },
  { chain: 'optimism', country: 'SG', nodeCount: 9, percentage: 7.5 },
  { chain: 'optimism', country: 'NL', nodeCount: 8, percentage: 6.7 },
  { chain: 'optimism', country: 'JP', nodeCount: 6, percentage: 5.0 },
  { chain: 'optimism', country: 'CA', nodeCount: 5, percentage: 4.2 },
  { chain: 'optimism', country: 'FR', nodeCount: 5, percentage: 4.2 },
];

function buildNodeEntry(chain, item) {
  const coords = COUNTRY_COORDS[item.country];
  if (!coords) return null;
  return {
    id: `${chain}-${item.country.toLowerCase()}`,
    chain,
    country: item.country,
    countryName: coords.name,
    lat: coords.lat,
    lon: coords.lon,
    nodeCount: item.nodeCount,
    percentage: item.percentage,
    ...(item.client ? { client: item.client } : {}),
  };
}

function buildFallbackResult() {
  const nodes = [];

  // Ethereum nodes
  for (const item of ETHEREUM_FALLBACK) {
    const entry = buildNodeEntry('ethereum', item);
    if (entry) nodes.push(entry);
  }

  // Solana nodes
  for (const item of SOLANA_NODES) {
    const entry = buildNodeEntry('solana', item);
    if (entry) nodes.push(entry);
  }

  // L2 nodes
  for (const item of L2_NODES) {
    const entry = buildNodeEntry(item.chain, item);
    if (entry) nodes.push(entry);
  }

  const totalNodes = nodes.reduce((sum, n) => sum + n.nodeCount, 0);
  const countryTotals = {};
  for (const n of nodes) {
    countryTotals[n.countryName] = (countryTotals[n.countryName] || 0) + n.nodeCount;
  }
  const topCountry = Object.entries(countryTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

  return {
    timestamp: new Date().toISOString(),
    nodes,
    chains: ['ethereum', 'solana', 'arbitrum', 'base', 'optimism'],
    summary: {
      totalNodes,
      topCountry,
      chainCount: 5,
      nakamotoCoefficient: 3,
    },
  };
}

async function fetchLiveEthernodes(signal) {
  // Try ethernodes.org API for live Ethereum node data
  const res = await fetch('https://ethernodes.org/api/countries', {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': 'three.ws-HQ/1.0' },
  });
  if (!res.ok) throw new Error(`ethernodes HTTP ${res.status}`);
  const data = await res.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ethernodes returned empty data');
  }

  // ethernodes.org returns [{country: "US", count: 1842}, ...]
  const totalNodes = data.reduce((sum, d) => sum + (d.count || 0), 0);
  const nodes = [];

  for (const item of data) {
    const code = item.country || item.code;
    const coords = COUNTRY_COORDS[code];
    if (!coords || !item.count) continue;

    nodes.push({
      id: `eth-${code.toLowerCase()}`,
      chain: 'ethereum',
      country: code,
      countryName: coords.name,
      lat: coords.lat,
      lon: coords.lon,
      nodeCount: item.count,
      percentage: totalNodes > 0 ? Math.round((item.count / totalNodes) * 1000) / 10 : 0,
      // Live data may not have client breakdown
    });
  }

  return nodes;
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

  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  }

  try {
    // Try live ethernodes data, fall back to static
    let ethNodes;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);
      ethNodes = await fetchLiveEthernodes(controller.signal);
      clearTimeout(id);
    } catch (liveErr) {
      console.warn('[validator-nodes] Live fetch failed, using fallback:', liveErr?.message);
      ethNodes = null;
    }

    let result;
    if (ethNodes && ethNodes.length > 0) {
      // Merge live ETH data with static Solana + L2 data
      const nodes = [...ethNodes];
      for (const item of SOLANA_NODES) {
        const entry = buildNodeEntry('solana', item);
        if (entry) nodes.push(entry);
      }
      for (const item of L2_NODES) {
        const entry = buildNodeEntry(item.chain, item);
        if (entry) nodes.push(entry);
      }

      const totalNodes = nodes.reduce((sum, n) => sum + n.nodeCount, 0);
      const countryTotals = {};
      for (const n of nodes) {
        countryTotals[n.countryName] = (countryTotals[n.countryName] || 0) + n.nodeCount;
      }
      const topCountry = Object.entries(countryTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

      result = {
        timestamp: new Date().toISOString(),
        nodes,
        chains: ['ethereum', 'solana', 'arbitrum', 'base', 'optimism'],
        summary: {
          totalNodes,
          topCountry,
          chainCount: 5,
          nakamotoCoefficient: 3,
        },
      };
    } else {
      result = buildFallbackResult();
    }

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  } catch (err) {
    console.error('[validator-nodes] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
