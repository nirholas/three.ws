// Token lifecycle: new -> running -> dying -> dead, with graduated as a
// milestone that the chain itself reports. Thresholds are deliberately plain
// so a human can read a status and know exactly why it was assigned.
import { db } from '../db/client.ts';
import { logger } from '../lib/log.ts';

const log = logger('status');

export const STATUS_RULES = {
  running: 'mcap at least 60% of ATH, ATH set within 24h, mcap >= $100k and 24h volume >= $50k',
  dying: 'mcap down 70% or more from an ATH of at least $50k, or 24h volume under 10% of its peak after peaking above $100k',
  dead: 'mcap down 90% or more from an ATH of at least $20k, or liquidity under $1k, or no fresh data for 3 days with negligible volume',
  graduated: 'the launchpad reported the bonding curve completed (pump.fun complete event, Odyssey PoolMigrated)',
  new: 'seen but none of the above yet',
} as const;

export type StatusChange = { chain: string; address: string; symbol: string | null; from: string; to: string; mcap: number | null; ath: number | null };

/** Re-evaluate every live token and return the transitions that happened. */
export async function updateStatuses(): Promise<StatusChange[]> {
  const d = await db();
  const rows = await d.query<StatusChange>(
    `with next as (
       select chain, address, symbol, status as from_status, last_mcap, ath_mcap,
         case
           when (ath_mcap >= 20000 and last_mcap <= ath_mcap * 0.10)
             or (last_liquidity is not null and last_liquidity < 1000 and ath_mcap >= 20000)
             or (last_snapshot_at < now() - interval '3 days' and coalesce(last_volume_24h, 0) < 1000 and status <> 'new')
             then 'dead'
           when (ath_mcap >= 50000 and last_mcap <= ath_mcap * 0.30)
             or (peak_volume_24h >= 100000 and coalesce(last_volume_24h, 0) < peak_volume_24h * 0.10)
             then 'dying'
           when last_mcap >= 100000 and coalesce(last_volume_24h, 0) >= 50000 and ath_at >= now() - interval '24 hours' and last_mcap >= ath_mcap * 0.60
             then 'running'
           when graduated_at is not null and status in ('new', 'running') then 'graduated'
           else status
         end as to_status
       from tokens where status <> 'dead' and last_mcap is not null
     ),
     changed as (
       update tokens t set status = n.to_status, status_changed_at = now(),
         died_at = case when n.to_status = 'dead' then now() else t.died_at end
       from next n where t.chain = n.chain and t.address = n.address and n.to_status <> n.from_status
       returning t.chain, t.address, t.symbol, n.from_status as "from", n.to_status as "to", t.last_mcap as mcap, t.ath_mcap as ath
     )
     select * from changed`,
  );
  if (rows.length) {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.to] = (counts[r.to] ?? 0) + 1;
    log.info(`status transitions: ${JSON.stringify(counts)}`);
  }
  return rows;
}
