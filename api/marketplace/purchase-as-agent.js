/**
 * POST /api/marketplace/purchase-as-agent
 *
 * Autonomous skill purchase: a buyer-agent (whose keypair is stored encrypted
 * in agent_identities.meta.encrypted_solana_secret) pays from its own wallet
 * to acquire persistent access to a seller-agent's priced skill.
 *
 * Body: { buyer_agent_id, seller_agent_id, skill }
 *
 * Auth: session user must own buyer_agent_id. Bearer auth with an API key
 * bound to the buyer agent will be added later for fully-headless agent runs.
 *
 * Flow:
 *   1. Verify session owns buyer_agent_id and recover its Keypair.
 *   2. Look up the active price + seller's payout wallet.
 *   3. If buyer already has a confirmed skill_purchases row, return it.
 *   4. Generate a Solana Pay reference key, insert pending skill_purchases.
 *   5. Build SPL transferChecked tx (with reference key appended) signed
 *      by the buyer keypair. Send and wait for 'confirmed'.
 *   6. Re-validate via @solana/pay validateTransfer, mark confirmed.
 */
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	createTransferCheckedInstruction,
	createAssociatedTokenAccountIdempotentInstruction,
	getMint,
} from '@solana/spl-token';
import { findReference, validateTransfer } from '@solana/pay';
import BigNumber from 'bignumber.js';

import { sql } from '../_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { recoverSolanaAgentKeypair } from '../_lib/agent-wallet.js';
import { z } from 'zod';

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

