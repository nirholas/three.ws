// Wallet intelligence: import public KOL and smart-money labels, score every
// wallet we have positions for, and promote wallets that keep buying early
// into winners to the smart-money set.
import { db, insertMany } from '../db/client.ts';
import { logger } from '../lib/log.ts';
import { kolQuestWallets, kolscanLeaderboard, type WalletLabel } from '../sources/wallets.ts';

const log = logger('wallets');

export async function importWallets(): Promise<{ kol: number; smart: number }> {
  const results = await Promise.allSettled([kolscanLeaderboard(), kolQuestWallets()]);
  const labels: WalletLabel[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') labels.push(...r.value);
    else log.warn(`wallet source failed: ${(r.reason as Error).message}`);
  }
  if (!labels.length) return { kol: 0, smart: 0 };
  const seen = new Map<string, WalletLabel>();
  for (const l of labels) {
    const prev = seen.get(l.address);
    // A KOL label beats a generic smart-money tag for the same address.
    if (!prev || (prev.kind !== 'kol' && l.kind === 'kol')) seen.set(l.address, l);
  }
  await insertMany(
    'wallets',
    ['chain', 'address', 'label', 'kind', 'source', 'twitter', 'telegram', 'meta', 'updated_at'],
    [...seen.values()].map((l) => [l.chain, l.address, l.label ?? null, l.kind, l.source, l.twitter ?? null, l.telegram ?? null, JSON.stringify(l.meta ?? {}), new Date()]),
    `on conflict (chain, address) do update set
       label = coalesce(excluded.label, wallets.label),
       kind = case when wallets.kind = 'kol' then wallets.kind else excluded.kind end,
       source = excluded.source, twitter = coalesce(excluded.twitter, wallets.twitter), telegram = coalesce(excluded.telegram, wallets.telegram),
       meta = wallets.meta || excluded.meta, updated_at = excluded.updated_at`,
  );
  const kol = [...seen.values()].filter((l) => l.kind === 'kol').length;
  log.info(`imported ${seen.size} wallets (${kol} KOLs)`);
  return { kol, smart: seen.size - kol };
}

/**
 * Score wallets from their positions over the last `windowDays`. PnL is in
 * SOL: realized from sells, unrealized from what is still held at the
 * token's last price. Early hits are buys under $50k mcap on tokens that
 * went on to a $500k+ ATH.
 */
export async function scoreWallets(solUsd: number, windowDays = 30): Promise<number> {
  const d = await db();
  const rows = await d.query<{ wallet: string }>(
    `with pos as (
       select p.wallet, p.token, p.first_buy_at, p.first_buy_mcap_usd, p.bought_quote, p.sold_quote, p.bought_tokens, p.sold_tokens,
              t.last_price, t.ath_mcap,
              greatest(p.bought_tokens - p.sold_tokens, 0) * coalesce(t.last_price, 0) / nullif($1::double precision, 0) as unrealized
         from wallet_positions p
         left join tokens t on t.chain = p.chain and t.address = p.token
        where p.chain = 'solana' and p.last_trade_at >= now() - ($2::int * interval '1 day')
     ),
     agg as (
       select wallet,
              count(*)::int as tokens_traded,
              count(*) filter (where sold_quote + coalesce(unrealized, 0) > bought_quote)::int as wins,
              sum(bought_quote) as invested, sum(sold_quote) as realized, sum(coalesce(unrealized, 0)) as unrealized,
              count(*) filter (where first_buy_mcap_usd is not null and first_buy_mcap_usd < 50000 and ath_mcap >= 500000)::int as early_hits,
              max(case when first_buy_mcap_usd > 0 then ath_mcap / first_buy_mcap_usd end) as best_multiple
         from pos group by wallet
     )
     insert into wallet_scores (chain, wallet, computed_at, window_days, tokens_traded, wins, win_rate, invested_quote, realized_quote, unrealized_quote, pnl_quote, pnl_usd, early_hits, best_multiple, score)
     select 'solana', wallet, now(), $2, tokens_traded, wins,
            case when tokens_traded > 0 then wins::real / tokens_traded else 0 end,
            invested, realized, unrealized, realized + unrealized - invested, (realized + unrealized - invested) * $1,
            early_hits, best_multiple,
            (case when tokens_traded > 0 then wins::real / tokens_traded else 0 end) * 40
              + log(1 + greatest(realized + unrealized - invested, 0)) * 15
              + least(early_hits, 10) * 5
              + least(tokens_traded, 20)
       from agg
     on conflict (chain, wallet) do update set
       computed_at = excluded.computed_at, window_days = excluded.window_days, tokens_traded = excluded.tokens_traded, wins = excluded.wins,
       win_rate = excluded.win_rate, invested_quote = excluded.invested_quote, realized_quote = excluded.realized_quote,
       unrealized_quote = excluded.unrealized_quote, pnl_quote = excluded.pnl_quote, pnl_usd = excluded.pnl_usd,
       early_hits = excluded.early_hits, best_multiple = excluded.best_multiple, score = excluded.score
     returning wallet`,
    [solUsd || 0, windowDays],
  );
  const promoted = await d.query<{ wallet: string }>(
    `insert into wallets (chain, address, kind, source, meta)
     select 'solana', s.wallet, 'smart', 'pulse:discovered', jsonb_build_object('early_hits', s.early_hits, 'score', s.score, 'promoted_at', now())
       from wallet_scores s
      where s.early_hits >= 3 and s.win_rate >= 0.5
     on conflict (chain, address) do nothing
     returning address as wallet`,
  );
  if (promoted.length) log.info(`promoted ${promoted.length} wallets to smart money`);
  return rows.length;
}
