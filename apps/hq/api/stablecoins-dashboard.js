export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 300;
let cachedResponse = null;
let cacheTimestamp = 0;

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    stablecoins: [],
    totalMarketCap: 0,
    totalCount: 0,
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

    const res = await fetch('https://stablecoins.llama.fi/stablecoins?includePrices=true', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);

    const json = await res.json();
    const peggedAssets = json.peggedAssets || [];

    const stablecoins = peggedAssets
      .filter(s => typeof s === 'object' && s !== null)
      .map(s => {
        // DeFiLlama stores circulating under the relevant peg key:
        // peggedUSD, peggedEUR, peggedGBP, peggedJPY, peggedCNY, etc.
        const pegType = String(s.pegType || 'peggedUSD');
        const circulatingObj = s.circulating || {};
        const circulating = Number(
          circulatingObj[pegType] ??
          circulatingObj.peggedUSD ??
          // Fallback: sum all pegged variants
          Object.values(circulatingObj).reduce((sum, v) => sum + (Number(v) || 0), 0)
        ) || 0;
        const price = s.price != null ? Number(s.price) : null;
        return {
          name: String(s.name || 'Unknown'),
          symbol: String(s.symbol || '???'),
          pegType,
          circulating,
          price,
          chains: Array.isArray(s.chains) ? s.chains.slice(0, 15).map(String) : [],
          pegMechanism: String(s.pegMechanism || ''),
        };
      })
      .filter(s => s.circulating > 0)
      .sort((a, b) => b.circulating - a.circulating);

    const totalMarketCap = stablecoins.reduce((sum, s) => sum + s.circulating, 0);

    const result = {
      timestamp: new Date().toISOString(),
      stablecoins: stablecoins.slice(0, 50),
      totalMarketCap,
      totalCount: stablecoins.length,
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  } catch (err) {
    console.error('[stablecoins-dashboard]', err?.message || err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
