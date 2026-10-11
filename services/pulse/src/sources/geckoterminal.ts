// GeckoTerminal (keyless, ~30 req/min). Pool-level trending and new-pool
// feeds, and the OHLCV candles the token pages chart.
import { fetchJson, num } from '../lib/http.ts';
import type { Observation } from './types.ts';
import { toDate } from './types.ts';

const BASE = 'https://api.geckoterminal.com/api/v2';
type Pool = { id: string; attributes: Record<string, any>; relationships?: Record<string, any> };

function baseAddress(p: Pool): string | null {
  const id: string | undefined = p.relationships?.base_token?.data?.id;
  return id ? id.slice(id.indexOf('_') + 1) : null;
}

function mapPool(p: Pool, list: string, rank: number): Observation | null {
  const addr = baseAddress(p);
  if (!addr) return null;
  const a = p.attributes;
  const tx = a.transactions ?? {};
  return {
    meta: { chain: 'solana', address: addr, name: String(a.name ?? '').split(' / ')[0] || undefined, createdAt: toDate(a.pool_created_at) },
    snap: {
      priceUsd: num(a.base_token_price_usd),
      mcap: num(a.market_cap_usd) ?? num(a.fdv_usd),
      fdv: num(a.fdv_usd),
      vol5m: num(a.volume_usd?.m5),
      vol1h: num(a.volume_usd?.h1),
      vol6h: num(a.volume_usd?.h6),
      vol24h: num(a.volume_usd?.h24),
      buys1h: num(tx.h1?.buys),
      sells1h: num(tx.h1?.sells),
      buys24h: num(tx.h24?.buys),
      sells24h: num(tx.h24?.sells),
      chg5m: num(a.price_change_percentage?.m5),
      chg1h: num(a.price_change_percentage?.h1),
      chg6h: num(a.price_change_percentage?.h6),
      chg24h: num(a.price_change_percentage?.h24),
    },
    source: 'geckoterminal',
    list: { name: list, rank },
  };
}

async function pools(path: string, list: string): Promise<Observation[]> {
  const res = await fetchJson<{ data?: Pool[] }>(`${BASE}${path}`, { headers: { accept: 'application/json;version=20230302' } });
  const seen = new Set<string>();
  const out: Observation[] = [];
  for (const p of res.data ?? []) {
    const o = mapPool(p, list, out.length + 1);
    if (o && !seen.has(o.meta.address)) {
      seen.add(o.meta.address);
      out.push(o);
    }
  }
  return out;
}

export const geckoTrending = () => pools('/networks/solana/trending_pools?page=1&duration=1h&include=base_token', 'gecko:trending-1h');
export const geckoNewPools = () => pools('/networks/solana/new_pools?page=1&include=base_token', 'gecko:new-pools');

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** Candles for a pool. timeframe: minute|hour|day; aggregate e.g. 5 or 15 for minutes. */
export async function geckoOhlcv(network: string, pool: string, timeframe: 'minute' | 'hour' | 'day', aggregate: number, limit = 300): Promise<Candle[]> {
  const res = await fetchJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(
    `${BASE}/networks/${network}/pools/${pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd`,
  );
  return (res.data?.attributes?.ohlcv_list ?? [])
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time);
}
