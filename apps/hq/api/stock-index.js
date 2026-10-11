/**
 * Stock Market Index Endpoint
 * Fetches weekly % change for a country's primary stock index via Yahoo Finance
 * Redis cached (1h TTL)
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { UA_BROWSER } from './_ua.js';

export const config = {
  runtime: 'edge',
};

const CACHE_TTL_SECONDS = 3600; // 1 hour
const CACHE_VERSION = 'stock-v1';
const FETCH_TIMEOUT = 8000;

const COUNTRY_INDEX = {
  US: { symbol: '^GSPC', name: 'S&P 500' },
  GB: { symbol: '^FTSE', name: 'FTSE 100' },
  DE: { symbol: '^GDAXI', name: 'DAX' },
  FR: { symbol: '^FCHI', name: 'CAC 40' },
  JP: { symbol: '^N225', name: 'Nikkei 225' },
  CN: { symbol: '000001.SS', name: 'SSE Composite' },
  HK: { symbol: '^HSI', name: 'Hang Seng' },
  IN: { symbol: '^BSESN', name: 'BSE Sensex' },
  KR: { symbol: '^KS11', name: 'KOSPI' },
  TW: { symbol: '^TWII', name: 'TAIEX' },
  AU: { symbol: '^AXJO', name: 'ASX 200' },
  BR: { symbol: '^BVSP', name: 'Bovespa' },
  CA: { symbol: '^GSPTSE', name: 'TSX Composite' },
  MX: { symbol: '^MXX', name: 'IPC Mexico' },
  AR: { symbol: '^MERV', name: 'MERVAL' },
  RU: { symbol: 'IMOEX.ME', name: 'MOEX' },
  ZA: { symbol: '^J203.JO', name: 'JSE All Share' },
  SA: { symbol: '^TASI.SR', name: 'Tadawul' },
  AE: { symbol: 'DFMGI.AE', name: 'DFM General' },
  IL: { symbol: '^TA125.TA', name: 'TA-125' },
  TR: { symbol: 'XU100.IS', name: 'BIST 100' },
  PL: { symbol: '^WIG20', name: 'WIG 20' },
  NL: { symbol: '^AEX', name: 'AEX' },
  CH: { symbol: '^SSMI', name: 'SMI' },
  ES: { symbol: '^IBEX', name: 'IBEX 35' },
  IT: { symbol: 'FTSEMIB.MI', name: 'FTSE MIB' },
  SE: { symbol: '^OMX', name: 'OMX Stockholm 30' },
  NO: { symbol: '^OSEAX', name: 'Oslo All Share' },
  SG: { symbol: '^STI', name: 'STI' },
  TH: { symbol: '^SET.BK', name: 'SET' },
  MY: { symbol: '^KLSE', name: 'KLCI' },
  ID: { symbol: '^JKSE', name: 'Jakarta Composite' },
  PH: { symbol: 'PSEI.PS', name: 'PSEi' },
  NZ: { symbol: '^NZ50', name: 'NZX 50' },
  EG: { symbol: '^EGX30.CA', name: 'EGX 30' },
  CL: { symbol: '^IPSA', name: 'IPSA' },
  PE: { symbol: '^SPBLPGPT', name: 'S&P Lima' },
  AT: { symbol: '^ATX', name: 'ATX' },
  BE: { symbol: '^BFX', name: 'BEL 20' },
  FI: { symbol: '^OMXH25', name: 'OMX Helsinki 25' },
  DK: { symbol: '^OMXC25', name: 'OMX Copenhagen 25' },
  IE: { symbol: '^ISEQ', name: 'ISEQ Overall' },
  PT: { symbol: '^PSI20', name: 'PSI 20' },
  CZ: { symbol: '^PX', name: 'PX Prague' },
  HU: { symbol: '^BUX', name: 'BUX' },
};

export default async function handler(request) {
  const cors = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
    });
  }

  const url = new URL(request.url);
  const code = (url.searchParams.get('code') || '').toUpperCase();

  if (!code) {
    return new Response(JSON.stringify({ error: 'code parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
    });
  }

  const index = COUNTRY_INDEX[code];
  if (!index) {
    return new Response(JSON.stringify({ error: 'No stock index for country', code, available: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
    });
  }

  const cacheKey = `${CACHE_VERSION}:${code}`;
  const cached = await getCachedJson(cacheKey);
  if (cached && typeof cached === 'object' && cached.indexName) {
    return new Response(JSON.stringify({ ...cached, cached: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const encodedSymbol = encodeURIComponent(index.symbol);
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?range=1mo&interval=1d`;

    const res = await fetch(yahooUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': UA_BROWSER },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error('[StockIndex] Yahoo error:', res.status, index.symbol);
      // Try serving stale cache
      const stale = await getCachedJson(cacheKey);
      if (stale && typeof stale === 'object' && stale.indexName) {
        return new Response(JSON.stringify({ ...stale, cached: true, stale: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
        });
      }
      return new Response(JSON.stringify({ error: 'Upstream error', available: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
      });
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      return new Response(JSON.stringify({ error: 'No data', available: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
      });
    }

    const allCloses = result.indicators?.quote?.[0]?.close?.filter(v => v != null);
    if (!allCloses || allCloses.length < 2) {
      return new Response(JSON.stringify({ error: 'Insufficient data', available: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
      });
    }

    // Take last ~5 trading days worth of data
    const closes = allCloses.slice(-6);
    const latest = closes[closes.length - 1];
    const oldest = closes[0];
    const weekChange = ((latest - oldest) / oldest) * 100;
    const meta = result.meta || {};

    const payload = {
      available: true,
      code,
      symbol: index.symbol,
      indexName: index.name,
      price: latest.toFixed(2),
      weekChangePercent: weekChange.toFixed(2),
      currency: meta.currency || 'USD',
      fetchedAt: new Date().toISOString(),
    };

    await setCachedJson(cacheKey, payload, CACHE_TTL_SECONDS);

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
    });
  } catch (err) {
    console.error('[StockIndex] Error:', err);
    // Serve stale cache on error
    const stale = await getCachedJson(cacheKey).catch(() => null);
    if (stale && typeof stale === 'object' && stale.indexName) {
      return new Response(JSON.stringify({ ...stale, cached: true, stale: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
      });
    }
    return new Response(JSON.stringify({ error: 'Service temporarily unavailable', available: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60' },
    });
  }
}
