export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 180; // 3 minutes - longer TTL to reduce CoinGecko rate-limit pressure
let cachedResponse = null;
let cacheTimestamp = 0;

// CoinGecko platform → display chain ID mapping
const CHAIN_MAP = {
  ethereum: 'ethereum', solana: 'solana', 'binance-smart-chain': 'bsc',
  base: 'base', 'polygon-pos': 'polygon', 'arbitrum-one': 'arbitrum',
  avalanche: 'avalanche', 'optimistic-ethereum': 'optimism',
};
const DISPLAY_CHAINS = ['ethereum', 'solana', 'bsc', 'base', 'polygon', 'arbitrum', 'avalanche', 'optimism'];

/**
 * CoinGecko /search/trending - free, no API key, returns trending coins
 * with price, market cap, volume, and 24h change.
 */
async function fetchCoinGeckoTrending(controller) {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const coins = data.coins || [];
    return coins.map(entry => {
      const c = entry.item;
      const priceData = c.data || {};
      const priceChange24h = priceData.price_change_percentage_24h?.usd ?? 0;
      const platforms = Object.keys(c.platforms || {});
      let chainId = 'ethereum';
      for (const p of platforms) {
        if (CHAIN_MAP[p]) { chainId = CHAIN_MAP[p]; break; }
      }
      return {
        chainId,
        dexId: 'coingecko',
        pairAddress: c.id || '',
        baseToken: { address: c.id || '', name: c.name || '', symbol: (c.symbol || '').toUpperCase() },
        quoteToken: { symbol: 'USD' },
        priceUsd: priceData.price?.toString() || '0',
        priceChange: { m5: 0, h1: 0, h6: 0, h24: priceChange24h },
        volume: { h24: priceData.total_volume?.usd ?? priceData.total_volume ?? 0 },
        liquidity: { usd: priceData.market_cap?.usd ?? priceData.market_cap ?? 0 },
        txns: { h24: { buys: 0, sells: 0 } },
        fdv: priceData.market_cap?.usd ?? 0,
        pairCreatedAt: null,
        url: `https://www.coingecko.com/en/coins/${c.id}`,
        thumb: c.thumb || c.small || '',
        score: c.score ?? entry.score ?? 999,
        source: 'coingecko',
      };
    });
  } catch (err) {
    console.warn('[dex-trending] CoinGecko trending failed:', err?.message ?? err);
    return [];
  }
}

/**
 * CoinGecko /coins/markets - top movers by volume
 */
async function fetchCoinGeckoTopMovers(controller) {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=50&page=1&sparkline=false&price_change_percentage=1h%2C24h',
      { signal: controller.signal, headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return [];
    const coins = await res.json();
    return coins.map(c => {
      const chainId = CHAIN_MAP[c.asset_platform_id] || 'ethereum';
      const h1 = c.price_change_percentage_1h_in_currency ?? 0;
      const h24 = c.price_change_percentage_24h ?? 0;
      return {
        chainId,
        dexId: 'coingecko',
        pairAddress: c.id || '',
        baseToken: { address: c.id || '', name: c.name || '', symbol: (c.symbol || '').toUpperCase() },
        quoteToken: { symbol: 'USD' },
        priceUsd: c.current_price?.toString() || '0',
        priceChange: { m5: 0, h1, h6: 0, h24 },
        volume: { h24: c.total_volume || 0 },
        liquidity: { usd: c.market_cap || 0 },
        txns: { h24: { buys: 0, sells: 0 } },
        fdv: c.fully_diluted_valuation || c.market_cap || 0,
        pairCreatedAt: null,
        url: `https://www.coingecko.com/en/coins/${c.id}`,
        thumb: c.image || '',
        score: 999,
        source: 'coingecko',
      };
    });
  } catch (err) {
    console.warn('[dex-trending] CoinGecko top movers failed:', err?.message ?? err);
    return [];
  }
}

/**
 * DexScreener token boosts - supplementary on-chain trending tokens
 */
async function fetchDexScreenerBoosts(controller) {
  try {
    const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(t => DISPLAY_CHAINS.includes(t.chainId))
      .slice(0, 30)
      .map(t => ({ chainId: t.chainId, tokenAddress: t.tokenAddress, isBoosted: true }));
  } catch (err) {
    console.warn('[dex-trending] DexScreener boosts failed:', err?.message ?? err);
    return [];
  }
}

