/**
 * POST /api/agents/onchain/confirm
 *
 * Unified confirm endpoint. Replaces:
 *   • /api/agents/register-confirm         (EVM)
 *   • /api/agents/solana-register-confirm  (Solana)
 *
 * Verifies the on-chain transaction and writes a *unified* `meta.onchain`
 * block to `agent_identities` so downstream queries don't need to fork on
 * chain family. Persists the wallet linkage as a side effect (it was already
 * pre-checked at prep, but we re-verify here using the tx as ownership proof).
 *
 * Unified onchain shape stored in agent_identities.meta:
 * {
 *   onchain: {
 *     chain:           "eip155:8453" | "solana:5eyk...",   // CAIP-2
 *     family:          "evm" | "solana",
 *     tx_hash:         "0xabc..." | "<base58 sig>",
 *     onchain_id:      "<EVM agentId>" | null,             // null on Solana
 *     contract_or_mint:"<EVM registry addr>" | "<Solana mint pubkey>",
 *     wallet:          "<owner address>",
 *     metadata_uri:    "ipfs://...",
 *     confirmed_at:    "<ISO timestamp>",
 *     ... family-specific extras
 *   }
 * }
 */

import { z } from 'zod';
import { Connection } from '@solana/web3.js';
import { JsonRpcProvider } from 'ethers';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { env } from '../../_lib/env.js';

const bodySchema = z.object({
	prep_id: z.string().min(8).max(80),
	tx_hash: z.string().min(8).max(120),
	onchain_id: z.string().nullable().optional(),
	wallet_address: z.string().min(20).max(80),
});

// ── Verifiers ────────────────────────────────────────────────────────────────

async function verifyEvm({ chainId, txHash, expectedContract, expectedOwner }) {
	const { CHAIN_BY_ID } = await import('../../_lib/erc8004-chains.js');
	const cfg = CHAIN_BY_ID[chainId];
	if (!cfg?.rpcUrl) throw new Error(`no RPC for chainId ${chainId}`);

	const provider = new JsonRpcProvider(cfg.rpcUrl);
	const receipt = await provider.getTransactionReceipt(txHash);
	if (!receipt) {
		const e = new Error('Transaction not found yet — try again in a few seconds.');
		e.code = 'tx_not_found';
		e.status = 422;
		throw e;
	}
	if (receipt.status !== 1) {
		const e = new Error('Transaction failed on-chain.');
		e.code = 'tx_failed';
		e.status = 422;
		throw e;
	}
	if (
		expectedContract &&
		receipt.to &&
		receipt.to.toLowerCase() !== expectedContract.toLowerCase()
	) {
		const e = new Error('tx target does not match expected registry.');
		e.code = 'tx_wrong_target';
		e.status = 422;
		throw e;
	}
	if (receipt.from.toLowerCase() !== expectedOwner.toLowerCase()) {
		const e = new Error('tx sender does not match wallet_address.');
		e.code = 'tx_wrong_sender';
		e.status = 422;
		throw e;
	}
	return { blockNumber: receipt.blockNumber };
}

async function verifySolana({ cluster, txSig, expectedAsset, expectedOwner }) {
	const rpc =
		cluster === 'devnet'
			? process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com'
			: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
	const conn = new Connection(rpc, 'confirmed');

	// Bounded poll — RPC may not have indexed the tx yet, especially on devnet.
	const deadline = Date.now() + 20_000;
	let tx;
	while (Date.now() < deadline) {
		tx = await conn.getParsedTransaction(txSig, {
			maxSupportedTransactionVersion: 0,
			commitment: 'confirmed',
		});
		if (tx) break;
		await new Promise((r) => setTimeout(r, 1500));
	}
	if (!tx) {
		const e = new Error('Transaction not found on Solana RPC.');
		e.code = 'tx_not_found';
		e.status = 422;
		throw e;
	}
	if (tx.meta?.err) {
		const e = new Error('Transaction failed on-chain.');
		e.code = 'tx_failed';
		e.status = 422;
		throw e;
	}

	const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey?.toString());
	if (expectedAsset && !accountKeys.includes(expectedAsset)) {
		const e = new Error('Asset pubkey not found in transaction.');
		e.code = 'asset_not_in_tx';
		e.status = 422;
		throw e;
	}
	if (!accountKeys.includes(expectedOwner)) {
		const e = new Error('Wallet address not in transaction signers.');
		e.code = 'wrong_signer';
		e.status = 422;
		throw e;
	}
	return { slot: tx.slot };
}

