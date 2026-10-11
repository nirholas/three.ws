export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

const SUBGRAPH_ID = '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';

const POOL_QUERY = `{
  pools(first: 30, orderBy: totalValueLockedUSD, orderDirection: desc) {
    id
    token0 { symbol name decimals }
    token1 { symbol name decimals }
    feeTier
    totalValueLockedUSD
    volumeUSD
    token0Price
    token1Price
    txCount
    liquidity
  }
}`;

const FEE_TIER_MAP = {
  100: '0.01%',
  500: '0.05%',
  3000: '0.3%',
  10000: '1%',
};

function buildSubgraphUrl() {
  const apiKey = process.env.THEGRAPH_API_KEY || '';
  if (apiKey) {
    return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${SUBGRAPH_ID}`;
  }
  return `https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`;
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    pools: [],
    summary: { totalTvl: 0, totalVolume24h: 0, poolCount: 0, topPair: 'N/A', avgUtilization: 0 },
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

    const url = buildSubgraphUrl();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: POOL_QUERY }),
      signal: controller.signal,
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`The Graph HTTP ${res.status}`);

    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');

    const rawPools = json.data?.pools || [];

    const pools = rawPools.map((p) => {
      const tvl = parseFloat(p.totalValueLockedUSD) || 0;
      const volume = parseFloat(p.volumeUSD) || 0;
      const feeTier = parseInt(p.feeTier, 10);
      const utilization = tvl > 0 ? volume / tvl : 0;

      return {
        id: p.id,
        pair: `${p.token0.symbol}/${p.token1.symbol}`,
        token0: { symbol: p.token0.symbol, name: p.token0.name },
        token1: { symbol: p.token1.symbol, name: p.token1.name },
        feeTier,
        feeTierDisplay: FEE_TIER_MAP[feeTier] || `${(feeTier / 10000).toFixed(2)}%`,
        tvl,
        volume24h: volume,
        price: parseFloat(p.token0Price) || 0,
        txCount: parseInt(p.txCount, 10) || 0,
        utilization: Math.round(utilization * 1000) / 1000,
      };
    });

    const totalTvl = pools.reduce((s, p) => s + p.tvl, 0);
    const totalVolume24h = pools.reduce((s, p) => s + p.volume24h, 0);
    const avgUtilization = pools.length > 0
      ? Math.round((pools.reduce((s, p) => s + p.utilization, 0) / pools.length) * 1000) / 1000
      : 0;
    const topPair = pools[0]?.pair || 'N/A';

    const result = {
      timestamp: new Date().toISOString(),
      pools,
      summary: { totalTvl, totalVolume24h, poolCount: pools.length, topPair, avgUtilization },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  } catch (err) {
    console.error('[subgraph-uniswap] Error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
