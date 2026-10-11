export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const CACHE_TTL = 600; // 10 min
const cache = new Map();

/** Stablecoin IDs from DeFiLlama */
const STABLECOINS = [
  { id: 1, name: 'USDT' },
  { id: 2, name: 'USDC' },
  { id: 3, name: 'DAI' },
  { id: 5, name: 'BUSD' },
  { id: 6, name: 'FRAX' },
];

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
  const stablecoinsParam = url.searchParams.get('stablecoins') || 'USDT,USDC,DAI';
  const requestedNames = stablecoinsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const days = periodToDays(period);

  const cacheKey = `hist-sc:${requestedNames.join(',')}:${period}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cached.data), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000);
    const fetchOpts = { signal: controller.signal, headers: { Accept: 'application/json' } };

    const requested = STABLECOINS.filter(s => requestedNames.includes(s.name)).slice(0, 5);
    if (!requested.length) {
      clearTimeout(id);
      return new Response(JSON.stringify({ error: 'No valid stablecoins requested', series: [], period }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const cutoff = Date.now() / 1000 - days * 86400;

    const results = await Promise.allSettled(
      requested.map(sc =>
        fetch(`https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=${sc.id}`, fetchOpts)
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
          .then(raw => {
            // raw is array of { date: unixTs, totalCirculating: { peggedUSD: number }, ... }
            const filtered = (raw || []).filter(d => d.date >= cutoff);
            const mapped = filtered.map(d => ({
              date: new Date(d.date * 1000).toISOString().slice(0, 10),
              value: d.totalCirculating?.peggedUSD ?? d.totalCirculatingUSD?.peggedUSD ?? 0,
            }));
            return { name: sc.name, data: mapped };
          })
      )
    );
    clearTimeout(id);

    const seriesResult = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    const totalCurrent = seriesResult.reduce((s, sr) => s + (sr.data.length ? sr.data[sr.data.length - 1].value : 0), 0);
    const totalStart = seriesResult.reduce((s, sr) => s + (sr.data.length ? sr.data[0].value : 0), 0);

    const result = {
      timestamp: new Date().toISOString(),
      series: seriesResult,
      period,
      summary: {
        currentTotal: totalCurrent,
        periodStart: totalStart,
        percentChange: totalStart > 0 ? ((totalCurrent - totalStart) / totalStart) * 100 : 0,
      },
    };

    cache.set(cacheKey, { data: result, ts: Date.now() });

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });

  } catch (err) {
    console.error('[historical-stablecoins] Error:', err?.message ?? err);
    return new Response(JSON.stringify({ error: 'Failed to fetch stablecoin history', series: [], period, summary: {} }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
