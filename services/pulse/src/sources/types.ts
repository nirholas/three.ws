// Normalized shapes every source maps into. Fields a source cannot see are
// left undefined so merging never overwrites real data with a blank.
export type Chain = 'solana' | 'robinhood';

export type TokenMeta = {
  chain: Chain;
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  image?: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  launchpad?: string;
  creator?: string;
  createdAt?: Date;
  graduatedAt?: Date;
  tags?: string[];
  verified?: boolean;
};

export type Snapshot = {
  priceUsd?: number | null;
  mcap?: number | null;
  fdv?: number | null;
  liquidity?: number | null;
  vol5m?: number | null;
  vol1h?: number | null;
  vol6h?: number | null;
  vol24h?: number | null;
  buyVol24h?: number | null;
  sellVol24h?: number | null;
  organicVol24h?: number | null;
  buys1h?: number | null;
  sells1h?: number | null;
  buys24h?: number | null;
  sells24h?: number | null;
  traders1h?: number | null;
  traders24h?: number | null;
  netBuyers24h?: number | null;
  holders?: number | null;
  holderChange24h?: number | null;
  topHoldersPct?: number | null;
  organicScore?: number | null;
  chg5m?: number | null;
  chg1h?: number | null;
  chg6h?: number | null;
  chg24h?: number | null;
};

export type Pair = {
  chain: Chain;
  address: string;
  tokenAddress: string;
  dex?: string;
  quoteSymbol?: string;
  labels?: string[];
  createdAt?: Date;
  url?: string;
};

export type Observation = {
  meta: TokenMeta;
  snap?: Snapshot;
  source: string;
  pairs?: Pair[];
  /** Discovery list this observation came from, with rank, when it came from a ranked list. */
  list?: { name: string; rank: number };
};

export type LaunchEvent = {
  ts: Date;
  chain: Chain;
  kind: 'launch' | 'graduation' | 'pool';
  token: string;
  launchpad?: string;
  actor?: string;
  tx?: string;
  name?: string;
  symbol?: string;
  data?: Record<string, unknown>;
};

export function toDate(v: unknown): Date | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function cleanUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return /^https?:\/\//i.test(s) && s.length < 500 ? s : undefined;
}
