export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 30; // 30 seconds - gas changes rapidly
let cachedResponse = null;
let cacheTimestamp = 0;

const CHAINS = [
  { name: 'Ethereum', rpc: 'https://eth.llamarpc.com', fallbackRpc: 'https://rpc.ankr.com/eth', unit: 'gwei', decimals: 9, highThreshold: 50, moderateThreshold: 15 },
  { name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', unit: 'gwei', decimals: 9, highThreshold: 0.5, moderateThreshold: 0.1 },
  { name: 'Base', rpc: 'https://mainnet.base.org', unit: 'gwei', decimals: 9, highThreshold: 0.5, moderateThreshold: 0.1 },
  { name: 'Optimism', rpc: 'https://mainnet.optimism.io', fallbackRpc: 'https://rpc.ankr.com/optimism', unit: 'gwei', decimals: 9, highThreshold: 0.5, moderateThreshold: 0.1 },
  { name: 'Polygon', rpc: 'https://polygon-rpc.com', unit: 'gwei', decimals: 9, highThreshold: 300, moderateThreshold: 50 },
  { name: 'BSC', rpc: 'https://bsc-dataseed.binance.org', unit: 'gwei', decimals: 9, highThreshold: 10, moderateThreshold: 3 },
  { name: 'Avalanche', rpc: 'https://api.avax.network/ext/bc/C/rpc', unit: 'nAVAX', decimals: 9, highThreshold: 50, moderateThreshold: 25 },
];

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    chains: [],
    summary: { chainCount: 0, cheapestChain: 'N/A', ethGas: null },
    unavailable: true,
  };
}

async function fetchGasPriceFromRpc(rpcUrl, controller) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    signal: controller.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.result) return null;
  return parseInt(json.result, 16);
}

function formatGasGwei(gasGwei) {
  // Dynamic precision: show enough decimals for meaningful display
  if (gasGwei >= 1) return Math.round(gasGwei * 100) / 100;
  if (gasGwei >= 0.01) return Math.round(gasGwei * 10000) / 10000;
  if (gasGwei >= 0.001) return Math.round(gasGwei * 100000) / 100000;
  return Math.round(gasGwei * 1000000) / 1000000;
}

async function fetchGasPrice(chain, controller) {
  try {
    let gasWei = await fetchGasPriceFromRpc(chain.rpc, controller);
    // Try fallback RPC if primary fails or returns 0
    if ((!gasWei || gasWei === 0) && chain.fallbackRpc) {
      gasWei = await fetchGasPriceFromRpc(chain.fallbackRpc, controller);
    }
    if (!gasWei || gasWei === 0) return null;
    const gasGwei = gasWei / 1e9;
    return {
      name: chain.name,
      gasGwei: formatGasGwei(gasGwei),
      unit: chain.unit,
      level: gasGwei > chain.highThreshold ? 'HIGH' : gasGwei > chain.moderateThreshold ? 'MODERATE' : 'LOW',
      costEstimate: {
        transfer: Math.round(gasGwei * 21000) / 1e9,     // Simple ETH transfer in ETH
        swap: Math.round(gasGwei * 150000) / 1e9,          // DEX swap
        complex: Math.round(gasGwei * 500000) / 1e9,       // Complex DeFi tx
      },
    };
  } catch (err) {
    console.warn(`[gas-tracker] ${chain.name} gas fetch failed:`, err?.message ?? err);
    return null;
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
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=15` },
    });
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);

    const results = await Promise.allSettled(
      CHAINS.map(chain => fetchGasPrice(chain, controller))
    );
    clearTimeout(id);

    const chains = results
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter(Boolean);

    const cheapest = chains.length > 0
      ? chains.reduce((a, b) => a.gasGwei < b.gasGwei ? a : b)
      : null;

    const ethChain = chains.find(c => c.name === 'Ethereum');

    const result = {
      timestamp: new Date().toISOString(),
      chains,
      summary: {
        chainCount: chains.length,
        cheapestChain: cheapest?.name || 'N/A',
        cheapestGas: cheapest?.gasGwei || null,
        ethGas: ethChain?.gasGwei || null,
        ethLevel: ethChain?.level || 'UNKNOWN',
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=15` },
    });
  } catch (err) {
    console.error('[gas-tracker] Handler error:', err?.message ?? err);
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=15' },
    });
  }
}
