export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';
import { fetchOkxLongShort } from './_okx-derivatives.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 minutes - longer TTL to reduce upstream rate-limit pressure
let cachedResponse = null;
let cacheTimestamp = 0;

const TRACKED = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ARB', 'AVAX', 'LINK', 'BNB', 'SUI'];

// Bybit symbol mapping (some symbols differ)
const BYBIT_SYMBOLS = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', DOGE: 'DOGEUSDT',
  XRP: 'XRPUSDT', ARB: 'ARBUSDT', AVAX: 'AVAXUSDT', LINK: 'LINKUSDT',
  BNB: 'BNBUSDT', SUI: 'SUIUSDT',
};

async function fetchFromBinance(sym, controller) {
  try {
    const res = await fetch(
      `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${sym}USDT&period=1h&limit=5`,
      { signal: controller.signal, headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;
    const latest = data[data.length - 1];
    const prev = data.length > 1 ? data[data.length - 2] : null;
    return {
      symbol: sym,
      longAccount: parseFloat(latest.longAccount),
      shortAccount: parseFloat(latest.shortAccount),
      longShortRatio: parseFloat(latest.longShortRatio),
      timestamp: latest.timestamp,
      prevRatio: prev ? parseFloat(prev.longShortRatio) : null,
      change: prev ? parseFloat(latest.longShortRatio) - parseFloat(prev.longShortRatio) : 0,
      source: 'binance',
    };
  } catch (err) { console.warn(`[long-short-ratio] Binance ${sym} failed:`, err?.message ?? err); return null; }
}

async function fetchFromBybit(sym, controller) {
  try {
    const bybitSymbol = BYBIT_SYMBOLS[sym] || `${sym}USDT`;
    const res = await fetch(
      `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${bybitSymbol}&period=1h&limit=5`,
      { signal: controller.signal, headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (json.retCode !== 0 || !json.result?.list?.length) return null;
    const list = json.result.list;
    const latest = list[0]; // Bybit returns newest first
    const prev = list.length > 1 ? list[1] : null;
    const buyRatio = parseFloat(latest.buyRatio);
    const sellRatio = parseFloat(latest.sellRatio);
    const ratio = sellRatio > 0 ? buyRatio / sellRatio : 1;
    const prevBuy = prev ? parseFloat(prev.buyRatio) : null;
    const prevSell = prev ? parseFloat(prev.sellRatio) : null;
    const prevRatio = (prevBuy && prevSell && prevSell > 0) ? prevBuy / prevSell : null;
    return {
      symbol: sym,
      longAccount: buyRatio,
      shortAccount: sellRatio,
      longShortRatio: Math.round(ratio * 100) / 100,
      timestamp: parseInt(latest.timestamp),
      prevRatio,
      change: prevRatio != null ? ratio - prevRatio : 0,
      source: 'bybit',
    };
  } catch (err) { console.warn(`[long-short-ratio] Bybit ${sym} failed:`, err?.message ?? err); return null; }
}

async function fetchLongShortRatios(controller) {
  // Try Binance first for all symbols
  const binanceResults = await Promise.all(
    TRACKED.map(sym => fetchFromBinance(sym, controller))
  );

  const results = [];
  const failedSymbols = [];

  for (let i = 0; i < TRACKED.length; i++) {
    if (binanceResults[i]) {
      results.push(binanceResults[i]);
    } else {
      failedSymbols.push(TRACKED[i]);
    }
  }

  // Fallback to Bybit for any symbols that failed on Binance
  const stillFailed = [];
  if (failedSymbols.length > 0) {
    const bybitResults = await Promise.all(
      failedSymbols.map(sym => fetchFromBybit(sym, controller))
    );
    for (let i = 0; i < failedSymbols.length; i++) {
      if (bybitResults[i]) results.push(bybitResults[i]);
      else stillFailed.push(failedSymbols[i]);
    }
  }

  // Third rung: OKX. Binance and Bybit both refuse US egress IPs, which is
  // where Cloud Run runs, so in production this is usually the only lane
  // that answers.
  if (stillFailed.length > 0) {
    results.push(...await fetchOkxLongShort(stillFailed, controller));
  }

  return results;
}

async function fetchGlobalLongShort(controller, topTraderResults) {
  // Try Binance global ratios
  const fetches = TRACKED.slice(0, 5).map(async sym => {
    try {
      const res = await fetch(
        `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}USDT&period=1h&limit=5`,
        { signal: controller.signal, headers: { Accept: 'application/json' } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.length) return null;
      const latest = data[data.length - 1];
      return {
        symbol: sym,
        longAccount: parseFloat(latest.longAccount),
        shortAccount: parseFloat(latest.shortAccount),
        longShortRatio: parseFloat(latest.longShortRatio),
      };
    } catch (err) { console.warn(`[long-short-ratio] Global L/S ${sym} failed:`, err?.message ?? err); return null; }
  });
  const binanceGlobal = (await Promise.all(fetches)).filter(Boolean);
  if (binanceGlobal.length > 0) return binanceGlobal;

  // OKX has no separate "global" cohort: its account ratio is already the
  // all-accounts figure. Reuse what the top-trader pass fetched rather than
  // calling the same rate-limited endpoint twice, which starves both.
  return topTraderResults
    .filter(t => t.source === 'okx')
    .map(t => ({
      symbol: t.symbol,
      longAccount: t.longAccount,
      shortAccount: t.shortAccount,
      longShortRatio: t.longShortRatio,
    }));
}

function classifySentiment(ratio) {
  if (ratio >= 3) return 'EXTREME LONG';
  if (ratio >= 1.5) return 'BULLISH';
  if (ratio >= 0.7) return 'NEUTRAL';
  if (ratio >= 0.33) return 'BEARISH';
  return 'EXTREME SHORT';
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

    // Sequential on purpose: both passes can land on OKX's Rubik endpoint,
    // and running them concurrently rate-limits most of the board away.
    const topTrader = await fetchLongShortRatios(controller);
    const globalRatios = await fetchGlobalLongShort(controller, topTrader);
    clearTimeout(id);

    // Merge global data
    const globalMap = {};
    for (const g of globalRatios) { globalMap[g.symbol] = g; }

    const entries = topTrader.map(t => ({
      symbol: t.symbol,
      topTrader: {
        longPct: Math.round(t.longAccount * 100),
        shortPct: Math.round(t.shortAccount * 100),
        ratio: t.longShortRatio,
        change: t.change,
      },
      global: globalMap[t.symbol] ? {
        longPct: Math.round(globalMap[t.symbol].longAccount * 100),
        shortPct: Math.round(globalMap[t.symbol].shortAccount * 100),
        ratio: globalMap[t.symbol].longShortRatio,
      } : null,
      sentiment: classifySentiment(t.longShortRatio),
    }));

    // Sort by deviation from neutral (1.0)
    entries.sort((a, b) => Math.abs(b.topTrader.ratio - 1) - Math.abs(a.topTrader.ratio - 1));

    const avgRatio = entries.length > 0 ? entries.reduce((s, e) => s + e.topTrader.ratio, 0) / entries.length : 1;
    const extremeCount = entries.filter(e => e.sentiment.includes('EXTREME')).length;
    const bullishCount = entries.filter(e => e.sentiment === 'BULLISH' || e.sentiment === 'EXTREME LONG').length;
    const bearishCount = entries.filter(e => e.sentiment === 'BEARISH' || e.sentiment === 'EXTREME SHORT').length;

    const result = {
      timestamp: new Date().toISOString(),
      entries,
      summary: {
        avgRatio: Math.round(avgRatio * 100) / 100,
        extremeCount,
        bullishCount,
        bearishCount,
        marketSentiment: classifySentiment(avgRatio),
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=60` },
    });
  } catch (err) {
    console.error('[long-short-ratio] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || {
      timestamp: new Date().toISOString(), entries: [],
      summary: { avgRatio: 1, extremeCount: 0, bullishCount: 0, bearishCount: 0, marketSentiment: 'UNKNOWN' }, unavailable: true,
    };
    return new Response(JSON.stringify(fallback), { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=30' } });
  }
}
