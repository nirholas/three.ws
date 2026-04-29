/**
 * Solana attestations crawler.
 *
 * For every Solana-registered agent in `agent_identities`, pulls recent SPL
 * Memo attestations referencing the agent's Metaplex Core asset pubkey and
 * upserts them into `solana_attestations`. Applies revoke/dispute flags.
 *
 * Runs on Vercel Cron every 5 minutes (see vercel.json). Manually triggerable
 * with `Authorization: Bearer $CRON_SECRET`.
 */

import { sql } from '../_lib/db.js';
import { cors, error, json, wrap } from '../_lib/http.js';
import { crawlAgentAttestations } from '../_lib/solana-attestations.js';

const PER_RUN_MAX = 50; // bound RPC fan-out per cron tick

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;

	const auth = req.headers['authorization'] || '';
	const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
	const fromCron = req.headers['x-vercel-cron'] === '1';
	if (!fromCron && expected && auth !== expected) {
		return error(res, 401, 'unauthorized', 'cron secret required');
	}

	// Pull Solana agents, oldest-cursor first.
	const agents = await sql`
		select
			a.id,
			a.meta->>'sol_mint_address' as agent_asset,
			coalesce(a.meta->>'network', 'mainnet') as network,
			a.wallet_address as owner_wallet,
			c.last_indexed_at
		from agent_identities a
		left join solana_attestations_cursor c
			on c.agent_asset = a.meta->>'sol_mint_address'
		where a.deleted_at is null
		  and a.meta ? 'sol_mint_address'
		order by c.last_indexed_at nulls first
		limit ${PER_RUN_MAX}
	`;

	const report = { agents: [], errors: [] };
	for (const row of agents) {
		try {
			const r = await crawlAgentAttestations({
				agentAsset:  row.agent_asset,
				network:     row.network,
				ownerWallet: row.owner_wallet,
			});
			report.agents.push({ asset: row.agent_asset, ...r });
		} catch (err) {
			report.errors.push({ asset: row.agent_asset, error: err.message || String(err) });
		}
	}

	return json(res, 200, report);
});
