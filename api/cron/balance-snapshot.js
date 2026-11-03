// GET /api/cron/balance-snapshot: the hourly SOL + USDC history behind
// GET /api/agents/:id/wallet/history and the wallet page chart.
//
// Writes one row per agent wallet per hour into agent_balance_history, keyed on
// the top of the hour so a retried run overwrites its own row instead of
// duplicating it. Agents with money movement in the last 30 days, or a snapshot
// in the last 7, are valued least-recently-snapshotted first in a capped batch,
// so the sweep rotates through all of them. Read-only against the chain.

import { sql } from '../_lib/db.js';
import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { cachedSolUsd } from '../_lib/trader-stats.js';
import { readSolUsdc } from '../_lib/custody/balance-reader.js';

const BATCH = 60;
const CONCURRENCY = 4;

export async function agentsDueForBalanceSnapshot({ limit = BATCH } = {}) {
	return sql`
		with active as (
			select agent_id, network from agent_custody_events where created_at >= now() - interval '30 days'
			union
			select agent_id, network from agent_balance_history where captured_at >= now() - interval '7 days'
		)
		select i.id as agent_id, i.meta->>'solana_address' as address, a.network,
		       (select max(h.captured_at) from agent_balance_history h where h.agent_id = i.id and h.network = a.network) as last_snapshot
		from active a
		join agent_identities i on i.id = a.agent_id and i.deleted_at is null and i.meta ? 'solana_address'
		where a.network in ('mainnet', 'devnet')
		order by last_snapshot asc nulls first
		limit ${limit}
	`;
}

export async function recordBalanceSnapshot({ agentId, reading }) {
	await sql`
		insert into agent_balance_history (agent_id, network, captured_at, address, lamports, usdc_raw, sol_usd, usd_total)
		values (${agentId}, ${reading.network}, date_trunc('hour', now()), ${reading.address},
		        ${reading.lamports.toString()}, ${reading.usdc_raw.toString()}, ${reading.sol_usd}, ${reading.usd_total})
		on conflict (agent_id, network, captured_at) do update set
			address = excluded.address, lamports = excluded.lamports, usdc_raw = excluded.usdc_raw,
			sol_usd = excluded.sol_usd, usd_total = excluded.usd_total
	`;
}

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const due = await agentsDueForBalanceSnapshot();
	const solUsd = await cachedSolUsd();
	let recorded = 0;
	let failed = 0;
	const queue = [...due];
	async function worker() {
		while (queue.length) {
			const { agent_id: agentId, address, network } = queue.shift();
			try {
				const reading = await readSolUsdc({ address, network, solUsd: network === 'mainnet' ? solUsd : null });
				await recordBalanceSnapshot({ agentId, reading });
				recorded += 1;
			} catch (e) {
				failed += 1;
				console.warn('[cron/balance-snapshot] snapshot failed', agentId, e?.message);
			}
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	return json(res, 200, { ok: true, due: due.length, recorded, failed });
});