function classifyToken(pair) {
  const h1 = pair.priceChange?.h1 || 0;
  const h24 = pair.priceChange?.h24 || 0;
  if (h1 > 50 || h24 > 200) return 'PARABOLIC';
  if (h1 > 20 || h24 > 100) return 'HOT';
  if (h1 > 5 || h24 > 30) return 'RISING';
  if (h1 < -20 || h24 < -50) return 'DUMPING';
  return 'STABLE';
}

function isNewToken(pair) {
  if (!pair.pairCreatedAt) return false;
  const age = Date.now() - pair.pairCreatedAt;
  return age < 24 * 60 * 60 * 1000;
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

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);

    // Primary: CoinGecko trending + top movers. Supplementary: DexScreener boosts.
    // Stagger CoinGecko calls slightly to avoid concurrent rate-limit trips
    const [trending, boosts] = await Promise.all([
      fetchCoinGeckoTrending(controller),
      fetchDexScreenerBoosts(controller),
    ]);
    // Fetch top movers after trending to avoid hitting CoinGecko concurrently
    const topMovers = await fetchCoinGeckoTopMovers(controller);
    clearTimeout(id);

    // Merge: trending first, then top movers, deduplicate by symbol
    const seen = new Set();
    const allTokens = [];

    for (const t of trending) {
      const key = t.baseToken.symbol;
      if (!seen.has(key)) { seen.add(key); t.isTrending = true; allTokens.push(t); }
    }
    for (const t of topMovers) {
      const key = t.baseToken.symbol;
      if (!seen.has(key)) { seen.add(key); t.isTrending = false; allTokens.push(t); }
    }

    // Classify signals
    for (const t of allTokens) {
      t.signal = classifyToken(t);
      t.isNew = isNewToken(t);
    }

    // Sort: trending first, then by signal severity, then by volume
    const signalOrder = { PARABOLIC: 0, HOT: 1, DUMPING: 2, RISING: 3, STABLE: 4 };
    allTokens.sort((a, b) => {
      if (a.isTrending && !b.isTrending) return -1;
      if (!a.isTrending && b.isTrending) return 1;
      const so = (signalOrder[a.signal] ?? 5) - (signalOrder[b.signal] ?? 5);
      if (so !== 0) return so;
      return (b.volume?.h24 || 0) - (a.volume?.h24 || 0);
    });

    // Tag DexScreener boosted tokens
    const boostAddrs = new Set(boosts.map(b => `${b.chainId}-${b.tokenAddress}`));
    for (const t of allTokens) {
      if (!t.isTrending && boostAddrs.has(`${t.chainId}-${t.baseToken.address}`)) {
        t.isTrending = true;
      }
    }

    // Chain stats
    const chainStats = {};
    for (const chain of DISPLAY_CHAINS) {
      const cp = allTokens.filter(p => p.chainId === chain);
      chainStats[chain] = {
        count: cp.length,
        newCount: cp.filter(p => p.isNew).length,
        hotCount: cp.filter(p => p.signal === 'HOT' || p.signal === 'PARABOLIC').length,
        totalVolume: cp.reduce((s, p) => s + (p.volume?.h24 || 0), 0),
      };
    }

    const tokens = allTokens.slice(0, 50);
    const result = {
      timestamp: new Date().toISOString(),
      tokens,
      chainStats,
      summary: {
        totalTokens: tokens.length,
        parabolicCount: tokens.filter(p => p.signal === 'PARABOLIC').length,
        hotCount: tokens.filter(p => p.signal === 'HOT').length,
        newCount: tokens.filter(p => p.isNew).length,
        dumpingCount: tokens.filter(p => p.signal === 'DUMPING').length,
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=30` },
    });
  } catch (err) {
    console.error('[dex-trending] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || {
      timestamp: new Date().toISOString(), tokens: [], chainStats: {}, summary: { totalTokens: 0, parabolicCount: 0, hotCount: 0, newCount: 0, dumpingCount: 0 }, unavailable: true,
    };
    return new Response(JSON.stringify(fallback), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=30' },
    });
  }
}
