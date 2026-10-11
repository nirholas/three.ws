export const config = { runtime: 'edge' };

import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';
import { UA_BOT } from './_ua.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_KEY = 'sector-rotation:v1';
const CACHE_TTL = 600; // 10 min: generous TTL to stay inside CoinGecko's free rate limit

/** In-memory stale fallback (survives warm-start when Redis + upstream both fail) */
let staleResponse = null;

/**
 * Crypto sector momentum from CoinGecko /coins/categories (free, no API key):
 * market-cap-ranked sectors with 24h change, so rotation between narratives
 * (AI, RWA, memes, L2s, DeFi, gaming) is visible at a glance.
 */
function shapeResponse(data, limit) {
  const categories = (Array.isArray(data) ? data : [])
    .filter((c) => c && typeof c.market_cap === 'number' && c.market_cap > 0)
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      name: c.name,
      marketCap: c.market_cap,
      change24h: typeof c.market_cap_change_24h === 'number' ? Number(c.market_cap_change_24h.toFixed(2)) : null,
      volume24h: typeof c.volume_24h === 'number' ? c.volume_24h : null,
      topCoins: Array.isArray(c.top_3_coins) ? c.top_3_coins.slice(0, 3) : [],
    }));

  const withChange = categories.filter((c) => c.change24h != null);
  const gainers = [...withChange].sort((a, b) => b.change24h - a.change24h);
  const advancing = withChange.filter((c) => c.change24h > 0).length;

  return {
    timestamp: new Date().toISOString(),
    summary: {
      sectorCount: categories.length,
      advancing,
      declining: withChange.length - advancing,
      topGainer: gainers[0] ? { name: gainers[0].name, change24h: gainers[0].change24h } : null,
      topLoser: gainers.length ? { name: gainers[gainers.length - 1].name, change24h: gainers[gainers.length - 1].change24h } : null,
    },
    sectors: categories,
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

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '40', 10) || 40, 5), 100);
  const redisKey = `${CACHE_KEY}:${limit}`;

  const cached = await getCachedJson(redisKey);
  if (cached) {
    recordCacheTelemetry('/api/sector-rotation', 'HIT');
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'HIT', 'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}, stale-while-revalidate=120` },
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch('https://api.coingecko.com/api/v3/coins/categories?order=market_cap_desc', {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA_BOT },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${res.status}` }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    const shaped = shapeResponse(await res.json(), limit);
    staleResponse = shaped;
    void setCachedJson(redisKey, shaped, CACHE_TTL);
    recordCacheTelemetry('/api/sector-rotation', 'MISS');

    return new Response(JSON.stringify(shaped), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'MISS', 'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}, stale-while-revalidate=120` },
    });
  } catch {
    if (staleResponse) {
      recordCacheTelemetry('/api/sector-rotation', 'STALE');
      return new Response(JSON.stringify(staleResponse), {
        headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'STALE', 'Cache-Control': 'public, max-age=120' },
      });
    }
    recordCacheTelemetry('/api/sector-rotation', 'ERROR');
    return new Response(JSON.stringify({ error: 'Failed to fetch sector data' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}
