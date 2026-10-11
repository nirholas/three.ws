export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

// Target assets and their display names
const TARGET_SYMBOLS = {
  USDC: 'USD Coin',
  USDT: 'Tether',
  DAI: 'Dai',
  WETH: 'Wrapped Ether',
  WBTC: 'Wrapped Bitcoin',
  WSTETH: 'Wrapped stETH',
  CBETH: 'Coinbase Wrapped ETH',
  LINK: 'Chainlink',
  UNI: 'Uniswap',
  AAVE: 'Aave',
};

// Normalize symbol from pool data to our target list
function normalizeSymbol(sym) {
  if (!sym) return null;
  const upper = sym.toUpperCase().trim();
  // Handle multi-token pool symbols like "USDC-WETH" - only match single-asset pools
  if (upper.includes('-') || upper.includes('/')) return null;
  // Direct match
  if (TARGET_SYMBOLS[upper]) return upper;
  // Aliases
  if (upper === 'ETH' || upper === 'STETH') return null; // We want WETH/WSTETH explicitly
  return null;
}

// Target protocols and their DeFiLlama project slugs
const TARGET_PROTOCOLS = {
  'aave-v3': 'Aave V3',
  'aave-v2': 'Aave V2',
  'compound-v3': 'Compound V3',
  'compound-v2': 'Compound V2',
  'morpho-aave': 'Morpho',
  'morpho-aavev3': 'Morpho',
  'morpho-compound': 'Morpho',
  'morpho-blue': 'Morpho Blue',
  'spark': 'Spark',
  'spark-lending': 'Spark',
  'radiant-v2': 'Radiant V2',
  'benqi-lending': 'Benqi',
  'venus-core-pool': 'Venus',
  'venus': 'Venus',
  'justlend': 'JustLend',
  'silo-v2': 'Silo V2',
  'fluid': 'Fluid',
};

