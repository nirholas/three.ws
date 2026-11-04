// Reconcile every staked pool against the chain: sync the ledger from on-chain events,
// then compare vault balance, on-chain totals and recorded stakes (reconcile.js).
// Shared by the admin route (api/event-markets/staking-admin.js) and the cron
// (api/cron/event-markets-staking-reconcile.js) so the number an operator reads and
// the number that alerts cannot drift apart.

import { sql } from '../../db.js';
import { readPool, vaultBalance } from './chain.js';
import { ledgerTotals, listPools } from './store.js';
import { reconcilePool } from './reconcile.js';
import { syncPoolLedger } from './record.js';

/** Attribute an unrecorded on-chain event to an account when that wallet staked through the UI before. */
async function accountForWallet(wallet) {
	const [row] = await sql`select account_id from event_market_stakes where wallet = ${wallet} and account_id is not null limit 1`;
	return row?.account_id ?? null;
}

export async function reconcileAll() {
	const out = [];
	for (const pool of await listPools()) {
		const [title] = await sql`select title, slug from event_markets where id = ${pool.marketId}`;
		let entry = { market_id: pool.marketId, slug: title?.slug, title: title?.title, token: pool.tokenKey, cluster: pool.cluster, status: pool.status, pool_address: pool.poolAddress };
		try {
			const synced = await syncPoolLedger(pool, { accountForWallet });
			const [chain, vault, ledger] = await Promise.all([readPool(pool.poolIdHex), vaultBalance(pool.poolIdHex, pool.mint), ledgerTotals(pool.marketId)]);
			entry = chain
				? { ...entry, chain_status: chain.statusName, synced_from_chain: synced, ...reconcilePool({ chain, vaultBalance: vault, ledger }) }
				: { ...entry, ok: false, problems: [{ code: 'pool_missing_on_chain' }] };
		} catch (err) {
			entry = { ...entry, ok: false, problems: [{ code: 'chain_unreachable', message: err.message }] };
		}
		out.push(entry);
	}
	return out;
}