// ── Endpoint ─────────────────────────────────────────────────────────────────

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	const [prep] = await sql`
		select id, payload, metadata_uri, cid
		from agent_registrations_pending
		where user_id = ${user.id}
		  and payload->>'prep_id' = ${body.prep_id}
		  and expires_at > now()
		limit 1
	`;
	if (!prep) return error(res, 404, 'not_found', 'prep record expired or not found');

	const p = prep.payload;
	if (p.wallet_address !== body.wallet_address) {
		return error(res, 400, 'validation_error', 'wallet_address mismatch with prep record');
	}

	// Verify on-chain
	try {
		if (p.chain_family === 'evm') {
			const chainId = Number(p.chain.split(':')[1]);
			await verifyEvm({
				chainId,
				txHash: body.tx_hash,
				expectedContract: p.contract_address,
				expectedOwner: body.wallet_address,
			});
		} else if (p.chain_family === 'solana') {
			await verifySolana({
				cluster: p.cluster,
				txSig: body.tx_hash,
				expectedAsset: p.asset_pubkey,
				expectedOwner: body.wallet_address,
			});
		} else {
			return error(res, 400, 'validation_error', `unknown chain family: ${p.chain_family}`);
		}
	} catch (e) {
		return error(res, e.status || 500, e.code || 'verify_failed', e.message);
	}

	// Link wallet to user (idempotent — confirm time, since tx is ownership proof).
	await sql`
		insert into user_wallets (user_id, address, chain_type, is_primary)
		values (${user.id}, ${body.wallet_address}, ${p.chain_family === 'solana' ? 'solana' : 'evm'}, false)
		on conflict do nothing
	`;

	// Build the unified onchain block.
	const onchain = {
		chain: p.chain,
		family: p.chain_family,
		tx_hash: body.tx_hash,
		onchain_id: body.onchain_id || null,
		contract_or_mint: p.contract_address || p.asset_pubkey || null,
		wallet: body.wallet_address,
		metadata_uri: prep.metadata_uri,
		confirmed_at: new Date().toISOString(),
		...(p.chain_family === 'solana' ? { cluster: p.cluster } : {}),
	};

	// Upsert agent_identities. If a row already exists for (user, agent), we
	// merge the new onchain block in — supports redeploying across chains.
	const [existing] = await sql`
		select id, meta from agent_identities
		where user_id = ${user.id}
		  and (id::text = ${p.agent_id} or name = ${p.name})
		  and deleted_at is null
		limit 1
	`;

	let agent;
	if (existing) {
		const mergedMeta = { ...(existing.meta || {}), onchain };
		[agent] = await sql`
			update agent_identities
			set meta = ${JSON.stringify(mergedMeta)}::jsonb,
			    wallet_address = ${body.wallet_address},
			    updated_at = now()
			where id = ${existing.id}
			returning id, name, description, wallet_address, meta, created_at
		`;
	} else {
		[agent] = await sql`
			insert into agent_identities
				(user_id, name, description, avatar_id, wallet_address, meta)
			values (
				${user.id},
				${p.name},
				${p.description},
				${p.avatar_id},
				${body.wallet_address},
				${JSON.stringify({ onchain })}::jsonb
			)
			returning id, name, description, wallet_address, meta, created_at
		`;
	}

	// Cleanup prep
	await sql`delete from agent_registrations_pending where id = ${prep.id}`;

	return json(res, 201, {
		ok: true,
		agent: {
			...agent,
			onchain,
			home_url: `${env.APP_ORIGIN}/agent/${agent.id}`,
		},
	});
});
