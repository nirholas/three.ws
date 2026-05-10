/**
 * GET  /api/purchase/skill?agent_id=&skill=   — Solana Pay transaction request GET (label/icon)
 * POST /api/purchase/skill?agent_id=&skill=   — Solana Pay transaction request POST (build tx)
 *
 * Implements the Solana Pay Transaction Request spec so wallets that scan a
 * QR code can fetch and sign the USDC transfer directly.
 */
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction, getMint } from '@solana/spl-token';
import { findReference } from '@solana/pay';

import { sql } from '../_lib/db.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const url = new URL(req.url, 'http://x');
	const agentId   = url.searchParams.get('agent_id');
	const skillName = url.searchParams.get('skill');

	if (!agentId || !skillName) {
		return error(res, 400, 'validation_error', 'agent_id and skill query params required');
	}

	if (req.method === 'GET') {
		// Solana Pay spec: return label + icon for the wallet QR display
		return json(res, 200, {
			label:   'three.ws Agent Marketplace',
			icon:    'https://three.ws/favicon.ico',
		});
	}

	// POST — wallet sends its account (public key), we return a prepared transaction
	const body = await readJson(req).catch(() => null);
	const account = body?.account;
	if (!account) return error(res, 400, 'validation_error', 'account required');

	const [price] = await sql`
		SELECT amount, currency_mint, chain
		FROM agent_skill_prices
		WHERE agent_id = ${agentId} AND skill = ${skillName} AND is_active = true
		LIMIT 1
	`;
	if (!price) return error(res, 404, 'not_found', 'skill is not for sale');
	if (price.chain !== 'solana') {
		return error(res, 400, 'unsupported_chain', 'only solana transactions are supported via this endpoint');
	}

	// Resolve payout wallet
	const [payout] = await sql`
		SELECT pw.address
		FROM agent_identities a
		JOIN agent_payout_wallets pw
		  ON pw.user_id = a.user_id
		 AND pw.chain = 'solana'
		 AND (pw.agent_id = a.id OR pw.is_default = true)
		WHERE a.id = ${agentId} AND a.deleted_at IS NULL
		ORDER BY (pw.agent_id IS NOT NULL) DESC, pw.is_default DESC, pw.created_at ASC
		LIMIT 1
	`;
	let recipient = payout?.address;
	if (!recipient) {
		const [row] = await sql`SELECT meta FROM agent_identities WHERE id = ${agentId}`;
		recipient = row?.meta?.solana_address ?? null;
	}
	if (!recipient) return error(res, 412, 'creator_wallet_missing', 'agent owner has not configured a payout wallet');

	// Reference keypair for Solana Pay tracking
	const referenceKeypair = Keypair.generate();
	const referenceKey = referenceKeypair.publicKey;

	// Record pending purchase
	await sql`
		INSERT INTO skill_purchases (agent_id, skill, status, reference, amount, currency_mint, chain)
		VALUES (${agentId}, ${skillName}, 'pending', ${referenceKey.toBase58()},
		        ${price.amount}, ${price.currency_mint}, 'solana')
		ON CONFLICT DO NOTHING
	`;

	// Build transaction
	const connection = new Connection(SOLANA_RPC, 'confirmed');
	const { blockhash } = await connection.getLatestBlockhash('confirmed');

	const mintInfo = await getMint(connection, new PublicKey(price.currency_mint));
	const buyer    = new PublicKey(account);
	const mintKey  = new PublicKey(price.currency_mint);

	const fromAta = getAssociatedTokenAddressSync(mintKey, buyer);
	const toAta   = getAssociatedTokenAddressSync(mintKey, new PublicKey(recipient));

	const ix = createTransferCheckedInstruction(
		fromAta, mintKey, toAta, buyer, BigInt(price.amount), mintInfo.decimals,
	);
	ix.keys.push({ pubkey: referenceKey, isSigner: false, isWritable: false });

	const tx = new Transaction({ feePayer: buyer, recentBlockhash: blockhash }).add(ix);
	const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

	return json(res, 200, { transaction: serialized.toString('base64') });
});
