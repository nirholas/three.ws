export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

const SUBGRAPH_ID = 'Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g';

const RESERVES_QUERY = `{
  reserves(first: 30, orderBy: totalLiquidity, orderDirection: desc, where: { isActive: true }) {
    id
    symbol
    name
    underlyingAsset
    totalLiquidity
    totalCurrentVariableDebt
    totalPrincipalStableDebt
    availableLiquidity
    liquidityRate
    variableBorrowRate
    stableBorrowRate
    utilizationRate
    price { priceInEth }
    aToken { id }
  }
}`;

function buildSubgraphUrl() {
  const apiKey = process.env.THEGRAPH_API_KEY || '';
  if (apiKey) {
    return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${SUBGRAPH_ID}`;
  }
  return `https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`;
}

/** Convert a ray-based rate (1e27) to APY percentage */
function rayToApy(rayStr) {
  const ray = parseFloat(rayStr) || 0;
  // Aave rates are in ray (1e27). APY = rate / 1e27 * 100
  return Math.round((ray / 1e27) * 100 * 100) / 100;
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    markets: [],
    summary: { totalTvl: 0, totalBorrowed: 0, avgUtilization: 0, topMarket: 'N/A', marketCount: 0 },
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
      body: JSON.stringify({ query: RESERVES_QUERY }),
      signal: controller.signal,
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`The Graph HTTP ${res.status}`);

    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');

    const rawReserves = json.data?.reserves || [];

    const markets = rawReserves.map((r) => {
      const totalLiq = parseFloat(r.totalLiquidity) || 0;
      const varDebt = parseFloat(r.totalCurrentVariableDebt) || 0;
      const stableDebt = parseFloat(r.totalPrincipalStableDebt) || 0;
      const totalBorrowed = varDebt + stableDebt;
      const available = parseFloat(r.availableLiquidity) || 0;
      const utilRaw = parseFloat(r.utilizationRate) || 0;
      const utilization = Math.round(utilRaw * 1000) / 1000;

      return {
        symbol: r.symbol,
        name: r.name,
        totalSupplied: totalLiq,
        totalBorrowed,
        available,
        supplyAPY: rayToApy(r.liquidityRate),
        borrowAPY: rayToApy(r.variableBorrowRate),
        stableBorrowAPY: rayToApy(r.stableBorrowRate),
        utilization,
        tvlUSD: totalLiq, // total liquidity as TVL proxy (actual USD conversion would need price oracle)
      };
    });

    // Sort by TVL descending (already ordered by subgraph, but ensure consistency)
    markets.sort((a, b) => b.tvlUSD - a.tvlUSD);

    const totalTvl = markets.reduce((s, m) => s + m.tvlUSD, 0);
    const totalBorrowed = markets.reduce((s, m) => s + m.totalBorrowed, 0);
    const avgUtilization = markets.length > 0
      ? Math.round((markets.reduce((s, m) => s + m.utilization, 0) / markets.length) * 1000) / 1000
      : 0;
    const topMarket = markets[0]?.symbol || 'N/A';

    const result = {
      timestamp: new Date().toISOString(),
      markets,
      summary: { totalTvl, totalBorrowed, avgUtilization, topMarket, marketCount: markets.length },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  } catch (err) {
    console.error('[subgraph-aave] Error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
