/**
 * POST /api/agents/solana-register-prep
 *
 * Builds a Metaplex Core NFT creation transaction for a Solana agent identity.
 * The server constructs the unsigned transaction; the user's wallet signs and submits it.
 * Returns: base64-encoded serialized transaction + prepId for the confirm step.
 *
 * Mirrors register-prep.js (EVM ERC-8004) but targets Solana / Metaplex Core.
 */

import { z } from 'zod';
import { createUmi }                   from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore, createV1, fetchAsset } from '@metaplex-foundation/mpl-core';
import {
	generateSigner,
	publicKey as umiPublicKey,
	signerIdentity,
	createNoopSigner,
} from '@metaplex-foundation/umi';
import { sql }       from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { randomToken } from '../_lib/crypto.js';
import { env } from '../_lib/env.js';

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Base58 alphabet excluding 0/O/I/l. Mirrors src/solana/vanity/validation.js.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
// Vanity prefixes >= this length require a paid plan.
const VANITY_FREE_THRESHOLD = 5;

const bodySchema = z.object({
	name:           z.string().trim().min(1).max(60),
	description:    z.string().trim().max(280).default(''),
	avatar_id:      z.string().uuid().optional(),
	wallet_address: z.string().min(32).max(44), // Solana base58 pubkey
	metadata_uri:   z.string().url().optional(), // pre-pinned IPFS or HTTPS URI
	network:        z.enum(['mainnet', 'devnet']).default('mainnet'),
	// Optional client-grinded vanity asset pubkey. When provided, the server
	// builds the tx against this pubkey (noop signer) and the client must
	// sign the tx with the matching keypair before submitting.
	asset_pubkey:   z.string().min(32).max(44).optional(),
	vanity_prefix:  z.string().min(1).max(6).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const { name, description, avatar_id, wallet_address, network, asset_pubkey, vanity_prefix } = body;

	// Verify wallet belongs to this user.
	const [walletRow] = await sql`
		select id from user_wallets
		where user_id = ${user.id} and address = ${wallet_address} and chain_type = 'solana'
		limit 1
	`;
	if (!walletRow) return error(res, 403, 'forbidden', 'wallet not linked to your account');

	// If avatar_id provided, verify ownership.
	if (avatar_id) {
		const [av] = await sql`select id from avatars where id=${avatar_id} and owner_id=${user.id} and deleted_at is null limit 1`;
		if (!av) return error(res, 404, 'not_found', 'avatar not found');
	}

	// Vanity validation + paywall. Both fields are optional but must agree
	// when present (we don't trust the client to honestly report length).
	if (vanity_prefix && !asset_pubkey) {
		return error(res, 400, 'validation_error', 'vanity_prefix requires asset_pubkey');
	}
	if (asset_pubkey) {
		if (!BASE58_RE.test(asset_pubkey)) {
			return error(res, 400, 'validation_error', 'asset_pubkey is not valid base58');
		}
		if (vanity_prefix) {
			if (!BASE58_RE.test(vanity_prefix)) {
				return error(res, 400, 'validation_error', 'vanity_prefix is not valid base58');
			}
			if (!asset_pubkey.startsWith(vanity_prefix)) {
				return error(res, 400, 'validation_error', 'asset_pubkey does not start with vanity_prefix');
			}
			if (vanity_prefix.length >= VANITY_FREE_THRESHOLD && (user.plan ?? 'free') === 'free') {
				return error(res, 402, 'payment_required',
					`vanity prefixes of ${VANITY_FREE_THRESHOLD}+ characters require a paid plan`);
			}
		}
	}

	const rpcEndpoint = network === 'devnet'
		? (process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com')
		: SOLANA_RPC;

	// Build Umi instance. We use a noop signer since the user's wallet will sign.
	const umi = createUmi(rpcEndpoint).use(mplCore());
	const ownerPubkey = umiPublicKey(wallet_address);
	// Asset signer: either the client-supplied vanity pubkey (noop — client signs)
	// or a freshly-generated server-side throwaway keypair.
	const assetSigner = asset_pubkey
		? createNoopSigner(umiPublicKey(asset_pubkey))
		: generateSigner(umi);
	// Set the owner as a noop signer so Umi treats them as a required signer.
	umi.use(signerIdentity(createNoopSigner(ownerPubkey)));

	// Build the metadata URI: use provided one or synthesize from our app.
	const appOrigin = env.APP_ORIGIN;
	const metadataUri = body.metadata_uri || `${appOrigin}/api/agents/solana-metadata?name=${encodeURIComponent(name)}&desc=${encodeURIComponent(description)}`;

	// Build the createV1 (Metaplex Core NFT creation) instruction.
	const builder = createV1(umi, {
		asset:          assetSigner,
		owner:          ownerPubkey,
		name,
		uri:            metadataUri,
		// No collection — standalone asset for agent identity
	});

	// Serialize the transaction as base64 for the frontend. buildAndSign returns
	// a Transaction object — use the Umi transaction factory to get raw bytes.
	const tx       = await builder.buildAndSign(umi);
	const txBytes  = umi.transactions.serialize(tx);
	const txBase64 = Buffer.from(txBytes).toString('base64');

	// Store prep record.
	const prepId   = await randomToken(24);
	const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

	await sql`
		insert into agent_registrations_pending (user_id, cid, metadata_uri, payload, expires_at)
		values (
			${user.id},
			${assetSigner.publicKey},
			${metadataUri},
			${JSON.stringify({
				name, description, avatar_id, wallet_address,
				asset_pubkey: assetSigner.publicKey,
				network,
				prep_id: prepId,
				vanity_prefix: vanity_prefix || null,
			})}::jsonb,
			${expiresAt}
		)
	`;

	return json(res, 201, {
		prep_id:     prepId,
		asset_pubkey: assetSigner.publicKey,
		tx_base64:   txBase64,
		network,
		metadata_uri: metadataUri,
		expires_at:  expiresAt.toISOString(),
		instructions: 'Sign and submit the transaction with your Solana wallet, then call /api/agents/solana-register-confirm with the tx signature.',
	});
});
