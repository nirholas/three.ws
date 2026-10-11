export const config = { runtime: 'edge' };

import { getCachedJson, hashString, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

const ALLOWED_CURRENCIES = ['usd', 'eur', 'gbp', 'jpy', 'cny', 'btc', 'eth'];
const MAX_COIN_IDS = 20;
const COIN_ID_PATTERN = /^[a-z0-9-]+$/;

const CACHE_TTL_SECONDS = 120; // 2 minutes
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const RESPONSE_CACHE_CONTROL = 'public, max-age=120, s-maxage=120, stale-while-revalidate=60';
const CACHE_VERSION = 'v2';
const DEFILLAMA_TIMEOUT_MS = 8000;

// In-memory fallback cache for the current instance.
let fallbackCache = { key: '', payload: null, timestamp: 0 };

// DeFiLlama fallback
async function fetchFromDeFiLlama(ids, vsCurrencies) {
  const coinIds = ids.split(',').map(id => `coingecko:${id}`).join(',');
  const llamaUrl = `https://coins.llama.fi/prices/current/${coinIds}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFILLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(llamaUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !json.coins) return null;
    // Map DeFiLlama response to CoinGecko simple/price format
    const mapped = {};
    for (const id of ids.split(',')) {
      const key = `coingecko:${id}`;
      const coin = json.coins[key];
      if (coin) {
        mapped[id] = { [vsCurrencies]: coin.price, [`${vsCurrencies}_24h_change`]: null };
      }
    }
    return Object.keys(mapped).length > 0 ? mapped : null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

function validateCoinIds(idsParam) {
  if (!idsParam) return 'bitcoin,ethereum,solana';

  const ids = idsParam.split(',')
    .map(id => id.trim().toLowerCase())
    .filter(id => COIN_ID_PATTERN.test(id) && id.length <= 50)
    .slice(0, MAX_COIN_IDS);

  return ids.length > 0 ? ids.join(',') : 'bitcoin,ethereum,solana';
}

function validateCurrency(val) {
  const currency = (val || 'usd').toLowerCase();
  return ALLOWED_CURRENCIES.includes(currency) ? currency : 'usd';
}

function validateBoolean(val, defaultVal) {
  if (val === 'true' || val === 'false') return val;
  return defaultVal;
}

function getHeaders(cors, xCache, cacheControl = RESPONSE_CACHE_CONTROL) {
  return {
    'Content-Type': 'application/json',
    ...cors,
    'Cache-Control': cacheControl,
    'X-Cache': xCache,
  };
}

function isValidPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    typeof payload.body === 'string' &&
    Number.isFinite(payload.status)
  );
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  const url = new URL(req.url);

  const ids = validateCoinIds(url.searchParams.get('ids'));
  const vsCurrencies = validateCurrency(url.searchParams.get('vs_currencies'));
  const include24hrChange = validateBoolean(url.searchParams.get('include_24hr_change'), 'true');

  const now = Date.now();
  const cacheKey = `${ids}:${vsCurrencies}:${include24hrChange}`;
  const redisKey = `coingecko:${CACHE_VERSION}:${hashString(cacheKey)}`;

  const redisCached = await getCachedJson(redisKey);
  if (isValidPayload(redisCached)) {
    recordCacheTelemetry('/api/coingecko', 'REDIS-HIT');
    return new Response(redisCached.body, {
      status: redisCached.status,
      headers: getHeaders(cors, 'REDIS-HIT'),
    });
  }

  if (
    isValidPayload(fallbackCache.payload) &&
    fallbackCache.key === cacheKey &&
    now - fallbackCache.timestamp < CACHE_TTL_MS
  ) {
    recordCacheTelemetry('/api/coingecko', 'MEMORY-HIT');
    return new Response(fallbackCache.payload.body, {
      status: fallbackCache.payload.status,
      headers: getHeaders(cors, 'MEMORY-HIT'),
    });
  }

  const endpoint = url.searchParams.get('endpoint');

  try {
    let geckoUrl;
    if (endpoint === 'markets') {
      geckoUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vsCurrencies}&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`;
    } else {
      geckoUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vsCurrencies}&include_24hr_change=${include24hrChange}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(geckoUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });
    clearTimeout(timeout);

    // If rate limited or failed, try DeFiLlama fallback before stale cache
    if (response.status === 429 || !response.ok) {
      // DeFiLlama fallback - only for simple/price endpoint (not markets)
      if (endpoint !== 'markets') {
        const llamaData = await fetchFromDeFiLlama(ids, vsCurrencies);
        if (llamaData) {
          const body = JSON.stringify(llamaData);
          const payload = { body, status: 200 };
          fallbackCache = { key: cacheKey, payload, timestamp: Date.now() };
          void setCachedJson(redisKey, payload, CACHE_TTL_SECONDS);
          recordCacheTelemetry('/api/coingecko', 'DEFILLAMA-FALLBACK');
          return new Response(body, {
            status: 200,
            headers: { ...getHeaders(cors, 'DEFILLAMA-FALLBACK'), 'X-Data-Source': 'defillama' },
          });
        }
      }
      // DeFiLlama failed too - try stale in-memory cache
      if (isValidPayload(fallbackCache.payload) && fallbackCache.key === cacheKey) {
        recordCacheTelemetry('/api/coingecko', 'STALE');
        return new Response(fallbackCache.payload.body, {
          status: fallbackCache.payload.status,
          headers: getHeaders(cors, 'STALE'),
        });
      }
    }

    const data = await response.text();

    // Cache successful responses
    if (response.ok) {
      const payload = { body: data, status: response.status };
      fallbackCache = { key: cacheKey, payload, timestamp: Date.now() };
      void setCachedJson(redisKey, payload, CACHE_TTL_SECONDS);
      recordCacheTelemetry('/api/coingecko', 'MISS');
    } else {
      recordCacheTelemetry('/api/coingecko', 'UPSTREAM-ERROR');
    }

    return new Response(data, {
      status: response.status,
      headers: { ...getHeaders(cors, 'MISS'), 'X-Data-Source': 'coingecko' },
    });
  } catch (error) {
    // DeFiLlama fallback on network error (not markets endpoint)
    if (endpoint !== 'markets') {
      const llamaData = await fetchFromDeFiLlama(ids, vsCurrencies);
      if (llamaData) {
        const body = JSON.stringify(llamaData);
        const payload = { body, status: 200 };
        fallbackCache = { key: cacheKey, payload, timestamp: Date.now() };
        void setCachedJson(redisKey, payload, CACHE_TTL_SECONDS);
        recordCacheTelemetry('/api/coingecko', 'DEFILLAMA-FALLBACK');
        return new Response(body, {
          status: 200,
          headers: { ...getHeaders(cors, 'DEFILLAMA-FALLBACK'), 'X-Data-Source': 'defillama' },
        });
      }
    }

    // Return cached data on error if available
    if (isValidPayload(fallbackCache.payload) && fallbackCache.key === cacheKey) {
      recordCacheTelemetry('/api/coingecko', 'ERROR-FALLBACK');
      return new Response(fallbackCache.payload.body, {
        status: fallbackCache.payload.status,
        headers: getHeaders(cors, 'ERROR-FALLBACK', 'public, max-age=120'),
      });
    }

    recordCacheTelemetry('/api/coingecko', 'ERROR');
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}
