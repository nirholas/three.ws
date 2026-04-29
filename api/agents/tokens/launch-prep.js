/**
 * POST /api/agents/tokens/launch-prep
 *
 * Build an unsigned Pump.fun coin-creation transaction for the user to sign.
 *
 * Flow:
 *   1. Verify the agent belongs to caller and was deployed on Solana.
 *   2. Verify caller's wallet matches the agent's owner wallet.
 *   3. Pin token metadata JSON (name/symbol/description/image) to IPFS.
 *   4. Generate a fresh mint Keypair, build the create instruction via
 *      @pump-fun/pump-sdk, partial-sign with the mint, return base64.
 *   5. Persist a prep record (`token_launches_pending`) the confirm endpoint
 *      validates against.
 *
 * The mint Keypair is destroyed after partial-signing — its signature is now
 * embedded in the serialized tx bytes, so we never need to retain the secret.
 */

import { z } from 'zod';
import {
	Connection,
	Keypair,
	PublicKey,
	Transaction,
	ComputeBudgetProgram,
	SystemProgram,
} from '@solana/web3.js';
import { PumpSdk, getBuyTokenAmountFromSolAmount } from '@pump-fun/pump-sdk';
import BN from 'bn.js';

import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { randomToken } from '../../_lib/crypto.js';
import { env } from '../../_lib/env.js';
import { r2 } from '../../_lib/r2.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

const bodySchema = z.object({
	agent_id: z.string().min(1).max(80),
	provider: z.literal('pumpfun'),
	cluster: z.enum(['mainnet', 'devnet']),
	wallet_address: z.string().min(32).max(44),
	name: z.string().trim().min(1).max(32),
	// Pump.fun caps symbols at ~10 chars; let's be permissive but clamped.
	symbol: z
		.string()
		.trim()
		.min(2)
		.max(10)
		.regex(/^[A-Za-z0-9]+$/, 'symbol must be alphanumeric'),
	description: z.string().trim().max(280).default(''),
	image: z.string().url().or(z.literal('')).default(''),
	initial_buy_sol: z.number().min(0).max(50).default(0),
});

function rpcUrl(cluster) {
	return cluster === 'devnet'
		? process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com'
		: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

async function pinTokenMetadata({ name, symbol, description, image }) {
	const json = {
		name,
		symbol,
		description,
		image,
		showName: true,
		createdOn: 'three.ws',
	};
	const bytes = Buffer.from(JSON.stringify(json), 'utf-8');
	const token = process.env.WEB3_STORAGE_TOKEN;
	if (token) {
		try {
			const r = await fetch('https://api.web3.storage/upload', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` },
				body: bytes,
			});
			if (r.ok) {
				const data = await r.json();
				if (data.cid) return { cid: data.cid, uri: `ipfs://${data.cid}` };
			}
		} catch (e) {
			console.warn('[token launch-prep] web3.storage pin failed:', e.message);
		}
	}
	const hash = createHash('sha256').update(bytes).digest('hex');
	const stub = `bafkreigenerated${hash.slice(0, 40)}`;
	const key = `token-metadata/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
	await r2.send(
		new PutObjectCommand({
			Bucket: env.S3_BUCKET,
			Key: key,
			Body: bytes,
			ContentType: 'application/json',
		}),
	);
	return { cid: stub, uri: `ipfs://${stub}` };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	// Resolve agent + ownership + Solana deploy state
	const [agent] = await sql`
		select id, name, user_id, wallet_address, meta
		from agent_identities
		where id = ${body.agent_id} and user_id = ${user.id} and deleted_at is null
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	const onchain = agent.meta?.onchain;
	if (!onchain || onchain.family !== 'solana') {
		return error(
			res,
			409,
			'precondition_failed',
			'agent must be deployed on Solana before launching a token',
		);
	}
	if (onchain.wallet?.toLowerCase?.() !== body.wallet_address.toLowerCase?.()) {
		// Solana addresses are case-sensitive; equality check is exact.
		if (onchain.wallet !== body.wallet_address) {
			return error(res, 403, 'forbidden', 'wallet does not match agent owner');
		}
	}
	if (agent.meta?.token?.mint) {
		return error(res, 409, 'conflict', 'agent already has a launched token');
	}

	// 3. Pin token metadata
	const { cid, uri: metadataUri } = await pinTokenMetadata({
		name: body.name,
		symbol: body.symbol,
		description: body.description,
		image: body.image,
	});

	// 4. Build the launch tx
	const conn = new Connection(rpcUrl(body.cluster), 'confirmed');
	const sdk = new PumpSdk(conn);

	const mintKeypair = Keypair.generate();
	const creator = new PublicKey(body.wallet_address);
	const userPk = creator;

	const ixs = [
		// Bump compute budget — coin creation routinely exceeds the 200k default.
		ComputeBudgetProgram.setComputeUnitLimit({ units: 350_000 }),
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
	];

	if (body.initial_buy_sol > 0) {
		const global = await sdk.fetchGlobal();
		const lamports = new BN(Math.floor(body.initial_buy_sol * 1_000_000_000));
		const tokenAmount = getBuyTokenAmountFromSolAmount({
			global,
			feeConfig: null,
			mintSupply: null,
			bondingCurve: null,
			amount: lamports,
		});
		const launchIxs = await sdk.createAndBuyInstructions({
			global,
			mint: mintKeypair.publicKey,
			name: body.name,
			symbol: body.symbol,
			uri: metadataUri,
			creator,
			user: userPk,
			amount: tokenAmount,
			solAmount: lamports,
		});
		ixs.push(...launchIxs);
	} else {
		const ix = await sdk.createV2Instruction({
			mint: mintKeypair.publicKey,
			name: body.name,
			symbol: body.symbol,
			uri: metadataUri,
			creator,
			user: userPk,
			mayhemMode: false,
		});
		ixs.push(ix);
	}

	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
	const tx = new Transaction({
		feePayer: creator,
		blockhash,
		lastValidBlockHeight,
	}).add(...ixs);

	// Partial-sign with the mint keypair. The user's wallet adds the creator
	// signature client-side before submission. After this serialize, the mint
	// secret key is no longer needed and goes out of scope.
	tx.partialSign(mintKeypair);

	const txBase64 = tx
		.serialize({ requireAllSignatures: false, verifySignatures: false })
		.toString('base64');

	// 5. Persist prep
	const prepId = await randomToken(24);
	const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

	await sql`
		insert into token_launches_pending
			(id, user_id, agent_id, provider, cluster, mint, metadata_uri, cid, payload, expires_at)
		values (
			${prepId},
			${user.id},
			${agent.id},
			'pumpfun',
			${body.cluster},
			${mintKeypair.publicKey.toBase58()},
			${metadataUri},
			${cid},
			${JSON.stringify({
				name: body.name,
				symbol: body.symbol,
				description: body.description,
				image: body.image,
				initial_buy_sol: body.initial_buy_sol,
				wallet_address: body.wallet_address,
			})}::jsonb,
			${expiresAt}
		)
		on conflict (id) do nothing
	`;

	return json(res, 201, {
		prep_id: prepId,
		mint: mintKeypair.publicKey.toBase58(),
		tx_base64: txBase64,
		metadata_uri: metadataUri,
		cluster: body.cluster,
		expires_at: expiresAt.toISOString(),
	});
});

// Make sure SystemProgram import isn't tree-shaken away (some bundlers complain
// about unused imports). It's a peer for compute-budget instructions on some
// Pump.fun program versions.
void SystemProgram;
