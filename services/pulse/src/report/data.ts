// Builds the data behind one daily issue. Everything is a query over the
// archive, so an old day can be rebuilt exactly as long as its rows exist.
import { db } from '../db/client.ts';
import type { Chain } from '../sources/types.ts';

export type TokenRow = {
  chain: Chain; address: string; symbol: string | null; name: string | null; category: string; tech_score: number; status: string;
  mcap: number | null; ath_mcap: number | null; volume_24h: number | null; liquidity: number | null; holders: number | null;
  change_24h: number | null; launchpad: string | null; age_hours: number | null; first_mcap: number | null; multiple: number | null;
};
export type WalletRow = { address: string; label: string | null; kind: string; twitter: string | null; trades: number; buy_sol: number; sell_sol: number; tokens: number; score: number | null; win_rate: number | null; pnl_usd: number | null };
export type KolToken = { token: string; symbol: string | null; chain: Chain; wallets: number; buy_sol: number; sell_sol: number; mcap: number | null };
export type MarketRow = { chain: Chain; native_usd: number | null; total_mcap: number; total_volume_24h: number; tracked_tokens: number; launches_24h: number; graduations_24h: number; mcap_change_pct: number | null; volume_change_pct: number | null };
export type CategoryRow = { category: string; tokens: number; volume_24h: number; mcap: number; avg_change_24h: number | null };

export type DailyData = {
  day: string;
  generatedAt: string;
  windowHours: number;
  markets: MarketRow[];
  launches: { chain: Chain; launchpad: string | null; launches: number; graduations: number }[];
  runners: TokenRow[];
  newRunners: TokenRow[];
  techPicks: TokenRow[];
  dying: (TokenRow & { drawdown_pct: number | null })[];
  dead: (TokenRow & { drawdown_pct: number | null })[];
  topVolume: TokenRow[];
  holdersGrowth: TokenRow[];
  persistent: (TokenRow & { appearances: number; lists: number })[];
  promoted: TokenRow[];
  categories: CategoryRow[];
  kolWallets: WalletRow[];
  smartWallets: WalletRow[];
  kolTokens: KolToken[];
  smartTokens: KolToken[];
  robinhood: TokenRow[];
  stats: { tokensSeen24h: number; snapshots24h: number; tradesRecorded24h: number; walletsTracked: number; archiveTokens: number; archiveSnapshots: number };
};

const TOKEN_SELECT = `t.chain, t.address, t.symbol, t.name, t.category, t.tech_score, t.status,
  t.last_mcap as mcap, t.ath_mcap, t.last_volume_24h as volume_24h, t.last_liquidity as liquidity, t.last_holders as holders,
  t.last_change_24h as change_24h, t.launchpad,
  extract(epoch from (now() - coalesce(t.created_at, t.first_seen))) / 3600 as age_hours,
  t.first_mcap, case when t.first_mcap > 0 then t.ath_mcap / t.first_mcap end as multiple`;

async function tokens(where: string, order: string, limit: number, params: unknown[] = []): Promise<TokenRow[]> {
  return (await db()).query<TokenRow>(`select ${TOKEN_SELECT} from tokens t where ${where} order by ${order} limit ${limit}`, params);
}

