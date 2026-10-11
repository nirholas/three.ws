// Dashboard API and static host. Read-only over the archive, plus live
// firehose stats from the running stream. The built dashboard in dist/web is
// served from the same port.
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from '../lib/env.ts';
import { assetDir } from '../lib/paths.ts';
import { logger } from '../lib/log.ts';
import { db } from '../db/client.ts';
import type { SolanaStream } from '../collector/solana-stream.ts';
import { prices } from '../collector/scheduler.ts';
import { geckoOhlcv } from '../sources/geckoterminal.ts';
import { pumpCoin } from '../sources/pumpfun.ts';
import { STATUS_RULES } from '../intel/status.ts';
import { buildDailyData } from '../report/data.ts';

const log = logger('server');

const SORTS: Record<string, string> = {
  mcap: 'last_mcap desc nulls last',
  volume: 'last_volume_24h desc nulls last',
  change: 'last_change_24h desc nulls last',
  new: 'first_seen desc',
  tech: 'tech_score desc, last_volume_24h desc nulls last',
  holders: 'last_holders desc nulls last',
  ath: 'ath_mcap desc nulls last',
};

const TOKEN_COLS = `chain, address, symbol, name, image, category, tech_score, status, launchpad, last_price, last_mcap, last_liquidity, last_volume_24h, last_holders, last_change_24h, ath_mcap, ath_at, first_mcap, first_seen, created_at, graduated_at, died_at, status_changed_at`;

const clampInt = (v: string | undefined, def: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) && v ? Math.floor(Number(v)) : def));

