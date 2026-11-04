export const config = { runtime: 'edge' };

/**
 * Agent tool surface for HQ's DeFi data. One POST endpoint exposes a fixed
 * registry of read-only tools (top_yields, chain_tvl, protocol_health,
 * funding_rates, liquidations, venue_spread, whale_activity, gas,
 * portfolio_risk). Each tool calls the matching HQ data route on the same
 * deployment and returns a compact, ranked result plus plain-language facts.
 *
 *   GET  /api/agent-tools                       -> tool catalog (JSON Schema)
 *   POST /api/agent-tools {tool, args}          -> run one tool
 *   POST /api/agent-tools {question, narrate?}  -> route a question to a tool;
 *                                                  narrate:true adds a summary
 *                                                  from HQ's groq-summarize route
 *
 * No tool moves funds or signs anything.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';
import { assessPortfolio } from './_portfolio-risk.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const MAX_BODY_BYTES = 20_000;

const fmtUsd = (n) => {
  if (!Number.isFinite(n)) return 'n/a';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const pct = (n, d = 2) => (Number.isFinite(n) ? `${n.toFixed(d)}%` : 'n/a');
const clampInt = (v, lo, hi, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const str = (v, max = 64) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const eqi = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const limitProp = { type: 'integer', minimum: 1, maximum: 25, description: 'Rows to return (default 10).' };

/** The registry. `reduce(data, args)` -> { rows, facts }. */
export const TOOLS = {
  top_yields: {
    description: 'Highest-APY DeFi pools above a TVL floor, optionally for one chain or stablecoin pools only.',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Chain name, e.g. Ethereum, Solana.' },
        minTvl: { type: 'number', minimum: 0, description: 'Minimum pool TVL in USD (default 1000000).' },
        stablecoinOnly: { type: 'boolean' },
        limit: limitProp,
      },
      additionalProperties: false,
    },
    endpoint: (a) => {
      const q = new URLSearchParams({ minTvl: String(Math.max(0, Number(a.minTvl) || 1_000_000)) });
      if (str(a.chain)) q.set('chain', str(a.chain));
      return `/api/defi-yields?${q}`;
    },
    reduce(data, a) {
      let pools = Array.isArray(data.pools) ? data.pools : [];
      if (a.stablecoinOnly === true) pools = pools.filter((p) => p.stablecoin);
      const rows = [...pools].sort((x, y) => y.apy - x.apy).slice(0, clampInt(a.limit, 1, 25, 10)).map((p) => ({
        project: p.project, symbol: p.symbol, chain: p.chain, apy: +p.apy.toFixed(2), tvlUsd: Math.round(p.tvlUsd),
        stablecoin: !!p.stablecoin, apyBase: p.apyBase ?? null, apyReward: p.apyReward ?? null,
      }));
      return { rows, facts: rows.map((r) => `${r.project} ${r.symbol} on ${r.chain}: ${pct(r.apy)} APY, ${fmtUsd(r.tvlUsd)} TVL`) };
    },
  },

  chain_tvl: {
    description: 'Total value locked by chain, ranked, with each chain\'s share of the tracked total.',
    inputSchema: {
      type: 'object',
      properties: { chain: { type: 'string', description: 'Return just this chain.' }, limit: limitProp },
      additionalProperties: false,
    },
    endpoint: () => '/api/chain-tvl',
    reduce(data, a) {
      const chains = Array.isArray(data.chains) ? data.chains : [];
      const total = chains.reduce((s, c) => s + c.tvl, 0);
      const pick = str(a.chain) ? chains.filter((c) => eqi(c.name, str(a.chain))) : chains;
      const rows = pick.slice(0, clampInt(a.limit, 1, 25, 10)).map((c) => ({
        chain: c.name, tvlUsd: Math.round(c.tvl), sharePct: total > 0 ? +((c.tvl / total) * 100).toFixed(2) : 0,
      }));
      return { rows, facts: rows.map((r) => `${r.chain}: ${fmtUsd(r.tvlUsd)} TVL (${pct(r.sharePct, 1)} of tracked)`) };
    },
  },

  protocol_health: {
    description: 'Composite 0-100 health score per DeFi protocol (TVL scale, momentum, stability, maturity). Heuristic, not financial advice.',
    inputSchema: {
      type: 'object',
      properties: {
        protocol: { type: 'string', description: 'Name or slug filter.' },
        category: { type: 'string', description: 'Category filter, e.g. Lending, Dexes.' },
        sort: { type: 'string', enum: ['score', 'tvl', 'weakest'], description: 'weakest lists lowest scores first.' },
        limit: limitProp,
      },
      additionalProperties: false,
    },
    endpoint: () => '/api/protocol-health',
    reduce(data, a) {
      let list = Array.isArray(data.protocols) ? data.protocols : [];
      if (str(a.category)) list = list.filter((p) => eqi(p.category, str(a.category)));
      if (str(a.protocol)) {
        const needle = str(a.protocol).toLowerCase();
        list = list.filter((p) => p.name.toLowerCase().includes(needle) || String(p.slug || '').toLowerCase() === needle);
      }
      const sort = a.sort === 'tvl' ? (x, y) => y.tvl - x.tvl : a.sort === 'weakest' ? (x, y) => x.score - y.score : (x, y) => y.score - x.score;
      const rows = [...list].sort(sort).slice(0, clampInt(a.limit, 1, 25, 10)).map((p) => ({
        name: p.name, slug: p.slug, category: p.category, score: p.score, grade: p.grade,
        tvlUsd: p.tvl, change1dPct: p.change1d, change7dPct: p.change7d,
      }));
      return { rows, facts: rows.map((r) => `${r.name} (${r.category}): health ${r.score}/100 grade ${r.grade}, ${fmtUsd(r.tvlUsd)} TVL, 7d ${pct(r.change7dPct)}`) };
    },
  },

  funding_rates: {
    description: 'Perpetual funding rates averaged across Binance, Hyperliquid and OKX; positive means longs pay shorts.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'Base asset, e.g. BTC.' }, limit: limitProp },
      additionalProperties: false,
    },
    endpoint: () => '/api/funding-rates',
    reduce(data, a) {
      let rates = Array.isArray(data.rates) ? data.rates : [];
      if (str(a.symbol)) rates = rates.filter((r) => eqi(r.symbol, str(a.symbol)));
      const rows = rates.slice(0, clampInt(a.limit, 1, 25, 10)).map((r) => ({
        symbol: r.symbol, avgFundingPct: +r.avgFunding.toFixed(4), level: r.level, venues: Object.keys(r.exchanges || {}),
      }));
      const facts = rows.map((r) => `${r.symbol}: ${r.avgFundingPct}% per interval avg (${r.level}) across ${r.venues.join(', ')}`);
      if (data.summary?.sentiment) facts.unshift(`Market funding sentiment: ${data.summary.sentiment}`);
      return { rows, facts, summary: data.summary ?? null };
    },
  },

  liquidations: {
    description: 'Perp liquidations over the last four hours: totals, long versus short pain, and the symbols hit hardest.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string' }, limit: limitProp },
      additionalProperties: false,
    },
    endpoint: () => '/api/liquidations',
    reduce(data, a) {
      let stats = Array.isArray(data.symbolStats) ? data.symbolStats : [];
      if (str(a.symbol)) stats = stats.filter((s) => eqi(s.symbol, str(a.symbol)));
      const rows = stats.slice(0, clampInt(a.limit, 1, 25, 10)).map((s) => ({
        symbol: s.symbol, count: s.count, longUsd: Math.round(s.longValue), shortUsd: Math.round(s.shortValue),
      }));
      const sm = data.summary;
      const facts = rows.map((r) => `${r.symbol}: ${r.count} liquidations, longs ${fmtUsd(r.longUsd)}, shorts ${fmtUsd(r.shortUsd)}`);
      if (sm) facts.unshift(`Last 4h: ${sm.totalCount} liquidations worth ${fmtUsd(sm.totalValue)} (${sm.dominantSide})`);
      return { rows, facts, summary: sm ?? null };
    },
  },

  venue_spread: {
    description: 'Cross-venue price spreads in basis points per asset, widest first. Wide spreads flag dislocation or thin liquidity.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string' }, limit: limitProp },
      additionalProperties: false,
    },
    endpoint: () => '/api/venue-spread',
    reduce(data, a) {
      let spreads = Array.isArray(data.spreads) ? data.spreads : [];
      if (str(a.symbol)) spreads = spreads.filter((s) => eqi(s.symbol, str(a.symbol)));
      const rows = spreads.slice(0, clampInt(a.limit, 1, 25, 10)).map((s) => ({
        symbol: s.symbol, spreadBps: s.spreadBps, level: s.level, low: s.low, high: s.high, venueCount: s.venueCount,
      }));
      return { rows, facts: rows.map((r) => `${r.symbol}: ${r.spreadBps} bps (${r.level}), ${r.low.venue} ${r.low.price} to ${r.high.venue} ${r.high.price}`), summary: data.summary ?? null };
    },
  },

  whale_activity: {
    description: 'Large ETH transfers (above $500K) in the last hour with exchange inflow/outflow net flow.',
    inputSchema: { type: 'object', properties: { limit: limitProp }, additionalProperties: false },
    endpoint: () => '/api/whale-monitor',
    reduce(data, a) {
      const txs = Array.isArray(data.transactions) ? data.transactions : [];
      const rows = txs.slice(0, clampInt(a.limit, 1, 25, 10)).map((t) => ({
        hash: t.hash, valueUsd: Math.round(t.valueUSD), type: t.type, from: t.from?.label, to: t.to?.label, timestamp: t.timestamp,
      }));
      const sm = data.summary;
      const facts = rows.map((r) => `${fmtUsd(r.valueUsd)} ${r.type}: ${r.from} to ${r.to}`);
      if (sm) facts.unshift(`Net exchange flow ${fmtUsd(sm.netExchangeFlow)} (inflows ${fmtUsd(sm.exchangeInflows)}, outflows ${fmtUsd(sm.exchangeOutflows)})`);
      return { rows, facts, summary: sm ?? null };
    },
  },

  gas: {
    description: 'Current gas price per EVM chain with the cheapest chain highlighted.',
    inputSchema: {
      type: 'object',
      properties: { chain: { type: 'string' } },
      additionalProperties: false,
    },
    endpoint: () => '/api/gas-tracker',
    reduce(data, a) {
      let chains = Array.isArray(data.chains) ? data.chains : [];
      if (str(a.chain)) chains = chains.filter((c) => eqi(c.name, str(a.chain)));
      const rows = chains.map((c) => ({ chain: c.name, gasGwei: c.gasGwei, level: c.level }));
      const facts = rows.map((r) => `${r.chain}: ${r.gasGwei} gwei (${r.level})`);
      if (data.summary?.cheapestChain) facts.unshift(`Cheapest chain: ${data.summary.cheapestChain}`);
      return { rows, facts, summary: data.summary ?? null };
    },
  },

  portfolio_risk: {
    description: 'Score a portfolio\'s risk from supplied positions: concentration, weak protocols, and crowded-leverage assets. Positions are caller-supplied; nothing is stored.',
    inputSchema: {
      type: 'object',
      properties: {
        positions: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
              usd: { type: 'number', exclusiveMinimum: 0 },
              protocol: { type: 'string', description: 'Protocol name or slug when the position sits in one.' },
              chain: { type: 'string' },
            },
            required: ['symbol', 'usd'],
            additionalProperties: false,
          },
        },
      },
      required: ['positions'],
      additionalProperties: false,
    },
    async run(args, fetchData) {
      const [health, funding] = await Promise.all([fetchData('/api/protocol-health'), fetchData('/api/funding-rates')]);
      const report = assessPortfolio(args.positions, { protocols: health.protocols ?? [], rates: funding.rates ?? [] });
      return { rows: report.positions, facts: report.facts, summary: report.summary };
    },
  },
};

