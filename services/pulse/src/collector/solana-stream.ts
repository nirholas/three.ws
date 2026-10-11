// Live Solana firehose: every pump.fun curve trade, PumpSwap trade, token
// create, graduation and pool creation, straight from logsSubscribe. Keeps
// rolling per-token heat in memory, persists launches, and persists trades
// selectively: labelled wallets, whales, and early buyers of tokens that go
// on to graduate or run, so the smart-money set grows from evidence.
import { config } from '../lib/env.ts';
import { logger } from '../lib/log.ts';
import { db, insertMany } from '../db/client.ts';
import type { LaunchEvent } from '../sources/types.ts';
import { PUMP_AMM_PROGRAM, PUMP_PROGRAM, decodeLogs, poolBaseMint, type PumpEvent } from './pump-decode.ts';
import { recordLaunchEvents } from './store.ts';

const log = logger('solana-stream');

export const WHALE_SOL = 5;
const EARLY_BUYERS_PER_MINT = 40;
const EARLY_MINTS_MAX = 6000;
const BUCKET_MS = 5 * 60_000;
const BUCKETS = 12;
const STALL_MS = 45_000;
const FLUSH_MS = 5_000;
const PUMP_SUPPLY = 1e9;

type Bucket = { start: number; trades: number; buys: number; sells: number; vol: number; traders: Set<string> };
type Heat = { buckets: Bucket[]; lastTs: number; lastPriceSol: number; lastMcapUsd: number | null; symbol?: string };
type EarlyBuy = { wallet: string; ts: number; sol: number; tx: string; mcapUsd: number | null };
type TradeRow = { ts: Date; tx: string; token: string; wallet: string; side: 'buy' | 'sell'; sol: number; tokens: number; priceSol: number | null; mcapUsd: number | null; venue: string; reason: string };

export type StreamStats = {
  connected: boolean;
  endpoint: string | null;
  messages: number;
  decoded: number;
  launches1h: number;
  graduations1h: number;
  pools1h: number;
  trades1h: number;
  volume1h: number;
  tradersSeen1h: number;
  trackedTokens: number;
  persistedTrades: number;
  unresolvedPools: number;
};

export type HotToken = { mint: string; trades: number; buys: number; sells: number; vol: number; traders: number; lastPriceSol: number; lastMcapUsd: number | null; lastTs: number; symbol?: string };

function newBucket(start: number): Bucket {
  return { start, trades: 0, buys: 0, sells: 0, vol: 0, traders: new Set() };
}

class Rolling {
  buckets: Bucket[] = [];
  hit(ts: number, isBuy: boolean, sol: number, wallet: string) {
    const start = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
    // A timestamp older than the newest bucket (out-of-order delivery) is
    // counted in the newest bucket rather than opening a stale one.
    let b = this.buckets[this.buckets.length - 1];
    if (!b || b.start < start) {
      b = newBucket(start);
      this.buckets.push(b);
      if (this.buckets.length > BUCKETS) this.buckets.splice(0, this.buckets.length - BUCKETS);
    }
    b.trades++;
    if (isBuy) b.buys++;
    else b.sells++;
    b.vol += sol;
    if (b.traders.size < 20_000) b.traders.add(wallet);
  }
  sum(now: number) {
    const cutoff = now - BUCKETS * BUCKET_MS;
    const out = { trades: 0, buys: 0, sells: 0, vol: 0, traders: 0 };
    const traders = new Set<string>();
    for (const b of this.buckets) {
      if (b.start < cutoff) continue;
      out.trades += b.trades;
      out.buys += b.buys;
      out.sells += b.sells;
      out.vol += b.vol;
      for (const t of b.traders) traders.add(t);
    }
    out.traders = traders.size;
    return out;
  }
}

export class SolanaStream {
  solUsd = 0;
  private ws: WebSocket | null = null;
  private endpointIdx = 0;
  private endpoint: string | null = null;
  private lastMessage = 0;
  private messages = 0;
  private decoded = 0;
  private persisted = 0;
  private stopped = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private flusher: ReturnType<typeof setInterval> | null = null;
  private heat = new Map<string, Heat & { roll: Rolling }>();
  private chain = new Rolling();
  private launchTimes: number[] = [];
  private gradTimes: number[] = [];
  private poolTimes: number[] = [];
  private poolMint = new Map<string, string>();
  private poolPending = new Map<string, PumpEvent[]>();
  private poolResolving = new Set<string>();
  private early = new Map<string, EarlyBuy[]>();
  private labelled = new Map<string, string>();
  private tradeQueue: TradeRow[] = [];
  private launchQueue: LaunchEvent[] = [];
  private rpcIdx = 0;

