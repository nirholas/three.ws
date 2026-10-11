export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    pools: [],
    summary: { poolCount: 0, avgApy: 0, totalTvl: 0, topChain: 'N/A' },
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

  const url = new URL(req.url);
  const chain = url.searchParams.get('chain') || '';
  const rawMinTvl = parseInt(url.searchParams.get('minTvl') || '100000', 10);
  const minTvl = Number.isNaN(rawMinTvl) ? 100000 : rawMinTvl;

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);

    const apiUrl = 'https://yields.llama.fi/pools';
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);

    const json = await res.json();
    const pools = (json.data || [])
      .filter(p => {
        if (p.tvlUsd < minTvl) return false;
        if (chain && p.chain.toLowerCase() !== chain.toLowerCase()) return false;
        if (p.apy === null || p.apy === undefined || p.apy <= 0) return false;
        if (p.apy > 10000) return false; // filter obvious scams
        return true;
      })
      .sort((a, b) => b.tvlUsd - a.tvlUsd)
      .slice(0, 50)
      .map(p => ({
        pool: p.pool,
        chain: p.chain,
        project: p.project,
        symbol: p.symbol,
        tvlUsd: p.tvlUsd,
        apy: p.apy,
        apyBase: p.apyBase,
        apyReward: p.apyReward,
        il7d: p.il7d,
        apyMean30d: p.apyMean30d,
        stablecoin: p.stablecoin,
        exposure: p.exposure,
        volumeUsd7d: p.volumeUsd7d,
      }));

    const totalTvl = pools.reduce((s, p) => s + p.tvlUsd, 0);
    const avgApy = pools.length > 0 ? pools.reduce((s, p) => s + p.apy, 0) / pools.length : 0;
    const chainCounts = {};
    pools.forEach(p => { chainCounts[p.chain] = (chainCounts[p.chain] || 0) + 1; });
    const topChain = Object.entries(chainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    const result = {
      timestamp: new Date().toISOString(),
      pools,
      summary: { poolCount: pools.length, avgApy: Math.round(avgApy * 100) / 100, totalTvl, topChain },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  } catch (err) {
    console.error('[defi-yields] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
