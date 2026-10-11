export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

const TRACKED = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ARB', 'AVAX', 'LINK', 'BNB', 'SUI'];

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

// --- Binance funding rates (same upstream as funding-rates.js) ---
async function fetchBinanceFunding(controller) {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', {
      signal: controller.signal, headers: { Accept: 'application/json' },
    });
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const d of data || []) {
      const base = d.symbol.replace('USDT', '');
      if (TRACKED.includes(base)) {
        map[base] = parseFloat(d.lastFundingRate) * 100;
      }
    }
    return map;
  } catch (err) { console.warn('[exchange-flow] Binance funding failed:', err?.message ?? err); return {}; }
}

// --- Binance OI history (same upstream as open-interest.js) ---
async function fetchBinanceOIChanges(controller) {
  const map = {};
  const batchSize = 5;
  for (let i = 0; i < TRACKED.length; i += batchSize) {
    const batch = TRACKED.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async sym => {
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
          return { symbol: sym, changePct: prev > 0 ? ((curr - prev) / prev) * 100 : 0, oiValue: curr };
        }
        return null;
      } catch { return null; }
    }));
    for (const r of results) { if (r) map[r.symbol] = r; }
  }
  return map;
}

// --- Binance long/short ratio (same upstream as long-short-ratio.js) ---
async function fetchBinanceLongShort(controller) {
  const map = {};
  const results = await Promise.all(TRACKED.map(async sym => {
    try {
      const res = await fetch(
        `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${sym}USDT&period=1h&limit=1`,
        { signal: controller.signal, headers: { Accept: 'application/json' } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.length) return { symbol: sym, ratio: parseFloat(data[data.length - 1].longShortRatio) };
      return null;
    } catch { return null; }
  }));
  for (const r of results) { if (r) map[r.symbol] = r.ratio; }
  return map;
}

// --- Binance forced liquidation aggregates (same upstream as liquidations.js) ---
async function fetchLiquidationBias(controller) {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/allForceOrders?limit=100', {
      signal: controller.signal, headers: { Accept: 'application/json' },
    });
    if (!res.ok) return {};
    const data = await res.json();
    if (!Array.isArray(data)) return {};
    const map = {};
    for (const d of data) {
      const base = (d.symbol || '').replace('USDT', '').replace('BUSD', '');
      if (!TRACKED.includes(base)) continue;
      if (!map[base]) map[base] = { longVal: 0, shortVal: 0 };
      const val = parseFloat(d.price) * parseFloat(d.origQty);
      if (isNaN(val)) continue;
      if (d.side === 'BUY') map[base].shortVal += val; // BUY = short liq
      else map[base].longVal += val;
    }
    return map;
  } catch (err) { console.warn('[exchange-flow] Binance liquidations failed:', err?.message ?? err); return {}; }
}

// --- ETF flow direction (from Yahoo Finance, same as etf-flows.js) ---
async function fetchEtfDirection(controller) {
  try {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/IBIT?range=5d&interval=1d', {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const chart = await res.json();
    const result = chart?.chart?.result?.[0];
    if (!result) return null;
    const closes = (result.indicators?.quote?.[0]?.close || []).filter(p => p != null);
    if (closes.length < 2) return null;
    const latest = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const change = ((latest - prev) / prev) * 100;
    return change > 0.5 ? 'INFLOW' : change < -0.5 ? 'OUTFLOW' : 'NEUTRAL';
  } catch { return null; }
}

function buildFlows(fundingMap, oiMap, lsMap, liqMap, etfDirection) {
  return TRACKED.map(symbol => {
    let score = 0;
    const signals = {};

    // Funding rate signal: positive = longs paying = bullish positioning = accumulation
    const fr = fundingMap[symbol];
    if (fr !== undefined) {
      score += fr > 0.01 ? 15 : fr > 0 ? 8 : fr < -0.01 ? -15 : fr < 0 ? -8 : 0;
      signals.fundingRate = Math.round(fr * 10000) / 10000;
    }

    // OI change: rising = new money entering
    const oi = oiMap[symbol];
    if (oi) {
      const ch = oi.changePct || 0;
      score += ch > 5 ? 20 : ch > 0 ? 10 : ch < -5 ? -20 : ch < 0 ? -10 : 0;
      signals.oiChangePct = Math.round(ch * 100) / 100;
      signals.oiValue = oi.oiValue;
    }

    // Long/short ratio: > 1 means more longs = bullish
    const lsr = lsMap[symbol];
    if (lsr !== undefined) {
      score += lsr > 1.5 ? 15 : lsr > 1 ? 5 : lsr < 0.7 ? -15 : lsr < 1 ? -5 : 0;
      signals.longShortRatio = Math.round(lsr * 100) / 100;
    }

    // Liquidation bias: more short liqs = forced buying = bullish
    const liq = liqMap[symbol];
    if (liq) {
      const net = liq.shortVal - liq.longVal;
      score += net > 1e6 ? 15 : net > 0 ? 5 : net < -1e6 ? -15 : net < 0 ? -5 : 0;
      signals.netLiquidation = Math.round(net);
    }

    // ETF flow (BTC/ETH proxy)
    if ((symbol === 'BTC' || symbol === 'ETH') && etfDirection) {
      score += etfDirection === 'INFLOW' ? 20 : etfDirection === 'OUTFLOW' ? -20 : 0;
      signals.etfFlow = etfDirection;
    }

    score = clamp(score, -100, 100);
    const direction = score > 15 ? 'INFLOW' : score < -15 ? 'OUTFLOW' : 'NEUTRAL';

    return {
      symbol,
      score,
      direction,
      label: direction === 'INFLOW' ? 'Net Accumulation' : direction === 'OUTFLOW' ? 'Net Distribution' : 'Neutral',
      signals,
    };
  });
}

function computeSummary(flows) {
  const inflows = flows.filter(f => f.direction === 'INFLOW').length;
  const outflows = flows.filter(f => f.direction === 'OUTFLOW').length;
  const avg = flows.reduce((s, f) => s + f.score, 0) / (flows.length || 1);
  return {
    inflows,
    outflows,
    neutral: flows.length - inflows - outflows,
    avgScore: Math.round(avg),
    marketDirection: avg > 10 ? 'ACCUMULATION' : avg < -10 ? 'DISTRIBUTION' : 'MIXED',
  };
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    flows: TRACKED.map(symbol => ({ symbol, score: 0, direction: 'NEUTRAL', label: 'Neutral', signals: {} })),
    summary: { inflows: 0, outflows: 0, neutral: TRACKED.length, avgScore: 0, marketDirection: 'MIXED' },
    unavailable: true,
  };
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

    const [fundingMap, oiMap, lsMap, liqMap, etfDir] = await Promise.all([
      fetchBinanceFunding(controller),
      fetchBinanceOIChanges(controller),
      fetchBinanceLongShort(controller),
      fetchLiquidationBias(controller),
      fetchEtfDirection(controller),
    ]);
    clearTimeout(id);

    const flows = buildFlows(fundingMap, oiMap, lsMap, liqMap, etfDir);

    // Sort by absolute score descending (most actionable first)
    flows.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    const result = {
      timestamp: new Date().toISOString(),
      flows,
      summary: computeSummary(flows),
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=60` },
    });
  } catch (err) {
    console.error('[exchange-flow] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=30' },
    });
  }
}
