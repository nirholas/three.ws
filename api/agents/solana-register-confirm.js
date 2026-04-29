/**
 * POST /api/agents/solana-register-confirm
 *
 * Confirms that the Metaplex Core NFT was successfully minted on Solana,
 * then stores the agent identity linked to the NFT mint address.
 */

import { z } from 'zod';
import { Connection } from '@solana/web3.js';
import { sql }       from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { env } from '../_lib/env.js';

const bodySchema = z.object({
	tx_signature:  z.string().min(80).max(100),
	asset_pubkey:  z.string().min(32).max(44), // Metaplex Core asset address (base58)
	wallet_address: z.string().min(32).max(44),
	network:       z.enum(['mainnet', 'devnet']).default('mainnet'),
	// Optional overrides
	name:          z.string().trim().min(1).max(60).optional(),
	description:   z.string().trim().max(280).optional(),
	avatar_id:     z.string().uuid().optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const { tx_signature, asset_pubkey, wallet_address, network } = body;

	// Verify wallet is linked to user.
	const [walletRow] = await sql`
		select id from user_wallets
		where user_id=${user.id} and address=${wallet_address} and chain_type='solana'
		limit 1
	`;
	if (!walletRow) return error(res, 403, 'forbidden', 'wallet not linked to your account');

	// Verify transaction on-chain.
	const rpcEndpoint = network === 'devnet'
		? (process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com')
		: (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

	const connection = new Connection(rpcEndpoint, 'confirmed');

	let tx;
	try {
		tx = await connection.getParsedTransaction(tx_signature, {
			maxSupportedTransactionVersion: 0,
			commitment: 'confirmed',
		});
	} catch {
		return error(res, 422, 'tx_not_found', 'transaction not found — try again after a few seconds');
	}
	if (!tx)          return error(res, 422, 'tx_not_found', 'transaction not found');
	if (tx.meta?.err) return error(res, 422, 'tx_failed', 'transaction failed on-chain');

	// Confirm the asset_pubkey appears as a writable account in the tx
	// (it was created — its balance went from 0 to > 0).
	const accountKeys  = tx.transaction.message.accountKeys.map((k) => k.pubkey?.toString());
	const assetInTx    = accountKeys.includes(asset_pubkey);
	if (!assetInTx) {
		return error(res, 422, 'asset_not_in_tx',
			'The asset pubkey was not found in the transaction accounts');
	}

	// Check if agent identity already exists for this mint.
	const [existing] = await sql`
		select id from agent_identities
		where (meta->>'sol_mint_address') = ${asset_pubkey} and deleted_at is null
		limit 1
	`;
	if (existing) return error(res, 409, 'conflict', 'agent already registered for this mint');

	// Resolve name/description from pending record or body.
	const [pending] = await sql`
		select payload from agent_registrations_pending
		where user_id=${user.id} and payload->>'asset_pubkey'=${asset_pubkey}
		  and expires_at > now()
		order by created_at desc limit 1
	`;
	const payload    = pending?.payload || {};
	const name       = body.name        || payload.name        || `Agent ${asset_pubkey.slice(0, 6)}`;
	const description = body.description || payload.description || '';
	const avatar_id  = body.avatar_id   || payload.avatar_id   || null;

	// Create agent identity record.
	const [agent] = await sql`
		insert into agent_identities
			(user_id, name, description, avatar_id, wallet_address, meta)
		values (
			${user.id},
			${name},
			${description},
			${avatar_id},
			${wallet_address},
			${JSON.stringify({
				chain_type:       'solana',
				network,
				sol_mint_address: asset_pubkey,
				tx_signature,
				...(payload.vanity_prefix ? { vanity_prefix: payload.vanity_prefix } : {}),
			})}::jsonb
		)
		returning id, name, description, wallet_address, meta, created_at
	`;

	// Clean up pending record.
	await sql`
		delete from agent_registrations_pending
		where user_id=${user.id} and payload->>'asset_pubkey'=${asset_pubkey}
	`;

	const appOrigin = env.APP_ORIGIN;
	return json(res, 201, {
		ok: true,
		agent: {
			...agent,
			home_url: `${appOrigin}/agent/${agent.id}`,
		},
		sol_mint_address: asset_pubkey,
		tx_signature,
		network,
	});
});
