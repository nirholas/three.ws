export const config = { runtime: 'edge' };

import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

/**
 * Protocol health scoring (roadmap: "Protocol health scoring system").
 *
 * Derives a 0-100 composite health score for the top DeFi protocols from the
 * free DeFiLlama /protocols dataset. The score blends six signals:
 *   - TVL scale (log-weighted, up to 25 pts)
 *   - 7d TVL momentum (0-20 pts, flat = 10)
 *   - 1d TVL stability (0-10 pts, big daily swings lose points)
 *   - Chain diversification (0-15 pts, capped at 6 chains)
 *   - Maturity since DeFiLlama listing (0-15 pts, capped at 3 years)
 *   - Market-cap / TVL sanity (0-15 pts; extreme ratios lose points)
 *
 * This is a heuristic ranking signal, not financial advice, and the response
 * says so via the `methodology` field.
 */

const CACHE_KEY = 'protocol-health:v1';
const CACHE_TTL = 900; // 15 min
const UPSTREAM_TIMEOUT_MS = 15000;
const MIN_TVL = 100e6;
const MAX_PROTOCOLS = 75;
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Chain', 'Infrastructure', 'Staking Pool']);

let staleResponse = null;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function scoreProtocol(p, nowSeconds) {
  const tvl = p.tvl ?? 0;
  const change1d = Number.isFinite(p.change_1d) ? p.change_1d : 0;
  const change7d = Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const chainCount = Array.isArray(p.chains) ? p.chains.length : 1;

  // TVL scale: 100M = 0, 1B = 10, 10B = 20, capped at 25
  const tvlScore = clamp(Math.log10(tvl / MIN_TVL) * 10, 0, 25);

  // 7d momentum: -30% or worse = 0, flat = 10, +30% or better = 20
  const momentumScore = ((clamp(change7d, -30, 30) + 30) / 60) * 20;

  // 1d stability: every point of daily TVL swing costs a point
  const stabilityScore = 10 - clamp(Math.abs(change1d), 0, 10);

  // Diversification: capped at 6 chains
  const diversificationScore = (clamp(chainCount, 1, 6) / 6) * 15;

  // Maturity: years since listing, capped at 3
  const ageYears = p.listedAt ? (nowSeconds - p.listedAt) / (365.25 * 24 * 3600) : 0;
  const maturityScore = (clamp(ageYears, 0, 3) / 3) * 15;

  // Mcap/TVL sanity: a token trading far above locked value is fragile
  let mcapScore = 7; // neutral when no token or no mcap data
  if (Number.isFinite(p.mcap) && p.mcap > 0 && tvl > 0) {
    const ratio = p.mcap / tvl;
    if (ratio >= 0.05 && ratio <= 5) mcapScore = 15;
    else if (ratio > 5 && ratio <= 20) mcapScore = 8;
    else mcapScore = 3;
  }

  const score = Math.round(tvlScore + momentumScore + stabilityScore + diversificationScore + maturityScore + mcapScore);
  return clamp(score, 0, 100);
}

export function gradeFor(score) {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'E';
}

async function buildHealthReport() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.llama.fi/protocols', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const protocols = await res.json();
    if (!Array.isArray(protocols)) return null;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const scored = protocols
      .filter(p => (p.tvl ?? 0) >= MIN_TVL && p.category && !EXCLUDED_CATEGORIES.has(p.category))
      .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
      .slice(0, MAX_PROTOCOLS * 2)
      .map(p => {
        const score = scoreProtocol(p, nowSeconds);
        return {
          name: p.name,
          slug: p.slug,
          logo: p.logo || null,
          category: p.category,
          chainCount: Array.isArray(p.chains) ? p.chains.length : 1,
          topChains: Array.isArray(p.chains) ? p.chains.slice(0, 3) : [],
          tvl: Math.round(p.tvl ?? 0),
          change1d: Number.isFinite(p.change_1d) ? +p.change_1d.toFixed(2) : null,
          change7d: Number.isFinite(p.change_7d) ? +p.change_7d.toFixed(2) : null,
          mcap: Number.isFinite(p.mcap) ? Math.round(p.mcap) : null,
          score,
          grade: gradeFor(score),
          url: p.slug ? `https://defillama.com/protocol/${p.slug}` : null,
        };
      })
      .sort((a, b) => b.score - a.score || b.tvl - a.tvl)
      .slice(0, MAX_PROTOCOLS);

    const categories = [...new Set(scored.map(p => p.category))].sort();

    return {
      timestamp: new Date().toISOString(),
      count: scored.length,
      categories,
      methodology: 'Composite 0-100 heuristic from DeFiLlama data: TVL scale, 7d momentum, 1d stability, chain diversification, listing maturity, mcap/TVL ratio. Not financial advice.',
      protocols: scored,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

  const cached = await getCachedJson(CACHE_KEY);
  if (cached) {
    recordCacheTelemetry('/api/protocol-health', 'HIT');
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'HIT', 'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  }

  const report = await buildHealthReport();
  if (report) {
    staleResponse = report;
    void setCachedJson(CACHE_KEY, report, CACHE_TTL);
    recordCacheTelemetry('/api/protocol-health', 'MISS');
    return new Response(JSON.stringify(report), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'MISS', 'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  }

  if (staleResponse) {
    recordCacheTelemetry('/api/protocol-health', 'STALE');
    return new Response(JSON.stringify(staleResponse), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'STALE', 'Cache-Control': 'public, max-age=120' },
    });
  }

  recordCacheTelemetry('/api/protocol-health', 'ERROR');
  return new Response(JSON.stringify({ error: 'Failed to build protocol health report' }), {
    status: 502, headers: { 'Content-Type': 'application/json', ...cors },
  });
}
