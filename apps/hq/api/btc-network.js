export const config = { runtime: 'edge' };

import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';
import { UA_BOT } from './_ua.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_KEY = 'btc-network:v1';
const CACHE_TTL = 120; // 2 min: fee estimates move block to block

/** In-memory stale fallback (survives warm-start when Redis + upstream both fail) */
let staleResponse = null;

const MEMPOOL_BASE = 'https://mempool.space/api';

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json', 'User-Agent': UA_BOT } });
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
  return res.json();
}

/**
 * Bitcoin network health from mempool.space (free, no API key):
 * recommended fees, mempool backlog, difficulty adjustment, hashrate,
 * and chain tip height, merged into one snapshot.
 */
async function buildSnapshot(signal) {
  const [fees, mempool, difficulty, hashrate, tipHeight] = await Promise.all([
    fetchJson(`${MEMPOOL_BASE}/v1/fees/recommended`, signal),
    fetchJson(`${MEMPOOL_BASE}/mempool`, signal),
    fetchJson(`${MEMPOOL_BASE}/v1/difficulty-adjustment`, signal),
    fetchJson(`${MEMPOOL_BASE}/v1/mining/hashrate/3d`, signal),
    fetchJson(`${MEMPOOL_BASE}/blocks/tip/height`, signal),
  ]);

  const mempoolVMB = mempool.vsize ? mempool.vsize / 1_000_000 : 0;
  let congestion = 'LOW';
  if (mempoolVMB > 80 || fees.fastestFee >= 50) congestion = 'HIGH';
  else if (mempoolVMB > 20 || fees.fastestFee >= 15) congestion = 'MODERATE';

  return {
    timestamp: new Date().toISOString(),
    fees: {
      fastest: fees.fastestFee,
      halfHour: fees.halfHourFee,
      hour: fees.hourFee,
      economy: fees.economyFee,
      minimum: fees.minimumFee,
    },
    mempool: {
      txCount: mempool.count ?? 0,
      vsizeVMB: Number(mempoolVMB.toFixed(2)),
      totalFeesBTC: mempool.total_fee ? Number((mempool.total_fee / 1e8).toFixed(4)) : 0,
      congestion,
    },
    difficulty: {
      progressPercent: difficulty.progressPercent ?? null,
      changePercent: difficulty.difficultyChange ?? null,
      remainingBlocks: difficulty.remainingBlocks ?? null,
      estimatedRetargetDate: difficulty.estimatedRetargetDate ?? null,
    },
    hashrate: {
      currentEHs: hashrate.currentHashrate ? Number((hashrate.currentHashrate / 1e18).toFixed(2)) : null,
      currentDifficultyT: hashrate.currentDifficulty ? Number((hashrate.currentDifficulty / 1e12).toFixed(2)) : null,
    },
    tipHeight,
  };
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

  const cached = await getCachedJson(CACHE_KEY);
  if (cached) {
    recordCacheTelemetry('/api/btc-network', 'HIT');
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'HIT', 'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}, stale-while-revalidate=60` },
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const snapshot = await buildSnapshot(controller.signal);
    clearTimeout(timeout);

    staleResponse = snapshot;
    void setCachedJson(CACHE_KEY, snapshot, CACHE_TTL);
    recordCacheTelemetry('/api/btc-network', 'MISS');

    return new Response(JSON.stringify(snapshot), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'MISS', 'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}, stale-while-revalidate=60` },
    });
  } catch {
    if (staleResponse) {
      recordCacheTelemetry('/api/btc-network', 'STALE');
      return new Response(JSON.stringify(staleResponse), {
        headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'STALE', 'Cache-Control': 'public, max-age=60' },
      });
    }
    recordCacheTelemetry('/api/btc-network', 'ERROR');
    return new Response(JSON.stringify({ error: 'Failed to fetch Bitcoin network data' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}