export async function buildDailyData(day: string): Promise<DailyData> {
  const d = await db();
  const markets: MarketRow[] = [];
  for (const chain of ['solana', 'robinhood'] as Chain[]) {
    const [now] = await d.query<{ native_usd: number | null; total_mcap: number; total_volume_24h: number; tracked_tokens: number }>(
      `select native_usd, total_mcap, total_volume_24h, tracked_tokens from market_snapshots where chain = $1 order by ts desc limit 1`, [chain]);
    const [prev] = await d.query<{ total_mcap: number; total_volume_24h: number }>(
      `select total_mcap, total_volume_24h from market_snapshots where chain = $1 and ts <= now() - interval '24 hours' order by ts desc limit 1`, [chain]);
    const [ev] = await d.query<{ launches: number; grads: number }>(
      `select count(*) filter (where kind = 'launch')::int as launches, count(*) filter (where kind = 'graduation')::int as grads from launch_events where chain = $1 and ts >= now() - interval '24 hours'`, [chain]);
    const pct = (a: number | undefined, b: number | undefined) => (a && b ? ((a - b) / b) * 100 : null);
    markets.push({
      chain, native_usd: now?.native_usd ?? null, total_mcap: now?.total_mcap ?? 0, total_volume_24h: now?.total_volume_24h ?? 0, tracked_tokens: now?.tracked_tokens ?? 0,
      launches_24h: ev?.launches ?? 0, graduations_24h: ev?.grads ?? 0, mcap_change_pct: pct(now?.total_mcap, prev?.total_mcap), volume_change_pct: pct(now?.total_volume_24h, prev?.total_volume_24h),
    });
  }

  const launches = await d.query<DailyData['launches'][number]>(
    `select chain, launchpad, count(*) filter (where kind = 'launch')::int as launches, count(*) filter (where kind = 'graduation')::int as graduations
       from launch_events where ts >= now() - interval '24 hours' and kind in ('launch', 'graduation') group by chain, launchpad order by launches desc`);

  const liquid = `t.last_mcap >= 50000 and t.last_mcap < 1000000000 and coalesce(t.last_liquidity, 0) >= 5000 and not (t.tags && array['stablecoin', 'lst', 'equities', 'xstocks', 'wrapped'])`;
  const runners = await tokens(`${liquid} and t.last_change_24h > 0 and coalesce(t.last_volume_24h, 0) >= 50000 and t.status in ('running', 'graduated', 'new')`, 't.last_change_24h desc', 15);
  const newRunners = await tokens(`${liquid} and coalesce(t.created_at, t.first_seen) >= now() - interval '48 hours' and coalesce(t.last_volume_24h, 0) >= 25000`, 't.last_mcap desc', 12);
  const techPicks = await tokens(`${liquid} and coalesce(t.created_at, t.first_seen) >= now() - interval '120 days' and t.tech_score >= 0.6 and t.category not in ('meme', 'animal', 'culture', 'politics', 'celebrity', 'unclassified') and coalesce(t.last_volume_24h, 0) >= 10000`, 't.tech_score desc, t.last_volume_24h desc', 12);
  const topVolume = await tokens(`t.last_volume_24h is not null and t.last_snapshot_at >= now() - interval '2 hours' and t.last_mcap < 1000000000 and not (t.tags && array['stablecoin', 'lst', 'equities', 'xstocks', 'wrapped'])`, 't.last_volume_24h desc', 15);
  const holdersGrowth = await d.query<TokenRow>(
    `select ${TOKEN_SELECT} from tokens t join lateral (
       select (select holders from token_snapshots s where s.chain = t.chain and s.address = t.address and s.holders is not null order by ts desc limit 1) as h_now,
              (select holders from token_snapshots s where s.chain = t.chain and s.address = t.address and s.holders is not null and ts <= now() - interval '20 hours' order by ts desc limit 1) as h_prev
     ) h on true where h.h_now > 100 and h.h_prev > 0 and h.h_now > h.h_prev order by (h.h_now::float / h.h_prev) desc limit 10`);

  const deathSelect = `, case when t.ath_mcap > 0 then (1 - t.last_mcap / t.ath_mcap) * 100 end as drawdown_pct`;
  const dying = await d.query<DailyData['dying'][number]>(
    `select ${TOKEN_SELECT}${deathSelect} from tokens t where t.status = 'dying' and t.status_changed_at >= now() - interval '24 hours' order by t.ath_mcap desc limit 12`);
  const dead = await d.query<DailyData['dead'][number]>(
    `select ${TOKEN_SELECT}${deathSelect} from tokens t where t.status = 'dead' and t.died_at >= now() - interval '24 hours' order by t.ath_mcap desc limit 12`);

  const persistent = await d.query<DailyData['persistent'][number]>(
    `select ${TOKEN_SELECT}, a.appearances::int, a.lists::int from tokens t join (
       select chain, address, count(*) as appearances, count(distinct list) as lists from list_appearances where ts >= now() - interval '24 hours' group by chain, address
     ) a on a.chain = t.chain and a.address = t.address where t.last_mcap >= 50000 and t.last_mcap < 1000000000 and not (t.tags && array['stablecoin', 'lst', 'equities', 'xstocks', 'wrapped']) order by a.lists desc, a.appearances desc limit 12`);

  const promoted = await d.query<TokenRow>(
    `select ${TOKEN_SELECT} from tokens t join (select distinct chain, address from list_appearances where list like 'dex:boosts%' and ts >= now() - interval '24 hours') a
       on a.chain = t.chain and a.address = t.address order by t.last_volume_24h desc nulls last limit 10`);

  const categories = await d.query<CategoryRow>(
    `select category, count(*)::int as tokens, coalesce(sum(last_volume_24h), 0) as volume_24h, coalesce(sum(last_mcap), 0) as mcap, avg(last_change_24h) as avg_change_24h
       from tokens where last_snapshot_at >= now() - interval '2 hours' and last_mcap >= 25000 and last_mcap < 1000000000 and not (tags && array['stablecoin', 'lst', 'equities', 'xstocks', 'wrapped']) group by category order by volume_24h desc`);

  const walletSelect = (kind: string) => `
    select w.address, w.label, w.kind, w.twitter, count(t.*)::int as trades,
           coalesce(sum(t.quote_amount) filter (where t.side = 'buy'), 0) as buy_sol, coalesce(sum(t.quote_amount) filter (where t.side = 'sell'), 0) as sell_sol,
           count(distinct t.token)::int as tokens, s.score, s.win_rate, s.pnl_usd
      from wallets w left join trades t on t.chain = w.chain and t.wallet = w.address and t.ts >= now() - interval '24 hours'
      left join wallet_scores s on s.chain = w.chain and s.wallet = w.address
     where w.kind = '${kind}' group by w.address, w.label, w.kind, w.twitter, s.score, s.win_rate, s.pnl_usd
    having count(t.*) > 0 order by coalesce(sum(t.quote_amount), 0) desc limit 15`;
  const kolWallets = await d.query<WalletRow>(walletSelect('kol'));
  const smartWallets = await d.query<WalletRow>(walletSelect('smart'));
  const walletTokens = (kind: string) => d.query<KolToken>(
    `select t.token, k.symbol, t.chain, count(distinct t.wallet)::int as wallets,
            coalesce(sum(t.quote_amount) filter (where t.side = 'buy'), 0) as buy_sol, coalesce(sum(t.quote_amount) filter (where t.side = 'sell'), 0) as sell_sol, k.last_mcap as mcap
       from trades t join wallets w on w.chain = t.chain and w.address = t.wallet and w.kind = '${kind}'
       left join tokens k on k.chain = t.chain and k.address = t.token where t.ts >= now() - interval '24 hours'
      group by t.token, k.symbol, t.chain, k.last_mcap order by wallets desc, buy_sol desc limit 12`);
  const kolTokens = await walletTokens('kol');
  const smartTokens = await walletTokens('smart');

  const robinhood = await tokens(`t.chain = 'robinhood' and t.last_mcap is not null`, 't.last_volume_24h desc nulls last', 12);

  const [counts] = await d.query<DailyData['stats'] & { tokens_seen: number }>(
    `select (select count(*) from tokens where last_seen >= now() - interval '24 hours')::int as "tokensSeen24h",
            (select count(*) from token_snapshots where ts >= now() - interval '24 hours')::int as "snapshots24h",
            (select count(*) from trades where ts >= now() - interval '24 hours')::int as "tradesRecorded24h",
            (select count(*) from wallets)::int as "walletsTracked",
            (select count(*) from tokens)::int as "archiveTokens",
            (select count(*) from token_snapshots)::int as "archiveSnapshots"`);

  return {
    day, generatedAt: new Date().toISOString(), windowHours: 24, markets, launches, runners, newRunners, techPicks, dying, dead, topVolume, holdersGrowth, persistent, promoted, categories,
    kolWallets, smartWallets, kolTokens, smartTokens, robinhood,
    stats: { tokensSeen24h: counts!.tokensSeen24h, snapshots24h: counts!.snapshots24h, tradesRecorded24h: counts!.tradesRecorded24h, walletsTracked: counts!.walletsTracked, archiveTokens: counts!.archiveTokens, archiveSnapshots: counts!.archiveSnapshots },
  };
}
