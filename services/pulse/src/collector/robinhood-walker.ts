// Robinhood Chain collector: walks launchpad factory logs from a saved block
// cursor, then prices every known token through DexScreener. No indexer and
// no explorer involved, only the public RPC and DexScreener.
import { logger } from '../lib/log.ts';
import { chunk, mapLimit } from '../lib/http.ts';
import { dexSearch, dexTokens, pairsToObservation } from '../sources/dexscreener.ts';
import { rhBlockNumber, rhLaunchEvents } from '../sources/robinhood.ts';
import type { Observation } from '../sources/types.ts';
import { kvGet, kvSet, recordLaunchEvents, tokensNeedingRefresh } from './store.ts';

const log = logger('robinhood');
const CURSOR_KEY = 'robinhood:cursor';
const WINDOW = 90_000;
const BACKFILL_BLOCKS = 400_000;
const SEARCH_TERMS = ['robinhood', 'pons', 'noxa', 'odyssey', 'RH', 'ETH'];

/** Advance the launch-event cursor to the chain head. Returns the new events. */
export async function walkRobinhoodLaunches(): Promise<number> {
  const head = await rhBlockNumber();
  const saved = await kvGet<{ block: number }>(CURSOR_KEY);
  let from = saved?.block ? saved.block + 1 : Math.max(0, head - BACKFILL_BLOCKS);
  let total = 0;
  while (from <= head) {
    const to = Math.min(head, from + WINDOW - 1);
    const events = await rhLaunchEvents(from, to);
    await recordLaunchEvents(events);
    total += events.length;
    await kvSet(CURSOR_KEY, { block: to, at: new Date().toISOString() });
    from = to + 1;
  }
  if (total) log.info(`${total} new launch events up to block ${head}`);
  return total;
}

/** Market data for every live Robinhood token we know, plus pairs DexScreener search surfaces that we do not. */
export async function robinhoodObservations(limit = 300): Promise<Observation[]> {
  const known = await tokensNeedingRefresh('robinhood', limit);
  const out: Observation[] = [];
  const seen = new Set<string>();
  const { ok } = await mapLimit(chunk(known, 30), 2, (batch) => dexTokens('robinhood', batch));
  for (const obs of ok.flat()) {
    seen.add(obs.meta.address);
    out.push(obs);
  }
  const search = await mapLimit(SEARCH_TERMS, 2, (q) => dexSearch(q));
  const byToken = new Map<string, any[]>();
  for (const p of search.ok.flat()) {
    if (p.chainId !== 'robinhood' || !p.baseToken?.address) continue;
    const addr = String(p.baseToken.address).toLowerCase();
    if (seen.has(addr)) continue;
    const arr = byToken.get(addr) ?? [];
    arr.push(p);
    byToken.set(addr, arr);
  }
  let rank = 0;
  for (const [addr, pairs] of byToken) {
    const obs = pairsToObservation('robinhood', addr, pairs);
    if (obs) out.push({ ...obs, list: { name: 'dex:search-robinhood', rank: ++rank } });
  }
  log.info(`${out.length} robinhood tokens observed (${known.length} refreshed, ${byToken.size} discovered)`);
  return out;
}
