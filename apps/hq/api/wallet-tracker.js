export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

/**
 * Wallet Tracker API - aggregates on-chain wallet activity
 * Fetches recent transactions for tracked wallets from public explorers.
 *
 * Query params:
 *   wallets - comma-separated list of wallet addresses (max 10)
 *   chain   - 'eth' | 'arb' | 'bsc' | 'sol' (default: 'eth')
 *
 * Security:
 *   - Address format validation (EVM 0x + 40 hex, Solana base58)
 *   - Chain whitelist
 *   - Max 10 addresses per request
 *   - 8s timeout on upstream calls
 */

const VALID_CHAINS = new Set(['eth', 'arb', 'bsc', 'sol']);
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const limiter = createIpRateLimiter({ limit: 10, windowMs: 60_000 });

// Per-address cache (60s TTL)
const addressCache = new Map();
const ADDR_CACHE_TTL = 60_000;

function isValidAddress(address, chain) {
  if (chain === 'sol') return SOL_ADDR_RE.test(address);
  return EVM_ADDR_RE.test(address);
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
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'GET, OPTIONS', ...cors },
    });
  }
  const clientIp = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (!limiter.check(clientIp)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors },
    });
  }

  const url = new URL(req.url);
  const walletsParam = url.searchParams.get('wallets');
  const chain = url.searchParams.get('chain') || 'eth';

  // Validate chain parameter
  if (!VALID_CHAINS.has(chain)) {
    return new Response(JSON.stringify({ error: `Invalid chain. Allowed: ${[...VALID_CHAINS].join(', ')}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  if (!walletsParam) {
    return new Response(JSON.stringify({ error: 'wallets parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const rawAddresses = walletsParam.split(',').map(w => w.trim()).filter(Boolean).slice(0, 10);
  if (rawAddresses.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid addresses provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  // Validate all addresses before making any upstream calls
  const invalidAddrs = rawAddresses.filter(a => !isValidAddress(a, chain));
  if (invalidAddrs.length > 0) {
    return new Response(JSON.stringify({
      error: `Invalid address format: ${invalidAddrs.map(a => shortenAddr(a)).join(', ')}`,
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const results = await Promise.all(
    rawAddresses.map(async (addr) => {
      // Check per-address cache
      const cacheKey = `${chain}:${addr}`;
      const cached = addressCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < ADDR_CACHE_TTL) {
        return cached.data;
      }
      try {
        const txns = await fetchWalletTxns(addr, chain);
        const result = {
          address: addr,
          chain,
          label: shortenAddr(addr),
          transactions: txns,
          lastActive: txns.length > 0 ? txns[0].timestamp : null,
          error: null,
        };
        addressCache.set(cacheKey, { data: result, ts: Date.now() });
        // Prevent unbounded growth
        if (addressCache.size > 500) {
          const oldest = addressCache.keys().next().value;
          addressCache.delete(oldest);
        }
        return result;
      } catch (_err) {
        return {
          address: addr,
          chain,
          label: shortenAddr(addr),
          transactions: [],
          lastActive: null,
          error: 'Failed to fetch transactions',
        };
      }
    })
  );

  return new Response(JSON.stringify({
    timestamp: new Date().toISOString(),
    chain,
    wallets: results,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
      ...cors,
    },
  });
}

function shortenAddr(addr) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function fetchWalletTxns(address, chain) {
  if (chain === 'sol') {
    return fetchSolanaTxns(address);
  }

  const explorerApis = {
    eth: 'https://api.etherscan.io/api',
    arb: 'https://api.arbiscan.io/api',
    bsc: 'https://api.bscscan.com/api',
  };

  const baseUrl = explorerApis[chain];
  if (!baseUrl) return [];

  // Build URL with validated address (already regex-checked)
  const params = new URLSearchParams({
    module: 'account',
    action: 'txlist',
    address,
    startblock: '0',
    endblock: '99999999',
    page: '1',
    offset: '20',
    sort: 'desc',
  });

  // Add API key if available
  const apiKeys = {
    eth: process.env.ETHERSCAN_API_KEY,
    arb: process.env.ARBISCAN_API_KEY,
    bsc: process.env.BSCSCAN_API_KEY,
  };
  const apiKey = apiKeys[chain];
  if (apiKey) params.set('apikey', apiKey);

  const resp = await fetch(`${baseUrl}?${params.toString()}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) {
    throw new Error(`Explorer API returned ${resp.status}`);
  }

  const data = await resp.json();

  if (data.status !== '1' || !Array.isArray(data.result)) {
    // Rate limited or no results - don't leak upstream error strings
    if (data.message === 'NOTOK') {
      throw new Error('Explorer API rate limited or unavailable');
    }
    return [];
  }

  return data.result.slice(0, 20).map(tx => ({
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: (parseFloat(tx.value) / 1e18).toFixed(6),
    timestamp: parseInt(tx.timeStamp, 10) * 1000,
    method: tx.functionName ? tx.functionName.split('(')[0] : (tx.input === '0x' ? 'transfer' : 'contract'),
    isError: tx.isError === '1',
    gasUsed: tx.gasUsed,
    direction: tx.from.toLowerCase() === address.toLowerCase() ? 'out' : 'in',
  }));
}

async function fetchSolanaTxns(address) {
  try {
    const resp = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [address, { limit: 20 }],
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      throw new Error(`Solana RPC returned ${resp.status}`);
    }

    const data = await resp.json();

    if (data.error) {
      throw new Error('Solana RPC unavailable');
    }

    if (!data.result || !Array.isArray(data.result)) return [];

    return data.result.map(sig => ({
      hash: sig.signature,
      from: address,
      to: '',
      value: '0',
      timestamp: (sig.blockTime || 0) * 1000,
      method: sig.memo ? 'memo' : 'transaction',
      isError: sig.err !== null,
      direction: 'unknown',
    }));
  } catch (err) {
    if (err instanceof Error) throw err;
    return [];
  }
}