const INTENTS = [
  ['portfolio_risk', /portfolio|my positions|exposure/],
  ['funding_rates', /funding|perp rate|overleveraged/],
  ['liquidations', /liquidat|squeez|rekt/],
  ['venue_spread', /spread|arbitrage|dislocation|cross.?venue/],
  ['whale_activity', /whale|large transfer|exchange (in|out)flow/],
  ['gas', /\bgas\b|gwei|cheapest chain/],
  ['protocol_health', /health|safe|risk|score|grade|audit/],
  ['chain_tvl', /\btvl\b|total value locked|chain.*(rank|biggest)/],
  ['top_yields', /yield|apy|apr|farm|stake|earn/],
];

const KNOWN_ASSETS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ARB', 'OP', 'AVAX', 'MATIC', 'LINK', 'BNB', 'SUI'];
const KNOWN_CHAINS = ['Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'Avalanche'];

/** Map a free-text question to {tool, args}, or null when nothing matches. */
export function routeQuestion(question) {
  const q = str(question, 500).toLowerCase();
  if (!q) return null;
  const hit = INTENTS.find(([, re]) => re.test(q));
  if (!hit) return null;
  const tool = hit[0];
  const args = {};
  const asset = KNOWN_ASSETS.find((s) => new RegExp(`\\b${s.toLowerCase()}\\b`).test(q));
  const chain = KNOWN_CHAINS.find((c) => q.includes(c.toLowerCase()));
  if (['funding_rates', 'liquidations', 'venue_spread'].includes(tool) && asset) args.symbol = asset;
  if (['top_yields', 'chain_tvl', 'gas'].includes(tool) && chain) args.chain = chain;
  if (tool === 'top_yields' && /stable/.test(q)) args.stablecoinOnly = true;
  if (tool === 'protocol_health' && /weak|risk|unsafe|worst/.test(q)) args.sort = 'weakest';
  return { tool, args };
}

export function listTools() {
  return Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema }));
}

