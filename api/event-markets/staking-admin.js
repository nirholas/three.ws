// /api/event-markets/staking-admin: owner view of every staked pool. Admin only.
//   GET   reconcile: sync each pool's ledger from the chain, then compare vault
//         balance, on-chain totals and recorded stakes. Also the kill-switch state.
//   POST  { action: 'pause' | 'resume' }  flip the instant kill switch for NEW stakes
// Claims and refunds are never blocked by the switch. Guide: docs/event-markets-staking.md.

import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin.js';
import { requireCsrf } from '../_lib/csrf.js';
import { sql } from '../_lib/db.js';
import { stakingConfig } from '../_lib/event-markets/staking/config.js';
import { readConfig, readPool, vaultBalance } from '../_lib/event-markets/staking/chain.js';
import { ledgerTotals, listPools, getSettings, setStakesEnabled } from '../_lib/event-markets/staking/store.js';
import { reconcilePool } from '../_lib/event-markets/staking/reconcile.js';
import { syncPoolLedger } from '../_lib/event-markets/staking/record.js';

/** Attribute an unrecorded on-chain event to an account when that wallet staked through the UI before. */
async function accountForWallet(wallet) {
	const [row] = await sql`select account_id from event_market_stakes where wallet = ${wallet} and account_id is not null limit 1`;
	return row?.account_id ?? null;
}

async function reconcileAll() {
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

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	if (req.method === 'GET') {
		const cfg = stakingConfig();
		const [settings, pools, onchain] = await Promise.all([getSettings(), reconcileAll(), readConfig().catch(() => null)]);
		return json(res, 200, {
			flag_enabled: cfg.enabled,
			cluster: cfg.cluster,
			stakes_enabled: settings.stakesEnabled,
			onchain_paused: onchain ? onchain.paused : null,
			pools,
			all_ok: pools.every((p) => p.ok),
		}, { 'cache-control': 'no-store' });
	}

	if (!(await requireCsrf(req, res, admin.id))) return;
	const body = (await readJson(req)) || {};
	if (body.action !== 'pause' && body.action !== 'resume') return error(res, 400, 'validation_error', 'action must be pause or resume');
	await setStakesEnabled(body.action === 'resume', admin.id);
	return json(res, 200, { stakes_enabled: body.action === 'resume' });
});
