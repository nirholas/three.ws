export const config = { runtime: 'edge' };

import { getCachedJson, hashString, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

const CACHE_TTL = 120; // 2 min
const CACHE_VERSION = 'v1';
const DEFILLAMA_TIMEOUT_MS = 8000;

// Top coin IDs for DeFiLlama fallback (used when CoinGecko fails)
const TOP_COIN_IDS = [
  'bitcoin', 'ethereum', 'tether', 'binancecoin', 'solana',
  'ripple', 'usd-coin', 'staked-ether', 'cardano', 'dogecoin',
  'avalanche-2', 'chainlink', 'polkadot', 'tron', 'polygon-ecosystem-token',
  'shiba-inu', 'litecoin', 'dai', 'bitcoin-cash', 'uniswap',
  'stellar', 'cosmos', 'monero', 'ethereum-classic', 'internet-computer',
];

/** In-memory stale fallback keyed by cache params */
let staleCache = { key: '', data: null };

const COINPAPRIKA_TIMEOUT_MS = 8000;

// CoinPaprika fallback: keyless and reachable from GCP egress IPs where
// CoinGecko is blocked. Unlike the DeFiLlama price lane it carries the full
// market shape (24h change, market cap, volume, supply, rank) plus logos.
async function fetchMarketsFromCoinPaprika(perPage, page, vsCurrency) {
  // CoinPaprika's free tier is USD-quoted and unpaginated; other pages and
  // currencies fall through to the next fallback.
  if (page > 1 || vsCurrency !== 'usd') return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COINPAPRIKA_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.coinpaprika.com/v1/tickers?quotes=USD&limit=${perPage}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const tickers = await res.json();
    if (!Array.isArray(tickers) || tickers.length === 0) return null;
    const result = [];
    for (const t of tickers) {
      const usd = t?.quotes?.USD;
      if (!usd || !Number.isFinite(usd.price)) continue;
      result.push({
        id: t.id,
        symbol: (t.symbol || '').toLowerCase(),
        name: t.name || t.symbol || t.id,
        image: t.id ? `https://static.coinpaprika.com/coin/${t.id}/logo.png` : null,
        current_price: usd.price,
        market_cap: Number.isFinite(usd.market_cap) ? usd.market_cap : null,
        market_cap_rank: t.rank || null,
        fully_diluted_valuation: null,
        total_volume: Number.isFinite(usd.volume_24h) ? usd.volume_24h : null,
        high_24h: null,
        low_24h: null,
        price_change_24h: Number.isFinite(usd.percent_change_24h) ? usd.price * (usd.percent_change_24h / 100) : null,
        price_change_percentage_24h: Number.isFinite(usd.percent_change_24h) ? usd.percent_change_24h : null,
        market_cap_change_24h: null,
        market_cap_change_percentage_24h: Number.isFinite(usd.market_cap_change_24h) ? usd.market_cap_change_24h : null,
        circulating_supply: Number.isFinite(t.circulating_supply) ? t.circulating_supply : null,
        total_supply: Number.isFinite(t.total_supply) ? t.total_supply : null,
        max_supply: Number.isFinite(t.max_supply) ? t.max_supply : null,
        ath: Number.isFinite(usd.ath_price) ? usd.ath_price : null,
        ath_change_percentage: Number.isFinite(usd.percent_from_price_ath) ? usd.percent_from_price_ath : null,
        ath_date: usd.ath_date || null,
        atl: null,
        atl_change_percentage: null,
        atl_date: null,
        last_updated: t.last_updated || new Date().toISOString(),
        sparkline_in_7d: null,
        price_change_percentage_24h_in_currency: Number.isFinite(usd.percent_change_24h) ? usd.percent_change_24h : null,
      });
      if (result.length >= perPage) break;
    }
    return result.length > 0 ? result : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Fallback chain when CoinGecko is unreachable or rate-limited:
// CoinPaprika first (full market shape), then DeFiLlama (prices only).
async function fetchFallbackMarkets(perPage, page, vsCurrency) {
  const paprika = await fetchMarketsFromCoinPaprika(perPage, page, vsCurrency);
  if (paprika) return { data: paprika, source: 'coinpaprika' };
  const llama = await fetchMarketsFromDeFiLlama(perPage, page);
  if (llama) return { data: llama, source: 'defillama' };
  return null;
}

// DeFiLlama fallback
async function fetchMarketsFromDeFiLlama(perPage, page) {
  // Only handle page 1 for fallback; subsequent pages return null
  if (page > 1) return null;
  const ids = TOP_COIN_IDS.slice(0, perPage);
  const coinIds = ids.map(id => `coingecko:${id}`).join(',');
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
    // Map DeFiLlama response to CoinGecko /coins/markets format
    const result = [];
    let rank = 1;
    for (const id of ids) {
      const key = `coingecko:${id}`;
      const coin = json.coins[key];
      if (coin) {
        result.push({
          id,
          symbol: (coin.symbol || id).toLowerCase(),
          name: coin.symbol || id,
          image: null,
          current_price: coin.price ?? 0,
          market_cap: null,
          market_cap_rank: rank,
          fully_diluted_valuation: null,
          total_volume: null,
          high_24h: null,
          low_24h: null,
          price_change_24h: null,
          price_change_percentage_24h: null,
          market_cap_change_24h: null,
          market_cap_change_percentage_24h: null,
          circulating_supply: null,
          total_supply: null,
          max_supply: null,
          ath: null,
          ath_change_percentage: null,
          ath_date: null,
          atl: null,
          atl_change_percentage: null,
          atl_date: null,
          last_updated: new Date(coin.timestamp * 1000).toISOString(),
          sparkline_in_7d: null,
          price_change_percentage_24h_in_currency: null,
        });
        rank++;
      }
    }
    return result.length > 0 ? result : null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  const url = new URL(req.url);
  const perPage = Math.min(Math.max(parseInt(url.searchParams.get('per_page') || '100', 10), 1), 250);
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1);
  const vsCurrency = (url.searchParams.get('vs_currency') || 'usd').toLowerCase();

  const cacheKey = `cg-markets:${CACHE_VERSION}:${vsCurrency}:${perPage}:${page}`;
  const redisKey = `coingecko-markets:${CACHE_VERSION}:${hashString(cacheKey)}`;

  const cached = await getCachedJson(redisKey);
  if (cached) {
    recordCacheTelemetry('/api/coingecko-markets', 'HIT');
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60' },
    });
  }

  try {
    const geckoUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vsCurrency}&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=false&price_change_percentage=24h`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(geckoUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // Fallback chain (CoinPaprika, then DeFiLlama) before stale cache
      const fallback = await fetchFallbackMarkets(perPage, page, vsCurrency);
      if (fallback) {
        staleCache = { key: cacheKey, data: fallback.data };
        void setCachedJson(redisKey, fallback.data, CACHE_TTL);
        recordCacheTelemetry('/api/coingecko-markets', `${fallback.source.toUpperCase()}-FALLBACK`);
        return new Response(JSON.stringify(fallback.data), {
          headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': `${fallback.source.toUpperCase()}-FALLBACK`, 'X-Data-Source': fallback.source, 'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60' },
        });
      }
      // On rate-limit / error, return stale in-memory data if available
      if (staleCache.data && staleCache.key === cacheKey) {
        recordCacheTelemetry('/api/coingecko-markets', 'STALE');
        return new Response(JSON.stringify(staleCache.data), {
          headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'STALE', 'Cache-Control': 'public, max-age=60' },
        });
      }
      return new Response(JSON.stringify({ error: `Upstream ${res.status}` }), {
        status: res.status === 429 ? 429 : 502,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    const data = await res.json();
    staleCache = { key: cacheKey, data };
    void setCachedJson(redisKey, data, CACHE_TTL);
    recordCacheTelemetry('/api/coingecko-markets', 'MISS');

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'MISS', 'X-Data-Source': 'coingecko', 'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60' },
    });
  } catch (err) {
    // Fallback chain on network error
    const fallback = await fetchFallbackMarkets(perPage, page, vsCurrency);
    if (fallback) {
      staleCache = { key: cacheKey, data: fallback.data };
      void setCachedJson(redisKey, fallback.data, CACHE_TTL);
      recordCacheTelemetry('/api/coingecko-markets', `${fallback.source.toUpperCase()}-FALLBACK`);
      return new Response(JSON.stringify(fallback.data), {
        headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': `${fallback.source.toUpperCase()}-FALLBACK`, 'X-Data-Source': fallback.source, 'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60' },
      });
    }
    // On network error / timeout, return stale in-memory data if available
    if (staleCache.data && staleCache.key === cacheKey) {
      recordCacheTelemetry('/api/coingecko-markets', 'STALE');
      return new Response(JSON.stringify(staleCache.data), {
        headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'STALE', 'Cache-Control': 'public, max-age=60' },
      });
    }
    recordCacheTelemetry('/api/coingecko-markets', 'ERROR');
    return new Response(JSON.stringify({ error: 'Failed to fetch market data' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}
