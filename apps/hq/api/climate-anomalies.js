import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

export const config = { runtime: 'edge' };

const CACHE_KEY = 'climate:anomalies:v1';
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;

let fallbackCache = { data: null, timestamp: 0 };

const rateLimiter = createIpRateLimiter({
  limit: 15,
  windowMs: 60 * 1000,
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

function isValidResult(data) {
  return Boolean(data && typeof data === 'object' && Array.isArray(data.anomalies));
}

const MONITORED_ZONES = [
  { name: 'Ukraine', lat: 48.4, lon: 31.2 },
  { name: 'Middle East', lat: 33.0, lon: 44.0 },
  { name: 'Sahel', lat: 14.0, lon: 0.0 },
  { name: 'Horn of Africa', lat: 8.0, lon: 42.0 },
  { name: 'South Asia', lat: 25.0, lon: 78.0 },
  { name: 'California', lat: 36.8, lon: -119.4 },
  { name: 'Amazon', lat: -3.4, lon: -60.0 },
  { name: 'Australia', lat: -25.0, lon: 134.0 },
  { name: 'Mediterranean', lat: 38.0, lon: 20.0 },
  { name: 'Taiwan Strait', lat: 24.0, lon: 120.0 },
  { name: 'Myanmar', lat: 19.8, lon: 96.7 },
  { name: 'Central Africa', lat: 4.0, lon: 22.0 },
  { name: 'Southern Africa', lat: -25.0, lon: 28.0 },
  { name: 'Central Asia', lat: 42.0, lon: 65.0 },
  { name: 'Caribbean', lat: 19.0, lon: -72.0 },
];

function classifySeverity(tempDelta, precipDelta) {
  const absTemp = Math.abs(tempDelta);
  const absPrecip = Math.abs(precipDelta);
  if (absTemp >= 5 || absPrecip >= 80) return 'extreme';
  if (absTemp >= 3 || absPrecip >= 40) return 'moderate';
  return 'normal';
}

function classifyType(tempDelta, precipDelta) {
  const absTemp = Math.abs(tempDelta);
  const absPrecip = Math.abs(precipDelta);
  if (absTemp >= absPrecip / 20) {
    if (tempDelta > 0 && precipDelta < -20) return 'mixed';
    if (tempDelta > 3) return 'warm';
    if (tempDelta < -3) return 'cold';
  }
  if (precipDelta > 40) return 'wet';
  if (precipDelta < -40) return 'dry';
  if (tempDelta > 0) return 'warm';
  return 'cold';
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) return new Response(null, { status: 403, headers: corsHeaders });
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  if (isDisallowedOrigin(req)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: corsHeaders });
  }

  const ip = getClientIp(req);
  if (!rateLimiter.check(ip)) {
    return Response.json({ error: 'Rate limited' }, {
      status: 429, headers: { ...corsHeaders, 'Retry-After': '60' },
    });
  }

  const now = Date.now();
  const cached = await getCachedJson(CACHE_KEY);
  if (isValidResult(cached)) {
    recordCacheTelemetry('/api/climate-anomalies', 'REDIS-HIT');
    return Response.json(cached, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', 'X-Cache': 'REDIS-HIT' },
    });
  }

  if (isValidResult(fallbackCache.data) && now - fallbackCache.timestamp < CACHE_TTL_MS) {
    recordCacheTelemetry('/api/climate-anomalies', 'MEMORY-HIT');
    return Response.json(fallbackCache.data, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', 'X-Cache': 'MEMORY-HIT' },
    });
  }

  try {
    const endDate = new Date();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const start = startDate.toISOString().split('T')[0];
    const end = endDate.toISOString().split('T')[0];

    const fetchZone = async (zone) => {
      try {
        const params = new URLSearchParams({
          latitude: String(zone.lat),
          longitude: String(zone.lon),
          start_date: start,
          end_date: end,
          daily: 'temperature_2m_mean,precipitation_sum',
          timezone: 'UTC',
        });

        const resp = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`, {
          headers: { Accept: 'application/json' },
        });

        if (!resp.ok) return null;
        const data = await resp.json();
        const temps = data.daily?.temperature_2m_mean || [];
        const precips = data.daily?.precipitation_sum || [];

        if (temps.length < 14) return null;

        const validTemps = temps.filter(t => t !== null);
        const validPrecips = precips.filter(p => p !== null);

        const last7Temps = validTemps.slice(-7);
        const baseline30Temps = validTemps.slice(0, -7);
        const last7Precips = validPrecips.slice(-7);
        const baseline30Precips = validPrecips.slice(0, -7);

        const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

        const tempDelta = avg(last7Temps) - avg(baseline30Temps);
        const precipDelta = avg(last7Precips) - avg(baseline30Precips);
        const severity = classifySeverity(tempDelta, precipDelta);

        return {
          zone: zone.name,
          lat: zone.lat,
          lon: zone.lon,
          tempDelta: Math.round(tempDelta * 10) / 10,
          precipDelta: Math.round(precipDelta * 10) / 10,
          severity,
          type: classifyType(tempDelta, precipDelta),
          period: `${start} to ${end}`,
        };
      } catch {
        return null;
      }
    };

    const results = await Promise.allSettled(MONITORED_ZONES.map(fetchZone));
    const anomalies = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    const result = {
      success: true,
      anomalies,
      timestamp: new Date().toISOString(),
    };

    fallbackCache = { data: result, timestamp: now };
    void setCachedJson(CACHE_KEY, result, CACHE_TTL_SECONDS);
    recordCacheTelemetry('/api/climate-anomalies', 'MISS');

    return Response.json(result, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', 'X-Cache': 'MISS' },
    });
  } catch (error) {
    if (isValidResult(fallbackCache.data)) {
      recordCacheTelemetry('/api/climate-anomalies', 'STALE');
      return Response.json(fallbackCache.data, {
        status: 200,
        headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120', 'X-Cache': 'STALE' },
      });
    }

    recordCacheTelemetry('/api/climate-anomalies', 'ERROR');
    return Response.json({ error: `Fetch failed: ${toErrorMessage(error)}`, anomalies: [] }, {
      status: 500, headers: corsHeaders,
    });
  }
}
