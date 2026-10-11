export const config = { runtime: 'edge' };

import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

const CACHE_KEY = 'cg-global:v1';
const CACHE_TTL = 300; // 5 min
const DEFILLAMA_TIMEOUT_MS = 8000;

/** In-memory stale fallback (survives warm-start when Redis + upstream both fail) */
let staleResponse = null;

const COINPAPRIKA_TIMEOUT_MS = 8000;

// CoinPaprika global stats: keyless, reachable from GCP egress IPs, and
// carries the market-cap and volume figures the DeFiLlama lane cannot provide.
async function fetchGlobalFromCoinPaprika() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COINPAPRIKA_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.coinpaprika.com/v1/global', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const g = await res.json();
    if (!Number.isFinite(g?.market_cap_usd)) return null;
    return g;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Combined fallback: CoinPaprika market figures merged with DeFiLlama chain
// TVLs, so the degraded response carries real numbers instead of nulls.
async function fetchGlobalFallback() {
  const [paprika, llama] = await Promise.all([
    fetchGlobalFromCoinPaprika(),
    fetchGlobalFromDeFiLlama(),
  ]);
  if (!paprika && !llama) return null;
  const base = llama || { data: {} };
  const d = base.data;
  if (paprika) {
    d.active_cryptocurrencies = paprika.cryptocurrencies_number ?? d.active_cryptocurrencies ?? null;
    d.total_market_cap = { usd: paprika.market_cap_usd };
    d.total_volume = { usd: paprika.volume_24h_usd ?? null };
    d.market_cap_percentage = {
      btc: paprika.bitcoin_dominance_percentage ?? null,
      eth: d.market_cap_percentage?.eth ?? null,
    };
    d.market_cap_change_percentage_24h_usd = paprika.market_cap_change_24h ?? null;
    d.updated_at = paprika.last_updated ?? Math.floor(Date.now() / 1000);
  }
  return base;
}

// DeFiLlama fallback
async function fetchGlobalFromDeFiLlama() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFILLAMA_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.llama.fi/v2/chains', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const chains = await res.json();
    if (!Array.isArray(chains)) return null;
    // Sum total TVL across all chains
    let totalTvl = 0;
    const chainTvls = {};
    for (const chain of chains) {
      const tvl = chain.tvl ?? 0;
      totalTvl += tvl;
      if (chain.name) {
        chainTvls[chain.name.toLowerCase()] = tvl;
      }
    }
    // Construct a partial CoinGecko /global compatible response
    return {
      data: {
        active_cryptocurrencies: null,
        upcoming_icos: null,
        ongoing_icos: null,
        ended_icos: null,
        markets: null,
        total_market_cap: { usd: null },
        total_volume: { usd: null },
        market_cap_percentage: { btc: null, eth: null },
        market_cap_change_percentage_24h_usd: null,
        updated_at: Math.floor(Date.now() / 1000),
        defi_total_tvl: totalTvl,
        defi_chain_tvls: chainTvls,
      },
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }

  const cached = await getCachedJson(CACHE_KEY);
  if (cached) {
    recordCacheTelemetry('/api/coingecko-global', 'HIT');
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120' },
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch('https://api.coingecko.com/api/v3/global', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // DeFiLlama fallback - try DeFiLlama before stale cache
      const llamaData = await fetchGlobalFallback();
      if (llamaData) {
        staleResponse = llamaData;
        void setCachedJson(CACHE_KEY, llamaData, CACHE_TTL);
        recordCacheTelemetry('/api/coingecko-global', 'FALLBACK');
        return new Response(JSON.stringify(llamaData), {
          headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'FALLBACK', 'X-Data-Source': 'coinpaprika+defillama', 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120' },
        });
      }
      // On 429 / 5xx, serve stale in-memory data instead of forwarding the error
      if (staleResponse) {
        recordCacheTelemetry('/api/coingecko-global', 'STALE');
        return new Response(JSON.stringify(staleResponse), {
          headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'STALE', 'Cache-Control': 'public, max-age=60' },
        });
      }
      return new Response(JSON.stringify({ error: `Upstream ${res.status}` }), {
        status: res.status === 429 ? 429 : 502,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    const data = await res.json();
    staleResponse = data;
    void setCachedJson(CACHE_KEY, data, CACHE_TTL);
    recordCacheTelemetry('/api/coingecko-global', 'MISS');

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'MISS', 'X-Data-Source': 'coingecko', 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120' },
    });
  } catch (err) {
    // DeFiLlama fallback on network error
    const llamaData = await fetchGlobalFallback();
    if (llamaData) {
      staleResponse = llamaData;
      void setCachedJson(CACHE_KEY, llamaData, CACHE_TTL);
      recordCacheTelemetry('/api/coingecko-global', 'FALLBACK');
      return new Response(JSON.stringify(llamaData), {
        headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'FALLBACK', 'X-Data-Source': 'coinpaprika+defillama', 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120' },
      });
    }
    if (staleResponse) {
      recordCacheTelemetry('/api/coingecko-global', 'STALE');
      return new Response(JSON.stringify(staleResponse), {
        headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'STALE', 'Cache-Control': 'public, max-age=60' },
      });
    }
    recordCacheTelemetry('/api/coingecko-global', 'ERROR');
    return new Response(JSON.stringify({ error: 'Failed to fetch global data' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}
