export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

/**
 * Fetch all bridges from DeFiLlama
 */
async function fetchBridges(controller) {
  const res = await fetch('https://bridges.llama.fi/bridges?includeChains=true', {
    signal: controller.signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`DeFiLlama bridges HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch recent bridge volume for a specific bridge
 */
async function fetchBridgeVolume(bridgeId, controller) {
  try {
    const res = await fetch(`https://bridges.llama.fi/bridge/${bridgeId}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Extract volume from chain data objects.
 * DeFiLlama returns currentDayVolume / lastDayVolume / dayBeforeLastVolume per chain.
 */
function sumVolumes(chainVolumes) {
  if (!chainVolumes || typeof chainVolumes !== 'object') return 0;
  let total = 0;
  for (const chain of Object.keys(chainVolumes)) {
    const v = chainVolumes[chain];
    if (typeof v === 'number') total += v;
    else if (v && typeof v === 'object') {
      // Some bridges have { deposits, withdrawals } per chain
      total += (parseFloat(v.deposits) || 0) + (parseFloat(v.withdrawals) || 0);
    }
  }
  return total;
}

function sumDeposits(chainVolumes) {
  if (!chainVolumes || typeof chainVolumes !== 'object') return 0;
  let total = 0;
  for (const chain of Object.keys(chainVolumes)) {
    const v = chainVolumes[chain];
    if (v && typeof v === 'object') {
      total += Math.abs(parseFloat(v.depositUSD) || parseFloat(v.deposits) || 0);
    } else if (typeof v === 'number') {
      total += Math.abs(v) / 2; // rough split
    }
  }
  return total;
}

function sumWithdrawals(chainVolumes) {
  if (!chainVolumes || typeof chainVolumes !== 'object') return 0;
  let total = 0;
  for (const chain of Object.keys(chainVolumes)) {
    const v = chainVolumes[chain];
    if (v && typeof v === 'object') {
      total += Math.abs(parseFloat(v.withdrawUSD) || parseFloat(v.withdrawals) || 0);
    } else if (typeof v === 'number') {
      total += Math.abs(v) / 2;
    }
  }
  return total;
}

/**
 * Process raw DeFiLlama bridge data into our normalized format
 */
function processBridges(raw) {
  if (!raw || !raw.bridges || !Array.isArray(raw.bridges)) {
    return { bridges: [], chainSummary: [], alerts: [], summary: buildEmptySummary() };
  }

  const bridges = [];
  const chainMap = {}; // chain -> { deposits, withdrawals, bridges }

  for (const b of raw.bridges) {
    const currentDay = b.currentDayVolume || {};
    const lastDay = b.lastDayVolume || {};
    const weeklyVol = b.weeklyVolume || {};

    // Calculate deposits and withdrawals from chain-level data
    let deposits = 0;
    let withdrawals = 0;
    let vol24h = 0;

    // DeFiLlama provides per-chain breakdown
    if (currentDay && typeof currentDay === 'object') {
      for (const chain of Object.keys(currentDay)) {
        const cv = currentDay[chain];
        if (cv && typeof cv === 'object') {
          const dep = Math.abs(parseFloat(cv.depositUSD) || 0);
          const wth = Math.abs(parseFloat(cv.withdrawUSD) || 0);
          deposits += dep;
          withdrawals += wth;

          // Accumulate chain summary
          if (!chainMap[chain]) chainMap[chain] = { deposits: 0, withdrawals: 0, bridgeCount: 0 };
          chainMap[chain].deposits += dep;
          chainMap[chain].withdrawals += wth;
          chainMap[chain].bridgeCount++;
        }
      }
      vol24h = deposits + withdrawals;
    }

    // Fallback: use lastDayVolume if currentDay is empty
    if (vol24h === 0 && lastDay && typeof lastDay === 'object') {
      for (const chain of Object.keys(lastDay)) {
        const cv = lastDay[chain];
        if (cv && typeof cv === 'object') {
          const dep = Math.abs(parseFloat(cv.depositUSD) || 0);
          const wth = Math.abs(parseFloat(cv.withdrawUSD) || 0);
          deposits += dep;
          withdrawals += wth;

          if (!chainMap[chain]) chainMap[chain] = { deposits: 0, withdrawals: 0, bridgeCount: 0 };
          chainMap[chain].deposits += dep;
          chainMap[chain].withdrawals += wth;
          chainMap[chain].bridgeCount++;
        }
      }
      vol24h = deposits + withdrawals;
    }

    // Calculate weekly volume
    let vol7d = 0;
    if (weeklyVol && typeof weeklyVol === 'object') {
      for (const chain of Object.keys(weeklyVol)) {
        const cv = weeklyVol[chain];
        if (cv && typeof cv === 'object') {
          vol7d += Math.abs(parseFloat(cv.depositUSD) || 0) + Math.abs(parseFloat(cv.withdrawUSD) || 0);
        }
      }
    }

    const netFlow = deposits - withdrawals;
    const dailyAvg7d = vol7d > 0 ? vol7d / 7 : 0;
    const volumeChange = dailyAvg7d > 0 ? ((vol24h - dailyAvg7d) / dailyAvg7d) * 100 : 0;

    // Determine bridge status
    let status = 'healthy';
    if (vol24h === 0 && vol7d > 0) status = 'down';
    else if (vol24h > 0 && vol24h < dailyAvg7d * 0.2) status = 'degraded';

    const chains = Array.isArray(b.chains) ? b.chains : (b.destinationChain ? [b.destinationChain] : []);

    bridges.push({
      id: b.id || 0,
      name: b.displayName || b.name || `Bridge #${b.id}`,
      displayName: b.displayName || b.name || `Bridge #${b.id}`,
      icon: b.icon || `chain:${(b.displayName || b.name || '').toLowerCase().replace(/\s+/g, '-')}`,
      chains,
      volume24h: Math.round(vol24h),
      volume7d: Math.round(vol7d),
      volumeChange24h: Math.round(volumeChange * 10) / 10,
      currentDayDeposits: Math.round(deposits),
      currentDayWithdrawals: Math.round(withdrawals),
      netFlow: Math.round(netFlow),
      netFlowDirection: netFlow > 1_000_000 ? 'inflow' : netFlow < -1_000_000 ? 'outflow' : 'balanced',
      txCount24h: b.txCount24h || 0,
      status,
    });
  }

  // Sort by 24h volume descending
  bridges.sort((a, b) => b.volume24h - a.volume24h);

  // Build chain summary
  const chainSummary = Object.entries(chainMap)
    .map(([chain, data]) => ({
      chain,
      totalDeposits24h: Math.round(data.deposits),
      totalWithdrawals24h: Math.round(data.withdrawals),
      netFlow: Math.round(data.deposits - data.withdrawals),
      activeBridges: data.bridgeCount,
    }))
    .sort((a, b) => Math.abs(b.netFlow) - Math.abs(a.netFlow))
    .slice(0, 20); // Top 20 chains

  // Generate alerts
  const alerts = generateAlerts(bridges, chainSummary);

  // Build summary
  const totalVolume24h = bridges.reduce((s, b) => s + b.volume24h, 0);
  const totalVolume7d = bridges.reduce((s, b) => s + b.volume7d, 0);
  const activeBridges = bridges.filter(b => b.status !== 'down').length;
  const largestBridge = bridges[0]?.name || 'N/A';

  const inflowChains = chainSummary.filter(c => c.netFlow > 0).sort((a, b) => b.netFlow - a.netFlow);
  const outflowChains = chainSummary.filter(c => c.netFlow < 0).sort((a, b) => a.netFlow - b.netFlow);

  const summary = {
    totalVolume24h,
    totalVolume7d,
    activeBridges,
    largestBridge,
    biggestNetInflow: inflowChains[0]
      ? { chain: inflowChains[0].chain, amount: inflowChains[0].netFlow }
      : { chain: 'N/A', amount: 0 },
    biggestNetOutflow: outflowChains[0]
      ? { chain: outflowChains[0].chain, amount: outflowChains[0].netFlow }
      : { chain: 'N/A', amount: 0 },
  };

  return {
    timestamp: new Date().toISOString(),
    bridges: bridges.slice(0, 50), // top 50 bridges
    chainSummary,
    alerts,
    summary,
  };
}

/**
 * Generate alerts from bridge data
 */
function generateAlerts(bridges, chainSummary) {
  const alerts = [];
  const now = new Date().toISOString();

  for (const b of bridges) {
    // High volume alert: 24h volume > 30% above 7d daily average
    if (b.volumeChange24h > 30) {
      alerts.push({
        type: 'high-volume',
        bridge: b.name,
        message: `24h volume ${Math.round(b.volumeChange24h)}% above 7d average`,
        severity: b.volumeChange24h > 100 ? 'warning' : 'info',
        timestamp: now,
      });
    }

    // Imbalance alert: deposits/withdrawals ratio > 2:1 or < 1:2
    if (b.currentDayDeposits > 0 && b.currentDayWithdrawals > 0) {
      const ratio = b.currentDayDeposits / b.currentDayWithdrawals;
      if (ratio > 2 || ratio < 0.5) {
        const direction = ratio > 2 ? 'deposits' : 'withdrawals';
        const ratioStr = ratio > 2 ? `${ratio.toFixed(1)}:1` : `1:${(1 / ratio).toFixed(1)}`;
        alerts.push({
          type: 'imbalance',
          bridge: b.name,
          message: `Heavy ${direction} imbalance (${ratioStr} ratio)`,
          severity: (ratio > 3 || ratio < 0.33) ? 'warning' : 'info',
          timestamp: now,
        });
      }
    }
  }

  // Chain-level net outflow alerts (> $50M/day)
  for (const c of chainSummary) {
    if (c.netFlow < -50_000_000) {
      alerts.push({
        type: 'net-outflow',
        bridge: c.chain,
        message: `$${Math.abs(Math.round(c.netFlow / 1_000_000))}M net outflow from ${c.chain}`,
        severity: c.netFlow < -200_000_000 ? 'critical' : c.netFlow < -100_000_000 ? 'warning' : 'info',
        timestamp: now,
      });
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts.slice(0, 20); // cap at 20
}

function buildEmptySummary() {
  return {
    totalVolume24h: 0,
    totalVolume7d: 0,
    activeBridges: 0,
    largestBridge: 'N/A',
    biggestNetInflow: { chain: 'N/A', amount: 0 },
    biggestNetOutflow: { chain: 'N/A', amount: 0 },
  };
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    bridges: [],
    chainSummary: [],
    alerts: [],
    summary: buildEmptySummary(),
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

  // Serve from in-memory cache
  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=60`,
      },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000);

    const raw = await fetchBridges(controller);
    clearTimeout(id);

    const result = processBridges(raw);

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=60`,
      },
    });
  } catch (err) {
    console.error('[bridge-monitor] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=30' },
    });
  }
}
