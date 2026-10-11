export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';
import { fetchOkxOpenInterest } from './_okx-derivatives.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 120; // 2 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

// Tracked symbols on Binance Futures (USDT pairs)
const TRACKED = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ARB', 'OP', 'AVAX', 'MATIC', 'LINK', 'BNB', 'SUI', 'WIF', 'PEPE', 'BONK', 'INJ', 'TIA', 'SEI', 'APT', 'NEAR'];

async function fetchBinanceOI(controller) {
  const results = [];
  // Binance requires per-symbol calls for OI
  const batchSize = 5;
  for (let i = 0; i < TRACKED.length; i += batchSize) {
    const batch = TRACKED.slice(i, i + batchSize);
    const fetches = batch.map(async sym => {
      try {
        const res = await fetch(
          `https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}USDT`,
          { signal: controller.signal, headers: { Accept: 'application/json' } }
        );
        if (!res.ok) return null;
        const d = await res.json();
        return { symbol: sym, exchange: 'Binance', openInterest: parseFloat(d.openInterest), time: d.time };
      } catch (err) { console.warn(`[open-interest] Binance OI ${sym} failed:`, err?.message ?? err); return null; }
    });
    results.push(...(await Promise.all(fetches)));
  }
  return results.filter(Boolean);
}

async function fetchBinanceOIHistory(sym, controller) {
  try {
    const res = await fetch(
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}USDT&period=1h&limit=2`,
      { signal: controller.signal, headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.length >= 2) {
      const prev = parseFloat(data[0].sumOpenInterestValue);
      const curr = parseFloat(data[1].sumOpenInterestValue);
      return { symbol: sym, prevOiValue: prev, currOiValue: curr, change: prev > 0 ? ((curr - prev) / prev) * 100 : 0 };
    }
    return null;
  } catch (err) { console.warn(`[open-interest] Binance OI history ${sym} failed:`, err?.message ?? err); return null; }
}

async function fetchHyperliquidOI(controller) {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data) || data.length < 2) return [];
    const [meta, assetCtxs] = data;
    if (!meta?.universe || !assetCtxs) return [];
    return meta.universe
      .map((asset, i) => {
        const ctx = assetCtxs[i];
        if (!ctx || !TRACKED.includes(asset.name)) return null;
        return {
          symbol: asset.name,
          exchange: 'Hyperliquid',
          openInterest: parseFloat(ctx.openInterest),
          markPrice: parseFloat(ctx.markPx),
          oiValue: parseFloat(ctx.openInterest) * parseFloat(ctx.markPx),
        };
      })
      .filter(Boolean);
  } catch (err) { console.warn('[open-interest] Hyperliquid OI failed:', err?.message ?? err); return []; }
}

function classifyOI(changePct) {
  if (changePct > 10) return 'SURGING';
  if (changePct > 3) return 'RISING';
  if (changePct < -10) return 'COLLAPSING';
  if (changePct < -3) return 'DECLINING';
  return 'STABLE';
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

  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=60` },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000);

    // OKX runs alongside the others: Binance refuses US egress IPs (where
    // Cloud Run runs), so without it production sees Hyperliquid alone.
    const [binanceOI, hlOI, okxOI, ...histories] = await Promise.all([
      fetchBinanceOI(controller),
      fetchHyperliquidOI(controller),
      fetchOkxOpenInterest(TRACKED, controller),
      // Get OI history for top symbols
      ...TRACKED.slice(0, 10).map(s => fetchBinanceOIHistory(s, controller)),
    ]);
    clearTimeout(id);

    // Build OI history map
    const histMap = {};
    for (const h of histories) {
      if (h) histMap[h.symbol] = h;
    }

    // Merge by symbol
    const bySymbol = {};
    for (const r of binanceOI) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { symbol: r.symbol, exchanges: {} };
      bySymbol[r.symbol].exchanges.Binance = {
        openInterest: r.openInterest,
        oiValue: histMap[r.symbol]?.currOiValue || null,
        changePct: histMap[r.symbol]?.change || null,
      };
    }
    for (const r of hlOI) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { symbol: r.symbol, exchanges: {} };
      bySymbol[r.symbol].exchanges.Hyperliquid = {
        openInterest: r.openInterest,
        oiValue: r.oiValue,
        markPrice: r.markPrice,
      };
    }
    for (const r of okxOI) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { symbol: r.symbol, exchanges: {} };
      bySymbol[r.symbol].exchanges.OKX = {
        openInterest: r.openInterest,
        oiValue: r.oiValue,
        markPrice: r.markPrice,
      };
    }

    const entries = Object.values(bySymbol).map(entry => {
      const binance = entry.exchanges.Binance;
      const hl = entry.exchanges.Hyperliquid;
      const okx = entry.exchanges.OKX;
      const totalOiValue = (binance?.oiValue || 0) + (hl?.oiValue || 0) + (okx?.oiValue || 0);
      const changePct = binance?.changePct || 0;
      return {
        ...entry,
        totalOiValue,
        changePct,
        signal: classifyOI(changePct),
      };
    });

    entries.sort((a, b) => b.totalOiValue - a.totalOiValue);

    const totalOI = entries.reduce((s, e) => s + e.totalOiValue, 0);
    const surgingCount = entries.filter(e => e.signal === 'SURGING' || e.signal === 'RISING').length;
    const decliningCount = entries.filter(e => e.signal === 'COLLAPSING' || e.signal === 'DECLINING').length;

    const result = {
      timestamp: new Date().toISOString(),
      entries,
      summary: {
        totalOI,
        entryCount: entries.length,
        surgingCount,
        decliningCount,
        btcDominance: entries.find(e => e.symbol === 'BTC')?.totalOiValue
          ? Math.round((entries.find(e => e.symbol === 'BTC').totalOiValue / totalOI) * 100)
          : 0,
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=60` },
    });
  } catch (err) {
    console.error('[open-interest] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || {
      timestamp: new Date().toISOString(), entries: [], summary: { totalOI: 0, entryCount: 0, surgingCount: 0, decliningCount: 0, btcDominance: 0 }, unavailable: true,
    };
    return new Response(JSON.stringify(fallback), { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=30' } });
  }
}
