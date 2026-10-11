export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 120; // 2 min - MEV data is time-sensitive
let cachedResponse = null;
let cacheTimestamp = 0;

/* Builder colour palette (deterministic) */
const BUILDER_COLORS = {
  beaverbuild: '#f59e0b',
  'Titan Builder': '#8b5cf6',
  Titan: '#8b5cf6',
  rsync: '#10b981',
  flashbots: '#3b82f6',
  bloxroute: '#ef4444',
  'builder0x69': '#ec4899',
  buildAI: '#06b6d4',
};

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    recentBlocks: [],
    stats: {
      totalMev24h: 0,
      avgMevPerBlock: 0,
      topBuilder: 'unknown',
      builderDominance: 0,
      sandwichVolume24h: 0,
      arbitrageProfit24h: 0,
    },
    topSandwiches: [],
    builderShare: [],
    summary: {
      totalBlocks: 0,
      avgMevUSD: 0,
      sandwichRate: 0,
      topMevType: 'unknown',
    },
    unavailable: true,
  };
}

/**
 * Fetch recent MEV blocks from Flashbots Blocks API.
 * Returns up to `limit` recent blocks with builder info and MEV reward.
 */
async function fetchFlashbotsBlocks(signal) {
  const url = 'https://blocks.flashbots.net/v1/blocks?limit=100';
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': 'three.ws-HQ/1.0' },
  });
  if (!res.ok) throw new Error(`Flashbots HTTP ${res.status}`);
  const data = await res.json();
  // Flashbots returns { blocks: [...] }
  return data.blocks || data;
}

/**
 * Fetch recent MEV activity from libMEV API as secondary source.
 */
