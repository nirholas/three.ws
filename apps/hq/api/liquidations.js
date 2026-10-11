export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';
import { fetchOkxLiquidations } from './_okx-derivatives.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 30; // 30 seconds - liquidations are time-critical
let cachedResponse = null;
let cacheTimestamp = 0;

const TRACKED = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ARB', 'OP', 'AVAX', 'LINK', 'BNB', 'SUI', 'WIF', 'PEPE', 'BONK', 'INJ', 'TIA', 'APT', 'NEAR'];

// --- Bybit V5 recent liquidation trades ---
async function fetchBybitLiquidations(controller) {
  const results = [];
  // Bybit exposes liquidation orders on their public recent-trade endpoint
  // We fetch major symbols in parallel batches
  const symbols = TRACKED.map(s => s + 'USDT');
  const batchSize = 6;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const fetches = batch.map(async sym => {
      try {
        const res = await fetch(
          `https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${sym}&limit=50`,
          { signal: controller.signal, headers: { Accept: 'application/json' } }
        );
        if (!res.ok) return [];
        const json = await res.json();
        if (json.retCode !== 0 || !json.result?.list) return [];
        // Bybit marks liquidation trades with isBlockTrade flag
        // Note: Using isBlockTrade + value threshold as heuristic - may include large non-liquidation trades
        return json.result.list
          .filter(t => {
            const value = parseFloat(t.size) * parseFloat(t.price);
            return (t.isBlockTrade === 'true' || value >= 5000) && !isNaN(value);
          })
          .map(t => {
            const base = sym.replace('USDT', '');
            const price = parseFloat(t.price);
            const qty = parseFloat(t.size);
            return {
              symbol: base,
              exchange: 'Bybit',
              side: t.side === 'Buy' ? 'SHORT' : 'LONG',
              price,
              qty,
              value: price * qty,
              time: parseInt(t.time),
            };
          })
          .filter(l => TRACKED.includes(l.symbol));
      } catch (err) { console.warn(`[liquidations] Bybit ${sym} failed:`, err?.message ?? err); return []; }
    });
    const batchResults = await Promise.all(fetches);
    results.push(...batchResults.flat());
  }
  return results;
}

// --- Binance forced liquidation orders (public, but only returns very recent) ---
async function fetchBinanceLiquidations(controller) {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/allForceOrders?limit=100', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(d => {
        const base = (d.symbol || '').replace('USDT', '').replace('BUSD', '');
        return TRACKED.includes(base);
      })
      .map(d => ({
        symbol: d.symbol.replace('USDT', '').replace('BUSD', ''),
        exchange: 'Binance',
        side: d.side === 'BUY' ? 'SHORT' : 'LONG',
        price: parseFloat(d.price),
        qty: parseFloat(d.origQty),
        value: parseFloat(d.price) * parseFloat(d.origQty),
        time: d.time,
      }));
  } catch (err) { console.warn('[liquidations] Binance allForceOrders failed:', err?.message ?? err); return []; }
}

// OKX liquidations come from the shared derivatives lane in
// _okx-derivatives.js, which queries per instrument family. Querying
// instType=SWAP alone returns error 50015 and no data.

function classifyLiquidation(value) {
  if (value >= 1000000) return 'MEGA';
  if (value >= 100000) return 'LARGE';
  if (value >= 10000) return 'MEDIUM';
  return 'SMALL';
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
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=15` },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);

    const [binanceLiqs, bybitLiqs, okxLiqs] = await Promise.all([
      fetchBinanceLiquidations(controller),
      fetchBybitLiquidations(controller),
      fetchOkxLiquidations(TRACKED, controller),
    ]);
    clearTimeout(id);

    // Deduplicate by exchange+symbol+time (within 1s window)
    const seen = new Set();
    const allLiqs = [...binanceLiqs, ...bybitLiqs, ...okxLiqs]
      .map(l => ({ ...l, severity: classifyLiquidation(l.value) }))
      .filter(l => {
        const key = `${l.exchange}-${l.symbol}-${l.side}-${Math.floor((l.time || 0) / 1000)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    // Sort by time descending (most recent first)
    allLiqs.sort((a, b) => (b.time || 0) - (a.time || 0));

    // Only keep liquidations from the last 4 hours
    const cutoff = now - 4 * 60 * 60 * 1000;
    const recentLiqs = allLiqs.filter(l => (l.time || 0) > cutoff);

    // Aggregate stats
    const totalValue = recentLiqs.reduce((s, l) => s + l.value, 0);
    const longLiqs = recentLiqs.filter(l => l.side === 'LONG');
    const shortLiqs = recentLiqs.filter(l => l.side === 'SHORT');
    const longValue = longLiqs.reduce((s, l) => s + l.value, 0);
    const shortValue = shortLiqs.reduce((s, l) => s + l.value, 0);
    const megaCount = recentLiqs.filter(l => l.severity === 'MEGA').length;
    const largeCount = recentLiqs.filter(l => l.severity === 'LARGE').length;

    // By-symbol aggregation
    const bySymbol = {};
    for (const l of recentLiqs) {
      if (!bySymbol[l.symbol]) bySymbol[l.symbol] = { symbol: l.symbol, longValue: 0, shortValue: 0, count: 0 };
      bySymbol[l.symbol].count++;
      if (l.side === 'LONG') bySymbol[l.symbol].longValue += l.value;
      else bySymbol[l.symbol].shortValue += l.value;
    }
    const symbolStats = Object.values(bySymbol).sort((a, b) => (b.longValue + b.shortValue) - (a.longValue + a.shortValue));

    const result = {
      timestamp: new Date().toISOString(),
      liquidations: recentLiqs.slice(0, 50),
      symbolStats,
      summary: {
        totalCount: recentLiqs.length,
        totalValue,
        longCount: longLiqs.length,
        shortCount: shortLiqs.length,
        longValue,
        shortValue,
        megaCount,
        largeCount,
        dominantSide: longValue > shortValue * 1.5 ? 'LONG PAIN' : shortValue > longValue * 1.5 ? 'SHORT SQUEEZE' : 'BALANCED',
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=15` },
    });
  } catch (err) {
    console.error('[liquidations] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || {
      timestamp: new Date().toISOString(), liquidations: [], symbolStats: [], summary: { totalCount: 0, totalValue: 0, longCount: 0, shortCount: 0, longValue: 0, shortValue: 0, megaCount: 0, largeCount: 0, dominantSide: 'UNKNOWN' }, unavailable: true,
    };
    return new Response(JSON.stringify(fallback), { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=15' } });
  }
}
