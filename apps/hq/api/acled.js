// ACLED API proxy - keeps token server-side only
// Token is stored in ACLED_ACCESS_TOKEN (no VITE_ prefix)
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

export const config = { runtime: 'edge' };

const CACHE_KEY = 'acled:protests:v2';
const CACHE_TTL_SECONDS = 10 * 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;

// In-memory fallback cache when Redis is unavailable.
let fallbackCache = { data: null, timestamp: 0 };

const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW_MS = 60 * 1000;
const rateLimiter = createIpRateLimiter({
  limit: RATE_LIMIT,
  windowMs: RATE_WINDOW_MS,
  maxEntries: 5000,
});

function getClientIp(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0] ||
    req.headers.get('x-real-ip') ||
    'unknown';
}

function toErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || 'unknown error');
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, { status: 403, headers: corsHeaders });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed', data: [] }, {
      status: 405,
      headers: corsHeaders,
    });
  }

  if (isDisallowedOrigin(req)) {
    return Response.json({ error: 'Origin not allowed', data: [] }, {
      status: 403,
      headers: corsHeaders,
    });
  }

  const ip = getClientIp(req);
  if (!rateLimiter.check(ip)) {
    return Response.json({ error: 'Rate limited', data: [] }, {
      status: 429,
      headers: {
        ...corsHeaders,
        'Retry-After': '60',
      },
    });
  }

  const token = process.env.ACLED_ACCESS_TOKEN;
  if (!token) {
    return Response.json({
      error: 'ACLED not configured',
      data: [],
      configured: false,
    }, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const now = Date.now();
  const cached = await getCachedJson(CACHE_KEY);
  if (cached && typeof cached === 'object' && Array.isArray(cached.data)) {
    recordCacheTelemetry('/api/acled', 'REDIS-HIT');
    return Response.json(cached, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
        'X-Cache': 'REDIS-HIT',
      },
    });
  }

  if (fallbackCache.data && now - fallbackCache.timestamp < CACHE_TTL_MS) {
    recordCacheTelemetry('/api/acled', 'MEMORY-HIT');
    return Response.json(fallbackCache.data, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
        'X-Cache': 'MEMORY-HIT',
      },
    });
  }

  try {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const params = new URLSearchParams({
      event_type: 'Protests',
      event_date: `${startDate}|${endDate}`,
      event_date_where: 'BETWEEN',
      limit: '500',
      _format: 'json',
    });

    const response = await fetch(`https://acleddata.com/api/acled/read?${params}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return Response.json({
        error: `ACLED API error: ${response.status}`,
        details: text.substring(0, 200),
        data: [],
      }, {
        status: response.status,
        headers: corsHeaders,
      });
    }

    const rawData = await response.json();
    const events = Array.isArray(rawData?.data) ? rawData.data : [];
    const sanitizedEvents = events.map((e) => ({
      event_id_cnty: e.event_id_cnty,
      event_date: e.event_date,
      event_type: e.event_type,
      sub_event_type: e.sub_event_type,
      actor1: e.actor1,
      actor2: e.actor2,
      country: e.country,
      admin1: e.admin1,
      location: e.location,
      latitude: e.latitude,
      longitude: e.longitude,
      fatalities: e.fatalities,
      notes: typeof e.notes === 'string' ? e.notes.substring(0, 500) : undefined,
      source: e.source,
      tags: e.tags,
    }));

    const result = {
      success: true,
      count: sanitizedEvents.length,
      data: sanitizedEvents,
      cached_at: new Date().toISOString(),
    };

    fallbackCache = { data: result, timestamp: now };
    void setCachedJson(CACHE_KEY, result, CACHE_TTL_SECONDS);
    recordCacheTelemetry('/api/acled', 'MISS');

    return Response.json(result, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    if (fallbackCache.data) {
      recordCacheTelemetry('/api/acled', 'STALE');
      return Response.json(fallbackCache.data, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30',
          'X-Cache': 'STALE',
        },
      });
    }

    recordCacheTelemetry('/api/acled', 'ERROR');
    return Response.json({
      error: `Fetch failed: ${toErrorMessage(error)}`,
      data: [],
    }, {
      status: 500,
      headers: corsHeaders,
    });
  }
}