export function createApp(deps: { stream: SolanaStream | null }): Hono {
  const app = new Hono();
  app.use('/api/*', cors());
  app.onError((err, c) => {
    log.error(`${c.req.method} ${c.req.path}: ${err.message}`);
    return c.json({ error: 'internal error', detail: err.message }, 500);
  });

  app.get('/api/health', async (c) => {
    const d = await db();
    const [last] = await d.query<{ value: { at: string } }>(`select value from kv where key = 'collector:last-cycle'`);
    return c.json({ ok: true, db: d.kind, lastCycle: last?.value?.at ?? null, stream: deps.stream?.stats() ?? null, prices });
  });

  app.get('/api/overview', async (c) => {
    const d = await db();
    const markets = await d.query(`select distinct on (chain) * from market_snapshots order by chain, ts desc`);
    const series = await d.query(
      `select ts, chain, total_mcap, total_volume_24h, launches_1h, graduations_1h, stream_trades_1h, stream_volume_1h, native_usd from market_snapshots where ts >= now() - interval '7 days' order by ts`);
    const status = await d.query(`select chain, status, count(*)::int as tokens, coalesce(sum(last_mcap), 0) as mcap from tokens group by chain, status`);
    const categories = await d.query(
      `select category, count(*)::int as tokens, coalesce(sum(last_volume_24h), 0) as volume_24h, coalesce(sum(last_mcap), 0) as mcap, avg(last_change_24h) as avg_change_24h
         from tokens where last_snapshot_at >= now() - interval '2 hours' and last_mcap >= 25000 and last_mcap < 1000000000 group by category order by volume_24h desc`);
    const launches = await d.query(
      `select date_trunc('hour', ts) as hour, chain, count(*) filter (where kind = 'launch')::int as launches, count(*) filter (where kind = 'graduation')::int as graduations
         from launch_events where ts >= now() - interval '48 hours' group by 1, 2 order by 1`);
    return c.json({ markets, series, status, categories, launches, hot: deps.stream?.hot(20) ?? [], stream: deps.stream?.stats() ?? null, prices, rules: STATUS_RULES });
  });

  app.get('/api/tokens', async (c) => {
    const q = c.req.query();
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.chain) add('chain = ?', q.chain);
    if (q.status) add('status = ?', q.status);
    if (q.category) add('category = ?', q.category);
    if (q.launchpad) add('launchpad = ?', q.launchpad);
    if (q.tech === '1') where.push(`tech_score >= 0.6 and category not in ('meme', 'animal', 'culture', 'politics', 'celebrity', 'unclassified')`);
    if (q.minMcap) add('last_mcap >= ?', Number(q.minMcap) || 0);
    if (q.minVolume) add('last_volume_24h >= ?', Number(q.minVolume) || 0);
    if (q.q) {
      params.push(`%${q.q.toLowerCase()}%`);
      where.push(`(lower(symbol) like $${params.length} or lower(name) like $${params.length} or lower(address) like $${params.length})`);
    }
    const order = SORTS[q.sort ?? 'volume'] ?? SORTS.volume!;
    const limit = clampInt(q.limit, 50, 1, 200);
    const offset = clampInt(q.offset, 0, 0, 100_000);
    const sql = `select ${TOKEN_COLS} from tokens ${where.length ? `where ${where.join(' and ')}` : ''} order by ${order} limit ${limit} offset ${offset}`;
    const d = await db();
    const rows = await d.query(sql, params);
    const [total] = await d.query<{ n: number }>(`select count(*)::int as n from tokens ${where.length ? `where ${where.join(' and ')}` : ''}`, params);
    return c.json({ total: total?.n ?? 0, rows });
  });

  app.get('/api/tokens/:chain/:address', async (c) => {
    const { chain, address } = c.req.param();
    const d = await db();
    const [token] = await d.query(`select * from tokens where chain = $1 and address = $2`, [chain, address]);
    if (!token) return c.json({ error: 'token not found' }, 404);
    const [pairs, snapshots, lists, events, whales, holders] = await Promise.all([
      d.query(`select * from pairs where chain = $1 and token_address = $2 order by created_at desc nulls last`, [chain, address]),
      d.query(`select ts, price_usd, mcap, liquidity, vol_1h, vol_24h, holders, buys_24h, sells_24h, traders_24h, organic_score, top_holders_pct from token_snapshots where chain = $1 and address = $2 order by ts desc limit 1500`, [chain, address]),
      d.query(`select list, min(rank)::int as best_rank, count(*)::int as appearances, min(ts) as first_ts, max(ts) as last_ts from list_appearances where chain = $1 and address = $2 group by list order by appearances desc`, [chain, address]),
      d.query(`select ts, kind, launchpad, actor, tx from launch_events where chain = $1 and token = $2 order by ts`, [chain, address]),
      d.query(
        `select t.ts, t.wallet, t.side, t.quote_amount, t.mcap_usd, t.reason, w.label, w.kind from trades t left join wallets w on w.chain = t.chain and w.address = t.wallet
          where t.chain = $1 and t.token = $2 order by t.ts desc limit 100`, [chain, address]),
      d.query(`select p.wallet, p.first_buy_at, p.first_buy_mcap_usd, p.bought_quote, p.sold_quote, w.label, w.kind from wallet_positions p left join wallets w on w.chain = p.chain and w.address = p.wallet where p.chain = $1 and p.token = $2 order by p.bought_quote desc limit 25`, [chain, address]),
    ]);
    return c.json({ token, pairs, snapshots: snapshots.reverse(), lists, events, trades: whales, positions: holders, heat: chain === 'solana' ? deps.stream?.heatFor(address) ?? null : null });
  });

  app.get('/api/tokens/:chain/:address/candles', async (c) => {
    const { chain, address } = c.req.param();
    const tf = (c.req.query('tf') ?? '15m') as '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    const map = { '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1] } as const;
    const [unit, agg] = map[tf] ?? map['15m'];
    const d = await db();
    const [pair] = await d.query<{ address: string }>(
      `select p.address from pairs p join tokens t on t.chain = p.chain and t.address = p.token_address where p.chain = $1 and p.token_address = $2 order by p.created_at desc nulls last limit 1`, [chain, address]);
    if (!pair) return c.json({ candles: [], source: 'none' });
    const network = chain === 'solana' ? 'solana' : 'robinhood';
    try {
      return c.json({ candles: await geckoOhlcv(network, pair.address, unit, agg, 300), source: 'geckoterminal', pool: pair.address });
    } catch (err) {
      return c.json({ candles: [], source: 'unavailable', error: (err as Error).message });
    }
  });

  app.get('/api/pump/:mint', async (c) => c.json((await pumpCoin(c.req.param('mint'))) ?? { error: 'not found' }));

  app.get('/api/launches', async (c) => {
    const limit = clampInt(c.req.query('limit'), 100, 1, 500);
    const rows = await (await db()).query(
      `select e.ts, e.chain, e.kind, e.token, e.launchpad, e.actor, e.name, e.symbol, t.last_mcap, t.last_volume_24h, t.status
         from launch_events e left join tokens t on t.chain = e.chain and t.address = e.token
        where ($1::text is null or e.chain = $1) and ($2::text is null or e.kind = $2) order by e.ts desc limit ${limit}`,
      [c.req.query('chain') ?? null, c.req.query('kind') ?? null]);
    return c.json({ rows });
  });

  app.get('/api/wallets', async (c) => {
    const kind = c.req.query('kind') ?? null;
    const rows = await (await db()).query(
      `select w.chain, w.address, w.label, w.kind, w.source, w.twitter, s.score, s.win_rate, s.tokens_traded, s.early_hits, s.best_multiple, s.pnl_usd,
              (select count(*)::int from trades t where t.chain = w.chain and t.wallet = w.address and t.ts >= now() - interval '24 hours') as trades_24h
         from wallets w left join wallet_scores s on s.chain = w.chain and s.wallet = w.address where ($1::text is null or w.kind = $1)
        order by s.score desc nulls last, trades_24h desc limit 200`, [kind]);
    return c.json({ rows });
  });

  app.get('/api/wallets/:address', async (c) => {
    const address = c.req.param('address');
    const d = await db();
    const [wallet] = await d.query(`select w.*, s.score, s.win_rate, s.tokens_traded, s.early_hits, s.best_multiple, s.pnl_usd from wallets w left join wallet_scores s on s.chain = w.chain and s.wallet = w.address where w.address = $1`, [address]);
    const positions = await d.query(
      `select p.*, t.symbol, t.last_mcap, t.status from wallet_positions p left join tokens t on t.chain = p.chain and t.address = p.token where p.wallet = $1 order by p.last_trade_at desc limit 100`, [address]);
    const trades = await d.query(`select t.*, k.symbol from trades t left join tokens k on k.chain = t.chain and k.address = t.token where t.wallet = $1 order by t.ts desc limit 100`, [address]);
    return c.json({ wallet: wallet ?? null, positions, trades });
  });

  app.get('/api/reports', async (c) => c.json({ rows: await (await db()).query(`select day, generated_at, telegram is not null as sent from daily_reports order by day desc limit 120`) }));
  app.get('/api/reports/:day', async (c) => {
    const [row] = await (await db()).query(`select day, generated_at, data, markdown, html, telegram from daily_reports where day = $1`, [c.req.param('day')]);
    return row ? c.json(row) : c.json({ error: 'no report for that day' }, 404);
  });
  app.get('/api/reports/:day/live', async (c) => c.json(await buildDailyData(c.req.param('day'))));

  app.get('/api/export/:table', async (c) => {
    const allowed = ['tokens', 'token_snapshots', 'trades', 'launch_events', 'wallets', 'wallet_scores', 'wallet_positions', 'market_snapshots', 'list_appearances'];
    const table = c.req.param('table');
    if (!allowed.includes(table)) return c.json({ error: `table must be one of ${allowed.join(', ')}` }, 400);
    const limit = clampInt(c.req.query('limit'), 10_000, 1, 100_000);
    return c.json({ table, rows: await (await db()).query(`select * from ${table} limit ${limit}`) });
  });

  const webDir = assetDir('web', 'dist/web');
  if (existsSync(webDir)) {
    const rel = relative(process.cwd(), webDir) || '.';
    app.use('/*', serveStatic({ root: rel }));
    app.get('*', serveStatic({ path: join(rel, 'index.html') }));
  } else {
    app.get('/', (c) => c.text('Pulse API is running. Build the dashboard with `npm run build`, or run `npm run dev` for the live dev server.'));
  }
  return app;
}

export function startServer(deps: { stream: SolanaStream | null }) {
  const app = createApp(deps);
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => log.info(`dashboard on http://localhost:${info.port}`));
  return server;
}
