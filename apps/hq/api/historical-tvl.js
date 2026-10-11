export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const CACHE_TTL = 600; // 10 min
const cache = new Map(); // key → { data, ts }

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

/** Trim data array to only include points within the requested period */
function trimToPeriod(data, days) {
  if (!data || !data.length) return [];
  const cutoff = Date.now() / 1000 - days * 86400;
  return data.filter(d => d.date >= cutoff);
}

/** Format unix timestamp to ISO date string */
function unixToDate(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
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
  const type = url.searchParams.get('type') || 'total';
  const period = url.searchParams.get('period') || '30d';
  const chain = url.searchParams.get('chain') || '';
  const chains = url.searchParams.get('chains') || '';
  const days = periodToDays(period);

  const cacheKey = `hist-tvl:${type}:${chain || chains}:${period}`;
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

    let seriesResult = [];
    let summary = {};

    if (type === 'total') {
      // Total DeFi TVL history
      const res = await fetch('https://api.llama.fi/v2/historicalChainTvl', fetchOpts);
      clearTimeout(id);
      if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);
      const raw = await res.json();
      const trimmed = trimToPeriod(raw, days);
      const mapped = trimmed.map(d => ({ date: unixToDate(d.date), value: d.tvl }));
      seriesResult = [{ name: 'Total DeFi', data: mapped }];

      if (mapped.length) {
        const current = mapped[mapped.length - 1].value;
        const start = mapped[0].value;
        const allTimeMax = raw.reduce((m, d) => Math.max(m, d.tvl), 0);
        const athEntry = raw.find(d => d.tvl === allTimeMax);
        summary = {
          currentTotal: current,
          periodStart: start,
          percentChange: start > 0 ? ((current - start) / start) * 100 : 0,
          allTimeHigh: allTimeMax,
          allTimeHighDate: athEntry ? unixToDate(athEntry.date) : null,
        };
      }

    } else if (type === 'chain' && chain) {
      // Single chain TVL history
      const res = await fetch(`https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(chain)}`, fetchOpts);
      clearTimeout(id);
      if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);
      const raw = await res.json();
      const trimmed = trimToPeriod(raw, days);
      const mapped = trimmed.map(d => ({ date: unixToDate(d.date), value: d.tvl }));
      seriesResult = [{ name: chain, data: mapped }];

      if (mapped.length) {
        summary = {
          currentTotal: mapped[mapped.length - 1].value,
          periodStart: mapped[0].value,
          percentChange: mapped[0].value > 0 ? ((mapped[mapped.length - 1].value - mapped[0].value) / mapped[0].value) * 100 : 0,
        };
      }

    } else if (type === 'chains' && chains) {
      // Multiple chains TVL history
      const chainList = chains.split(',').map(c => c.trim()).filter(Boolean).slice(0, 10);
      const results = await Promise.allSettled(
        chainList.map(c =>
          fetch(`https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(c)}`, fetchOpts)
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(raw => {
              const trimmed = trimToPeriod(raw, days);
              return { name: c, data: trimmed.map(d => ({ date: unixToDate(d.date), value: d.tvl })) };
            })
        )
      );
      clearTimeout(id);

      seriesResult = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

      if (seriesResult.length) {
        const totalCurrent = seriesResult.reduce((s, sr) => s + (sr.data.length ? sr.data[sr.data.length - 1].value : 0), 0);
        const totalStart = seriesResult.reduce((s, sr) => s + (sr.data.length ? sr.data[0].value : 0), 0);
        summary = {
          currentTotal: totalCurrent,
          periodStart: totalStart,
          percentChange: totalStart > 0 ? ((totalCurrent - totalStart) / totalStart) * 100 : 0,
        };
      }

    } else {
      clearTimeout(id);
      return new Response(JSON.stringify({ error: 'Invalid type. Use total, chain, or chains' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const result = {
      timestamp: new Date().toISOString(),
      series: seriesResult,
      period,
      summary,
    };

    cache.set(cacheKey, { data: result, ts: Date.now() });

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });

  } catch (err) {
    console.error('[historical-tvl] Error:', err?.message ?? err);
    return new Response(JSON.stringify({ error: 'Failed to fetch historical TVL data', series: [], period, summary: {} }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
