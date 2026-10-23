// Scheduled reconciliation of the revenue ledger. Two independent checks:
//
//   1. Database drift. For each source, count and sum what the source table
//      says is eligible income and compare it with the ledger. A difference
//      means a row was missed, deleted or changed after the last sync. A sync
//      runs first, so drift left over after it is real.
//   2. Chain verification. A sample of mainnet Solana entries (never-checked
//      first, then oldest check) is looked up on the cluster. A transaction that
//      is missing or failed on-chain is flagged; one that landed is stamped
//      verified with the time of the check.
//
// Drift alerts the affected owners once per distinct drift (not on every run).

import { sql } from './db.js';
import { solanaConnection } from './solana/connection.js';
import { insertNotification } from './notify.js';
import { syncLedger } from './revenue-ledger.js';
import { SOURCE_BY_KEY, reachedMilestones } from './revenue-ledger-core.js';

const CHAIN_SAMPLE = 120;
const NOT_FOUND_GRACE_MS = 2 * 3600 * 1000;
// The RPC pool is not an archive node: a signature older than this cannot be
// judged missing, so it is skipped rather than reported as drift.
const HISTORY_WINDOW_MS = Number(process.env.REVENUE_CHAIN_HISTORY_DAYS || 3) * 86400000;

/** Per-source counts and sums straight from the source tables, against the ledger. */
async function dbChecks() {
	const src = await sql`
		select 'creator_fee_claim' as source, count(*)::int as n, coalesce(sum(c.claimed_lamports), 0)::numeric as atomics
		  from launcher_claims c join agent_identities ai on ai.id = c.agent_id
		 where c.claim_sig is not null and c.claimed_lamports > 0
		union all
		select 'skill_sale', count(*)::int, coalesce(sum(r.net_amount), 0)::numeric
		  from agent_revenue_events r join agent_identities ai on ai.id = r.agent_id
		 where r.net_amount > 0 and coalesce(r.owner_user_id, ai.user_id) is not null
		union all
		select 'hire', count(*)::int, coalesce(sum(amount_atomics::numeric), 0)
		  from agent_hires where status = 'completed' and provider_agent_id is not null and provider_user_id is not null and amount_atomics::numeric > 0
		union all
		select 'skill_royalty', count(*)::int, coalesce(sum(round(price_usd * 1000000)), 0)::numeric
		  from royalty_ledger where status = 'settled' and author_user_id is not null and price_usd > 0
		union all
		select 'invoice', count(*)::int, coalesce(sum(paid_atomics), 0)
		  from agent_commerce_invoices where status = 'paid' and paid_atomics > 0
		union all
		select 'trading_pnl', count(*)::int, coalesce(sum(realized_pnl_lamports), 0)::numeric
		  from agent_sniper_positions where status = 'closed' and realized_pnl_lamports is not null and realized_pnl_lamports <> 0 and user_id is not null`;
	const led = await sql`select source, count(*)::int as n, coalesce(sum(amount_atomics), 0)::numeric as atomics from revenue_ledger_entries group by source`;
	const byLed = new Map(led.map((r) => [r.source, r]));
	return src.map((s) => {
		const l = byLed.get(s.source);
		const ledgerN = l?.n ?? 0;
		const ledgerAtomics = BigInt(String(l?.atomics ?? 0).split('.')[0]);
		const sourceAtomics = BigInt(String(s.atomics).split('.')[0]);
		return {
			source: s.source, label: SOURCE_BY_KEY[s.source].label,
			source_count: s.n, ledger_count: ledgerN,
			source_atomics: sourceAtomics.toString(), ledger_atomics: ledgerAtomics.toString(),
			drift: s.n !== ledgerN || sourceAtomics !== ledgerAtomics,
		};
	});
}

/** Look a sample of signatures up on mainnet and stamp each entry. */
async function chainVerify() {
	const rows = await sql`
		select id, user_id, tx_signature, occurred_at from revenue_ledger_entries
		where tx_signature is not null and chain = 'solana' and network = 'mainnet' and counted
		  and chain_status in ('unchecked', 'verified', 'mismatch', 'not_found')
		order by chain_checked_at nulls first, occurred_at desc
		limit ${CHAIN_SAMPLE}`;
	if (!rows.length) return { checked: 0, mismatches: 0, not_found: 0, flagged: [] };
	const conn = solanaConnection({ network: 'mainnet' });
	const sigs = [...new Set(rows.map((r) => r.tx_signature))];
	const status = new Map();
	for (let i = 0; i < sigs.length; i += 100) {
		const batch = sigs.slice(i, i + 100);
		const res = await conn.getSignatureStatuses(batch, { searchTransactionHistory: true });
		batch.forEach((sig, j) => status.set(sig, res.value[j]));
	}
	let mismatches = 0;
	let notFound = 0;
	const flagged = [];
	for (const r of rows) {
		const st = status.get(r.tx_signature);
		let next;
		let detail;
		if (st?.err) {
			next = 'mismatch';
			detail = `Transaction failed on-chain: ${JSON.stringify(st.err).slice(0, 160)}`;
			mismatches++;
		} else if (st) {
			next = 'verified';
			detail = `Landed at slot ${st.slot} (${st.confirmationStatus || 'confirmed'}).`;
		} else if (Date.now() - new Date(r.occurred_at).getTime() < NOT_FOUND_GRACE_MS) {
			next = 'unchecked';
			detail = 'Too recent to judge; will be checked again.';
		} else if (Date.now() - new Date(r.occurred_at).getTime() > HISTORY_WINDOW_MS) {
			next = 'skipped';
			detail = `Older than the ${Math.round(HISTORY_WINDOW_MS / 86400000)}-day window the RPC pool can search, so it cannot be checked; the source row is the record.`;
		} else {
			next = 'not_found';
			detail = 'No transaction with this signature was found on mainnet.';
			notFound++;
		}
		if (next === 'mismatch' || next === 'not_found') flagged.push({ id: r.id, user_id: r.user_id, tx_signature: r.tx_signature, status: next });
		await sql`update revenue_ledger_entries set chain_status = ${next}, chain_checked_at = now(), chain_detail = ${detail} where id = ${r.id}`;
	}
	return { checked: rows.length, mismatches, not_found: notFound, flagged };
}

