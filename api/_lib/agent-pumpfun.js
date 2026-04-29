// Shared helpers for agent → pump.fun actions.
// Loads an agent, requires the caller is the owner, and returns a signing
// Keypair derived from the agent's encrypted Solana secret.

import { sql } from './db.js';
import { Connection } from '@solana/web3.js';
import {
	generateSolanaAgentWallet,
	recoverSolanaAgentKeypair,
} from './agent-wallet.js';

const RPC = {
	mainnet: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
	devnet: process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com',
};

export function solanaConnection(network = 'mainnet') {
	return new Connection(RPC[network] || RPC.mainnet, 'confirmed');
}

/**
 * Load an agent owned by `userId`. If the agent has no Solana wallet yet
 * (older rows from before pump-fun integration), one is generated and
 * persisted into meta in-place.
 *
 * Returns { agent, keypair, meta }. Caller is responsible for calling
 * agent-payments / pump-sdk / pump-swap-sdk with `keypair`.
 */
export async function loadAgentForSigning(agentId, userId) {
	const [row] = await sql`
		SELECT * FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) return { error: { status: 404, code: 'not_found', msg: 'agent not found' } };
	if (row.user_id !== userId)
		return { error: { status: 403, code: 'forbidden', msg: 'not your agent' } };

	let meta = { ...(row.meta || {}) };
	if (!meta.encrypted_solana_secret || !meta.solana_address) {
		const sol = await generateSolanaAgentWallet();
		meta = { ...meta, solana_address: sol.address, encrypted_solana_secret: sol.encrypted_secret };
		await sql`
			UPDATE agent_identities
			SET meta = ${JSON.stringify(meta)}::jsonb
			WHERE id = ${agentId}
		`;
	}

	const keypair = await recoverSolanaAgentKeypair(meta.encrypted_solana_secret);
	return { agent: row, keypair, meta };
}
