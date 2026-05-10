/**
 * POST /api/payments/prepare-skill-purchase
 * Builds and returns a base64-serialised Solana legacy transaction that the
 * browser wallet can sign and send.  The buyer's public key must be provided
 * in the request body so the fee-payer and ATA source can be set correctly.
 *
 * Body: { agentId, skillName, buyerPublicKey }
 * Returns: { transaction (base64), reference, recipient, amount, currency_mint }
 */
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction, getMint } from '@solana/spl-token';

import { sql } from '../_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { z } from 'zod';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const bodySchema = z.object({
	agentId:        z.string().uuid(),
	skillName:      z.string().trim().min(1).max(100),
	buyerPublicKey: z.string().regex(BASE58_RE, 'invalid public key'),
});

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req).catch(() => null);
	const parsed = bodySchema.safeParse(body);
	if (!parsed.success) {
		return error(res, 400, 'validation_error', parsed.error.issues[0]?.message || 'validation error');
	}

	const { agentId, skillName, buyerPublicKey } = parsed.data;

	// Fetch active price
	const [price] = await sql`
		SELECT amount, currency_mint, chain
		FROM agent_skill_prices
		WHERE agent_id = ${agentId} AND skill = ${skillName} AND is_active = true
		LIMIT 1
	`;
	if (!price) return error(res, 404, 'not_found', 'skill is not for sale');
	if (price.chain !== 'solana') {
		return error(res, 400, 'unsupported_chain', `chain '${price.chain}' does not support prepared transactions`);
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

	// Mint a reference keypair for Solana Pay tracking
	const referenceKeypair = Keypair.generate();
	const referenceKey = referenceKeypair.publicKey;
	const reference = referenceKey.toBase58();

	// Record pending purchase before building tx so confirm can find it
	await sql`
		INSERT INTO skill_purchases (user_id, agent_id, skill, status, reference, amount, currency_mint, chain)
		VALUES (${auth.userId}, ${agentId}, ${skillName}, 'pending', ${reference},
		        ${price.amount}, ${price.currency_mint}, 'solana')
		ON CONFLICT DO NOTHING
	`;

	// Build the SPL token transfer transaction
	const connection = new Connection(SOLANA_RPC, 'confirmed');
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

	const mintInfo   = await getMint(connection, new PublicKey(price.currency_mint));
	const decimals   = mintInfo.decimals;

	const buyer      = new PublicKey(buyerPublicKey);
	const recipientKey = new PublicKey(recipient);
	const mintKey    = new PublicKey(price.currency_mint);

	const fromAta = getAssociatedTokenAddressSync(mintKey, buyer);
	const toAta   = getAssociatedTokenAddressSync(mintKey, recipientKey);

	const ix = createTransferCheckedInstruction(
		fromAta,
		mintKey,
		toAta,
		buyer,
		BigInt(price.amount),
		decimals,
	);
	// Append reference key as non-signer so findReference can locate this tx
	ix.keys.push({ pubkey: referenceKey, isSigner: false, isWritable: false });

	const tx = new Transaction({
		feePayer:         buyer,
		recentBlockhash:  blockhash,
		lastValidBlockHeight,
	}).add(ix);

	const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

	return json(res, 200, {
		data: {
			transaction:   serialized.toString('base64'),
			reference,
			recipient,
			amount:        String(price.amount),
			currency_mint: price.currency_mint,
			label:         `Skill: ${skillName.slice(0, 40)}`,
			message:       `Unlock '${skillName}' for this agent`,
		},
	});
});
