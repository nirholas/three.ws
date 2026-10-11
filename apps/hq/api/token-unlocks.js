export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const CACHE_TTL = 600; // 10 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

/* ── Inline condensed vesting schedules (Edge can't import src/) ── */

function mo(startY, startM, count, amount, pct, recip, day = 16) {
  const out = [];
  let y = startY, m = startM;
  for (let i = 0; i < count; i++) {
    const mm = String(m).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    out.push({ date: `${y}-${mm}-${dd}`, amount, percentOfSupply: pct, recipient: recip, cliff: false, recurring: 'monthly' });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

const SCHEDULES = [
  { token: 'Arbitrum', symbol: 'ARB', coingeckoId: 'arbitrum', totalSupply: 10e9, circulatingSupply: 4.6e9, category: 'L2',
    events: [...mo(2026,2,14,92_650_000,0.93,'team'), ...mo(2026,2,14,62_500_000,0.63,'investors')] },
  { token: 'Optimism', symbol: 'OP', coingeckoId: 'optimism', totalSupply: 4_294_967_296, circulatingSupply: 1.65e9, category: 'L2',
    events: [...mo(2026,2,12,15_600_000,0.36,'team'), ...mo(2026,2,12,10_750_000,0.25,'investors',1),
      { date: '2026-03-31', amount: 42_950_000, percentOfSupply: 1.0, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
      { date: '2026-06-30', amount: 42_950_000, percentOfSupply: 1.0, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
      { date: '2026-09-30', amount: 42_950_000, percentOfSupply: 1.0, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
      { date: '2026-12-31', amount: 42_950_000, percentOfSupply: 1.0, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' }] },
  { token: 'Starknet', symbol: 'STRK', coingeckoId: 'starknet', totalSupply: 10e9, circulatingSupply: 2.1e9, category: 'L2',
    events: [...mo(2026,2,12,64_000_000,0.64,'team'), ...mo(2026,2,12,45_000_000,0.45,'investors')] },
  { token: 'zkSync', symbol: 'ZK', coingeckoId: 'zksync', totalSupply: 21e9, circulatingSupply: 3.675e9, category: 'L2',
    events: [...mo(2026,2,12,131_250_000,0.63,'team',17), ...mo(2026,2,12,87_500_000,0.42,'investors',17)] },
  { token: 'Scroll', symbol: 'SCR', coingeckoId: 'scroll', totalSupply: 1e9, circulatingSupply: 190e6, category: 'L2',
    events: [...mo(2026,2,12,6_944_000,0.69,'team'), ...mo(2026,2,12,5_208_000,0.52,'investors')] },
  { token: 'Aptos', symbol: 'APT', coingeckoId: 'aptos', totalSupply: 1_084_721_789, circulatingSupply: 580e6, category: 'L1',
    events: [...mo(2026,2,12,11_310_000,1.04,'team',12), ...mo(2026,2,12,8_500_000,0.78,'investors',12)] },
  { token: 'Sui', symbol: 'SUI', coingeckoId: 'sui', totalSupply: 10e9, circulatingSupply: 3.2e9, category: 'L1',
    events: [...mo(2026,2,12,55_000_000,0.55,'team',1), ...mo(2026,2,12,38_000_000,0.38,'investors',1),
      { date: '2026-05-01', amount: 75e6, percentOfSupply: 0.75, recipient: 'community', cliff: false, recurring: 'quarterly' },
      { date: '2026-08-01', amount: 75e6, percentOfSupply: 0.75, recipient: 'community', cliff: false, recurring: 'quarterly' },
      { date: '2026-11-01', amount: 75e6, percentOfSupply: 0.75, recipient: 'community', cliff: false, recurring: 'quarterly' }] },
  { token: 'Sei', symbol: 'SEI', coingeckoId: 'sei-network', totalSupply: 10e9, circulatingSupply: 3.85e9, category: 'L1',
    events: [...mo(2026,2,12,27_780_000,0.28,'team',15), ...mo(2026,2,12,20_830_000,0.21,'investors',15)] },
  { token: 'Celestia', symbol: 'TIA', coingeckoId: 'celestia', totalSupply: 1e9, circulatingSupply: 320e6, category: 'L1',
    events: [...mo(2026,2,12,4_167_000,0.42,'team',31), ...mo(2026,2,12,6_250_000,0.63,'investors',31)] },
  { token: 'Monad', symbol: 'MON', coingeckoId: 'monad', totalSupply: 10e9, circulatingSupply: 1.2e9, category: 'L1',
    events: [...mo(2026,3,10,83_333_000,0.83,'team'), ...mo(2026,3,10,62_500_000,0.63,'investors')] },
  { token: 'dYdX', symbol: 'DYDX', coingeckoId: 'dydx-chain', totalSupply: 1e9, circulatingSupply: 580e6, category: 'DeFi',
    events: [...mo(2026,2,12,6_944_000,0.69,'team',1), ...mo(2026,2,12,5_556_000,0.56,'investors',1)] },
  { token: 'Jupiter', symbol: 'JUP', coingeckoId: 'jupiter-exchange-solana', totalSupply: 10e9, circulatingSupply: 2.7e9, category: 'DeFi',
    events: [...mo(2026,2,12,41_667_000,0.42,'team'), ...mo(2026,2,12,27_778_000,0.28,'ecosystem')] },
  { token: 'Pendle', symbol: 'PENDLE', coingeckoId: 'pendle', totalSupply: 258_446_028, circulatingSupply: 160e6, category: 'DeFi',
    events: [...mo(2026,2,12,1_930_000,0.75,'team',1), ...mo(2026,2,12,1_075_000,0.42,'ecosystem',1)] },
  { token: 'Ethena', symbol: 'ENA', coingeckoId: 'ethena', totalSupply: 15e9, circulatingSupply: 5.85e9, category: 'DeFi',
    events: [...mo(2026,2,12,62_500_000,0.42,'team',2), ...mo(2026,2,12,37_500_000,0.25,'investors',2)] },
  { token: 'Ondo Finance', symbol: 'ONDO', coingeckoId: 'ondo-finance', totalSupply: 10e9, circulatingSupply: 3.1e9, category: 'DeFi',
    events: [...mo(2026,2,12,45_000_000,0.45,'team',18), ...mo(2026,2,12,30_000_000,0.30,'investors',18)] },
  { token: 'EigenLayer', symbol: 'EIGEN', coingeckoId: 'eigenlayer', totalSupply: 1.67e9, circulatingSupply: 310e6, category: 'DeFi',
    events: [...mo(2026,2,12,9_722_000,0.58,'team',10), ...mo(2026,2,12,6_944_000,0.42,'investors',10)] },
  { token: 'Pyth Network', symbol: 'PYTH', coingeckoId: 'pyth-network', totalSupply: 10e9, circulatingSupply: 3.6e9, category: 'Infrastructure',
    events: [...mo(2026,2,12,27_778_000,0.28,'team',20), ...mo(2026,2,12,20_833_000,0.21,'investors',20)] },
  { token: 'Worldcoin', symbol: 'WLD', coingeckoId: 'worldcoin-wld', totalSupply: 10e9, circulatingSupply: 1.15e9, category: 'Infrastructure',
    events: [...mo(2026,2,12,100_000_000,1.0,'community',24), ...mo(2026,2,12,20_833_000,0.21,'team',24)] },
  { token: 'Wormhole', symbol: 'W', coingeckoId: 'wormhole', totalSupply: 10e9, circulatingSupply: 2.5e9, category: 'Infrastructure',
    events: [...mo(2026,2,12,33_333_000,0.33,'team',3), ...mo(2026,2,12,25_000_000,0.25,'investors',3)] },
  { token: 'LayerZero', symbol: 'ZRO', coingeckoId: 'layerzero', totalSupply: 1e9, circulatingSupply: 250e6, category: 'Infrastructure',
    events: [...mo(2026,2,12,5_556_000,0.56,'team',20), ...mo(2026,2,12,4_167_000,0.42,'investors',20)] },
  { token: 'Immutable', symbol: 'IMX', coingeckoId: 'immutable-x', totalSupply: 2e9, circulatingSupply: 1.65e9, category: 'Infrastructure',
    events: [...mo(2026,2,12,8_333_000,0.42,'ecosystem',22), ...mo(2026,2,12,5_556_000,0.28,'team',22)] },
  { token: 'Jito', symbol: 'JTO', coingeckoId: 'jito-governance-token', totalSupply: 1e9, circulatingSupply: 350e6, category: 'Infrastructure',
    events: [...mo(2026,2,12,5_556_000,0.56,'team',7), ...mo(2026,2,12,4_167_000,0.42,'investors',7)] },
  { token: 'Ethfi', symbol: 'ETHFI', coingeckoId: 'ether-fi', totalSupply: 1e9, circulatingSupply: 310e6, category: 'DeFi',
    events: [...mo(2026,2,12,6_944_000,0.69,'team',18), ...mo(2026,2,12,4_861_000,0.49,'investors',18),
      { date: '2026-03-18', amount: 12_500_000, percentOfSupply: 1.25, recipient: 'treasury', cliff: false, recurring: 'quarterly' },
      { date: '2026-06-18', amount: 12_500_000, percentOfSupply: 1.25, recipient: 'treasury', cliff: false, recurring: 'quarterly' },
      { date: '2026-09-18', amount: 12_500_000, percentOfSupply: 1.25, recipient: 'treasury', cliff: false, recurring: 'quarterly' },
      { date: '2026-12-18', amount: 12_500_000, percentOfSupply: 1.25, recipient: 'treasury', cliff: false, recurring: 'quarterly' }] },
  { token: 'Manta Network', symbol: 'MANTA', coingeckoId: 'manta-network', totalSupply: 1e9, circulatingSupply: 430e6, category: 'L2',
    events: [...mo(2026,2,12,4_167_000,0.42,'team',18), ...mo(2026,2,12,3_472_000,0.35,'investors',18)] },
  { token: 'Altlayer', symbol: 'ALT', coingeckoId: 'altlayer', totalSupply: 10e9, circulatingSupply: 3.2e9, category: 'Infrastructure',
    events: [...mo(2026,2,12,41_667_000,0.42,'team',25), ...mo(2026,2,12,27_778_000,0.28,'investors',25)] },
  { token: 'Pixels', symbol: 'PIXEL', coingeckoId: 'pixels', totalSupply: 5e9, circulatingSupply: 1.4e9, category: 'Gaming',
    events: [...mo(2026,2,12,20_833_000,0.42,'ecosystem',19), ...mo(2026,2,12,13_889_000,0.28,'team',19)] },
  { token: 'Portal', symbol: 'PORTAL', coingeckoId: 'portal-2', totalSupply: 1e9, circulatingSupply: 280e6, category: 'Gaming',
    events: [...mo(2026,2,12,5_556_000,0.56,'team',22), ...mo(2026,2,12,4_167_000,0.42,'investors',22)] },
  { token: 'Drift Protocol', symbol: 'DRIFT', coingeckoId: 'drift-protocol', totalSupply: 1e9, circulatingSupply: 270e6, category: 'DeFi',
    events: [...mo(2026,2,12,5_556_000,0.56,'team',16), ...mo(2026,2,12,4_167_000,0.42,'investors',16)] },
  { token: 'Aave', symbol: 'AAVE', coingeckoId: 'aave', totalSupply: 16e6, circulatingSupply: 15e6, category: 'DeFi',
    events: [
      { date: '2026-04-01', amount: 50_000, percentOfSupply: 0.31, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
      { date: '2026-07-01', amount: 50_000, percentOfSupply: 0.31, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
      { date: '2026-10-01', amount: 50_000, percentOfSupply: 0.31, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' }] },
  { token: 'Parcl', symbol: 'PRCL', coingeckoId: 'parcl', totalSupply: 1e9, circulatingSupply: 200e6, category: 'DeFi',
    events: [...mo(2026,2,12,6_250_000,0.63,'team',15), ...mo(2026,2,12,4_861_000,0.49,'investors',15)] },
];

/* ── Price impact risk classification ── */
function riskLevel(percentOfCirculating) {
  if (percentOfCirculating > 5) return 'high';
  if (percentOfCirculating >= 1) return 'medium';
  return 'low';
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    upcoming: [],
    calendar: { thisWeek: [], nextWeek: [], thisMonth: [], next90Days: [] },
    summary: { totalValueNext7d: 0, totalValueNext30d: 0, highestImpact: null, upcomingCount: 0 },
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
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=1200` },
    });
  }

  try {
    // 1. Collect all CoinGecko IDs for price fetch
    const ids = [...new Set(SCHEDULES.map(s => s.coingeckoId))].join(',');

    // 2. Fetch current prices from CoinGecko
    let prices = {};
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const priceRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
        { signal: controller.signal, headers: { Accept: 'application/json' } },
      );
      clearTimeout(timeout);
      if (priceRes.ok) {
        prices = await priceRes.json();
      }
    } catch {
      // Price fetch failed - continue with $0 values
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const DAY_MS = 86_400_000;
    const endOfWeek = new Date(todayMs + 7 * DAY_MS);
    const endOfNextWeek = new Date(todayMs + 14 * DAY_MS);
    const endOfMonth = new Date(todayMs + 30 * DAY_MS);
    const endOf90 = new Date(todayMs + 90 * DAY_MS);

    // 3. Build upcoming unlocks list
    const upcoming = [];

    for (const schedule of SCHEDULES) {
      const price = prices[schedule.coingeckoId]?.usd ?? 0;

      for (const evt of schedule.events) {
        const evtDate = new Date(evt.date + 'T00:00:00Z');
        const evtMs = evtDate.getTime();
        if (evtMs < todayMs) continue;          // skip past events
        if (evtMs > endOf90.getTime()) continue; // skip > 90 days

        const daysUntil = Math.ceil((evtMs - todayMs) / DAY_MS);
        const valueUSD = evt.amount * price;
        const percentOfCirculating = (evt.amount / schedule.circulatingSupply) * 100;

        upcoming.push({
          token: schedule.token,
          symbol: schedule.symbol,
          date: evt.date,
          daysUntil,
          amount: evt.amount,
          percentOfSupply: evt.percentOfSupply,
          valueUSD,
          recipient: evt.recipient,
          cliff: evt.cliff,
          currentPrice: price,
          priceImpactRisk: riskLevel(percentOfCirculating),
          category: schedule.category,
        });
      }
    }

    // Sort by date ascending, then by value descending (for same day)
    upcoming.sort((a, b) => a.daysUntil - b.daysUntil || b.valueUSD - a.valueUSD);

    // 4. Build calendar buckets
    const thisWeek = upcoming.filter(u => new Date(u.date) < endOfWeek);
    const nextWeek = upcoming.filter(u => {
      const d = new Date(u.date);
      return d >= endOfWeek && d < endOfNextWeek;
    });
    const thisMonth = upcoming.filter(u => new Date(u.date) < endOfMonth);
    const next90Days = upcoming;

    // 5. Summary
    const totalValueNext7d = thisWeek.reduce((s, u) => s + u.valueUSD, 0);
    const totalValueNext30d = thisMonth.reduce((s, u) => s + u.valueUSD, 0);
    const highestImpact = upcoming.length
      ? upcoming.reduce((best, u) => u.percentOfSupply > best.percentOfSupply ? u : best)
      : null;

    const result = {
      timestamp: new Date().toISOString(),
      upcoming: upcoming.slice(0, 100), // Cap response size
      calendar: {
        thisWeek,
        nextWeek,
        thisMonth: thisMonth.slice(0, 60),
        next90Days: next90Days.slice(0, 100),
      },
      summary: {
        totalValueNext7d,
        totalValueNext30d,
        highestImpact: highestImpact ? { token: highestImpact.token, percentOfSupply: highestImpact.percentOfSupply } : null,
        upcomingCount: upcoming.length,
      },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=1200`,
      },
    });
  } catch (err) {
    const fallback = cachedResponse || buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'ERROR' },
    });
  }
}