async function fetchLibMev(signal) {
  try {
    const res = await fetch('https://api.libmev.com/v1/bundles?limit=20', {
      signal,
      headers: { Accept: 'application/json', 'User-Agent': 'three.ws-HQ/1.0' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Compute aggregated stats from raw block data.
 */
function computeStats(blocks) {
  if (!blocks || blocks.length === 0) return buildFallbackResult();

  const ethPrice = 3500; // approximate; in production could fetch from coingecko

  // Map raw blocks → normalised
  const recentBlocks = blocks.slice(0, 20).map((b) => {
    const mevReward = parseFloat(b.mev_reward || b.proposer_fee_recipient_reward || '0') / 1e18;
    return {
      blockNumber: b.block_number || b.blockNumber || 0,
      mevReward: +mevReward.toFixed(6),
      mevRewardUSD: +(mevReward * ethPrice).toFixed(2),
      gasUsed: b.gas_used || b.gasUsed || 0,
      txCount: b.transactions?.length ?? b.tx_count ?? 0,
      builderName: b.builder_pubkey_label || b.extra_data || b.builderName || 'unknown',
      timestamp: b.timestamp
        ? new Date(typeof b.timestamp === 'number' ? b.timestamp * 1000 : b.timestamp).toISOString()
        : new Date().toISOString(),
      sandwichCount: b.sandwich_count ?? 0,
      arbitrageCount: b.arbitrage_count ?? 0,
      liquidationCount: b.liquidation_count ?? 0,
    };
  });

  // Builder share
  const builderMap = {};
  for (const b of blocks) {
    const name = b.builder_pubkey_label || b.extra_data || 'unknown';
    if (!builderMap[name]) builderMap[name] = 0;
    builderMap[name]++;
  }
  const totalBlockCount = blocks.length;
  const builderShare = Object.entries(builderMap)
    .map(([name, count]) => ({
      name,
      share: +((count / totalBlockCount) * 100).toFixed(1),
      blockCount: count,
    }))
    .sort((a, b) => b.blockCount - a.blockCount)
    .slice(0, 10);

  // Aggregate stats
  const totalMevETH = blocks.reduce((sum, b) => {
    return sum + parseFloat(b.mev_reward || b.proposer_fee_recipient_reward || '0') / 1e18;
  }, 0);
  const avgMevPerBlock = totalMevETH / (totalBlockCount || 1);
  const topBuilder = builderShare[0]?.name || 'unknown';
  const builderDominance = builderShare[0]?.share || 0;

  // Sandwich estimation (if not provided by the API, estimate ~15% of blocks)
  const sandwichBlocks = blocks.filter((b) => (b.sandwich_count ?? 0) > 0).length;
  const sandwichRate = totalBlockCount > 0 ? sandwichBlocks / totalBlockCount : 0.15;

  // Top sandwiches (from blocks that have sandwich data)
  const topSandwiches = blocks
    .filter((b) => b.sandwich_count > 0 || b.top_sandwich)
    .slice(0, 5)
    .map((b) => ({
      hash: b.top_sandwich?.hash || `0x${(b.block_number || 0).toString(16)}`,
      victimSwap: b.top_sandwich?.victim || { token: 'Unknown', amount: 0, dex: 'Uniswap V3' },
      profit: b.top_sandwich?.profit || 0,
      profitUSD: (b.top_sandwich?.profit || 0) * ethPrice,
      blockNumber: b.block_number || b.blockNumber || 0,
      timestamp: b.timestamp
        ? new Date(typeof b.timestamp === 'number' ? b.timestamp * 1000 : b.timestamp).toISOString()
        : new Date().toISOString(),
    }));

  return {
    timestamp: new Date().toISOString(),
    recentBlocks,
    stats: {
      totalMev24h: +(totalMevETH * ethPrice).toFixed(2),
      avgMevPerBlock: +avgMevPerBlock.toFixed(6),
      topBuilder,
      builderDominance,
      sandwichVolume24h: +(totalMevETH * ethPrice * sandwichRate).toFixed(2),
      arbitrageProfit24h: +(totalMevETH * ethPrice * 0.4).toFixed(2), // ~40% of MEV is arb
    },
    topSandwiches,
    builderShare,
    summary: {
      totalBlocks: totalBlockCount,
      avgMevUSD: +(avgMevPerBlock * ethPrice).toFixed(2),
      sandwichRate: +sandwichRate.toFixed(3),
      topMevType: sandwichRate > 0.2 ? 'sandwich' : 'arbitrage',
    },
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
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json', Allow: 'GET, OPTIONS' },
    });
  }

  const clientIp = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (!limiter.check(clientIp)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  // In-memory cache
  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=300`,
      },
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    const [flashbotsBlocks, libMevData] = await Promise.allSettled([
      fetchFlashbotsBlocks(controller.signal),
      fetchLibMev(controller.signal),
    ]);

    clearTimeout(timeout);

    const blocks =
      flashbotsBlocks.status === 'fulfilled' && Array.isArray(flashbotsBlocks.value)
        ? flashbotsBlocks.value
        : [];

    const result = computeStats(blocks);

    // Enrich with libMEV data if available
    if (libMevData.status === 'fulfilled' && libMevData.value) {
      // libMEV can provide more granular sandwich data
      const bundles = Array.isArray(libMevData.value) ? libMevData.value : libMevData.value.bundles || [];
      if (bundles.length > 0 && result.topSandwiches.length === 0) {
        result.topSandwiches = bundles.slice(0, 5).map((b) => ({
          hash: b.transaction_hash || b.hash || '0x',
          victimSwap: {
            token: b.token_symbol || 'Unknown',
            amount: b.victim_amount || 0,
            dex: b.protocol || 'Uniswap V3',
          },
          profit: b.profit_eth || 0,
          profitUSD: b.profit_usd || 0,
          blockNumber: b.block_number || 0,
          timestamp: b.timestamp || new Date().toISOString(),
        }));
      }
    }

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=300`,
      },
    });
  } catch (err) {
    console.error('[mev-monitor]', err?.message || err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60',
      },
    });
  }
}
