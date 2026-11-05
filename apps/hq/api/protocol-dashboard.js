export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';
import { resolveDashboard } from './_protocol-dashboards.js';
import { chainTvlRows, downsample, lpProfitability, seriesChangePct, utilization } from './_dashboard-math.js';

/**
 * Protocol dashboard: one protocol, many blocks, all from keyless public sources
 * (DeFiLlama protocol, fees, yields and coin-price APIs, Lido's public API,
 * Hyperliquid's public info API). Which blocks apply is declared in
 * _protocol-dashboards.js. Each block settles on its own: one upstream failing
 * degrades that block to { status: 'unavailable', reason }, never the dashboard,
 * and nothing is ever filled in with made-up numbers.
 *
 *   GET /api/protocol-dashboard?slug=<defillama slug>[&window=7|30|90]
 */

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 12_000;
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WINDOWS = new Set([7, 30, 90]);
const COINS_CHAIN = { Ethereum: 'ethereum', Arbitrum: 'arbitrum', Base: 'base', Polygon: 'polygon', Optimism: 'optimism', Avalanche: 'avax', BSC: 'bsc' };

const cache = new Map();

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

const ok = (data) => ({ status: 'ok', ...data });
const unavailable = (reason) => ({ status: 'unavailable', reason });

async function settle(fn) {
  try { return await fn(); } catch (err) { return unavailable(err?.message || 'upstream error'); }
}

let yieldsMemo = null;
async function allPools() {
  if (yieldsMemo && Date.now() - yieldsMemo.at < CACHE_TTL_MS) return yieldsMemo.pools;
  const json = await getJson('https://yields.llama.fi/pools');
  const pools = Array.isArray(json?.data) ? json.data : [];
  yieldsMemo = { at: Date.now(), pools };
  return pools;
}

async function poolsFor(projects) {
  if (!projects.length) return [];
  const set = new Set(projects);
  return (await allPools()).filter((p) => set.has(p.project));
}

const num = (v) => (Number.isFinite(v) ? v : null);

