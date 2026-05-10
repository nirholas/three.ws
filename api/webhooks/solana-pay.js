/**
 * POST /api/webhooks/solana-pay
 * Server-side webhook / polling endpoint to confirm a pending skill purchase.
 * Called by a cron job or monitoring service after it observes the on-chain tx.
 *
 * Body: { reference }
 *   reference — the base58 Solana Pay reference key for the skill_purchases row
 *
 * Authorization: bearer token matching WEBHOOK_SECRET env var.
 *
 * Flow:
 *   1. Look up the pending skill_purchases row by reference.
 *   2. Use findReference + validateTransfer to locate and verify the on-chain tx.
 *   3. Mark the purchase confirmed and return.
 */
import { PublicKey } from '@solana/web3.js';
import { findReference, validateTransfer } from '@solana/pay';
import BigNumber from 'bignumber.js';

import { sql } from '../_lib/db.js';
import { error, json, method, readJson, wrap } from '../_lib/http.js';
import { rpcFallbackFromEnv } from '../_lib/solana/rpc-fallback.js';

let _rpc;
function rpc() {
	if (!_rpc) _rpc = rpcFallbackFromEnv({ network: 'mainnet' });
	return _rpc;
}

function authOk(req) {
	const secret = process.env.WEBHOOK_SECRET;
	if (!secret) return false; // require explicit secret; no secret = endpoint disabled
	const header = req.headers?.authorization || '';
	return header === `Bearer ${secret}`;
}

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'GET') {
		// Solana Pay merchant discovery probe.
		return json(res, 200, {
			label: '3D-Agent Skill Marketplace',
			icon: 'https://three.ws/assets/logo.png',
		});
	}

	if (!authOk(req)) return error(res, 401, 'unauthorized', 'invalid or missing webhook secret');

	const body = await readJson(req).catch(() => null);
	const reference = typeof body?.reference === 'string' ? body.reference.trim() : null;
	if (!reference) return error(res, 400, 'validation_error', 'reference required');

	// Load the pending purchase
	const [pur] = await sql`
		SELECT id, user_id, agent_id, skill, status, amount, currency_mint, chain
		FROM skill_purchases
		WHERE reference = ${reference}
		LIMIT 1
	`;
	if (!pur) return error(res, 404, 'not_found', 'purchase not found');
	if (pur.status === 'confirmed') {
		return json(res, 200, { data: { status: 'confirmed' } });
	}
	if (pur.status === 'failed') {
		return error(res, 409, 'purchase_failed', 'purchase was already marked failed');
	}
	if (pur.chain !== 'solana') {
		return error(res, 501, 'not_implemented', `chain '${pur.chain}' not supported`);
	}

	// Resolve payout wallet (re-verify to prevent recipient drift)
	const [payout] = await sql`
		SELECT pw.address
		FROM agent_identities a
		JOIN agent_payout_wallets pw
		  ON pw.user_id = a.user_id
		 AND pw.chain = 'solana'
		 AND (pw.agent_id = a.id OR pw.is_default = true)
		WHERE a.id = ${pur.agent_id}
		ORDER BY (pw.agent_id IS NOT NULL) DESC, pw.is_default DESC, pw.created_at ASC
		LIMIT 1
	`;
	let recipientAddress = payout?.address;
	if (!recipientAddress) {
		const [row] = await sql`SELECT meta FROM agent_identities WHERE id = ${pur.agent_id}`;
		recipientAddress = row?.meta?.solana_address ?? null;
	}
	if (!recipientAddress) return error(res, 412, 'creator_wallet_missing', 'payout wallet not configured');

	const refKey    = new PublicKey(reference);
	const recipient = new PublicKey(recipientAddress);
	const splToken  = new PublicKey(pur.currency_mint);
	const expectedAmount = new BigNumber(pur.amount).dividedBy(1e6); // 6-decimal USDC

	let signatureInfo;
	try {
		signatureInfo = await rpc().withFallback((conn) =>
			findReference(conn, refKey, { finality: 'confirmed' }),
		);
	} catch (e) {
		if (/FindReferenceError|not found/i.test(e?.message || '')) {
			return json(res, 200, { data: { status: 'pending' } });
		}
		throw e;
	}

	const txSig = signatureInfo.signature;

	try {
		await rpc().withFallback((conn) =>
			validateTransfer(
				conn,
				txSig,
				{ recipient, amount: expectedAmount, splToken, reference: refKey },
				{ commitment: 'confirmed' },
			),
		);
	} catch (e) {
		await sql`
			UPDATE skill_purchases SET status = 'failed', tx_signature = ${txSig}
			WHERE id = ${pur.id} AND status = 'pending'
		`;
		return error(res, 409, 'transfer_mismatch', `on-chain transfer did not match: ${e.message}`);
	}

	const intentId = `sp_${pur.id}`;
	const updated = await sql`
		UPDATE skill_purchases
		SET status = 'confirmed', tx_signature = ${txSig}, confirmed_at = now()
		WHERE id = ${pur.id} AND status = 'pending'
		RETURNING id
	`;
	if (updated.length > 0) {
		await sql`
			INSERT INTO agent_payment_intents
				(id, payer_user_id, agent_id, currency_mint, amount, status, expires_at,
				 cluster, tx_signature, paid_at, payload)
			VALUES
				(${intentId}, ${pur.user_id}, ${pur.agent_id}, ${pur.currency_mint},
				 ${String(pur.amount)}, 'confirmed', now() + interval '30 days',
				 'mainnet', ${txSig}, now(),
				 ${JSON.stringify({ kind: 'skill_purchase', skill: pur.skill, reference })}::jsonb)
			ON CONFLICT (id) DO NOTHING
		`;
		await sql`
			INSERT INTO agent_revenue_events
				(agent_id, intent_id, skill, gross_amount, fee_amount, net_amount,
				 currency_mint, chain, payer_address)
			VALUES
				(${pur.agent_id}, ${intentId}, ${pur.skill},
				 ${pur.amount}, 0, ${pur.amount},
				 ${pur.currency_mint}, ${pur.chain}, ${recipientAddress})
		`;
	}

	return json(res, 200, { data: { status: 'confirmed', tx_signature: txSig } });
});
