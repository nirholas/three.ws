import { sql } from './db.js';

export async function resolvePayoutAddress(agentId, chain) {
	const [wallet] = await sql`
		select address from agent_payout_wallets
		where agent_id = ${agentId} and chain = ${chain}
		order by is_default desc, created_at desc
		limit 1
	`;
	if (wallet) return wallet.address;

	const [agent] = await sql`
		select wallet_address from agent_identities where id = ${agentId}
	`;
	return agent?.wallet_address ?? null;
}
