import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

export const config = { runtime: 'edge' };

const COUNTRIES_CACHE_KEY = 'worldpop:countries:v1';
const COUNTRIES_TTL_SECONDS = 7 * 24 * 60 * 60;
const COUNTRIES_TTL_MS = COUNTRIES_TTL_SECONDS * 1000;
const EXPOSURE_TTL_SECONDS = 24 * 60 * 60;

let countriesFallback = { data: null, timestamp: 0 };

const rateLimiter = createIpRateLimiter({
  limit: 30,
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

const PRIORITY_COUNTRIES = {
  UKR: { name: 'Ukraine', pop: 37000000, area: 603550 },
  RUS: { name: 'Russia', pop: 144100000, area: 17098242 },
  ISR: { name: 'Israel', pop: 9800000, area: 22072 },
  PSE: { name: 'Palestine', pop: 5400000, area: 6020 },
  SYR: { name: 'Syria', pop: 22100000, area: 185180 },
  IRN: { name: 'Iran', pop: 88600000, area: 1648195 },
  TWN: { name: 'Taiwan', pop: 23600000, area: 36193 },
  ETH: { name: 'Ethiopia', pop: 126500000, area: 1104300 },
  SDN: { name: 'Sudan', pop: 48100000, area: 1861484 },
  SSD: { name: 'South Sudan', pop: 11400000, area: 619745 },
  SOM: { name: 'Somalia', pop: 18100000, area: 637657 },
  YEM: { name: 'Yemen', pop: 34400000, area: 527968 },
  AFG: { name: 'Afghanistan', pop: 42200000, area: 652230 },
  PAK: { name: 'Pakistan', pop: 240500000, area: 881913 },
  IND: { name: 'India', pop: 1428600000, area: 3287263 },
  MMR: { name: 'Myanmar', pop: 54200000, area: 676578 },
  COD: { name: 'DR Congo', pop: 102300000, area: 2344858 },
  NGA: { name: 'Nigeria', pop: 223800000, area: 923768 },
  MLI: { name: 'Mali', pop: 22600000, area: 1240192 },
  BFA: { name: 'Burkina Faso', pop: 22700000, area: 274200 },
};

function isValidCountries(data) {
  return Boolean(data && typeof data === 'object' && Array.isArray(data.countries));
}

async function handleCountries(corsHeaders, now) {
  const cached = await getCachedJson(COUNTRIES_CACHE_KEY);
  if (isValidCountries(cached)) {
    recordCacheTelemetry('/api/worldpop-exposure?countries', 'REDIS-HIT');
    return Response.json(cached, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600', 'X-Cache': 'REDIS-HIT' },
    });
  }

  if (isValidCountries(countriesFallback.data) && now - countriesFallback.timestamp < COUNTRIES_TTL_MS) {
    recordCacheTelemetry('/api/worldpop-exposure?countries', 'MEMORY-HIT');
    return Response.json(countriesFallback.data, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600', 'X-Cache': 'MEMORY-HIT' },
    });
  }

  const countries = Object.entries(PRIORITY_COUNTRIES).map(([code, info]) => ({
    code,
    name: info.name,
    population: info.pop,
    densityPerKm2: Math.round(info.pop / info.area),
  }));

  const result = { success: true, countries, cached_at: new Date().toISOString() };
  countriesFallback = { data: result, timestamp: now };
  void setCachedJson(COUNTRIES_CACHE_KEY, result, COUNTRIES_TTL_SECONDS);
  recordCacheTelemetry('/api/worldpop-exposure?countries', 'MISS');

  return Response.json(result, {
    status: 200,
    headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600', 'X-Cache': 'MISS' },
  });
}

function handleExposure(corsHeaders, lat, lon, radius) {
  let bestMatch = null;
  let bestDist = Infinity;

  const CENTROIDS = {
    UKR: [48.4, 31.2], RUS: [61.5, 105.3], ISR: [31.0, 34.8], PSE: [31.9, 35.2],
    SYR: [35.0, 38.0], IRN: [32.4, 53.7], TWN: [23.7, 121.0], ETH: [9.1, 40.5],
    SDN: [15.5, 32.5], SSD: [6.9, 31.3], SOM: [5.2, 46.2], YEM: [15.6, 48.5],
    AFG: [33.9, 67.7], PAK: [30.4, 69.3], IND: [20.6, 79.0], MMR: [19.8, 96.7],
    COD: [-4.0, 21.8], NGA: [9.1, 7.5], MLI: [17.6, -4.0], BFA: [12.3, -1.6],
  };

  for (const [code, [cLat, cLon]] of Object.entries(CENTROIDS)) {
    const dist = Math.sqrt(Math.pow(lat - cLat, 2) + Math.pow(lon - cLon, 2));
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = code;
    }
  }

  const info = PRIORITY_COUNTRIES[bestMatch] || { pop: 50000000, area: 500000 };
  const density = info.pop / info.area;
  const areaKm2 = Math.PI * radius * radius;
  const exposed = Math.round(density * areaKm2);

  return Response.json({
    success: true,
    exposedPopulation: exposed,
    exposureRadiusKm: radius,
    nearestCountry: bestMatch,
    densityPerKm2: Math.round(density),
  }, {
    status: 200,
    headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
  });
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

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'countries';

  if (mode === 'exposure') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    const radius = Number(url.searchParams.get('radius')) || 50;

    if (isNaN(lat) || isNaN(lon)) {
      return Response.json({ error: 'lat and lon required' }, { status: 400, headers: corsHeaders });
    }

    return handleExposure(corsHeaders, lat, lon, radius);
  }

  return handleCountries(corsHeaders, Date.now());
}