  async start(): Promise<void> {
    await this.loadPoolCache();
    await this.reloadWallets();
    this.connect();
    this.watchdog = setInterval(() => this.checkStall(), 10_000);
    this.flusher = setInterval(() => void this.flush(), FLUSH_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.flusher) clearInterval(this.flusher);
    this.ws?.close();
    await this.flush();
  }

  stats(): StreamStats {
    const now = Date.now();
    const cutoff = now - 3_600_000;
    const c = this.chain.sum(now);
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      endpoint: this.endpoint,
      messages: this.messages,
      decoded: this.decoded,
      launches1h: this.launchTimes.filter((t) => t > cutoff).length,
      graduations1h: this.gradTimes.filter((t) => t > cutoff).length,
      pools1h: this.poolTimes.filter((t) => t > cutoff).length,
      trades1h: c.trades,
      volume1h: c.vol,
      tradersSeen1h: c.traders,
      trackedTokens: this.heat.size,
      persistedTrades: this.persisted,
      unresolvedPools: this.poolPending.size,
    };
  }

  /** Tokens ranked by last-hour stream volume. */
  hot(limit = 50): HotToken[] {
    const now = Date.now();
    const rows: HotToken[] = [];
    for (const [mint, h] of this.heat) {
      const s = h.roll.sum(now);
      if (!s.trades) continue;
      rows.push({ mint, ...s, lastPriceSol: h.lastPriceSol, lastMcapUsd: h.lastMcapUsd, lastTs: h.lastTs, symbol: h.symbol });
    }
    rows.sort((a, b) => b.vol - a.vol);
    return rows.slice(0, limit);
  }

  heatFor(mint: string): HotToken | null {
    const h = this.heat.get(mint);
    if (!h) return null;
    return { mint, ...h.roll.sum(Date.now()), lastPriceSol: h.lastPriceSol, lastMcapUsd: h.lastMcapUsd, lastTs: h.lastTs, symbol: h.symbol };
  }

  /** Persist the early buyers of a token that proved itself (graduated or became a runner). */
  flushEarlyBuyers(mint: string, reason: string): number {
    const buys = this.early.get(mint);
    if (!buys?.length) return 0;
    this.early.delete(mint);
    for (const b of buys) {
      this.tradeQueue.push({ ts: new Date(b.ts), tx: b.tx, token: mint, wallet: b.wallet, side: 'buy', sol: b.sol, tokens: 0, priceSol: null, mcapUsd: b.mcapUsd, venue: 'pump', reason });
    }
    return buys.length;
  }

  async reloadWallets(): Promise<void> {
    const rows = await (await db()).query<{ address: string; kind: string }>(`select address, kind from wallets where chain = 'solana'`);
    this.labelled = new Map(rows.map((r) => [r.address, r.kind]));
    log.info(`watching ${this.labelled.size} labelled wallets`);
  }

  private async loadPoolCache(): Promise<void> {
    const rows = await (await db()).query<{ address: string; token_address: string }>(`select address, token_address from pairs where chain = 'solana' and dex = 'pumpswap'`);
    for (const r of rows) this.poolMint.set(r.address, r.token_address);
    log.info(`pool cache: ${this.poolMint.size} PumpSwap pools`);
  }

  private connect(): void {
    if (this.stopped) return;
    const urls = config.solanaRpcWs;
    const url = urls[this.endpointIdx % urls.length]!;
    this.endpoint = url;
    this.lastMessage = Date.now();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      log.warn(`cannot open ${url}: ${(err as Error).message}`);
      this.rotate();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      log.info(`connected ${url}`);
      for (const [i, p] of [PUMP_PROGRAM, PUMP_AMM_PROGRAM].entries()) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'logsSubscribe', params: [{ mentions: [p] }, { commitment: 'confirmed' }] }));
      }
    };
    ws.onmessage = (m) => this.onMessage(String(m.data));
    ws.onerror = () => log.warn(`socket error on ${url}`);
    ws.onclose = () => {
      if (this.ws === ws && !this.stopped) {
        log.warn(`socket closed on ${url}, reconnecting`);
        setTimeout(() => this.rotate(), 1_000);
      }
    };
  }

  private rotate(): void {
    if (this.stopped) return;
    this.endpointIdx++;
    const old = this.ws;
    this.ws = null;
    try {
      old?.close();
    } catch {
      /* closing a dead socket */
    }
    this.connect();
  }

  private checkStall(): void {
    if (this.ws && Date.now() - this.lastMessage > STALL_MS) {
      log.warn(`no messages for ${STALL_MS / 1000}s on ${this.endpoint}, rotating`);
      this.rotate();
    }
  }

  private onMessage(raw: string): void {
    this.lastMessage = Date.now();
    this.messages++;
    let j: any;
    try {
      j = JSON.parse(raw);
    } catch {
      return;
    }
    const v = j?.params?.result?.value;
    if (!v?.logs || v.err) return;
    const sig: string = v.signature;
    let events: PumpEvent[];
    try {
      events = decodeLogs(v.logs);
    } catch {
      return;
    }
    for (const ev of events) {
      this.decoded++;
      this.handle(ev, sig);
    }
  }

  private handle(ev: PumpEvent, sig: string): void {
    const ts = ev.ts * 1000;
    switch (ev.kind) {
      case 'create': {
        this.launchTimes.push(ts);
        this.launchQueue.push({ ts: new Date(ts), chain: 'solana', kind: 'launch', token: ev.mint, launchpad: 'pump', actor: ev.creator, tx: sig, name: ev.name, symbol: ev.symbol, data: { uri: ev.uri, bondingCurve: ev.bondingCurve } });
        this.early.set(ev.mint, []);
        if (this.early.size > EARLY_MINTS_MAX) {
          const oldest = this.early.keys().next().value;
          if (oldest) this.early.delete(oldest);
        }
        const h = this.touch(ev.mint, ts);
        h.symbol = ev.symbol;
        break;
      }
      case 'complete': {
        this.gradTimes.push(ts);
        this.launchQueue.push({ ts: new Date(ts), chain: 'solana', kind: 'graduation', token: ev.mint, launchpad: 'pump', actor: ev.user, tx: sig });
        this.flushEarlyBuyers(ev.mint, 'early:graduated');
        break;
      }
      case 'pool': {
        this.poolTimes.push(ts);
        this.poolMint.set(ev.pool, ev.mint);
        this.launchQueue.push({ ts: new Date(ts), chain: 'solana', kind: 'pool', token: ev.mint, launchpad: 'pumpswap', actor: ev.creator, tx: sig, data: { pool: ev.pool, quoteMint: ev.quoteMint } });
        this.drainPool(ev.pool, sig);
        break;
      }
      case 'trade': {
        if (ev.venue === 'curve') {
          const priceSol = ev.tokens > 0 ? ev.sol / ev.tokens : 0;
          const mcapUsd = priceSol && this.solUsd ? priceSol * PUMP_SUPPLY * this.solUsd : null;
          this.onTrade(ev.mint, ev.user, ev.isBuy, ev.sol, ev.tokens, priceSol, mcapUsd, ts, sig, 'pump');
        } else {
          const mint = this.poolMint.get(ev.pool);
          if (!mint) {
            this.queueForPool(ev.pool, ev, sig);
            return;
          }
          const priceSol = ev.poolBase > 0 ? ev.poolQuote / ev.poolBase : 0;
          const mcapUsd = priceSol && this.solUsd ? priceSol * PUMP_SUPPLY * this.solUsd : null;
          this.onTrade(mint, ev.user, ev.isBuy, ev.sol, ev.tokens, priceSol, mcapUsd, ts, sig, 'pumpswap');
        }
        break;
      }
    }
  }

  private touch(mint: string, ts: number) {
    let h = this.heat.get(mint);
    if (!h) {
      h = { buckets: [], lastTs: ts, lastPriceSol: 0, lastMcapUsd: null, roll: new Rolling() };
      this.heat.set(mint, h);
    }
    h.lastTs = Math.max(h.lastTs, ts);
    return h;
  }

  private onTrade(mint: string, wallet: string, isBuy: boolean, sol: number, tokens: number, priceSol: number, mcapUsd: number | null, ts: number, sig: string, venue: string): void {
    const h = this.touch(mint, ts);
    h.roll.hit(ts, isBuy, sol, wallet);
    if (priceSol) h.lastPriceSol = priceSol;
    if (mcapUsd) h.lastMcapUsd = mcapUsd;
    this.chain.hit(ts, isBuy, sol, wallet);

    const early = this.early.get(mint);
    if (early && isBuy && early.length < EARLY_BUYERS_PER_MINT && !early.some((e) => e.wallet === wallet)) {
      early.push({ wallet, ts, sol, tx: sig, mcapUsd });
    }

    const kind = this.labelled.get(wallet);
    const reason = kind ? `wallet:${kind}` : sol >= WHALE_SOL ? 'whale' : null;
    if (reason) {
      this.tradeQueue.push({ ts: new Date(ts), tx: sig, token: mint, wallet, side: isBuy ? 'buy' : 'sell', sol, tokens, priceSol: priceSol || null, mcapUsd, venue, reason });
    }
  }

  private queueForPool(pool: string, ev: PumpEvent, sig: string): void {
    let q = this.poolPending.get(pool);
    if (!q) {
      q = [];
      this.poolPending.set(pool, q);
    }
    if (q.length < 50) q.push({ ...ev, ts: ev.ts, sig } as PumpEvent & { sig: string });
    if (!this.poolResolving.has(pool)) void this.resolvePool(pool);
  }

  private async resolvePool(pool: string): Promise<void> {
    this.poolResolving.add(pool);
    try {
      const urls = config.solanaRpcHttp;
      const url = urls[this.rpcIdx++ % urls.length]!;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [pool, { encoding: 'base64' }] }),
        signal: AbortSignal.timeout(10_000),
      });
      const j: any = await res.json();
      const b64 = j?.result?.value?.data?.[0];
      const mint = b64 ? poolBaseMint(Buffer.from(b64, 'base64')) : null;
      if (mint) {
        this.poolMint.set(pool, mint);
        await insertMany('pairs', ['chain', 'address', 'token_address', 'dex', 'quote_symbol'], [['solana', pool, mint, 'pumpswap', 'SOL']], 'on conflict (chain, address) do update set token_address = excluded.token_address, dex = excluded.dex');
        this.drainPool(pool, null);
      } else {
        this.poolPending.delete(pool);
      }
    } catch (err) {
      log.warn(`pool resolve ${pool}: ${(err as Error).message}`);
      this.poolPending.delete(pool);
    } finally {
      this.poolResolving.delete(pool);
    }
  }

  private drainPool(pool: string, _sig: string | null): void {
    const q = this.poolPending.get(pool);
    this.poolPending.delete(pool);
    if (!q) return;
    for (const ev of q) this.handle(ev, (ev as PumpEvent & { sig: string }).sig);
  }

  private pruneHeat(): void {
    const cutoff = Date.now() - BUCKETS * BUCKET_MS;
    for (const [mint, h] of this.heat) if (h.lastTs < cutoff) this.heat.delete(mint);
    const hourAgo = Date.now() - 3_600_000;
    this.launchTimes = this.launchTimes.filter((t) => t > hourAgo);
    this.gradTimes = this.gradTimes.filter((t) => t > hourAgo);
    this.poolTimes = this.poolTimes.filter((t) => t > hourAgo);
  }

  private flushing = false;
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      this.pruneHeat();
      const launches = this.launchQueue.splice(0);
      if (launches.length) await recordLaunchEvents(launches);
      const trades = this.tradeQueue.splice(0);
      if (trades.length) {
        await insertMany(
          'trades',
          ['ts', 'chain', 'tx', 'token', 'wallet', 'side', 'quote_amount', 'token_amount', 'price_quote', 'mcap_usd', 'venue', 'reason'],
          trades.map((t) => [t.ts, 'solana', t.tx, t.token, t.wallet, t.side, t.sol, t.tokens, t.priceSol, t.mcapUsd, t.venue, t.reason]),
          'on conflict do nothing',
        );
        await this.updatePositions(trades);
        this.persisted += trades.length;
      }
    } catch (err) {
      log.error(`flush failed: ${(err as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }

  private async updatePositions(trades: TradeRow[]): Promise<void> {
    const d = await db();
    for (const t of trades) {
      const buy = t.side === 'buy';
      await d.query(
        `insert into wallet_positions (chain, wallet, token, first_buy_at, first_buy_mcap_usd, last_trade_at, buys, sells, bought_quote, sold_quote, bought_tokens, sold_tokens)
         values ('solana', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (chain, wallet, token) do update set
           first_buy_at = coalesce(wallet_positions.first_buy_at, excluded.first_buy_at),
           first_buy_mcap_usd = coalesce(wallet_positions.first_buy_mcap_usd, excluded.first_buy_mcap_usd),
           last_trade_at = greatest(wallet_positions.last_trade_at, excluded.last_trade_at),
           buys = wallet_positions.buys + excluded.buys, sells = wallet_positions.sells + excluded.sells,
           bought_quote = wallet_positions.bought_quote + excluded.bought_quote, sold_quote = wallet_positions.sold_quote + excluded.sold_quote,
           bought_tokens = wallet_positions.bought_tokens + excluded.bought_tokens, sold_tokens = wallet_positions.sold_tokens + excluded.sold_tokens`,
        [t.wallet, t.token, buy ? t.ts : null, buy ? t.mcapUsd : null, t.ts, buy ? 1 : 0, buy ? 0 : 1, buy ? t.sol : 0, buy ? 0 : t.sol, buy ? t.tokens : 0, buy ? 0 : t.tokens],
      );
    }
  }
}
