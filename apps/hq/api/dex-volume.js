export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

async function fetchDexVolumes(controller) {
  try {
    // DeFiLlama DEX volumes endpoint
    const res = await fetch('https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.protocols || [])
      .map(p => {
        // DeFiLlama uses 'dailyVolume' or 'total24h' depending on API version
        const dailyVolume = p.dailyVolume ?? p.total24h ?? 0;
        return {
          name: p.name,
          displayName: p.displayName || p.name,
          logo: p.logo,
          chains: p.chains || [],
          dailyVolume,
          change1d: p.change_1d ?? p.change1d ?? 0,
          change7d: p.change_7d ?? p.change7d ?? 0,
          change1m: p.change_1m ?? p.change1m ?? 0,
          totalVolume: p.totalAllTime ?? p.total7d ?? 0,
          category: p.category || 'Dexes',
        };
      })
      .filter(p => p.dailyVolume > 0)
      .sort((a, b) => b.dailyVolume - a.dailyVolume);
  } catch (err) { console.warn('[dex-volume] DeFiLlama dex volumes failed:', err?.message ?? err); return []; }
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
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=120` },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);

    const dexes = await fetchDexVolumes(controller);
    clearTimeout(id);

    const top30 = dexes.slice(0, 30);
    const totalDailyVolume = dexes.reduce((s, d) => s + d.dailyVolume, 0);

    // Chain breakdown from protocol chain lists
    const chainVolume = {};
    for (const d of dexes) {
      for (const chain of d.chains) {
        if (!chainVolume[chain]) chainVolume[chain] = { volume: 0, dexCount: 0 };
        // Approximate: split volume evenly across chains (rough)
        chainVolume[chain].volume += d.dailyVolume / d.chains.length;
        chainVolume[chain].dexCount++;
      }
    }

    const chainRanking = Object.entries(chainVolume)
      .map(([chain, data]) => ({ chain, volume: data.volume, dexCount: data.dexCount }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 15);

    // Identify which chains the user cares about
    const targetChains = ['Solana', 'BSC', 'Base', 'Ethereum', 'Arbitrum', 'Polygon', 'Optimism', 'Avalanche'];
    const focusedChains = chainRanking.filter(c => targetChains.includes(c.chain));

    const result = {
      timestamp: new Date().toISOString(),
      dexes: top30,
      chainRanking,
      focusedChains,
      summary: {
        totalDailyVolume,
        topDex: top30[0]?.name || null,
        topDexVolume: top30[0]?.dailyVolume || 0,
        dexCount: dexes.length,
        topChain: chainRanking[0]?.chain || null,
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=120` },
    });
  } catch (err) {
    console.error('[dex-volume] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || {
      timestamp: new Date().toISOString(), dexes: [], chainRanking: [], focusedChains: [],
      summary: { totalDailyVolume: 0, topDex: null, topDexVolume: 0, dexCount: 0, topChain: null }, unavailable: true,
    };
    return new Response(JSON.stringify(fallback), { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' } });
  }
}
