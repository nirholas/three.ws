// DexScreener (keyless). Pair-level market data for every chain, including
// Robinhood Chain (chainId "robinhood"), plus the promoted-token feeds
// (boosts, paid profiles), which show where attention is being bought.
import { chunk, fetchJson, num } from '../lib/http.ts';
import type { Chain, Observation, Pair, Snapshot, TokenMeta } from './types.ts';
import { cleanUrl, toDate } from './types.ts';

const BASE = 'https://api.dexscreener.com';
const CHAINS: Record<string, Chain> = { solana: 'solana', robinhood: 'robinhood' };

type DsPair = Record<string, any>;

function pairToPair(p: DsPair, chain: Chain): Pair {
  return {
    chain,
    address: p.pairAddress,
    tokenAddress: p.baseToken?.address,
    dex: p.dexId,
    quoteSymbol: p.quoteToken?.symbol,
    labels: Array.isArray(p.labels) ? p.labels : [],
    createdAt: toDate(p.pairCreatedAt),
    url: cleanUrl(p.url),
  };
}

/**
 * Collapse a token's pairs into one observation: market data from its deepest
 * pool, volumes and transaction counts summed across all pools.
 */
export function pairsToObservation(chain: Chain, address: string, pairs: DsPair[]): Observation | null {
  const mine = pairs.filter((p) => p.chainId === chain && p.baseToken?.address?.toLowerCase() === address.toLowerCase());
  if (!mine.length) return null;
  mine.sort((a, b) => (num(b.liquidity?.usd) ?? 0) - (num(a.liquidity?.usd) ?? 0));
  const top = mine[0];
  const sum = (f: (p: DsPair) => unknown) => mine.reduce((acc, p) => acc + (num(f(p)) ?? 0), 0) || null;
  const socials: Record<string, string> = {};
  for (const s of top.info?.socials ?? []) if (s?.type && s?.url) socials[s.type] = s.url;
  const meta: TokenMeta = {
    chain,
    address: top.baseToken.address,
    symbol: top.baseToken.symbol,
    name: top.baseToken.name,
    image: cleanUrl(top.info?.imageUrl),
    website: cleanUrl(top.info?.websites?.[0]?.url),
    twitter: cleanUrl(socials.twitter),
    telegram: cleanUrl(socials.telegram),
    createdAt: toDate(Math.min(...mine.map((p) => num(p.pairCreatedAt) ?? Infinity).filter(Number.isFinite))),
  };
  if (chain === 'robinhood' && mine.some((p) => p.dexId === 'flapsh')) meta.launchpad = 'flap.sh';
  const snap: Snapshot = {
    priceUsd: num(top.priceUsd),
    mcap: num(top.marketCap) ?? num(top.fdv),
    fdv: num(top.fdv),
    liquidity: sum((p) => p.liquidity?.usd),
    vol5m: sum((p) => p.volume?.m5),
    vol1h: sum((p) => p.volume?.h1),
    vol6h: sum((p) => p.volume?.h6),
    vol24h: sum((p) => p.volume?.h24),
    buys1h: sum((p) => p.txns?.h1?.buys),
    sells1h: sum((p) => p.txns?.h1?.sells),
    buys24h: sum((p) => p.txns?.h24?.buys),
    sells24h: sum((p) => p.txns?.h24?.sells),
    chg5m: num(top.priceChange?.m5),
    chg1h: num(top.priceChange?.h1),
    chg6h: num(top.priceChange?.h6),
    chg24h: num(top.priceChange?.h24),
  };
  return { meta, snap, source: 'dexscreener', pairs: mine.map((p) => pairToPair(p, chain)) };
}

/** Pairs for up to 30 token addresses per request, grouped back into one observation per token. */
export async function dexTokens(chain: Chain, addresses: string[]): Promise<Observation[]> {
  const out: Observation[] = [];
  for (const group of chunk([...new Set(addresses)], 30)) {
    const pairs = await fetchJson<DsPair[]>(`${BASE}/tokens/v1/${chain}/${group.join(',')}`);
    for (const addr of group) {
      const obs = pairsToObservation(chain, addr, Array.isArray(pairs) ? pairs : []);
      if (obs) out.push(obs);
    }
  }
  return out;
}

type Promoted = { chainId: string; tokenAddress: string; description?: string; totalAmount?: number; amount?: number };

/** Boosted and profiled tokens: paid attention, ranked. Returns addresses per chain with the list name. */
export async function dexPromoted(): Promise<{ chain: Chain; address: string; list: string; rank: number; description?: string }[]> {
  const feeds: [string, string][] = [
    ['dex:boosts-top', '/token-boosts/top/v1'],
    ['dex:boosts-latest', '/token-boosts/latest/v1'],
    ['dex:profiles', '/token-profiles/latest/v1'],
    ['dex:takeovers', '/community-takeovers/latest/v1'],
  ];
  const out: { chain: Chain; address: string; list: string; rank: number; description?: string }[] = [];
  for (const [list, path] of feeds) {
    let rows: Promoted[] = [];
    try {
      rows = await fetchJson<Promoted[]>(`${BASE}${path}`);
    } catch {
      continue;
    }
    let rank = 0;
    for (const r of Array.isArray(rows) ? rows : []) {
      const chain = CHAINS[r.chainId];
      if (!chain || !r.tokenAddress) continue;
      out.push({ chain, address: r.tokenAddress, list, rank: ++rank, description: r.description });
    }
  }
  return out;
}

/** Search pairs; used to sweep Robinhood Chain, which has no chain-wide listing endpoint. */
export async function dexSearch(q: string): Promise<DsPair[]> {
  const res = await fetchJson<{ pairs?: DsPair[] }>(`${BASE}/latest/dex/search?q=${encodeURIComponent(q)}`);
  return res.pairs ?? [];
}

export async function ethUsd(): Promise<number | null> {
  const res = await fetchJson<{ data?: { amount?: string } }>('https://api.coinbase.com/v2/prices/ETH-USD/spot');
  return num(res.data?.amount);
}
