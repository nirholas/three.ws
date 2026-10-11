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
    totalFees24h: 0,
    totalRevenue24h: 0,
    topProtocols: [],
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

    const res = await fetch('https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);

    const json = await res.json();

    const rawProtocols = Array.isArray(json.protocols) ? json.protocols : [];
    const topProtocols = rawProtocols
      .filter(p => typeof p === 'object' && p !== null && p.total24h > 0)
      .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
      .slice(0, 30)
      .map(p => {
        // Preserve null for revenue - panel uses null-safety to show '-' vs '$0'
        const rev = p.revenue24h ?? p.totalRevenue24h ?? null;
        return {
          name: String(p.name || 'Unknown'),
          slug: String(p.defillamaId || p.slug || ''),
          fees24h: Number(p.total24h) || 0,
          revenue24h: rev != null ? Number(rev) : null,
        };
      });

    const result = {
      timestamp: new Date().toISOString(),
      totalFees24h: Number(json.total24h) || 0,
      totalRevenue24h: Number(json.total24hRevenue || json.totalRevenue24h) || 0,
      topProtocols,
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  } catch (err) {
    console.error('[defi-fees]', err?.message || err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