/**
 * Announce lifetime-revenue milestones once per agent. Revenue only (trading
 * PnL is not income), mainnet only, valued entries only. The unique
 * (scope, milestone) row makes each fire exactly once.
 */
export async function announceMilestones() {
	const totals = await sql`
		select user_id, agent_id, sum(usd)::float8 as usd from revenue_ledger_entries
		where kind = 'revenue' and counted and usd is not null and agent_id is not null group by user_id, agent_id`;
	let announced = 0;
	for (const t of totals) {
		for (const m of reachedMilestones(t.usd)) {
			const [row] = await sql`
				insert into revenue_milestones (user_id, scope, milestone, usd_at_reach)
				values (${t.user_id}, ${`agent:${t.agent_id}`}, ${`revenue_usd_${m}`}, ${t.usd})
				on conflict (scope, milestone) do nothing returning id`;
			if (!row) continue;
			announced++;
			insertNotification(t.user_id, 'revenue_milestone', {
				title: `Your agent has earned $${m.toLocaleString('en-US')}`,
				body: 'Lifetime revenue across creator fees, skill sales, hires, royalties and invoices.',
				link: '/earnings',
			});
		}
	}
	return announced;
}

/**
 * One reconcile run. Records it in revenue_reconcile_runs and alerts owners
 * whose entries are flagged, and every owner when a source drifted.
 */
export async function runReconcile() {
	const [run] = await sql`insert into revenue_reconcile_runs default values returning id`;
	try {
		const synced = await syncLedger({});
		const checks = await dbChecks();
		const chain = await chainVerify().catch((e) => ({ checked: 0, mismatches: 0, not_found: 0, flagged: [], error: e?.message }));
		const milestones = await announceMilestones().catch(() => 0);
		const [{ n }] = await sql`select count(*)::int as n from revenue_ledger_entries`;
		const dbDrift = checks.filter((c) => c.drift).length;
		const status = dbDrift || chain.mismatches || chain.not_found ? 'drift' : chain.error ? 'error' : 'clean';

		const [prev] = await sql`select db_drift_count, chain_mismatches, chain_not_found from revenue_reconcile_runs where id <> ${run.id} and status <> 'running' order by started_at desc limit 1`;
		const changed = !prev || prev.db_drift_count !== dbDrift || prev.chain_mismatches !== chain.mismatches || prev.chain_not_found !== chain.not_found;
		let alerted = 0;
		if (status === 'drift' && changed) {
			const owners = new Map();
			for (const f of chain.flagged) owners.set(f.user_id, (owners.get(f.user_id) || 0) + 1);
			for (const [userId, count] of owners) {
				insertNotification(userId, 'revenue_reconcile_drift', {
					title: 'Revenue ledger needs a look',
					body: `${count} income ${count === 1 ? 'entry has' : 'entries have'} a transaction that is missing or failed on-chain.`,
					link: '/earnings',
				});
				alerted++;
			}
			if (dbDrift) {
				const affected = await sql`select distinct user_id from revenue_ledger_entries`;
				for (const { user_id } of affected) {
					if (owners.has(user_id)) continue;
					insertNotification(user_id, 'revenue_reconcile_drift', {
						title: 'Revenue ledger drifted from its sources',
						body: `${dbDrift} income ${dbDrift === 1 ? 'source differs' : 'sources differ'} from the ledger. It re-syncs every cycle; open the earnings page for the detail.`,
						link: '/earnings',
					});
					alerted++;
				}
			}
		}
		await sql`
			update revenue_reconcile_runs set finished_at = now(), status = ${status}, entries_total = ${n},
				db_checks = ${JSON.stringify(checks)}::jsonb, db_drift_count = ${dbDrift}, chain_checked = ${chain.checked},
				chain_mismatches = ${chain.mismatches}, chain_not_found = ${chain.not_found}, alerted_users = ${alerted},
				error = ${chain.error || null}
			where id = ${run.id}`;
		return { id: run.id, status, synced, milestones, entries_total: n, db_checks: checks, chain: { checked: chain.checked, mismatches: chain.mismatches, not_found: chain.not_found, error: chain.error || null }, alerted };
	} catch (err) {
		await sql`update revenue_reconcile_runs set finished_at = now(), status = 'error', error = ${String(err?.message || err).slice(0, 500)} where id = ${run.id}`;
		throw err;
	}
}

/** Latest finished run, for the "how reconciliation is doing" line. */
export async function latestReconcile() {
	const [r] = await sql`
		select id, started_at, finished_at, status, entries_total, db_checks, db_drift_count, chain_checked, chain_mismatches, chain_not_found
		from revenue_reconcile_runs where status <> 'running' order by started_at desc limit 1`;
	return r || null;
}
