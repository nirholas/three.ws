// Jupiter Tokens API v2 (keyless lite tier). The richest free Solana token
// feed: price, mcap, liquidity, holder count and holder delta, organic volume
// split, trader counts per window, audit flags, launchpad and graduation.
import { chunk, fetchJson, num } from '../lib/http.ts';
import type { Observation, Snapshot, TokenMeta } from './types.ts';
import { cleanUrl, toDate } from './types.ts';

const BASE = 'https://lite-api.jup.ag/tokens/v2';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

type Stats = Record<string, number | undefined>;
type JupToken = Record<string, any> & { id: string };

export const JUP_LISTS = ['toptrending', 'toptraded', 'toporganicscore'] as const;
export const JUP_WINDOWS = ['5m', '1h', '6h', '24h'] as const;

function volume(s: Stats | undefined): number | null {
  if (!s) return null;
  const b = num(s.buyVolume) ?? 0;
  const v = num(s.sellVolume) ?? 0;
  return b + v || null;
}

export function mapJupToken(t: JupToken): { meta: TokenMeta; snap: Snapshot } {
  const s5 = t.stats5m as Stats | undefined;
  const s1 = t.stats1h as Stats | undefined;
  const s6 = t.stats6h as Stats | undefined;
  const s24 = t.stats24h as Stats | undefined;
  const meta: TokenMeta = {
    chain: 'solana',
    address: t.id,
    symbol: t.symbol,
    name: t.name,
    decimals: num(t.decimals) ?? undefined,
    image: cleanUrl(t.icon),
    website: cleanUrl(t.website),
    twitter: cleanUrl(t.twitter),
    telegram: cleanUrl(t.telegram),
    launchpad: t.launchpad || t.metaLaunchpad || undefined,
    creator: t.dev || undefined,
    createdAt: toDate(t.firstPool?.createdAt) ?? toDate(t.createdAt),
    graduatedAt: toDate(t.graduatedAt),
    tags: Array.isArray(t.tags) ? t.tags : undefined,
    verified: typeof t.isVerified === 'boolean' ? t.isVerified : undefined,
  };
  const snap: Snapshot = {
    priceUsd: num(t.usdPrice),
    mcap: num(t.mcap),
    fdv: num(t.fdv),
    liquidity: num(t.liquidity),
    vol5m: volume(s5),
    vol1h: volume(s1),
    vol6h: volume(s6),
    vol24h: volume(s24),
    buyVol24h: num(s24?.buyVolume),
    sellVol24h: num(s24?.sellVolume),
    organicVol24h: s24 ? (num(s24.buyOrganicVolume) ?? 0) + (num(s24.sellOrganicVolume) ?? 0) : null,
    buys1h: num(s1?.numBuys),
    sells1h: num(s1?.numSells),
    buys24h: num(s24?.numBuys),
    sells24h: num(s24?.numSells),
    traders1h: num(s1?.numTraders),
    traders24h: num(s24?.numTraders),
    netBuyers24h: num(s24?.numNetBuyers),
    holders: num(t.holderCount),
    holderChange24h: num(s24?.holderChange),
    topHoldersPct: num(t.audit?.topHoldersPercentage),
    organicScore: num(t.organicScore),
    chg5m: num(s5?.priceChange),
    chg1h: num(s1?.priceChange),
    chg6h: num(s6?.priceChange),
    chg24h: num(s24?.priceChange),
  };
  return { meta, snap };
}

export async function jupList(list: (typeof JUP_LISTS)[number], window: (typeof JUP_WINDOWS)[number], limit = 100): Promise<Observation[]> {
  const rows = await fetchJson<JupToken[]>(`${BASE}/${list}/${window}?limit=${limit}`);
  return rows.map((t, i) => ({ ...mapJupToken(t), source: 'jupiter', list: { name: `jup:${list}:${window}`, rank: i + 1 } }));
}

/** Newest tokens to get a first pool, any launchpad. */
export async function jupRecent(limit = 100): Promise<Observation[]> {
  const rows = await fetchJson<JupToken[]>(`${BASE}/recent?limit=${limit}`);
  return rows.map((t, i) => ({ ...mapJupToken(t), source: 'jupiter', list: { name: 'jup:recent', rank: i + 1 } }));
}

/** Full records for up to 100 mints per request. */
export async function jupLookup(mints: string[]): Promise<Observation[]> {
  const out: Observation[] = [];
  for (const group of chunk([...new Set(mints)], 100)) {
    const rows = await fetchJson<JupToken[]>(`${BASE}/search?query=${group.join(',')}`);
    for (const t of rows) if (group.includes(t.id)) out.push({ ...mapJupToken(t), source: 'jupiter' });
  }
  return out;
}

export async function solUsd(): Promise<number | null> {
  const rows = await fetchJson<JupToken[]>(`${BASE}/search?query=${SOL_MINT}`);
  return num(rows.find((t) => t.id === SOL_MINT)?.usdPrice);
}