function getProtocolName(project) {
  const lower = (project || '').toLowerCase().replace(/\s+/g, '-');
  return TARGET_PROTOCOLS[lower] || null;
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    assets: [],
    protocols: [],
    summary: {
      avgSupplyAPY: 0,
      avgBorrowAPY: 0,
      bestOverallSupply: null,
      lowestBorrow: null,
      assetCount: 0,
    },
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
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
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
        ...cors, 'Content-Type': 'application/json',
        'X-Cache': 'HIT',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000);

    const res = await fetch('https://yields.llama.fi/pools', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(id);

    if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);

    const json = await res.json();
    const allPools = json.data || [];

    // Filter to lending pools from target protocols with target assets and meaningful TVL
    const lendingPools = allPools.filter(p => {
      if (!p || p.tvlUsd < 100_000) return false;
      const cat = (p.category || '').toLowerCase();
      if (cat !== 'lending' && cat !== 'cdp') return false;
      const protoName = getProtocolName(p.project);
      if (!protoName) return false;
      const sym = normalizeSymbol(p.symbol);
      if (!sym) return false;
      return true;
    });

    // Group by asset symbol
    const assetMap = {};
    for (const p of lendingPools) {
      const sym = normalizeSymbol(p.symbol);
      if (!sym) continue;
      if (!assetMap[sym]) {
        assetMap[sym] = {
          symbol: sym,
          name: TARGET_SYMBOLS[sym],
          rates: [],
        };
      }

      const protoName = getProtocolName(p.project);
      const supplyAPY = typeof p.apyBase === 'number' ? p.apyBase : (p.apy || 0);
      const rewardAPY = typeof p.apyReward === 'number' ? p.apyReward : 0;
      const borrowAPY = typeof p.apyBorrow === 'number' ? Math.abs(p.apyBorrow) : 0;
      const borrowRewardAPY = typeof p.apyRewardBorrow === 'number' ? p.apyRewardBorrow : 0;

      // Net rates: supply gets rewards added, borrow gets rewards subtracted
      const netSupplyAPY = supplyAPY + rewardAPY;
      const netBorrowAPY = borrowAPY > 0 ? borrowAPY - borrowRewardAPY : 0;

      // Calculate utilization from total supply / borrow if available
      const totalSupply = p.totalSupplyUsd || p.tvlUsd || 0;
      const totalBorrow = p.totalBorrowUsd || 0;
      const utilization = totalSupply > 0 ? totalBorrow / totalSupply : 0;

      assetMap[sym].rates.push({
        protocol: protoName,
        chain: p.chain || 'Unknown',
        supplyAPY: Math.round(supplyAPY * 100) / 100,
        borrowAPY: Math.round(borrowAPY * 100) / 100,
        rewardAPY: Math.round(rewardAPY * 100) / 100,
        netSupplyAPY: Math.round(netSupplyAPY * 100) / 100,
        netBorrowAPY: Math.round(Math.max(0, netBorrowAPY) * 100) / 100,
        tvl: p.tvlUsd,
        utilization: Math.round(Math.min(1, utilization) * 100) / 100,
        poolId: p.pool || '',
      });
    }

    // Build assets array, sort rates by TVL, compute best rates
    const assets = Object.values(assetMap)
      .filter(a => a.rates.length > 0)
      .map(a => {
        // Sort by TVL descending, keep top entries per protocol-chain combo
        const seen = new Set();
        a.rates.sort((x, y) => y.tvl - x.tvl);
        a.rates = a.rates.filter(r => {
          const key = `${r.protocol}__${r.chain}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Determine best supply (highest net supply APY)
        let bestSupply = { protocol: '', apy: -1, chain: '' };
        let bestBorrow = { protocol: '', apy: Infinity, chain: '' };

        for (const r of a.rates) {
          if (r.netSupplyAPY > bestSupply.apy) {
            bestSupply = { protocol: r.protocol, apy: r.netSupplyAPY, chain: r.chain };
          }
          if (r.borrowAPY > 0 && r.netBorrowAPY < bestBorrow.apy) {
            bestBorrow = { protocol: r.protocol, apy: r.netBorrowAPY, chain: r.chain };
          }
        }

        if (bestBorrow.apy === Infinity) {
          bestBorrow = { protocol: '', apy: 0, chain: '' };
        }

        const spread = bestSupply.apy > 0 && bestBorrow.apy > 0
          ? Math.round((bestBorrow.apy - bestSupply.apy) * 100) / 100
          : 0;

        return { ...a, bestSupply, bestBorrow, spread };
      })
      .sort((a, b) => b.rates.reduce((s, r) => s + r.tvl, 0) - a.rates.reduce((s, r) => s + r.tvl, 0));

    // Collect unique protocol names
    const protocolSet = new Set();
    for (const a of assets) {
      for (const r of a.rates) protocolSet.add(r.protocol);
    }

    // Build summary
    let allSupply = [];
    let allBorrow = [];
    let overallBestSupply = null;
    let overallLowestBorrow = null;

    for (const a of assets) {
      for (const r of a.rates) {
        if (r.netSupplyAPY > 0) allSupply.push(r.netSupplyAPY);
        if (r.netBorrowAPY > 0) allBorrow.push(r.netBorrowAPY);

        if (!overallBestSupply || r.netSupplyAPY > overallBestSupply.apy) {
          overallBestSupply = { asset: a.symbol, protocol: r.protocol, apy: r.netSupplyAPY };
        }
        if (r.borrowAPY > 0 && (!overallLowestBorrow || r.netBorrowAPY < overallLowestBorrow.apy)) {
          overallLowestBorrow = { asset: a.symbol, protocol: r.protocol, apy: r.netBorrowAPY };
        }
      }
    }

    const avgSupplyAPY = allSupply.length > 0
      ? Math.round((allSupply.reduce((s, v) => s + v, 0) / allSupply.length) * 100) / 100
      : 0;
    const avgBorrowAPY = allBorrow.length > 0
      ? Math.round((allBorrow.reduce((s, v) => s + v, 0) / allBorrow.length) * 100) / 100
      : 0;

    const result = {
      timestamp: new Date().toISOString(),
      assets,
      protocols: [...protocolSet].sort(),
      summary: {
        avgSupplyAPY,
        avgBorrowAPY,
        bestOverallSupply: overallBestSupply,
        lowestBorrow: overallLowestBorrow,
        assetCount: assets.length,
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: {
        ...cors, 'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  } catch (err) {
    console.error('[lending-rates] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}
