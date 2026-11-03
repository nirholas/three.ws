// The account holder's own wallet, as opposed to an agent's platform wallet.
//
// "Private wallet" is the primary Solana wallet linked to the account (the one
// the owner signs with). It is never custodial: the platform only reads its
// balances. Shared by GET /api/me/wallet and the get_private_wallet_balance and
// get_wallet_summaries tools.

import { sql } from '../db.js';
import { primaryLinkedSolanaWallet } from './signing.js';
import { readSolUsdc, parseNetwork } from './balance-reader.js';

const wire = (r) => ({
	address: r.address,
	network: r.network,
	sol: r.sol,
	lamports: r.lamports.toString(),
	usdc: r.usdc,
	usdc_raw: r.usdc_raw.toString(),
	sol_usd: r.sol_usd,
	usd_total: r.usd_total,
});

/**
 * @returns {Promise<{ linked: false, network: string } | ({ linked: true } & ReturnType<typeof wire>)>}
 */
export async function readPrivateWallet(userId, networkInput = 'mainnet', deps = {}) {
	const network = parseNetwork(networkInput);
	const address = await primaryLinkedSolanaWallet(userId);
	if (!address) return { linked: false, network };
	const reading = await (deps.readSolUsdc || readSolUsdc)({ address, network });
	return { linked: true, ...wire(reading) };
}

/**
 * Every agent wallet the account owns with its latest recorded hourly snapshot,
 * plus the live private wallet. Agent rows come from agent_balance_history, so
 * one call never fans out an RPC read per agent.
 */
export async function readWalletSummaries(userId, networkInput = 'mainnet', deps = {}) {
	const network = parseNetwork(networkInput);
	const rows = await sql`
		select i.id as agent_id, i.name, i.meta->>'solana_address' as address,
		       h.captured_at, h.lamports, h.usdc_raw, h.sol_usd, h.usd_total
		from agent_identities i
		left join lateral (
			select captured_at, lamports, usdc_raw, sol_usd, usd_total
			from agent_balance_history
			where agent_id = i.id and network = ${network}
			order by captured_at desc
			limit 1
		) h on true
		where i.user_id = ${userId} and i.deleted_at is null and i.meta ? 'solana_address'
		order by h.usd_total desc nulls last, i.name asc
		limit 200
	`;
	const agents = rows.map((r) => ({
		agent_id: r.agent_id,
		name: r.name,
		address: r.address,
		snapshot_at: r.captured_at ? new Date(r.captured_at).toISOString() : null,
		sol: r.lamports != null ? Number(r.lamports) / 1e9 : null,
		usdc: r.usdc_raw != null ? Number(r.usdc_raw) / 1e6 : null,
		usd_total: r.usd_total != null ? Number(r.usd_total) : null,
	}));
	const priv = await readPrivateWallet(userId, network, deps);
	const known = agents.filter((a) => a.usd_total != null);
	const total = known.reduce((s, a) => s + a.usd_total, 0) + (priv.linked && priv.usd_total != null ? priv.usd_total : 0);
	return {
		network,
		private_wallet: priv,
		agents,
		agents_without_snapshot: agents.length - known.length,
		total_usd: total,
	};
}
