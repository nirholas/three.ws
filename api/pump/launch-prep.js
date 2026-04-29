// POST /api/pump/launch-prep
//
// Builds an unsigned transaction that:
//   1. creates a pump.fun bonding-curve token (createInstruction or
//      createAndBuyInstructions if `sol_buy_in` > 0)
//   2. binds it to a pump-agent-payments PDA via PumpAgent.create with the
//      caller's chosen buybackBps
//
// The user signs + submits in their wallet, then calls launch-confirm.

import { z } from 'zod';
import { Keypair } from '@solana/web3.js';
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { randomToken } from '../_lib/crypto.js';
import {
	getPumpSdk,
	getPumpAgentOffline,
	buildUnsignedTxBase64,
	solanaPubkey,
} from '../_lib/pump.js';

const bodySchema = z.object({
	agent_id: z.string().uuid(),
	wallet_address: z.string().min(32).max(44),
	name: z.string().trim().min(1).max(32),
	symbol: z.string().trim().min(1).max(10),
	uri: z.string().url(),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	buyback_bps: z.number().int().min(0).max(10_000).default(0),
	sol_buy_in: z.number().nonnegative().max(50).default(0), // optional creator initial buy, capped 50 SOL
	// Optional client-ground vanity mint address. When provided, the client
	// already holds the secret key locally and will co-sign in the wallet —
	// the server never sees the secret. When omitted, the server falls back
	// to a fresh Keypair.generate() and returns the secret key for co-sign.
	mint_address: z.string().min(32).max(44).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const creator = solanaPubkey(body.wallet_address);
	if (!creator) return error(res, 400, 'validation_error', 'invalid wallet_address');

	// Verify wallet linked to user.
	const [walletRow] = await sql`
		select id from user_wallets
		where user_id=${user.id} and address=${body.wallet_address} and chain_type='solana'
		limit 1
	`;
	if (!walletRow) return error(res, 403, 'forbidden', 'wallet not linked to your account');

	// Verify the agent belongs to this user.
	const [agent] = await sql`
		select id, name from agent_identities
		where id=${body.agent_id} and user_id=${user.id} and deleted_at is null limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	// Mint pubkey: client-supplied (vanity-ground) or freshly generated.
	let mintKeypair = null;
	let mint;
	if (body.mint_address) {
		const supplied = solanaPubkey(body.mint_address);
		if (!supplied) return error(res, 400, 'validation_error', 'invalid mint_address');
		mint = supplied;
	} else {
		mintKeypair = Keypair.generate();
		mint = mintKeypair.publicKey;
	}

	const { sdk, BN } = await getPumpSdk({ network: body.network });
	const LAMPORTS_PER_SOL = 1_000_000_000;

	const instructions = [];
	if (body.sol_buy_in > 0 && sdk.createAndBuyInstructions) {
		const global = await sdk.fetchGlobal();
		const solAmount = new BN(Math.floor(body.sol_buy_in * LAMPORTS_PER_SOL));
		const pumpSdk = await import('@pump-fun/pump-sdk');
		const tokenAmount = pumpSdk.getBuyTokenAmountFromSolAmount(global, null, solAmount);
		const ixs = await sdk.createAndBuyInstructions({
			global,
			mint,
			name: body.name,
			symbol: body.symbol,
			uri: body.uri,
			creator,
			user: creator,
			solAmount,
			amount: tokenAmount,
		});
		instructions.push(...(Array.isArray(ixs) ? ixs : [ixs]));
	} else {
		const ix = await sdk.createInstruction({
			mint,
			name: body.name,
			symbol: body.symbol,
			uri: body.uri,
			creator,
			user: creator,
		});
		instructions.push(ix);
	}

	// Bind PumpAgent.create.
	if (body.buyback_bps > 0) {
		const { offline } = await getPumpAgentOffline({ network: body.network, mint });
		const createIx = await offline.create({
			authority: creator,
			mint,
			agentAuthority: creator,
			buybackBps: body.buyback_bps,
		});
		instructions.push(createIx);
	}

	const txBase64 = await buildUnsignedTxBase64({
		network: body.network,
		payer: creator,
		instructions,
	});

	const prepId = await randomToken(24);
	const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

	await sql`
		insert into agent_registrations_pending (user_id, cid, metadata_uri, payload, expires_at)
		values (
			${user.id},
			${mint.toBase58()},
			${body.uri},
			${JSON.stringify({
				kind: 'pump_launch',
				agent_id: body.agent_id,
				wallet_address: body.wallet_address,
				mint: mint.toBase58(),
				name: body.name,
				symbol: body.symbol,
				network: body.network,
				buyback_bps: body.buyback_bps,
				prep_id: prepId,
			})}::jsonb,
			${expiresAt}
		)
	`;

	return json(res, 201, {
		prep_id: prepId,
		mint: mint.toBase58(),
		// Mint keypair must co-sign the tx — frontend appends it before submit.
		mint_secret_key_b64: Buffer.from(mintKeypair.secretKey).toString('base64'),
		tx_base64: txBase64,
		network: body.network,
		buyback_bps: body.buyback_bps,
		expires_at: expiresAt.toISOString(),
		instructions:
			'Decode tx_base64 as VersionedTransaction. Sign with the mint keypair (mint_secret_key_b64) AND the user wallet, submit, then POST /api/pump/launch-confirm with the tx_signature.',
	});
});