/**
 * Run one tool. `origin` is the base URL of the HQ deployment serving the data
 * routes; `fetchImpl` is injectable for tests of the transport only.
 */
export async function runTool(name, args, { origin, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) throw Object.assign(new Error(`Unknown tool "${name}"`), { status: 400 });
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};

  const fetchData = async (path) => {
    const res = await fetchImpl(new URL(path, origin), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw Object.assign(new Error(`${path} returned HTTP ${res.status}`), { status: 502 });
    const json = await res.json();
    if (json?.unavailable) throw Object.assign(new Error(`${path} has no live data right now`), { status: 503 });
    return json;
  };

  const out = tool.run
    ? await tool.run(safeArgs, fetchData)
    : tool.reduce(await fetchData(tool.endpoint(safeArgs)), safeArgs);
  return { tool: name, timestamp: new Date().toISOString(), args: safeArgs, ...out };
}

function json(body, status, cors, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });
}

async function narrate(result, question, origin, request) {
  const headlines = result.facts.slice(0, 8);
  if (headlines.length === 0) return null;
  try {
    const res = await fetch(new URL('/api/groq-summarize', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: request.headers.get('origin') || origin },
      body: JSON.stringify({ headlines, mode: 'analysis', geoContext: question ? `User question: ${question}` : '' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.summary === 'string' ? data.summary : null;
  } catch {
    return null;
  }
}

export default async function handler(request) {
  const cors = getCorsHeaders(request, 'GET, POST, OPTIONS');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (isDisallowedOrigin(request)) return json({ error: 'Origin not allowed' }, 403, cors);
  if (request.method === 'GET') return json({ tools: listTools() }, 200, cors, { 'Cache-Control': 'public, max-age=300' });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (!limiter.check(ip)) return json({ error: 'Too many requests' }, 429, cors, { 'Retry-After': '60' });
  if (parseInt(request.headers.get('content-length') || '0', 10) > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413, cors);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400, cors);
  }

  let name = str(body?.tool);
  let args = body?.args;
  const question = str(body?.question, 500);
  if (!name) {
    const routed = routeQuestion(question);
    if (!routed) {
      return json({ error: 'No tool matched. Send {tool, args} or a question about yields, TVL, protocol health, funding, liquidations, spreads, whales or gas.', tools: listTools().map((t) => t.name) }, 422, cors);
    }
    name = routed.tool;
    args = routed.args;
  }

  try {
    const origin = new URL(request.url).origin;
    const result = await runTool(name, args, { origin });
    if (body?.narrate === true) result.narrative = await narrate(result, question, origin, request);
    return json(result, 200, cors, { 'Cache-Control': 'no-store' });
  } catch (err) {
    return json({ error: err.message || 'Tool failed' }, err.status || 500, cors);
  }
}
