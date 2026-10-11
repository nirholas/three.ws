// Pure decoders for the Anchor events pump.fun's two programs put in
// transaction logs ("Program data: <base64>"). Layouts come from the
// published IDLs (@pump-fun/pump-sdk and @pump-fun/pump-swap-sdk); only the
// leading fields are read, so later IDL additions never break the parse.
import { createHash } from 'node:crypto';
import bs58 from 'bs58';

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const LAMPORTS = 1e9;
export const PUMP_DECIMALS = 1e6;

const disc = (name: string) => createHash('sha256').update(`event:${name}`).digest().subarray(0, 8).toString('hex');
const DISC = {
  trade: disc('TradeEvent'),
  create: disc('CreateEvent'),
  complete: disc('CompleteEvent'),
  buy: disc('BuyEvent'),
  sell: disc('SellEvent'),
  pool: disc('CreatePoolEvent'),
};

export type PumpEvent =
  | { kind: 'trade'; venue: 'curve'; mint: string; user: string; isBuy: boolean; sol: number; tokens: number; ts: number; vSol: number; vTokens: number; realSol: number }
  | { kind: 'create'; mint: string; name: string; symbol: string; uri: string; creator: string; bondingCurve: string; ts: number }
  | { kind: 'complete'; mint: string; user: string; ts: number }
  | { kind: 'trade'; venue: 'amm'; pool: string; user: string; isBuy: boolean; sol: number; tokens: number; ts: number; poolBase: number; poolQuote: number }
  | { kind: 'pool'; pool: string; mint: string; quoteMint: string; creator: string; ts: number };

class Reader {
  off = 8;
  private b: Buffer;
  constructor(b: Buffer) {
    this.b = b;
  }
  u64(): number {
    const v = Number(this.b.readBigUInt64LE(this.off));
    this.off += 8;
    return v;
  }
  i64(): number {
    const v = Number(this.b.readBigInt64LE(this.off));
    this.off += 8;
    return v;
  }
  u16(): number {
    const v = this.b.readUInt16LE(this.off);
    this.off += 2;
    return v;
  }
  u8(): number {
    return this.b[this.off++];
  }
  bool(): boolean {
    return this.b[this.off++] !== 0;
  }
  pubkey(): string {
    const v = bs58.encode(this.b.subarray(this.off, this.off + 32));
    this.off += 32;
    return v;
  }
  string(): string {
    const len = this.b.readUInt32LE(this.off);
    this.off += 4;
    const v = this.b.subarray(this.off, this.off + len).toString('utf8');
    this.off += len;
    return v;
  }
  skip(n: number) {
    this.off += n;
  }
}

export function decodeEventData(b64: string): PumpEvent | null {
  let b: Buffer;
  try {
    b = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  if (b.length < 16) return null;
  const d = b.subarray(0, 8).toString('hex');
  const r = new Reader(b);
  try {
    switch (d) {
      case DISC.trade: {
        const mint = r.pubkey();
        const sol = r.u64() / LAMPORTS;
        const tokens = r.u64() / PUMP_DECIMALS;
        const isBuy = r.bool();
        const user = r.pubkey();
        const ts = r.i64();
        const vSol = r.u64() / LAMPORTS;
        const vTokens = r.u64() / PUMP_DECIMALS;
        const realSol = r.u64() / LAMPORTS;
        return { kind: 'trade', venue: 'curve', mint, user, isBuy, sol, tokens, ts, vSol, vTokens, realSol };
      }
      case DISC.create: {
        const name = r.string();
        const symbol = r.string();
        const uri = r.string();
        const mint = r.pubkey();
        const bondingCurve = r.pubkey();
        r.pubkey();
        const creator = r.pubkey();
        const ts = r.i64();
        return { kind: 'create', mint, name, symbol, uri, creator, bondingCurve, ts };
      }
      case DISC.complete: {
        const user = r.pubkey();
        const mint = r.pubkey();
        r.pubkey();
        const ts = r.i64();
        return { kind: 'complete', mint, user, ts };
      }
      case DISC.buy: {
        const ts = r.i64();
        const tokens = r.u64() / PUMP_DECIMALS;
        r.skip(8 * 3);
        const poolBase = r.u64() / PUMP_DECIMALS;
        const poolQuote = r.u64() / LAMPORTS;
        const sol = r.u64() / LAMPORTS;
        r.skip(8 * 6);
        const pool = r.pubkey();
        const user = r.pubkey();
        return { kind: 'trade', venue: 'amm', pool, user, isBuy: true, sol, tokens, ts, poolBase, poolQuote };
      }
      case DISC.sell: {
        const ts = r.i64();
        const tokens = r.u64() / PUMP_DECIMALS;
        r.skip(8 * 3);
        const poolBase = r.u64() / PUMP_DECIMALS;
        const poolQuote = r.u64() / LAMPORTS;
        const sol = r.u64() / LAMPORTS;
        r.skip(8 * 6);
        const pool = r.pubkey();
        const user = r.pubkey();
        return { kind: 'trade', venue: 'amm', pool, user, isBuy: false, sol, tokens, ts, poolBase, poolQuote };
      }
      case DISC.pool: {
        const ts = r.i64();
        r.u16();
        const creator = r.pubkey();
        const mint = r.pubkey();
        const quoteMint = r.pubkey();
        r.skip(2 + 8 * 7 + 1);
        const pool = r.pubkey();
        return { kind: 'pool', pool, mint, quoteMint, creator, ts };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Every decodable event in one transaction's log lines. */
export function decodeLogs(logs: string[]): PumpEvent[] {
  const out: PumpEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith('Program data: ')) continue;
    const ev = decodeEventData(line.slice(14));
    if (ev) out.push(ev);
  }
  return out;
}

/** base_mint from a raw PumpSwap Pool account (8 disc + bump u8 + index u16 + creator + base_mint). */
export function poolBaseMint(accountData: Buffer): string | null {
  if (accountData.length < 8 + 1 + 2 + 32 + 32) return null;
  return bs58.encode(accountData.subarray(43, 75));
}