const bodySchema = z.object({
	buyer_agent_id:  z.string().uuid(),
	seller_agent_id: z.string().uuid(),
	skill:           z.string().trim().min(1).max(100),
});

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
	const { buyer_agent_id, seller_agent_id, skill } = parsed.data;

	if (buyer_agent_id === seller_agent_id) {
		return error(res, 400, 'validation_error', 'buyer and seller must differ');
	}

	// 1. Verify ownership and load buyer keypair
	const [buyer] = await sql`
		SELECT id, user_id, meta FROM agent_identities
		WHERE id = ${buyer_agent_id} AND deleted_at IS NULL
	`;
	if (!buyer) return error(res, 404, 'not_found', 'buyer agent not found');
	if (buyer.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const encryptedSecret = buyer.meta?.encrypted_solana_secret;
	if (!encryptedSecret) {
		return error(res, 412, 'no_buyer_wallet', 'buyer agent has no Solana wallet — provision via /api/agents/:id/solana');
	}

	let buyerKeypair;
	try {
		buyerKeypair = await recoverSolanaAgentKeypair(encryptedSecret, {
			agentId: buyer_agent_id,
			userId: auth.userId,
			reason: 'autonomous_skill_purchase',
			meta: { seller_agent_id, skill },
		});
	} catch (e) {
		return error(res, 500, 'wallet_decrypt_failed', `could not load buyer keypair: ${e.message}`);
	}

	// 2. Already purchased?
	const [existing] = await sql`
		SELECT reference, status, tx_signature, confirmed_at
		FROM skill_purchases
		WHERE user_id = ${auth.userId} AND agent_id = ${seller_agent_id} AND skill = ${skill}
		  AND status = 'confirmed'
		LIMIT 1
	`;
	if (existing) {
		return json(res, 200, { data: { already_owned: true, ...existing } });
	}

	// 3. Look up price
	const [price] = await sql`
		SELECT amount, currency_mint, chain
		FROM agent_skill_prices
		WHERE agent_id = ${seller_agent_id} AND skill = ${skill} AND is_active = true
		LIMIT 1
	`;
	if (!price) return error(res, 404, 'not_found', 'skill is not for sale');
	if (price.chain !== 'solana') {
		return error(res, 400, 'unsupported_chain', `only solana auto-purchase supported, got ${price.chain}`);
	}

	// 4. Resolve seller's payout wallet
	const [payout] = await sql`
		SELECT pw.address
		FROM agent_identities a
		JOIN agent_payout_wallets pw
		  ON pw.user_id = a.user_id
		 AND pw.chain = 'solana'
		 AND (pw.agent_id = a.id OR pw.is_default = true)
		WHERE a.id = ${seller_agent_id} AND a.deleted_at IS NULL
		ORDER BY (pw.agent_id IS NOT NULL) DESC, pw.is_default DESC, pw.created_at ASC
		LIMIT 1
	`;
	let recipientAddr = payout?.address;
	if (!recipientAddr) {
		const [seller] = await sql`SELECT meta FROM agent_identities WHERE id = ${seller_agent_id}`;
		recipientAddr = seller?.meta?.solana_address ?? null;
	}
	if (!recipientAddr) {
		return error(res, 412, 'creator_wallet_missing', 'seller agent has no payout wallet configured');
	}

	// 5. Mint reference + insert pending row
	const referenceKeypair = Keypair.generate();
	const referenceKey = referenceKeypair.publicKey;
	const reference = referenceKey.toBase58();

	await sql`
		INSERT INTO skill_purchases
			(user_id, agent_id, skill, status, reference, amount, currency_mint, chain)
		VALUES
			(${auth.userId}, ${seller_agent_id}, ${skill}, 'pending', ${reference},
			 ${price.amount}, ${price.currency_mint}, 'solana')
	`;

	// 6. Build, sign, and submit the SPL transfer
	const connection = new Connection(SOLANA_RPC, 'confirmed');
	const mintKey  = new PublicKey(price.currency_mint);
	const recipKey = new PublicKey(recipientAddr);

	const mintInfo = await getMint(connection, mintKey);
	const fromAta  = getAssociatedTokenAddressSync(mintKey, buyerKeypair.publicKey);
	const toAta    = getAssociatedTokenAddressSync(mintKey, recipKey);

	const ixs = [
		// Idempotently create the seller's ATA in case it doesn't exist yet —
		// payer is the buyer.
		createAssociatedTokenAccountIdempotentInstruction(
			buyerKeypair.publicKey, toAta, recipKey, mintKey,
		),
	];

	const transferIx = createTransferCheckedInstruction(
		fromAta, mintKey, toAta, buyerKeypair.publicKey, BigInt(price.amount), mintInfo.decimals,
	);
	transferIx.keys.push({ pubkey: referenceKey, isSigner: false, isWritable: false });
	ixs.push(transferIx);

	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
	const tx = new Transaction({
		feePayer:        buyerKeypair.publicKey,
		recentBlockhash: blockhash,
		lastValidBlockHeight,
	});
	for (const ix of ixs) tx.add(ix);
	tx.sign(buyerKeypair);

	let txSig;
	try {
		txSig = await connection.sendRawTransaction(tx.serialize(), {
			skipPreflight: false,
			preflightCommitment: 'confirmed',
		});
		await connection.confirmTransaction(
			{ signature: txSig, blockhash, lastValidBlockHeight },
			'confirmed',
		);
	} catch (e) {
		await sql`
			UPDATE skill_purchases SET status = 'failed'
			WHERE reference = ${reference} AND status = 'pending'
		`;
		return error(res, 502, 'tx_send_failed', `failed to submit transaction: ${e.message}`);
	}

	// 7. Re-validate via Solana Pay (defence-in-depth — confirms the on-chain
	// state matches what we just sent, in case of weird RPC behaviour)
	try {
		const sigInfo = await findReference(connection, referenceKey, { finality: 'confirmed' });
		await validateTransfer(
			connection,
			sigInfo.signature,
			{
				recipient: recipKey,
				amount: new BigNumber(price.amount).dividedBy(10 ** mintInfo.decimals),
				splToken: mintKey,
				reference: referenceKey,
			},
			{ commitment: 'confirmed' },
		);
	} catch (e) {
		await sql`
			UPDATE skill_purchases SET status = 'failed', tx_signature = ${txSig}
			WHERE reference = ${reference} AND status = 'pending'
		`;
		return error(res, 502, 'tx_validation_failed', `on-chain validation failed: ${e.message}`);
	}

	// 8. Mark confirmed
	await sql`
		UPDATE skill_purchases
		SET status = 'confirmed', tx_signature = ${txSig}, confirmed_at = now()
		WHERE reference = ${reference} AND status = 'pending'
	`;

	return json(res, 200, {
		data: {
			status: 'confirmed',
			reference,
			tx_signature: txSig,
			amount:        String(price.amount),
			currency_mint: price.currency_mint,
			seller_agent_id,
			skill,
		},
	});
});
