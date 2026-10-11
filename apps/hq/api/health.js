export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

/**
 * Service health endpoint for Cloud Run monitoring, uptime checks, and the
 * Service Status panel. Reports process vitals, which optional integrations
 * are configured (booleans only, never values), and reachability of the
 * keyless upstream data lanes the dashboard depends on.
 */

const PROBE_TIMEOUT_MS = 3000;
const PROBE_CACHE_TTL_MS = 30_000;

const UPSTREAMS = [
  { name: 'defillama', url: 'https://api.llama.fi/v2/chains' },
  { name: 'defillama-prices', url: 'https://coins.llama.fi/prices/current/coingecko:bitcoin' },
  { name: 'coinpaprika', url: 'https://api.coinpaprika.com/v1/global' },
  { name: 'yahoo-finance', url: 'https://query1.finance.yahoo.com/v8/finance/chart/IBIT?range=1d&interval=1d' },
];

let probeCache = { timestamp: 0, results: null };

async function probeUpstream({ name, url }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    return { name, ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch {
    return { name, ok: false, status: 0, ms: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}

async function getUpstreamResults() {
  const now = Date.now();
  if (probeCache.results && now - probeCache.timestamp < PROBE_CACHE_TTL_MS) {
    return { results: probeCache.results, cached: true };
  }
  const results = await Promise.all(UPSTREAMS.map(probeUpstream));
  probeCache = { timestamp: now, results };
  return { results, cached: false };
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

  const url = new URL(req.url);
  const skipProbes = url.searchParams.get('probes') === '0';

  const proc = globalThis.process;
  const env = proc?.env ?? {};

  const body = {
    status: 'ok',
    service: env.K_SERVICE || 'hq',
    revision: env.K_REVISION || null,
    timestamp: new Date().toISOString(),
    uptimeSeconds: typeof proc?.uptime === 'function' ? Math.round(proc.uptime()) : null,
    node: proc?.version || null,
    memoryRssMb: typeof proc?.memoryUsage === 'function'
      ? Math.round(proc.memoryUsage().rss / 1024 / 1024)
      : null,
    integrations: {
      groq: Boolean(env.GROQ_API_KEY),
      finnhub: Boolean(env.FINNHUB_API_KEY),
      acled: Boolean(env.ACLED_API_KEY),
      upstashCache: Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
    },
  };

  if (!skipProbes) {
    const { results, cached } = await getUpstreamResults();
    body.upstreams = results;
    body.upstreamsCached = cached;
    if (results.every(r => !r.ok)) body.status = 'degraded';
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
