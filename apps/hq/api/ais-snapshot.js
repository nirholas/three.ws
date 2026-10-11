export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';

const CACHE_TTL_SECONDS = 8;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const CACHE_VERSION = 'v1';
const MEMORY_CACHE_MAX_ENTRIES = 8;
const MEMORY_FALLBACK_MAX_AGE_MS = 60 * 1000;
const memoryCache = new Map();
const inFlightByKey = new Map();

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || 'Failed to fetch AIS snapshot');
}

function getMemoryCachedSnapshot(cacheKey, allowStale = false) {
  const entry = memoryCache.get(cacheKey);
  if (!entry) return null;

  const now = Date.now();
  const age = now - entry.timestamp;
  if (age > MEMORY_FALLBACK_MAX_AGE_MS) {
    memoryCache.delete(cacheKey);
    return null;
  }

  if (!allowStale && age > CACHE_TTL_MS) {
    return null;
  }

  entry.lastSeen = now;
  return entry.data;
}

function setMemoryCachedSnapshot(cacheKey, data) {
  const now = Date.now();
  memoryCache.set(cacheKey, {
    data,
    timestamp: now,
    lastSeen: now,
  });

  if (memoryCache.size <= MEMORY_CACHE_MAX_ENTRIES) return;

  const overflow = memoryCache.size - MEMORY_CACHE_MAX_ENTRIES;
  const oldestEntries = Array.from(memoryCache.entries())
    .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  for (let i = 0; i < overflow; i++) {
    const entry = oldestEntries[i];
    if (!entry) break;
    memoryCache.delete(entry[0]);
  }
}

function getRelayBaseUrl() {
  const relayUrl = process.env.WS_RELAY_URL;
  if (!relayUrl) return null;
  return relayUrl
    .replace('wss://', 'https://')
    .replace('ws://', 'http://')
    .replace(/\/$/, '');
}

function isValidSnapshot(data) {
  return Boolean(
    data &&
    typeof data === 'object' &&
    data.status &&
    typeof data.status === 'object' &&
    Array.isArray(data.disruptions) &&
    Array.isArray(data.density)
  );
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

  const requestUrl = new URL(req.url);
  const includeCandidates = requestUrl.searchParams.get('candidates') === 'true';
  const cacheKey = `ais-snapshot:${CACHE_VERSION}:${includeCandidates ? 'full' : 'lite'}`;
  const redisCached = await getCachedJson(cacheKey);
  if (isValidSnapshot(redisCached)) {
    setMemoryCachedSnapshot(cacheKey, redisCached);
    recordCacheTelemetry('/api/ais-snapshot', 'REDIS-HIT');
    return new Response(JSON.stringify(redisCached), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=5`,
        'X-Cache': 'REDIS-HIT',
        ...corsHeaders,
      },
    });
  }

  const memoryCached = getMemoryCachedSnapshot(cacheKey);
  if (isValidSnapshot(memoryCached)) {
    recordCacheTelemetry('/api/ais-snapshot', 'MEMORY-HIT');
    return new Response(JSON.stringify(memoryCached), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=5`,
        'X-Cache': 'MEMORY-HIT',
        ...corsHeaders,
      },
    });
  }

  const relayBaseUrl = getRelayBaseUrl();
  if (!relayBaseUrl) {
    recordCacheTelemetry('/api/ais-snapshot', 'NO-RELAY-CONFIG');
    return new Response(JSON.stringify({ vessels: [], skipped: true, reason: 'AIS relay not configured' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    let requestPromise = inFlightByKey.get(cacheKey);
    if (!requestPromise) {
      requestPromise = (async () => {
        const upstreamUrl = `${relayBaseUrl}/ais/snapshot?candidates=${includeCandidates ? 'true' : 'false'}`;
        const response = await fetch(upstreamUrl, {
          headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) {
          throw new Error(`AIS relay HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!isValidSnapshot(data)) {
          throw new Error('Invalid AIS snapshot payload');
        }
        return data;
      })();
      inFlightByKey.set(cacheKey, requestPromise);
    }

    const data = await requestPromise;
    if (!isValidSnapshot(data)) {
      throw new Error('Invalid AIS snapshot payload');
    }

    setMemoryCachedSnapshot(cacheKey, data);
    void setCachedJson(cacheKey, data, CACHE_TTL_SECONDS);
    recordCacheTelemetry('/api/ais-snapshot', 'MISS');

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=5`,
        'X-Cache': 'MISS',
        ...corsHeaders,
      },
    });
  } catch (error) {
    const staleMemory = getMemoryCachedSnapshot(cacheKey, true);
    if (isValidSnapshot(staleMemory)) {
      recordCacheTelemetry('/api/ais-snapshot', 'MEMORY-ERROR-FALLBACK');
      return new Response(JSON.stringify(staleMemory), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=5`,
          'X-Cache': 'MEMORY-ERROR-FALLBACK',
          ...corsHeaders,
        },
      });
    }

    recordCacheTelemetry('/api/ais-snapshot', 'ERROR');
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } finally {
    inFlightByKey.delete(cacheKey);
  }
}
