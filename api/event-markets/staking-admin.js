// /api/event-markets/staking-admin: owner view of every staked pool. Admin only.
//   GET   reconcile: sync each pool's ledger from the chain, then compare vault
//         balance, on-chain totals and recorded stakes. Also the kill-switch state.
//   POST  { action: 'pause' | 'resume' }  flip the instant kill switch for NEW stakes
// Claims and refunds are never blocked by the switch. Guide: docs/event-markets-staking.md.

import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin.js';
import { requireCsrf } from '../_lib/csrf.js';
import { stakingConfig } from '../_lib/event-markets/staking/config.js';
import { readConfig } from '../_lib/event-markets/staking/chain.js';
import { getSettings, setStakesEnabled } from '../_lib/event-markets/staking/store.js';
import { reconcileAll } from '../_lib/event-markets/staking/reconcile-all.js';

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
