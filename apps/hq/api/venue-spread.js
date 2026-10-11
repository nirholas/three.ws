export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

/**
 * Cross-venue price divergence monitor.
 *
 * Quotes the same asset on several independent spot venues at the same
 * moment and reports the spread between the cheapest and dearest in basis
 * points. A wide spread means either a real arbitrage window or a venue
 * with a stale or thin book, and both are worth seeing.
 *
 * All three venues are keyless and answer from US egress IPs (unlike
 * Binance and Bybit, which refuse them), so this works on Cloud Run.
 */

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 60;
const UPSTREAM_TIMEOUT_MS = 8000;

let cachedResponse = null;
let cacheTimestamp = 0;

/** Per-venue symbol conventions. Kraken uses its own asset codes. */
const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', coinbase: 'BTC-USD', kraken: 'XBTUSD', okx: 'BTC-USDT' },
  { symbol: 'ETH', name: 'Ethereum', coinbase: 'ETH-USD', kraken: 'ETHUSD', okx: 'ETH-USDT' },
  { symbol: 'SOL', name: 'Solana', coinbase: 'SOL-USD', kraken: 'SOLUSD', okx: 'SOL-USDT' },
  { symbol: 'XRP', name: 'XRP', coinbase: 'XRP-USD', kraken: 'XRPUSD', okx: 'XRP-USDT' },
  { symbol: 'DOGE', name: 'Dogecoin', coinbase: 'DOGE-USD', kraken: 'XDGUSD', okx: 'DOGE-USDT' },
  { symbol: 'LINK', name: 'Chainlink', coinbase: 'LINK-USD', kraken: 'LINKUSD', okx: 'LINK-USDT' },
  { symbol: 'AVAX', name: 'Avalanche', coinbase: 'AVAX-USD', kraken: 'AVAXUSD', okx: 'AVAX-USDT' },
  { symbol: 'ADA', name: 'Cardano', coinbase: 'ADA-USD', kraken: 'ADAUSD', okx: 'ADA-USDT' },
];

/** Spread thresholds in basis points. */
const WIDE_BPS = 25;
const NOTABLE_BPS = 10;

function withTimeout(controller) {
  return setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
}

async function fetchCoinbase(signal) {
  const out = new Map();
  await Promise.all(ASSETS.map(async a => {
    try {
      const res = await fetch(`https://api.exchange.coinbase.com/products/${a.coinbase}/ticker`, {
        signal,
        headers: { Accept: 'application/json', 'User-Agent': 'three.ws-HQ' },
      });
      if (!res.ok) return;
      const j = await res.json();
      const price = parseFloat(j.price);
      if (Number.isFinite(price)) out.set(a.symbol, price);
    } catch (err) {
      console.warn(`[venue-spread] Coinbase ${a.symbol} failed:`, err?.message ?? err);
    }
  }));
  return out;
}

