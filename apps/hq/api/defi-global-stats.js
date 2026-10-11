export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 300;
let cachedResponse = null;
let cacheTimestamp = 0;

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    totalTvl: 0,
    tvlChange24h: 0,
    totalProtocols: 0,
    defiDominance: 0,
    btcDominance: 0,
    ethDominance: 0,
    totalCryptoMarketCap: 0,
    dex: { totalVolume24h: 0, change24h: 0 },
    fees: { totalFees24h: 0, totalRevenue24h: 0 },
    fearGreed: { value: 0, classification: 'N/A' },
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
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
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
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const opts = { signal: controller.signal, headers: { Accept: 'application/json' } };

    // Parallel fetch all 5 upstream sources - parallel upstream fetch
    const [tvlRes, protocolsRes, dexRes, feesRes, fgRes, cgRes] = await Promise.allSettled([
      fetch('https://api.llama.fi/v2/historicalChainTvl', opts),
      fetch('https://api.llama.fi/protocols', opts),
      fetch('https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', opts),
      fetch('https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', opts),
      fetch('https://api.alternative.me/fng/?limit=1', opts),
      fetch('https://api.coingecko.com/api/v3/global', opts),
    ]);
    clearTimeout(timeout);

    // --- TVL from historical data ---
    let totalTvl = 0;
    let tvlChange24h = 0;
    if (tvlRes.status === 'fulfilled' && tvlRes.value.ok) {
      const tvlData = await tvlRes.value.json();
      if (Array.isArray(tvlData) && tvlData.length >= 2) {
        const latest = tvlData[tvlData.length - 1];
        const prev = tvlData[tvlData.length - 2];
        totalTvl = latest.tvl || 0;
        tvlChange24h = prev.tvl > 0 ? ((latest.tvl - prev.tvl) / prev.tvl) * 100 : 0;
      }
    }

    // --- Protocol count from /protocols ---
    let totalProtocols = 0;
    if (protocolsRes.status === 'fulfilled' && protocolsRes.value.ok) {
      const protocolsData = await protocolsRes.value.json();
      if (Array.isArray(protocolsData)) {
        totalProtocols = protocolsData.filter(p => p.tvl > 0).length;
      }
    }

    // --- DEX Volume ---
    let dex = { totalVolume24h: 0, change24h: 0 };
    if (dexRes.status === 'fulfilled' && dexRes.value.ok) {
      const dexData = await dexRes.value.json();
      dex = {
        totalVolume24h: dexData.total24h || 0,
        change24h: typeof dexData.change_1d === 'number' ? dexData.change_1d : 0,
      };
    }

    // --- Fees & Revenue ---
    let fees = { totalFees24h: 0, totalRevenue24h: 0 };
    if (feesRes.status === 'fulfilled' && feesRes.value.ok) {
      const feesData = await feesRes.value.json();
      fees = {
        totalFees24h: feesData.total24h || 0,
        totalRevenue24h: feesData.total24hRevenue || feesData.totalRevenue24h || 0,
      };
    }

    // --- Fear & Greed Index ---
    let fearGreed = { value: 0, classification: 'N/A' };
    if (fgRes.status === 'fulfilled' && fgRes.value.ok) {
      const fgData = await fgRes.value.json();
      const entry = fgData?.data?.[0];
      if (entry) {
        fearGreed = {
          value: parseInt(entry.value, 10) || 0,
          classification: entry.value_classification || 'N/A',
        };
      }
    }

    // --- CoinGecko global dominance ---
    let defiDominance = 0;
    let btcDominance = 0;
    let ethDominance = 0;
    let totalCryptoMarketCap = 0;
    if (cgRes.status === 'fulfilled' && cgRes.value.ok) {
      const cgData = await cgRes.value.json();
      const d = cgData?.data;
      if (d) {
        totalCryptoMarketCap = d.total_market_cap?.usd || 0;
        btcDominance = typeof d.market_cap_percentage?.btc === 'number' ? d.market_cap_percentage.btc : 0;
        ethDominance = typeof d.market_cap_percentage?.eth === 'number' ? d.market_cap_percentage.eth : 0;
        // DeFi dominance = DeFi TVL / total crypto market cap
        if (totalCryptoMarketCap > 0 && totalTvl > 0) {
          defiDominance = totalTvl / totalCryptoMarketCap;
        }
      }
    }

    const result = {
      timestamp: new Date().toISOString(),
      totalTvl,
      tvlChange24h,
      totalProtocols,
      defiDominance,
      btcDominance,
      ethDominance,
      totalCryptoMarketCap,
      dex,
      fees,
      fearGreed,
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  } catch (err) {
    console.error('[defi-global-stats]', err?.message || err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
