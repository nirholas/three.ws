export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const CACHE_TTL = 600; // 10 min
let cachedResponse = null;
let cacheTimestamp = 0;

/** Convert period string to days */
function periodToDays(period) {
  switch (period) {
    case '7d': return 7;
    case '30d': return 30;
    case '90d': return 90;
    case '180d': return 180;
    case '1y': return 365;
    default: return 30;
  }
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
  const period = url.searchParams.get('period') || '30d';
  const days = periodToDays(period);

  // Check cache
  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000 && cachedResponse._period === period) {
    const { _period, ...data } = cachedResponse;
    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000);

    const res = await fetch('https://api.llama.fi/overview/dexs?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);

    const json = await res.json();
    const chart = json.totalDataChart || [];

    // Chart entries are [unixTimestamp, volume]
    const cutoff = Date.now() / 1000 - days * 86400;
    const filtered = chart.filter(entry => entry[0] >= cutoff);

    const mapped = filtered.map(entry => ({
      date: new Date(entry[0] * 1000).toISOString().slice(0, 10),
      value: entry[1],
    }));

    const result = {
      timestamp: new Date().toISOString(),
      series: [{ name: 'DEX Volume', data: mapped }],
      period,
      summary: {
        currentVolume: mapped.length ? mapped[mapped.length - 1].value : 0,
        periodAvg: mapped.length ? mapped.reduce((s, d) => s + d.value, 0) / mapped.length : 0,
        periodHigh: mapped.length ? Math.max(...mapped.map(d => d.value)) : 0,
        periodLow: mapped.length ? Math.min(...mapped.map(d => d.value)) : 0,
      },
    };

    cachedResponse = { ...result, _period: period };
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });

  } catch (err) {
    console.error('[historical-volume] Error:', err?.message ?? err);
    return new Response(JSON.stringify({ error: 'Failed to fetch historical volume data', series: [], period, summary: {} }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
