import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
export const config = { runtime: 'edge' };

const FETCH_TIMEOUT = 8000;
const CACHE_TTL = 3600_000; // 1 hour
const seriesCache = new Map();

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, { status: 403, headers: corsHeaders });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const seriesId = url.searchParams.get('series_id');
  const observationStart = url.searchParams.get('observation_start');
  const observationEnd = url.searchParams.get('observation_end');

  if (!seriesId) {
    return new Response(JSON.stringify({ error: 'Missing series_id parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Validate series_id format (alphanumeric + underscores, max 30 chars)
  if (!/^[A-Z0-9_]{1,30}$/i.test(seriesId)) {
    return new Response(JSON.stringify({ error: 'Invalid series_id format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Validate date formats if provided (YYYY-MM-DD)
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (observationStart && !dateRe.test(observationStart)) {
    return new Response(JSON.stringify({ error: 'Invalid observation_start format (YYYY-MM-DD)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  if (observationEnd && !dateRe.test(observationEnd)) {
    return new Response(JSON.stringify({ error: 'Invalid observation_end format (YYYY-MM-DD)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      observations: [],
      unavailable: true,
      reason: 'FRED_API_KEY not configured',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const now = Date.now();
    const cacheKey = `${seriesId}:${observationStart || ''}:${observationEnd || ''}`;
    const cached = seriesCache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', 'X-Cache': 'HIT', ...corsHeaders },
      });
    }

    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: apiKey,
      file_type: 'json',
      sort_order: 'desc',
      limit: '10',
    });

    if (observationStart) params.set('observation_start', observationStart);
    if (observationEnd) params.set('observation_end', observationEnd);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const fredUrl = `https://api.stlouisfed.org/fred/series/observations?${params}`;
    const response = await fetch(fredUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    const data = await response.json();

    if (response.ok) {
      seriesCache.set(cacheKey, { data, timestamp: Date.now() });
    }

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600',
        ...corsHeaders,
      },
    });
  } catch (error) {
    // Serve stale cache if available
    const cacheKey = `${seriesId}:${observationStart || ''}:${observationEnd || ''}`;
    const cached = seriesCache.get(cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', 'X-Cache': 'STALE', ...corsHeaders },
      });
    }
    return new Response(JSON.stringify({ observations: [], unavailable: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...corsHeaders },
    });
  }
}
