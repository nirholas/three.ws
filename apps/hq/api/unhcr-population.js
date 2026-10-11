import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

export const config = { runtime: 'edge' };

const CACHE_KEY = 'unhcr:population:v2';
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;

let fallbackCache = { data: null, timestamp: 0 };

const rateLimiter = createIpRateLimiter({
  limit: 20,
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
  return Boolean(data && typeof data === 'object' && Array.isArray(data.countries));
}

const COUNTRY_CENTROIDS = {
  AFG: [33.9, 67.7], SYR: [35.0, 38.0], UKR: [48.4, 31.2], SDN: [15.5, 32.5],
  SSD: [6.9, 31.3], SOM: [5.2, 46.2], COD: [-4.0, 21.8], MMR: [19.8, 96.7],
  YEM: [15.6, 48.5], ETH: [9.1, 40.5], VEN: [6.4, -66.6], IRQ: [33.2, 43.7],
  COL: [4.6, -74.1], NGA: [9.1, 7.5], PSE: [31.9, 35.2], TUR: [39.9, 32.9],
  DEU: [51.2, 10.4], PAK: [30.4, 69.3], UGA: [1.4, 32.3], BGD: [23.7, 90.4],
  KEN: [0.0, 38.0], TCD: [15.5, 19.0], JOR: [31.0, 36.0], LBN: [33.9, 35.5],
  EGY: [26.8, 30.8], IRN: [32.4, 53.7], TZA: [-6.4, 34.9], RWA: [-1.9, 29.9],
  CMR: [7.4, 12.4], MLI: [17.6, -4.0], BFA: [12.3, -1.6], NER: [17.6, 8.1],
  CAF: [6.6, 20.9], MOZ: [-18.7, 35.5], USA: [37.1, -95.7], FRA: [46.2, 2.2],
  GBR: [55.4, -3.4], IND: [20.6, 79.0], CHN: [35.9, 104.2], RUS: [61.5, 105.3],
};

async function fetchUnhcrYearItems(year) {
  const limit = 10000;
  const maxPageGuard = 25;
  const items = [];

  for (let page = 1; page <= maxPageGuard; page++) {
    const response = await fetch(
      `https://api.unhcr.org/population/v1/population/?year=${year}&limit=${limit}&page=${page}`,
      { headers: { Accept: 'application/json' } }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const pageItems = Array.isArray(data.items) ? data.items : [];
    if (pageItems.length === 0) break;
    items.push(...pageItems);

    const maxPages = Number(data.maxPages);
    if (Number.isFinite(maxPages) && maxPages > 0) {
      if (page >= maxPages) break;
      continue;
    }

    if (pageItems.length < limit) break;
  }

  return items;
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
    recordCacheTelemetry('/api/unhcr-population', 'REDIS-HIT');
    return Response.json(cached, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', 'X-Cache': 'REDIS-HIT' },
    });
  }

  if (isValidResult(fallbackCache.data) && now - fallbackCache.timestamp < CACHE_TTL_MS) {
    recordCacheTelemetry('/api/unhcr-population', 'MEMORY-HIT');
    return Response.json(fallbackCache.data, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', 'X-Cache': 'MEMORY-HIT' },
    });
  }

  try {
    const currentYear = new Date().getFullYear();
    let rawItems = [];
    let dataYearUsed = null;

    for (let year = currentYear; year >= currentYear - 2; year--) {
      const yearItems = await fetchUnhcrYearItems(year);
      if (!yearItems) {
        continue;
      }
      rawItems = yearItems;
      if (rawItems.length > 0) {
        dataYearUsed = year;
        break;
      }
    }

    const byOrigin = {};
    const byAsylum = {};
    const flowMap = {};
    let totalRefugees = 0, totalAsylumSeekers = 0, totalIdps = 0, totalStateless = 0;

    for (const item of rawItems) {
      const originCode = item.coo_iso || '';
      const asylumCode = item.coa_iso || '';
      const refugees = Number(item.refugees) || 0;
      const asylumSeekers = Number(item.asylum_seekers) || 0;
      const idps = Number(item.idps) || 0;
      const stateless = Number(item.stateless) || 0;

      totalRefugees += refugees;
      totalAsylumSeekers += asylumSeekers;
      totalIdps += idps;
      totalStateless += stateless;

      if (originCode) {
        if (!byOrigin[originCode]) byOrigin[originCode] = { refugees: 0, asylumSeekers: 0, idps: 0, stateless: 0, name: item.coo_name || originCode };
        byOrigin[originCode].refugees += refugees;
        byOrigin[originCode].asylumSeekers += asylumSeekers;
        byOrigin[originCode].idps += idps;
        byOrigin[originCode].stateless += stateless;
      }

      if (asylumCode) {
        if (!byAsylum[asylumCode]) byAsylum[asylumCode] = { refugees: 0, asylumSeekers: 0, idps: 0, stateless: 0, name: item.coa_name || asylumCode };
        byAsylum[asylumCode].refugees += refugees;
        byAsylum[asylumCode].asylumSeekers += asylumSeekers;
      }

      if (originCode && asylumCode && refugees > 0) {
        const flowKey = `${originCode}->${asylumCode}`;
        if (!flowMap[flowKey]) {
          flowMap[flowKey] = {
            originCode, originName: item.coo_name || originCode,
            asylumCode, asylumName: item.coa_name || asylumCode,
            refugees: 0,
          };
        }
        flowMap[flowKey].refugees += refugees;
      }
    }

    const countries = {};
    for (const [code, data] of Object.entries(byOrigin)) {
      const centroid = COUNTRY_CENTROIDS[code];
      countries[code] = {
        code, name: data.name,
        refugees: data.refugees, asylumSeekers: data.asylumSeekers,
        idps: data.idps, stateless: data.stateless,
        totalDisplaced: data.refugees + data.asylumSeekers + data.idps + data.stateless,
        hostRefugees: 0,
        hostAsylumSeekers: 0,
        hostTotal: 0,
        lat: centroid?.[0], lon: centroid?.[1],
      };
    }
    for (const [code, data] of Object.entries(byAsylum)) {
      const hostRefugees = data.refugees;
      const hostAsylumSeekers = data.asylumSeekers;
      const hostTotal = hostRefugees + hostAsylumSeekers;
      if (!countries[code]) {
        const centroid = COUNTRY_CENTROIDS[code];
        countries[code] = {
          code, name: data.name,
          refugees: 0, asylumSeekers: 0, idps: 0, stateless: 0, totalDisplaced: 0,
          hostRefugees,
          hostAsylumSeekers,
          hostTotal,
          lat: centroid?.[0], lon: centroid?.[1],
        };
      } else {
        countries[code].hostRefugees = hostRefugees;
        countries[code].hostAsylumSeekers = hostAsylumSeekers;
        countries[code].hostTotal = hostTotal;
      }
    }

    const topFlows = Object.values(flowMap)
      .sort((a, b) => b.refugees - a.refugees)
      .slice(0, 50)
      .map(f => {
        const oC = COUNTRY_CENTROIDS[f.originCode];
        const aC = COUNTRY_CENTROIDS[f.asylumCode];
        return {
          ...f,
          originLat: oC?.[0], originLon: oC?.[1],
          asylumLat: aC?.[0], asylumLon: aC?.[1],
        };
      });

    const result = {
      success: true,
      year: dataYearUsed ?? currentYear,
      globalTotals: {
        refugees: totalRefugees,
        asylumSeekers: totalAsylumSeekers,
        idps: totalIdps,
        stateless: totalStateless,
        total: totalRefugees + totalAsylumSeekers + totalIdps + totalStateless,
      },
      countries: Object.values(countries).sort((a, b) => {
        const aSize = Math.max(a.totalDisplaced || 0, a.hostTotal || 0);
        const bSize = Math.max(b.totalDisplaced || 0, b.hostTotal || 0);
        return bSize - aSize;
      }),
      topFlows,
      cached_at: new Date().toISOString(),
    };

    fallbackCache = { data: result, timestamp: now };
    void setCachedJson(CACHE_KEY, result, CACHE_TTL_SECONDS);
    recordCacheTelemetry('/api/unhcr-population', 'MISS');

    return Response.json(result, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', 'X-Cache': 'MISS' },
    });
  } catch (error) {
    if (isValidResult(fallbackCache.data)) {
      recordCacheTelemetry('/api/unhcr-population', 'STALE');
      return Response.json(fallbackCache.data, {
        status: 200,
        headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120', 'X-Cache': 'STALE' },
      });
    }

    recordCacheTelemetry('/api/unhcr-population', 'ERROR');
    return Response.json({ error: `Fetch failed: ${toErrorMessage(error)}`, countries: [], topFlows: [] }, {
      status: 500, headers: corsHeaders,
    });
  }
}
