import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

export const config = { runtime: 'edge' };

const CACHE_KEY = 'ucdp:gedevents:v2';
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const UCDP_PAGE_SIZE = 1000;
const MAX_PAGES = 12;
const TRAILING_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

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
  return Boolean(data && typeof data === 'object' && Array.isArray(data.data));
}

const VIOLENCE_TYPE_MAP = {
  1: 'state-based',
  2: 'non-state',
  3: 'one-sided',
};

function parseDateMs(value) {
  if (!value) return NaN;
  return Date.parse(String(value));
}

function getMaxDateMs(events) {
  let maxMs = NaN;
  for (const event of events) {
    const ms = parseDateMs(event?.date_start);
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(maxMs) || ms > maxMs) {
      maxMs = ms;
    }
  }
  return maxMs;
}

function buildVersionCandidates() {
  const year = new Date().getFullYear() - 2000;
  return Array.from(new Set([
    `${year}.1`,
    `${year - 1}.1`,
    '25.1',
    '24.1',
  ]));
}

async function fetchGedPage(version, page) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const token = process.env.UCDP_ACCESS_TOKEN;
    const response = await fetch(
      `https://ucdpapi.pcr.uu.se/api/gedevents/${version}?pagesize=${UCDP_PAGE_SIZE}&page=${page}`,
      {
        headers: { Accept: 'application/json', ...(token ? { 'x-ucdp-access-token': token } : {}) },
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      throw new Error(`UCDP GED API error (${version}, page ${page}): ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverGedVersion() {
  const candidates = buildVersionCandidates();
  for (const version of candidates) {
    try {
      const page0 = await fetchGedPage(version, 0);
      if (Array.isArray(page0?.Result)) {
        return { version, page0 };
      }
    } catch {
      // Try the next version candidate.
    }
  }
  throw new Error('Unable to fetch UCDP GED metadata from known API versions');
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
      status: 405, headers: corsHeaders,
    });
  }

  if (isDisallowedOrigin(req)) {
    return Response.json({ error: 'Origin not allowed', data: [] }, {
      status: 403, headers: corsHeaders,
    });
  }

  // The UCDP API now requires authentication (x-ucdp-access-token). Without a
  // configured token, degrade gracefully (HTTP 200, empty result) instead of
  // surfacing a 500 on every page load.
  if (!process.env.UCDP_ACCESS_TOKEN) {
    return Response.json({ success: false, configured: false, error: 'UCDP not configured', count: 0, data: [] }, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' },
    });
  }

  const ip = getClientIp(req);
  if (!rateLimiter.check(ip)) {
    return Response.json({ error: 'Rate limited', data: [] }, {
      status: 429,
      headers: { ...corsHeaders, 'Retry-After': '60' },
    });
  }

  const now = Date.now();
  const cached = await getCachedJson(CACHE_KEY);
  if (isValidResult(cached)) {
    recordCacheTelemetry('/api/ucdp-events', 'REDIS-HIT');
    return Response.json(cached, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', 'X-Cache': 'REDIS-HIT' },
    });
  }

  if (isValidResult(fallbackCache.data) && now - fallbackCache.timestamp < CACHE_TTL_MS) {
    recordCacheTelemetry('/api/ucdp-events', 'MEMORY-HIT');
    return Response.json(fallbackCache.data, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', 'X-Cache': 'MEMORY-HIT' },
    });
  }

  try {
    const { version, page0 } = await discoverGedVersion();
    const totalPages = Math.max(1, Number(page0?.TotalPages) || 1);
    const newestPage = totalPages - 1;

    let allEvents = [];
    let latestDatasetMs = NaN;

    for (let offset = 0; offset < MAX_PAGES && (newestPage - offset) >= 0; offset++) {
      const page = newestPage - offset;
      const rawData = page === 0 ? page0 : await fetchGedPage(version, page);
      const events = Array.isArray(rawData?.Result) ? rawData.Result : [];
      allEvents = allEvents.concat(events);

      const pageMaxMs = getMaxDateMs(events);
      if (!Number.isFinite(latestDatasetMs) && Number.isFinite(pageMaxMs)) {
        latestDatasetMs = pageMaxMs;
      }

      // Pages are ordered oldest->newest; once we are fully outside trailing window, stop.
      if (Number.isFinite(latestDatasetMs) && Number.isFinite(pageMaxMs)) {
        const cutoffMs = latestDatasetMs - TRAILING_WINDOW_MS;
        if (pageMaxMs < cutoffMs) {
          break;
        }
      }
    }

    const sanitized = allEvents
      .filter((event) => {
        if (!Number.isFinite(latestDatasetMs)) return true;
        const eventMs = parseDateMs(event?.date_start);
        if (!Number.isFinite(eventMs)) return false;
        return eventMs >= (latestDatasetMs - TRAILING_WINDOW_MS);
      })
      .map(e => ({
        id: String(e.id || ''),
        date_start: e.date_start || '',
        date_end: e.date_end || '',
        latitude: Number(e.latitude) || 0,
        longitude: Number(e.longitude) || 0,
        country: e.country || '',
        side_a: (e.side_a || '').substring(0, 200),
        side_b: (e.side_b || '').substring(0, 200),
        deaths_best: Number(e.best) || 0,
        deaths_low: Number(e.low) || 0,
        deaths_high: Number(e.high) || 0,
        type_of_violence: VIOLENCE_TYPE_MAP[e.type_of_violence] || 'state-based',
        source_original: (e.source_original || '').substring(0, 300),
      }))
      .sort((a, b) => {
        const bMs = parseDateMs(b.date_start);
        const aMs = parseDateMs(a.date_start);
        return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
      });

    const result = {
      success: true,
      count: sanitized.length,
      data: sanitized,
      version,
      cached_at: new Date().toISOString(),
    };

    fallbackCache = { data: result, timestamp: now };
    void setCachedJson(CACHE_KEY, result, CACHE_TTL_SECONDS);
    recordCacheTelemetry('/api/ucdp-events', 'MISS');

    return Response.json(result, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', 'X-Cache': 'MISS' },
    });
  } catch (error) {
    if (isValidResult(fallbackCache.data)) {
      recordCacheTelemetry('/api/ucdp-events', 'STALE');
      return Response.json(fallbackCache.data, {
        status: 200,
        headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120', 'X-Cache': 'STALE' },
      });
    }

    recordCacheTelemetry('/api/ucdp-events', 'ERROR');
    // Optional overlay - degrade to an empty 200 so a transient upstream
    // outage does not surface as a console error on every page load.
    return Response.json({ success: false, degraded: true, error: `Fetch failed: ${toErrorMessage(error)}`, count: 0, data: [] }, {
      status: 200, headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=120' },
    });
  }
}
