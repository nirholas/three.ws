export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 600; // 10 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    protocols: [],
    summary: { protocolCount: 0, totalDailyRevenue: 0, totalDailyFees: 0 },
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

    // DeFiLlama fees/revenue overview
    // The API uses total24h for the primary metric; we need separate requests
    // for fees and revenue since dataType controls which metric total24h represents
    const [feesRes, revenueRes, protocolsRes] = await Promise.all([
      fetch('https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      }),
      fetch('https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue', {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      }),
      fetch('https://api.llama.fi/protocols', {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      }),
    ]);
    clearTimeout(id);

    if (!feesRes.ok) throw new Error(`DeFiLlama fees HTTP ${feesRes.status}`);

    const feesJson = await feesRes.json();

    // Build revenue lookup: protocol name → daily revenue from the revenue endpoint
    let revenueMap = {};
    if (revenueRes.ok) {
      const revenueJson = await revenueRes.json();
      revenueMap = Object.fromEntries(
        (revenueJson.protocols || [])
          .filter(p => p.total24h > 0)
          .map(p => [p.name?.toLowerCase(), { dailyRevenue: p.total24h || 0, monthlyRevenue: p.total30d || 0 }])
      );
    }

    let protocolTvlMap = {};
    if (protocolsRes.ok) {
      const protocolsJson = await protocolsRes.json();
      protocolTvlMap = Object.fromEntries(
        (protocolsJson || []).map(p => [p.name?.toLowerCase(), p.tvl || 0])
      );
    }

    const protocols = (feesJson.protocols || [])
      .filter(p => {
        const fees = p.total24h || p.dailyFees || 0;
        const rev = revenueMap[p.name?.toLowerCase()]?.dailyRevenue || p.dailyRevenue || 0;
        return fees > 0 || rev > 0;
      })
      .map(p => {
        const key = p.name?.toLowerCase();
        const dailyFees = p.total24h || p.dailyFees || 0;
        const dailyRevenue = revenueMap[key]?.dailyRevenue || p.dailyRevenue || 0;
        const monthlyRevenue = revenueMap[key]?.monthlyRevenue || p.total30d || p.monthlyRevenue || 0;
        const tvl = protocolTvlMap[key] || 0;
        const revenuePerTvl = tvl > 0 && dailyRevenue > 0 ? (dailyRevenue * 365) / tvl : null;
        return {
          name: p.name,
          category: p.category,
          chains: (p.chains || []).slice(0, 3),
          dailyFees,
          dailyRevenue,
          monthlyRevenue,
          tvl,
          revenuePerTvl,
          change1d: p.change_1d ?? null,
          change7d: p.change_7d ?? null,
          change1m: p.change_1m ?? null,
        };
      })
      .sort((a, b) => b.dailyRevenue - a.dailyRevenue || b.dailyFees - a.dailyFees)
      .slice(0, 50);

    const totalDailyRevenue = protocols.reduce((s, p) => s + p.dailyRevenue, 0);
    const totalDailyFees = protocols.reduce((s, p) => s + p.dailyFees, 0);

    const result = {
      timestamp: new Date().toISOString(),
      protocols,
      summary: { protocolCount: protocols.length, totalDailyRevenue, totalDailyFees },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  } catch (err) {
    console.error('[protocol-revenue] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
