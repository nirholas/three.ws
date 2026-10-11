export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { UA_BROWSER } from './_ua.js';

const SYMBOL_PATTERN = /^[A-Za-z0-9.^=\-]+$/;
const MAX_SYMBOL_LENGTH = 20;
const CACHE_TTL = 60_000; // 60 seconds
const FETCH_TIMEOUT = 8000;

// In-memory cache keyed by symbol
const symbolCache = new Map();

function validateSymbol(symbol) {
  if (!symbol) return null;
  const trimmed = symbol.trim().toUpperCase();
  if (trimmed.length > MAX_SYMBOL_LENGTH) return null;
  if (!SYMBOL_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  const url = new URL(req.url);
  const symbol = validateSymbol(url.searchParams.get('symbol'));

  if (!symbol) {
    return new Response(JSON.stringify({ error: 'Invalid or missing symbol parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  try {
    const now = Date.now();
    const cached = symbolCache.get(symbol);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      return new Response(cached.data, {
        status: cached.status,
        headers: { 'Content-Type': 'application/json', ...cors, 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30', 'X-Cache': 'HIT' },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
    const response = await fetch(yahooUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': UA_BROWSER },
    });
    clearTimeout(timeout);

    const data = await response.text();

    if (response.ok) {
      symbolCache.set(symbol, { data, status: response.status, timestamp: Date.now() });
    }

    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', ...cors, 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30' },
    });
  } catch (error) {
    // Serve stale cache if available
    const cached = symbolCache.get(symbol);
    if (cached) {
      return new Response(cached.data, {
        status: cached.status,
        headers: { 'Content-Type': 'application/json', ...cors, 'Cache-Control': 'public, max-age=30', 'X-Cache': 'STALE' },
      });
    }
    return new Response(JSON.stringify({ chart: { result: null, error: { code: 'Unavailable', description: 'Service temporarily unavailable' } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors, 'Cache-Control': 'public, max-age=15' },
    });
  }
}
