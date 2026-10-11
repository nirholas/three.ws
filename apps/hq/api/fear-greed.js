export const config = { runtime: 'edge' };

import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

const CACHE_KEY = 'fear-greed:v1';
const CACHE_TTL = 300; // 5 min

/** In-memory stale fallback (survives warm-start when Redis + upstream both fail) */
let staleResponse = null;

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '30', 10), 1), 90);
  const redisKey = `${CACHE_KEY}:${limit}`;

  const cached = await getCachedJson(redisKey);
  if (cached) {
    recordCacheTelemetry('/api/fear-greed', 'HIT');
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120' },
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://api.alternative.me/fng/?limit=${limit}&format=json`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${res.status}` }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    const data = await res.json();
    staleResponse = data;
    void setCachedJson(redisKey, data, CACHE_TTL);
    recordCacheTelemetry('/api/fear-greed', 'MISS');

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120' },
    });
  } catch (err) {
    if (staleResponse) {
      recordCacheTelemetry('/api/fear-greed', 'STALE');
      return new Response(JSON.stringify(staleResponse), {
        headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'STALE', 'Cache-Control': 'public, max-age=60' },
      });
    }
    recordCacheTelemetry('/api/fear-greed', 'ERROR');
    return new Response(JSON.stringify({ error: 'Failed to fetch Fear & Greed data' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}
