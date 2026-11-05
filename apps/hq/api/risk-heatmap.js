export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';
import { fetchOracleRows } from './oracle-deviation.js';
import { overallRisk, scoreContract, scoreGovernance, scoreLiquidity, scoreMarket, scoreOracle } from './_risk-scoring.js';

/**
 * Risk heatmap: protocols by five risk dimensions (contract, oracle,
 * governance, liquidity, market). Sources are keyless: DeFiLlama protocols
 * (audits, listing age, TVL moves, governance ids) and hacks, plus the live
 * oracle monitor. A dimension with no data is "unknown", never "low".
 *
 *   GET /api/risk-heatmap[?chain=Solana][&limit=24]
 */

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 5 * 60_000;
const DIMENSIONS = ['contract', 'oracle', 'governance', 'liquidity', 'market'];

/** DeFiLlama slug -> the oracle feeds that protocol prices off. Unlisted protocols have no oracle mapping. */
const ORACLE_MAP = {
  'kamino-lend': [['Pyth', 'SOL']],
  'jupiter-lend': [['Pyth', 'SOL']],
  'marginfi-lending': [['Pyth', 'SOL']],
  'aave-v3': [['Chainlink', 'ETH'], ['Chainlink', 'BTC']],
  'aave-v2': [['Chainlink', 'ETH'], ['Chainlink', 'BTC']],
  'sky-lending': [['Chainlink', 'ETH'], ['Chainlink', 'BTC']],
  'maker': [['Chainlink', 'ETH'], ['Chainlink', 'BTC']],
  lido: [['Chainlink', 'ETH']],
  'compound-v3': [['Chainlink', 'ETH'], ['Chainlink', 'BTC']],
};

const cache = new Map();

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

export async function buildHeatmap(chain, limit) {
  const nowSec = Math.floor(Date.now() / 1000);
  const [protocols, hacks, oracle] = await Promise.all([
    getJson('https://api.llama.fi/protocols'),
    getJson('https://api.llama.fi/hacks').catch(() => null),
    fetchOracleRows().catch(() => null),
  ]);
  const lossById = new Map();
  for (const h of Array.isArray(hacks) ? hacks : []) {
    if (h.defillamaId != null) lossById.set(String(h.defillamaId), (lossById.get(String(h.defillamaId)) || 0) + (Number(h.amount) || 0));
  }
  const chainTvl = (p) => (chain ? Number(p.chainTvls?.[chain]) || 0 : Number(p.tvl) || 0);
  const picked = (Array.isArray(protocols) ? protocols : [])
    .filter((p) => p.slug && chainTvl(p) > 0 && (!chain || (p.chains || []).includes(chain)))
    .sort((a, b) => chainTvl(b) - chainTvl(a))
    .slice(0, limit);

  const rows = picked.map((p) => {
    const auditsN = p.audits == null || p.audits === '' ? null : Number(p.audits);
    const feeds = (ORACLE_MAP[p.slug] || []).map(([o, s]) => oracle?.rows?.find((r) => r.oracle === o && r.symbol === s)).filter(Boolean);
    const devs = feeds.map((f) => (f.deviationBps == null ? null : Math.abs(f.deviationBps))).filter((v) => v != null);
    const cells = {
      contract: scoreContract({ audits: Number.isFinite(auditsN) ? auditsN : null, listedAt: p.listedAt ?? null, hackLossUsd: hacks ? lossById.get(String(p.id)) || 0 : null, nowSec }),
      oracle: scoreOracle({ maxDeviationBps: devs.length ? Math.max(...devs) : null, anyStale: feeds.length ? feeds.some((f) => f.status === 'stale') : null }),
      governance: scoreGovernance({ governanceIds: Array.isArray(p.governanceID) ? p.governanceID : p.governanceID ? [p.governanceID] : [], activeProposals: null }),
      liquidity: scoreLiquidity({ tvl: chainTvl(p), change7d: p.change_7d ?? null }),
      market: scoreMarket({ change1d: p.change_1d ?? null, change7d: p.change_7d ?? null }),
    };
    return {
      slug: p.slug, name: p.name, category: p.category || null, logo: p.logo || null, tvl: chainTvl(p),
      cells, overall: overallRisk(DIMENSIONS.map((d) => cells[d])),
    };
  });
  return {
    timestamp: new Date().toISOString(), chain: chain || 'all', dimensions: DIMENSIONS, rows,
    sources: ['DeFiLlama protocols and hacks', 'Oracle monitor (Pyth via Solana RPC, Chainlink via Ethereum RPC, Coinbase and Kraken)'],
    methodology: 'Each cell is a 0-100 risk score (higher is riskier) from public data only. Contract: audit count, listing age, hack losses. Oracle: worst deviation from exchange mids and staleness, only for protocols with a mapped feed. Governance: whether a governance space is listed. Liquidity: TVL scale and 7d drawdown. Market: 1d and 7d TVL swing. A dimension with no data is unknown and is excluded from the overall average. Heuristic, not financial advice or an audit.',
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  const headers = { ...cors, 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: isDisallowedOrigin(req) ? 403 : 204, headers: cors });
  if (isDisallowedOrigin(req)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...headers, Allow: 'GET, OPTIONS' } });
  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (!limiter.check(ip)) return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: { ...headers, 'Retry-After': '60' } });

  const q = new URL(req.url).searchParams;
  const chain = (q.get('chain') || '').trim();
  if (chain && !/^[A-Za-z0-9 ._-]{1,30}$/.test(chain)) return new Response(JSON.stringify({ error: 'invalid chain' }), { status: 400, headers });
  const limit = Math.min(50, Math.max(5, Number(q.get('limit')) || 24));
  const key = `${chain}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return new Response(JSON.stringify(hit.body), { headers: { ...headers, 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=120' } });
  try {
    const body = await buildHeatmap(chain, limit);
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return new Response(JSON.stringify(body), { headers: { ...headers, 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=120' } });
  } catch (err) {
    if (hit) return new Response(JSON.stringify(hit.body), { headers: { ...headers, 'X-Cache': 'STALE' } });
    console.error('[risk-heatmap]', err?.message || err);
    return new Response(JSON.stringify({ error: 'The data sources did not answer. Try again in a moment.' }), { status: 502, headers });
  }
}
