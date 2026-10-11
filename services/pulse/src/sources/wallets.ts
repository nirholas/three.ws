// Labelled wallet universes. Two public sources seed the KOL and smart-money
// sets; Pulse then grows the smart-money set itself from early buyers of
// runners (see intel/wallets.ts).
import { fetchJson, fetchText } from '../lib/http.ts';

export type WalletLabel = {
  chain: 'solana';
  address: string;
  label?: string;
  kind: 'kol' | 'smart';
  source: string;
  twitter?: string;
  telegram?: string;
  meta: Record<string, unknown>;
};

/** Decode a Next.js flight payload into one searchable string. */
function decodeFlight(html: string): string {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let blob = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      blob += JSON.parse(`"${m[1]}"`);
    } catch {
      continue;
    }
  }
  return blob;
}

function extractArray(blob: string, key: string): unknown[] | null {
  const at = blob.indexOf(`"${key}":`);
  if (at === -1) return null;
  const start = blob.indexOf('[', at);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < blob.length; i++) {
    const ch = blob[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) {
      try {
        return JSON.parse(blob.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

type KolscanRow = { wallet_address: string; name?: string; twitter?: string | null; telegram?: string | null; profit?: number; wins?: number; losses?: number; timeframe?: number };

/** Parse the kolscan leaderboard page. Pure, for tests. */
export function parseKolscan(html: string): WalletLabel[] {
  const rows = extractArray(decodeFlight(html), 'initLeaderboard') as KolscanRow[] | null;
  if (!rows) return [];
  const byWallet = new Map<string, WalletLabel>();
  const windows: Record<number, string> = { 1: '24h', 7: '7d', 30: '30d' };
  for (const r of rows) {
    if (typeof r?.wallet_address !== 'string' || r.wallet_address.length < 32) continue;
    const w = byWallet.get(r.wallet_address) ?? {
      chain: 'solana' as const,
      address: r.wallet_address,
      label: r.name || undefined,
      kind: 'kol' as const,
      source: 'kolscan',
      twitter: r.twitter || undefined,
      telegram: r.telegram || undefined,
      meta: {} as Record<string, unknown>,
    };
    const win = windows[r.timeframe ?? 0];
    if (win) w.meta[win] = { pnlSol: r.profit ?? 0, wins: r.wins ?? 0, losses: r.losses ?? 0 };
    byWallet.set(r.wallet_address, w);
  }
  return [...byWallet.values()];
}

export async function kolscanLeaderboard(): Promise<WalletLabel[]> {
  const html = await fetchText('https://kolscan.io/leaderboard', {
    headers: { accept: 'text/html,application/xhtml+xml', referer: 'https://kolscan.io/' },
    timeoutMs: 20_000,
  });
  return parseKolscan(html);
}

type KqWallet = Record<string, any> & { wallet_address?: string; address?: string };
type KqFile = {
  smartMoney?: { wallets?: Record<string, KqWallet[]> };
  kol?: { wallets?: KqWallet[] | Record<string, KqWallet[]> };
};

/** Smart-money taxonomy snapshot published by nirholas/kol-quest (GMGN-derived). */
export async function kolQuestWallets(): Promise<WalletLabel[]> {
  const file = await fetchJson<KqFile>('https://raw.githubusercontent.com/nirholas/kol-quest/main/site/data/solwallets.json', { timeoutMs: 60_000 });
  const out: WalletLabel[] = [];
  const push = (w: KqWallet, kind: 'kol' | 'smart', tag: string) => {
    const address = w.wallet_address || w.address;
    if (typeof address !== 'string' || address.length < 32) return;
    out.push({
      chain: 'solana',
      address,
      label: w.name || w.twitter_username || undefined,
      kind,
      source: `kol-quest:${tag}`,
      twitter: w.twitter_username ? `https://x.com/${w.twitter_username}` : undefined,
      meta: {
        tag,
        pnl30d: Number(w.pnl_30d) || 0,
        realized30d: Number(w.realized_profit_30d) || 0,
        txs30d: Number(w.txs_30d) || 0,
        lastActive: Number(w.last_active) || 0,
      },
    });
  };
  for (const [tag, list] of Object.entries(file.smartMoney?.wallets ?? {})) for (const w of list ?? []) push(w, 'smart', tag);
  const kol = file.kol?.wallets;
  if (Array.isArray(kol)) for (const w of kol) push(w, 'kol', 'renowned');
  else for (const [tag, list] of Object.entries(kol ?? {})) for (const w of list ?? []) push(w, 'kol', tag);
  return out;
}
