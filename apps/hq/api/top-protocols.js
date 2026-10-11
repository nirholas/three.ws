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
    protocols: [],
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

  const url = new URL(req.url);
  const parsed = parseInt(url.searchParams.get('limit') || '100', 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 100;

  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    const sliced = { ...cachedResponse, protocols: cachedResponse.protocols.slice(0, limit) };
    return new Response(JSON.stringify(sliced), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);

    const res = await fetch('https://api.llama.fi/protocols', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);

    const json = await res.json();
    const rawProtocols = Array.isArray(json) ? json : [];
    const protocols = rawProtocols
      .filter(p => typeof p === 'object' && p !== null && Number(p.tvl) > 0)
      .sort((a, b) => Number(b.tvl) - Number(a.tvl))
      .slice(0, 200)
      .map(p => ({
        name: String(p.name || 'Unknown'),
        slug: String(p.slug || ''),
        category: String(p.category || 'Other'),
        tvl: Number(p.tvl) || 0,
        change24h: p.change_1d != null ? Number(p.change_1d) : null,
        change7d: p.change_7d != null ? Number(p.change_7d) : null,
        chains: Array.isArray(p.chains) ? p.chains.slice(0, 10).map(String) : [],
        logo: typeof p.logo === 'string' && p.logo.startsWith('http') ? p.logo : '',
      }));

    const result = {
      timestamp: new Date().toISOString(),
      protocols,
    };

    cachedResponse = result;
    cacheTimestamp = now;

    const sliced = { ...result, protocols: result.protocols.slice(0, limit) };
    return new Response(JSON.stringify(sliced), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  } catch (err) {
    console.error('[top-protocols]', err?.message || err);
    const fallback = cachedResponse
      ? { ...cachedResponse, protocols: cachedResponse.protocols.slice(0, limit) }
      : buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
