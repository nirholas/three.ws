import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
export const config = { runtime: 'edge' };

const SYMBOL_PATTERN = /^[A-Za-z0-9.^]+$/;
const MAX_SYMBOLS = 20;
const MAX_SYMBOL_LENGTH = 10;
const CACHE_TTL = 30_000; // 30 seconds
const FETCH_TIMEOUT = 8000; // 8 seconds

let cachedResponse = null;
let cacheTimestamp = 0;
let cacheKey = '';

function validateSymbols(symbolsParam) {
  if (!symbolsParam) return null;

  const symbols = symbolsParam
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => s.length <= MAX_SYMBOL_LENGTH && SYMBOL_PATTERN.test(s))
    .slice(0, MAX_SYMBOLS);

  return symbols.length > 0 ? symbols : null;
}

async function fetchQuote(symbol, apiKey, controller) {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      return { symbol, error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    if (data.c === 0 && data.h === 0 && data.l === 0) {
      return { symbol, error: 'No data available' };
    }

    return {
      symbol,
      price: data.c,
      change: data.d,
      changePercent: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc,
      timestamp: data.t,
    };
  } catch {
    return { symbol, error: 'Timeout or network error' };
  }
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, { status: 403, headers: corsHeaders });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ quotes: [], skipped: true, reason: 'FINNHUB_API_KEY not configured' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30', ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const symbols = validateSymbols(url.searchParams.get('symbols'));

  if (!symbols) {
    return new Response(JSON.stringify({ error: 'Invalid or missing symbols parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const symbolsKey = symbols.join(',');
    const now = Date.now();
    if (cachedResponse && cacheKey === symbolsKey && now - cacheTimestamp < CACHE_TTL) {
      return new Response(JSON.stringify(cachedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=15', 'X-Cache': 'HIT', ...corsHeaders },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const quotes = await Promise.all(
      symbols.map(symbol => fetchQuote(symbol, apiKey, controller))
    );
    clearTimeout(timeout);

    const result = { quotes };
    cachedResponse = result;
    cacheTimestamp = Date.now();
    cacheKey = symbolsKey;

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=15',
        ...corsHeaders,
      },
    });
  } catch (error) {
    const fallback = cachedResponse || { quotes: [], unavailable: true };
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15', ...corsHeaders },
    });
  }
}