async function fetchKraken(signal) {
  const out = new Map();
  try {
    const pairs = ASSETS.map(a => a.kraken).join(',');
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs}`, {
      signal, headers: { Accept: 'application/json' },
    });
    if (!res.ok) return out;
    const j = await res.json();
    const result = j?.result;
    if (!result) return out;
    // Kraken returns its own normalised pair keys (XXBTZUSD for XBTUSD), so
    // match by the base asset code rather than the requested pair string.
    for (const a of ASSETS) {
      const base = a.kraken.replace(/USD$/, '');
      const key = Object.keys(result).find(k => k === a.kraken || k.includes(base));
      const price = key ? parseFloat(result[key]?.c?.[0]) : NaN;
      if (Number.isFinite(price)) out.set(a.symbol, price);
    }
  } catch (err) {
    console.warn('[venue-spread] Kraken failed:', err?.message ?? err);
  }
  return out;
}

async function fetchOkx(signal) {
  const out = new Map();
  try {
    const res = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SPOT', {
      signal, headers: { Accept: 'application/json' },
    });
    if (!res.ok) return out;
    const j = await res.json();
    if (j.code !== '0' || !Array.isArray(j.data)) return out;
    const wanted = new Map(ASSETS.map(a => [a.okx, a.symbol]));
    for (const t of j.data) {
      const symbol = wanted.get(t.instId);
      if (!symbol) continue;
      const price = parseFloat(t.last);
      if (Number.isFinite(price)) out.set(symbol, price);
    }
  } catch (err) {
    console.warn('[venue-spread] OKX failed:', err?.message ?? err);
  }
  return out;
}

/**
 * Build the spread table from per-venue price maps.
 * Exported for unit testing; the handler supplies live maps.
 */
export function buildSpreads(venueMaps) {
  const rows = [];
  for (const asset of ASSETS) {
    const quotes = [];
    for (const [venue, prices] of venueMaps) {
      const price = prices.get(asset.symbol);
      if (Number.isFinite(price)) quotes.push({ venue, price });
    }
    // A spread needs at least two independent quotes.
    if (quotes.length < 2) continue;

    quotes.sort((a, b) => a.price - b.price);
    const low = quotes[0];
    const high = quotes[quotes.length - 1];
    const mid = quotes.reduce((s, q) => s + q.price, 0) / quotes.length;
    const spreadAbs = high.price - low.price;
    const spreadBps = mid > 0 ? (spreadAbs / mid) * 10000 : 0;

    rows.push({
      symbol: asset.symbol,
      name: asset.name,
      venues: quotes.map(q => ({ venue: q.venue, price: q.price })),
      venueCount: quotes.length,
      low: { venue: low.venue, price: low.price },
      high: { venue: high.venue, price: high.price },
      mid: +mid.toFixed(6),
      spreadAbs: +spreadAbs.toFixed(6),
      spreadBps: +spreadBps.toFixed(2),
      level: spreadBps >= WIDE_BPS ? 'WIDE' : spreadBps >= NOTABLE_BPS ? 'NOTABLE' : 'TIGHT',
    });
  }

  rows.sort((a, b) => b.spreadBps - a.spreadBps);

  const avgBps = rows.length > 0 ? rows.reduce((s, r) => s + r.spreadBps, 0) / rows.length : 0;
  return {
    timestamp: new Date().toISOString(),
    count: rows.length,
    venues: [...venueMaps.keys()],
    thresholds: { notableBps: NOTABLE_BPS, wideBps: WIDE_BPS },
    summary: {
      avgSpreadBps: +avgBps.toFixed(2),
      wideCount: rows.filter(r => r.level === 'WIDE').length,
      notableCount: rows.filter(r => r.level === 'NOTABLE').length,
      widest: rows[0] ? { symbol: rows[0].symbol, spreadBps: rows[0].spreadBps } : null,
    },
    spreads: rows,
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
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=30` },
    });
  }

  const controller = new AbortController();
  const timeout = withTimeout(controller);
  try {
    const [coinbase, kraken, okx] = await Promise.all([
      fetchCoinbase(controller.signal),
      fetchKraken(controller.signal),
      fetchOkx(controller.signal),
    ]);

    const venueMaps = new Map();
    if (coinbase.size) venueMaps.set('Coinbase', coinbase);
    if (kraken.size) venueMaps.set('Kraken', kraken);
    if (okx.size) venueMaps.set('OKX', okx);

    // One live venue cannot produce a spread; serve the last good table.
    if (venueMaps.size < 2) {
      if (cachedResponse) {
        return new Response(JSON.stringify(cachedResponse), {
          headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'STALE', 'Cache-Control': 'public, s-maxage=30' },
        });
      }
      return new Response(JSON.stringify({
        timestamp: new Date().toISOString(),
        count: 0,
        venues: [...venueMaps.keys()],
        thresholds: { notableBps: NOTABLE_BPS, wideBps: WIDE_BPS },
        summary: { avgSpreadBps: 0, wideCount: 0, notableCount: 0, widest: null },
        spreads: [],
        unavailable: true,
      }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=30' } });
    }

    const result = buildSpreads(venueMaps);
    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=30` },
    });
  } catch (err) {
    console.error('[venue-spread] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || {
      timestamp: new Date().toISOString(), count: 0, venues: [],
      thresholds: { notableBps: NOTABLE_BPS, wideBps: WIDE_BPS },
      summary: { avgSpreadBps: 0, wideCount: 0, notableCount: 0, widest: null },
      spreads: [], unavailable: true,
    };
    return new Response(JSON.stringify(fallback), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=30' },
    });
  } finally {
    clearTimeout(timeout);
  }
}