const blocks = {
  async 'tvl-history'(ctx) {
    const series = (ctx.protocol.tvl || []).map((p) => [p.date, p.totalLiquidityUSD]).filter((p) => Number.isFinite(p[1]));
    if (series.length < 2) return unavailable('DeFiLlama has no TVL history for this protocol');
    return ok({
      current: series[series.length - 1][1],
      change1d: seriesChangePct(series, 1),
      change7d: seriesChangePct(series, 7),
      change30d: seriesChangePct(series, 30),
      series: downsample(series.slice(-365), 120),
    });
  },

  async 'tvl-chains'(ctx) {
    const rows = chainTvlRows(ctx.protocol.currentChainTvls);
    return rows.length ? ok({ rows: rows.slice(0, 12) }) : unavailable('no per-chain TVL reported');
  },

  async fees(ctx) {
    const get = (type) => getJson(`https://api.llama.fi/summary/fees/${encodeURIComponent(ctx.slug)}?dataType=${type}`).catch(() => null);
    const [fees, revenue] = await Promise.all([get('dailyFees'), get('dailyRevenue')]);
    if (!fees && !revenue) return unavailable('no fee data from the free sources for this protocol');
    const pick = (d) => d && {
      total24h: num(d.total24h), total7d: num(d.total7d), total30d: num(d.total30d), allTime: num(d.totalAllTime),
      series: downsample((d.totalDataChart || []).slice(-90), 90),
    };
    return ok({ fees: pick(fees), revenue: pick(revenue) });
  },

  async yields(ctx) {
    const pools = (await poolsFor(ctx.def.yieldsProjects)).sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, 8);
    if (!pools.length) return unavailable('no yield pools listed for this protocol');
    return ok({
      rows: pools.map((p) => ({
        symbol: p.symbol, chain: p.chain, meta: p.poolMeta || null, tvlUsd: num(p.tvlUsd),
        apyBase: num(p.apyBase), apyReward: num(p.apyReward), apyMean30d: num(p.apyMean30d),
      })),
    });
  },

  async price(ctx) {
    const gecko = ctx.protocol.gecko_id;
    if (!gecko) return unavailable('this protocol has no token');
    const json = await getJson(`https://coins.llama.fi/prices/current/coingecko:${encodeURIComponent(gecko)}`);
    const coin = json?.coins?.[`coingecko:${gecko}`];
    if (!coin) return unavailable('no price for the token');
    return ok({ symbol: coin.symbol || ctx.protocol.symbol || null, price: coin.price, mcap: num(ctx.protocol.mcap), confidence: num(coin.confidence) });
  },

  async 'token-breakdown'(ctx) {
    const last = (ctx.protocol.tokensInUsd || []).at(-1)?.tokens;
    if (!last) return unavailable('no token breakdown reported');
    const rows = Object.entries(last).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([token, usd]) => ({ token, usd }));
    const total = Object.values(last).reduce((s, v) => s + (v > 0 ? v : 0), 0);
    return ok({ rows: rows.map((r) => ({ ...r, share: total > 0 ? r.usd / total : 0 })) });
  },

  async 'uniswap-lp'(ctx) {
    const pools = (await poolsFor(ctx.def.yieldsProjects)).filter((p) => Array.isArray(p.underlyingTokens) && p.underlyingTokens.length === 2 && COINS_CHAIN[p.chain]).sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, 5);
    if (!pools.length) return unavailable('no two-token pools with price history');
    const startSec = Math.floor(Date.now() / 1000) - ctx.window * 86400;
    const rows = await Promise.all(pools.map(async (p) => {
      const base = { pool: p.symbol, chain: p.chain, fee: p.poolMeta || null, tvlUsd: num(p.tvlUsd), volume1d: num(p.volumeUsd1d), feeApyPct: num(p.apyBase7d ?? p.apyBase), profitability: null };
      try {
        const ids = p.underlyingTokens.map((t) => `${COINS_CHAIN[p.chain]}:${t}`);
        const json = await getJson(`https://coins.llama.fi/chart/${ids.join(',')}?start=${startSec}&span=2&period=${ctx.window}d`);
        const [a, b] = ids.map((id) => json?.coins?.[id]?.prices || []);
        const [a0, a1] = [a[0]?.price, a.at(-1)?.price];
        const [b0, b1] = [b[0]?.price, b.at(-1)?.price];
        if (a0 > 0 && a1 > 0 && b0 > 0 && b1 > 0 && base.feeApyPct != null) {
          base.profitability = lpProfitability({ feeApyPct: base.feeApyPct, days: ctx.window, ratio: (a1 / b1) / (a0 / b0) });
        }
      } catch { /* price history missing: the row keeps depth and fee yield, profitability stays null */ }
      return base;
    }));
    return ok({ window: ctx.window, rows });
  },

  async 'lending-rates'(ctx) {
    const pools = (await poolsFor(ctx.def.yieldsProjects)).filter((p) => p.totalSupplyUsd > 0).sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd).slice(0, 10);
    if (!pools.length) return unavailable('no lending markets listed for this protocol');
    return ok({
      rows: pools.map((p) => ({
        symbol: p.symbol, chain: p.chain, meta: p.poolMeta || null, supplyUsd: num(p.totalSupplyUsd), borrowUsd: num(p.totalBorrowUsd),
        utilization: utilization(p.totalSupplyUsd, p.totalBorrowUsd), supplyApy: num(p.apyBase), borrowApy: num(p.apyBaseBorrow),
      })),
    });
  },

  async 'aave-health'() {
    return unavailable('health factors need per-account positions, which no free public source exposes');
  },

  async 'lido-staking'() {
    const [stats, apr] = await Promise.all([
      getJson('https://eth-api.lido.fi/v1/protocol/steth/stats'),
      getJson('https://eth-api.lido.fi/v1/protocol/steth/apr/sma'),
    ]);
    return ok({
      totalStakedEth: num(Number(stats.totalStaked)), marketCapUsd: num(stats.marketCap),
      holders: num(Number(stats.uniqueHolders)), smaAprPct: num(apr?.data?.smaApr),
      validators: null, validatorsNote: 'validator count is not published by a free source',
    });
  },

  async 'hyperliquid-markets'() {
    const json = await getJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) });
    const [meta, ctxs] = Array.isArray(json) ? json : [];
    if (!meta?.universe || !Array.isArray(ctxs)) return unavailable('unexpected Hyperliquid response');
    const rows = meta.universe.map((u, i) => {
      const c = ctxs[i] || {};
      const mark = Number(c.markPx);
      return { coin: u.name, delisted: !!u.isDelisted, markPx: num(mark), fundingPct: num(Number(c.funding) * 100), openInterestUsd: num(Number(c.openInterest) * mark), volume24hUsd: num(Number(c.dayNtlVlm)) };
    }).filter((r) => !r.delisted && r.openInterestUsd > 0).sort((a, b) => b.openInterestUsd - a.openInterestUsd);
    return ok({
      totalOpenInterestUsd: rows.reduce((s, r) => s + r.openInterestUsd, 0),
      totalVolume24hUsd: rows.reduce((s, r) => s + (r.volume24hUsd || 0), 0),
      rows: rows.slice(0, 12),
    });
  },
};

