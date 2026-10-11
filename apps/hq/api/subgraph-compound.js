export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

// Compound V3 (Comet) subgraph by Messari
const SUBGRAPH_NAME = 'messari/compound-v3-ethereum';

const MARKETS_QUERY = `{
  markets(first: 30, orderBy: totalValueLockedUSD, orderDirection: desc) {
    id
    name
    inputToken { symbol name }
    totalValueLockedUSD
    totalDepositBalanceUSD
    totalBorrowBalanceUSD
    rates {
      rate
      side
      type
    }
    maximumLTV
  }
}`;

function buildSubgraphUrl() {
  const apiKey = process.env.THEGRAPH_API_KEY || '';
  if (apiKey) {
    // Messari subgraphs may not be on the decentralized network; use hosted fallback
    return `https://api.thegraph.com/subgraphs/name/${SUBGRAPH_NAME}`;
  }
  return `https://api.thegraph.com/subgraphs/name/${SUBGRAPH_NAME}`;
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    markets: [],
    summary: { totalTvl: 0, totalBorrowed: 0, avgUtilization: 0, topMarket: 'N/A', marketCount: 0 },
    unavailable: true,
  };
}

function extractRate(rates, side, type) {
  if (!Array.isArray(rates)) return 0;
  const match = rates.find(r => r.side === side && r.type === type);
  return match ? parseFloat(match.rate) || 0 : 0;
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
      body: JSON.stringify({ query: MARKETS_QUERY }),
      signal: controller.signal,
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`The Graph HTTP ${res.status}`);

    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');

    const rawMarkets = json.data?.markets || [];

    const markets = rawMarkets.map((m) => {
      const tvl = parseFloat(m.totalValueLockedUSD) || 0;
      const totalSupplied = parseFloat(m.totalDepositBalanceUSD) || 0;
      const totalBorrowed = parseFloat(m.totalBorrowBalanceUSD) || 0;
      const utilization = totalSupplied > 0
        ? Math.round((totalBorrowed / totalSupplied) * 1000) / 1000
        : 0;

      const supplyAPY = extractRate(m.rates, 'LENDER', 'VARIABLE');
      const borrowAPY = extractRate(m.rates, 'BORROWER', 'VARIABLE');
      const collateralFactor = parseFloat(m.maximumLTV) || 0;

      return {
        symbol: m.inputToken?.symbol || m.name || 'Unknown',
        name: m.inputToken?.name || m.name || 'Unknown',
        totalSupplied,
        totalBorrowed,
        supplyAPY: Math.round(supplyAPY * 100) / 100,
        borrowAPY: Math.round(borrowAPY * 100) / 100,
        utilization,
        collateralFactor: Math.round(collateralFactor * 100) / 100,
        tvlUSD: tvl,
      };
    });

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
    console.error('[subgraph-compound] Error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
