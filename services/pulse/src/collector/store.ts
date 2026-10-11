// Persistence for observations: merge every source's view of a token into
// one row, append a snapshot, record which list surfaced it, keep its pools.
import { db, insertMany } from '../db/client.ts';
import type { Chain, LaunchEvent, Observation, Snapshot, TokenMeta } from '../sources/types.ts';

/** Fold many observations of the same token into one, later sources filling gaps left by earlier ones. */
export function mergeObservations(list: Observation[]): Map<string, Observation> {
  const merged = new Map<string, Observation>();
  for (const o of list) {
    const key = `${o.meta.chain}:${o.meta.address}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...o, meta: { ...o.meta }, snap: o.snap ? { ...o.snap } : undefined, pairs: o.pairs ? [...o.pairs] : undefined, lists: o.list ? [o.list] : [] } as Observation & { lists: { name: string; rank: number }[] });
      continue;
    }
    const target = prev as Observation & { lists: { name: string; rank: number }[] };
    for (const [k, v] of Object.entries(o.meta) as [keyof TokenMeta, unknown][]) {
      if (v !== undefined && v !== null && target.meta[k] === undefined) (target.meta as Record<string, unknown>)[k] = v;
    }
    if (o.snap) {
      target.snap ??= {};
      for (const [k, v] of Object.entries(o.snap) as [keyof Snapshot, number | null | undefined][]) {
        if (v !== undefined && v !== null && (target.snap[k] === undefined || target.snap[k] === null)) target.snap[k] = v;
      }
    }
    if (o.pairs?.length) target.pairs = [...(target.pairs ?? []), ...o.pairs];
    if (o.list) target.lists.push(o.list);
    if (o.source && !target.source.includes(o.source)) target.source = `${target.source}+${o.source}`;
  }
  return merged;
}

const TOKEN_META_COLS = ['symbol', 'name', 'decimals', 'image', 'description', 'website', 'twitter', 'telegram', 'launchpad', 'creator', 'created_at', 'graduated_at', 'tags', 'verified'] as const;

export async function upsertTokens(observations: Observation[], ts: Date): Promise<number> {
  const merged = mergeObservations(observations);
  if (!merged.size) return 0;
  const d = await db();
  const tokenRows: unknown[][] = [];
  const snapRows: unknown[][] = [];
  const listRows: unknown[][] = [];
  const pairRows: unknown[][] = [];
  for (const o of merged.values()) {
    const m = o.meta;
    const s = o.snap ?? {};
    tokenRows.push([
      m.chain, m.address, m.symbol ?? null, m.name ?? null, m.decimals ?? null, m.image ?? null, m.description ?? null, m.website ?? null, m.twitter ?? null, m.telegram ?? null,
      m.launchpad ?? null, m.creator ?? null, m.createdAt ?? null, m.graduatedAt ?? null, m.tags ?? [], m.verified ?? null,
      ts, s.priceUsd ?? null, s.mcap ?? null, s.liquidity ?? null, s.vol24h ?? null, s.holders ?? null, s.chg24h ?? null, o.snap ? ts : null,
    ]);
    if (o.snap) {
      snapRows.push([
        ts, m.chain, m.address, s.priceUsd ?? null, s.mcap ?? null, s.fdv ?? null, s.liquidity ?? null, s.vol5m ?? null, s.vol1h ?? null, s.vol6h ?? null, s.vol24h ?? null,
        s.buyVol24h ?? null, s.sellVol24h ?? null, s.organicVol24h ?? null, s.buys1h ?? null, s.sells1h ?? null, s.buys24h ?? null, s.sells24h ?? null, s.traders1h ?? null, s.traders24h ?? null,
        s.netBuyers24h ?? null, s.holders ?? null, s.holderChange24h ?? null, s.topHoldersPct ?? null, s.organicScore ?? null, s.chg5m ?? null, s.chg1h ?? null, s.chg6h ?? null, s.chg24h ?? null, o.source,
      ]);
    }
    for (const l of (o as Observation & { lists: { name: string; rank: number }[] }).lists) listRows.push([ts, m.chain, l.name, l.rank, m.address]);
    const seenPairs = new Set<string>();
    for (const p of o.pairs ?? []) {
      if (!p.address || seenPairs.has(p.address)) continue;
      seenPairs.add(p.address);
      pairRows.push([p.chain, p.address, p.tokenAddress, p.dex ?? null, p.quoteSymbol ?? null, p.labels ?? [], p.createdAt ?? null, p.url ?? null]);
    }
  }
  await insertMany(
    'tokens',
    ['chain', 'address', ...TOKEN_META_COLS, 'last_seen', 'last_price', 'last_mcap', 'last_liquidity', 'last_volume_24h', 'last_holders', 'last_change_24h', 'last_snapshot_at'],
    tokenRows,
    `on conflict (chain, address) do update set
      ${TOKEN_META_COLS.map((c) => (c === 'tags' ? `tags = case when cardinality(excluded.tags) > 0 then excluded.tags else tokens.tags end` : `${c} = coalesce(excluded.${c}, tokens.${c})`)).join(',\n      ')},
      last_seen = excluded.last_seen,
      last_price = coalesce(excluded.last_price, tokens.last_price),
      last_mcap = coalesce(excluded.last_mcap, tokens.last_mcap),
      last_liquidity = coalesce(excluded.last_liquidity, tokens.last_liquidity),
      last_volume_24h = coalesce(excluded.last_volume_24h, tokens.last_volume_24h),
      last_holders = coalesce(excluded.last_holders, tokens.last_holders),
      last_change_24h = coalesce(excluded.last_change_24h, tokens.last_change_24h),
      last_snapshot_at = coalesce(excluded.last_snapshot_at, tokens.last_snapshot_at),
      first_mcap = coalesce(tokens.first_mcap, excluded.last_mcap),
      ath_mcap = greatest(coalesce(tokens.ath_mcap, 0), coalesce(excluded.last_mcap, 0)),
      ath_at = case when coalesce(excluded.last_mcap, 0) > coalesce(tokens.ath_mcap, 0) then excluded.last_seen else tokens.ath_at end,
      peak_volume_24h = greatest(coalesce(tokens.peak_volume_24h, 0), coalesce(excluded.last_volume_24h, 0))`,
  );
  await insertMany(
    'token_snapshots',
    ['ts', 'chain', 'address', 'price_usd', 'mcap', 'fdv', 'liquidity', 'vol_5m', 'vol_1h', 'vol_6h', 'vol_24h', 'buy_vol_24h', 'sell_vol_24h', 'organic_vol_24h', 'buys_1h', 'sells_1h', 'buys_24h', 'sells_24h', 'traders_1h', 'traders_24h', 'net_buyers_24h', 'holders', 'holder_change_24h', 'top_holders_pct', 'organic_score', 'chg_5m', 'chg_1h', 'chg_6h', 'chg_24h', 'source'],
    snapRows,
    'on conflict do nothing',
  );
  await insertMany('list_appearances', ['ts', 'chain', 'list', 'rank', 'address'], listRows, 'on conflict do nothing');
  await insertMany(
    'pairs',
    ['chain', 'address', 'token_address', 'dex', 'quote_symbol', 'labels', 'created_at', 'url'],
    pairRows,
    'on conflict (chain, address) do update set dex = coalesce(excluded.dex, pairs.dex), quote_symbol = coalesce(excluded.quote_symbol, pairs.quote_symbol), labels = excluded.labels, created_at = coalesce(excluded.created_at, pairs.created_at), url = coalesce(excluded.url, pairs.url)',
  );
  void d;
  return merged.size;
}

export async function recordLaunchEvents(events: LaunchEvent[]): Promise<void> {
  if (!events.length) return;
  await insertMany(
    'launch_events',
    ['ts', 'chain', 'kind', 'token', 'launchpad', 'actor', 'tx', 'name', 'symbol', 'data'],
    events.map((e) => [e.ts, e.chain, e.kind, e.token, e.launchpad ?? null, e.actor ?? null, e.tx ?? null, e.name ?? null, e.symbol ?? null, JSON.stringify(e.data ?? {})]),
    'on conflict do nothing',
  );
  const d = await db();
  for (const e of events) {
    if (e.kind === 'launch') {
      await d.query(
        `insert into tokens (chain, address, symbol, name, launchpad, creator, created_at, first_seen, last_seen, status, status_changed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7, $7, 'new', $7)
         on conflict (chain, address) do update set
           symbol = coalesce(tokens.symbol, excluded.symbol), name = coalesce(tokens.name, excluded.name),
           launchpad = coalesce(tokens.launchpad, excluded.launchpad), creator = coalesce(tokens.creator, excluded.creator),
           created_at = coalesce(tokens.created_at, excluded.created_at)`,
        [e.chain, e.token, e.symbol ?? null, e.name ?? null, e.launchpad ?? null, e.actor ?? null, e.ts],
      );
    } else if (e.kind === 'graduation') {
      await d.query(
        `insert into tokens (chain, address, launchpad, first_seen, last_seen, graduated_at, status, status_changed_at)
         values ($1, $2, $3, $4, $4, $4, 'graduated', $4)
         on conflict (chain, address) do update set graduated_at = coalesce(tokens.graduated_at, excluded.graduated_at),
           status = case when tokens.status in ('new', 'curve') then 'graduated' else tokens.status end,
           status_changed_at = case when tokens.status in ('new', 'curve') then excluded.graduated_at else tokens.status_changed_at end`,
        [e.chain, e.token, e.launchpad ?? null, e.ts],
      );
    }
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const rows = await (await db()).query<{ value: T }>('select value from kv where key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).query('insert into kv (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, JSON.stringify(value)]);
}

export async function tokensNeedingRefresh(chain: Chain, limit: number): Promise<string[]> {
  const rows = await (await db()).query<{ address: string }>(
    `select address from tokens where chain = $1 and status not in ('dead')
       and (last_snapshot_at is null or last_snapshot_at < now() - interval '20 minutes')
     order by coalesce(last_volume_24h, 0) desc, first_seen desc limit $2`,
    [chain, limit],
  );
  return rows.map((r) => r.address);
}