export async function buildDashboard(slug, window) {
  const protocol = await getJson(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`);
  if (!protocol || !protocol.name) throw Object.assign(new Error('protocol not found'), { status: 404 });
  const def = resolveDashboard(slug);
  const ctx = { slug, window, protocol, def };
  const entries = await Promise.all(def.blocks.map(async (id) => [id, await settle(() => blocks[id](ctx))]));
  return {
    timestamp: new Date().toISOString(),
    slug,
    dashboard: def.id,
    protocol: {
      name: protocol.name, category: protocol.category || null, chains: protocol.chains || [], logo: protocol.logo || null,
      url: protocol.url || null, symbol: protocol.symbol || null, listedAt: protocol.listedAt || null,
    },
    blockOrder: def.blocks,
    blocks: Object.fromEntries(entries),
    sources: ['DeFiLlama protocol, fees, yields and coins APIs', ...(def.blocks.includes('lido-staking') ? ['Lido public API'] : []), ...(def.blocks.includes('hyperliquid-markets') ? ['Hyperliquid public info API'] : [])],
    methodology: 'Every block comes from a keyless public source and settles independently. A block with no free data says so instead of showing a placeholder. LP profitability is fee yield pro-rata over the window versus constant-product impermanent loss from the pair price ratio over the same window; it is an estimate, not financial advice.',
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  const jsonHeaders = { ...cors, 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: isDisallowedOrigin(req) ? 403 : 204, headers: cors });
  if (isDisallowedOrigin(req)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: jsonHeaders });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...jsonHeaders, Allow: 'GET, OPTIONS' } });
  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (!limiter.check(ip)) return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: { ...jsonHeaders, 'Retry-After': '60' } });

  const url = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return new Response(JSON.stringify({ error: 'slug is required: a DeFiLlama protocol slug such as kamino-lend' }), { status: 400, headers: jsonHeaders });
  const win = Number(url.searchParams.get('window') || 30);
  if (!WINDOWS.has(win)) return new Response(JSON.stringify({ error: 'window must be 7, 30 or 90' }), { status: 400, headers: jsonHeaders });

  const key = `${slug}:${win}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return new Response(JSON.stringify(hit.body), { headers: { ...jsonHeaders, 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=120' } });
  }
  try {
    const body = await buildDashboard(slug, win);
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return new Response(JSON.stringify(body), { headers: { ...jsonHeaders, 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=120' } });
  } catch (err) {
    if (err?.status === 404 || /HTTP 40[04]/.test(err?.message || '')) {
      return new Response(JSON.stringify({ error: `DeFiLlama has no protocol with slug "${slug}"` }), { status: 404, headers: jsonHeaders });
    }
    if (hit) return new Response(JSON.stringify(hit.body), { headers: { ...jsonHeaders, 'X-Cache': 'STALE', 'Cache-Control': 'public, max-age=60' } });
    console.error('[protocol-dashboard]', err?.message || err);
    return new Response(JSON.stringify({ error: 'The data sources did not answer. Try again in a moment.' }), { status: 502, headers: jsonHeaders });
  }
}
