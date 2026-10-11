export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

const CACHE_TTL = 120;
let cachedResponse = null;
let cacheTimestamp = 0;

const DEFAULT_COINS = 'tether,usd-coin,dai,first-digital-usd,ethena-usde';

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalMarketCap: 0,
      totalVolume24h: 0,
      coinCount: 0,
      depeggedCount: 0,
      healthStatus: 'UNAVAILABLE',
    },
    stablecoins: [],
    unavailable: true,
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, { status: 403, headers: cors });
    }
    return new Response(null, { status: 204, headers: cors });
  }
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=300` },
    });
  }

  const url = new URL(req.url);
  const rawCoins = url.searchParams.get('coins') || DEFAULT_COINS;
  const coins = rawCoins.split(',').filter(c => /^[a-z0-9-]+$/.test(c)).join(',') || DEFAULT_COINS;

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);

    const apiUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coins}&order=market_cap_desc&sparkline=false&price_change_percentage=7d`;
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(id);

    if (res.status === 429) {
      if (cachedResponse) {
        return new Response(JSON.stringify(cachedResponse), {
          headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=30' },
        });
      }
      return new Response(JSON.stringify({ error: 'Rate limited', timestamp: new Date().toISOString() }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const data = await res.json();

    const stablecoins = data.map(coin => {
      const price = coin.current_price || 0;
      const deviation = Math.abs(price - 1.0);
      let pegStatus;
      if (deviation <= 0.005) pegStatus = 'ON PEG';
      else if (deviation <= 0.01) pegStatus = 'SLIGHT DEPEG';
      else pegStatus = 'DEPEGGED';

      return {
        id: coin.id,
        symbol: (coin.symbol || '').toUpperCase(),
        name: coin.name,
        price,
        deviation: +(deviation * 100).toFixed(3),
        pegStatus,
        marketCap: coin.market_cap || 0,
        volume24h: coin.total_volume || 0,
        change24h: coin.price_change_percentage_24h || 0,
        change7d: coin.price_change_percentage_7d_in_currency || 0,
        image: coin.image,
      };
    });

    const totalMarketCap = stablecoins.reduce((sum, c) => sum + c.marketCap, 0);
    const totalVolume24h = stablecoins.reduce((sum, c) => sum + c.volume24h, 0);
    const depeggedCount = stablecoins.filter(c => c.pegStatus === 'DEPEGGED').length;

    const result = {
      timestamp: new Date().toISOString(),
      summary: {
        totalMarketCap,
        totalVolume24h,
        coinCount: stablecoins.length,
        depeggedCount,
        healthStatus: depeggedCount === 0 ? 'HEALTHY' : depeggedCount === 1 ? 'CAUTION' : 'WARNING',
      },
      stablecoins,
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=300` },
    });
  } catch (err) {
    const fallback = cachedResponse || buildFallbackResult();
    cachedResponse = fallback;
    cacheTimestamp = now;
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=30' },
    });
  }
}
