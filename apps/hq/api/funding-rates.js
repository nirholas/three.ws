export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';
import { fetchOkxFunding } from './_okx-derivatives.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 120; // 2 minutes - funding rates change fast
let cachedResponse = null;
let cacheTimestamp = 0;

const TRACKED_PAIRS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ARB', 'OP', 'AVAX', 'MATIC', 'LINK', 'BNB', 'SUI'];

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    rates: [],
    summary: { avgFunding: 0, extremeCount: 0, sentiment: 'UNKNOWN' },
    unavailable: true,
  };
}

async function fetchBinanceFunding(controller) {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data || [])
      .filter(d => {
        const base = d.symbol.replace('USDT', '');
        return TRACKED_PAIRS.includes(base);
      })
      .map(d => ({
        symbol: d.symbol.replace('USDT', ''),
        exchange: 'Binance',
        fundingRate: parseFloat(d.lastFundingRate) * 100,
        markPrice: parseFloat(d.markPrice),
        indexPrice: parseFloat(d.indexPrice),
        nextFundingTime: d.nextFundingTime,
      }));
  } catch (err) {
    console.warn('[funding-rates] Binance premium index failed:', err?.message ?? err);
    return [];
  }
}

async function fetchHyperliquidFunding(controller) {
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
        if (!ctx || !TRACKED_PAIRS.includes(asset.name)) return null;
        return {
          symbol: asset.name,
          exchange: 'Hyperliquid',
          fundingRate: parseFloat(ctx.funding) * 100,
          markPrice: parseFloat(ctx.markPx),
          openInterest: parseFloat(ctx.openInterest),
          volume24h: parseFloat(ctx.dayNtlVlm),
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('[funding-rates] Hyperliquid funding failed:', err?.message ?? err);
    return [];
  }
}

function classifyFunding(rate) {
  const absRate = Math.abs(rate);
  if (absRate >= 0.1) return 'EXTREME';
  if (absRate >= 0.05) return 'HIGH';
  if (absRate >= 0.01) return 'MODERATE';
  return 'NORMAL';
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
    const id = setTimeout(() => controller.abort(), 10000);

    // OKX runs alongside Binance and Hyperliquid rather than behind them:
    // Binance refuses US egress IPs (where Cloud Run runs), so without OKX
    // production sees Hyperliquid alone.
    const [binanceRates, hlRates, okxRates] = await Promise.all([
      fetchBinanceFunding(controller),
      fetchHyperliquidFunding(controller),
      fetchOkxFunding(TRACKED_PAIRS, controller),
    ]);
    clearTimeout(id);

    // Merge by symbol - group exchanges together
    const bySymbol = {};
    for (const r of [...binanceRates, ...hlRates, ...okxRates]) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { symbol: r.symbol, exchanges: {} };
      bySymbol[r.symbol].exchanges[r.exchange] = {
        fundingRate: r.fundingRate,
        markPrice: r.markPrice,
        level: classifyFunding(r.fundingRate),
      };
    }

    // Sort by highest absolute funding
    const rates = Object.values(bySymbol)
      .map(entry => {
        const allRates = Object.values(entry.exchanges).map(e => e.fundingRate);
        const avg = allRates.reduce((s, r) => s + r, 0) / allRates.length;
        return { ...entry, avgFunding: avg, level: classifyFunding(avg) };
      })
      .sort((a, b) => Math.abs(b.avgFunding) - Math.abs(a.avgFunding));

    const avgFunding = rates.length > 0 ? rates.reduce((s, r) => s + r.avgFunding, 0) / rates.length : 0;
    const extremeCount = rates.filter(r => r.level === 'EXTREME' || r.level === 'HIGH').length;
    const sentiment = avgFunding > 0.03 ? 'OVERLEVERAGED LONG' : avgFunding < -0.03 ? 'OVERLEVERAGED SHORT' : 'NEUTRAL';

    const result = {
      timestamp: new Date().toISOString(),
      rates,
      summary: {
        avgFunding: Math.round(avgFunding * 1000) / 1000,
        extremeCount,
        sentiment,
        sourceCount: [binanceRates, hlRates, okxRates].filter(l => l.length > 0).length,
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=60` },
    });
  } catch (err) {
    console.error('[funding-rates] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=30' },
    });
  }
}
