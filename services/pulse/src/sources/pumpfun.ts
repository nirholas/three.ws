// pump.fun frontend API (keyless). The bonding-curve view Jupiter and
// DexScreener do not have: coins still on the curve, livestreams, and the
// all-time-high market cap pump.fun itself tracks.
import { fetchJson, num } from '../lib/http.ts';
import type { Observation } from './types.ts';
import { cleanUrl, toDate } from './types.ts';

const BASE = 'https://frontend-api-v3.pump.fun';
type Coin = Record<string, any>;

function mapCoin(c: Coin, list: string, rank: number): Observation {
  return {
    meta: {
      chain: 'solana',
      address: c.mint,
      symbol: c.symbol,
      name: c.name,
      decimals: 6,
      image: cleanUrl(c.image_uri),
      description: typeof c.description === 'string' ? c.description.slice(0, 1000) : undefined,
      website: cleanUrl(c.website),
      twitter: cleanUrl(c.twitter),
      telegram: cleanUrl(c.telegram),
      launchpad: 'pump.fun',
      creator: c.creator,
      createdAt: toDate(c.created_timestamp),
    },
    snap: { mcap: num(c.usd_market_cap) },
    source: 'pumpfun',
    list: { name: list, rank },
  };
}

async function coins(query: string, list: string): Promise<Observation[]> {
  const rows = await fetchJson<Coin[]>(`${BASE}${query}`);
  return (Array.isArray(rows) ? rows : []).filter((c) => c?.mint).map((c, i) => mapCoin(c, list, i + 1));
}

/** Coins still on the bonding curve, by market cap: the graduation race. */
export const pumpCurveLeaders = () => coins('/coins?offset=0&limit=50&sort=market_cap&order=DESC&includeNsfw=false&complete=false', 'pump:curve-leaders');
/** Coins currently livestreaming. */
export const pumpLive = () => coins('/coins/currently-live?limit=50&offset=0&includeNsfw=false', 'pump:live');
/** Most recently traded coins. */
export const pumpActive = () => coins('/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false', 'pump:active');

/** Full pump.fun record for one mint (description, ATH). */
export async function pumpCoin(mint: string): Promise<Coin | null> {
  try {
    return await fetchJson<Coin>(`${BASE}/coins/${mint}`);
  } catch {
    return null;
  }
}
