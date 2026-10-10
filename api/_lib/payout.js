import { sql } from './db.js';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// The agent's own wallet on `chain`, used when the owner has not configured a
// payout wallet. agent_identities.wallet_address is the agent's EVM wallet on
// most rows (the Solana one lives in meta.solana_address, provisioned with the
// custodial wallet), so returning it unconditionally handed a 0x address to a
// Solana payTo. Each chain family only ever gets an address of its own shape.
export function ownWalletFor(chain, row) {
	if (!row) return null;
	const wallet = row.wallet_address || null;
	if (chain === 'solana') {
		if (row.solana_address) return row.solana_address;
		return wallet && !wallet.startsWith('0x') ? wallet : null;
	}
	return wallet && EVM_ADDRESS.test(wallet) ? wallet : null;
}

export async function resolvePayoutAddress(agentId, chain) {
	const [wallet] = await sql`
		select address from agent_payout_wallets
		where agent_id = ${agentId} and chain = ${chain}
		  and approved_at is not null and effective_at <= now()
		order by is_default desc, created_at desc
		limit 1
	`;
	if (wallet) return wallet.address;

	const [agent] = await sql`
		select wallet_address, meta->>'solana_address' as solana_address
		from agent_identities where id = ${agentId}
	`;
	return ownWalletFor(chain, agent);
}
