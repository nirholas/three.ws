/**
 * Skill purchase flow (Solana Pay).
 * ---------------------------------
 * POST /api/marketplace/purchase
 *   Body: { agent_id, skill }
 *   Creates a pending skill_purchases row and returns Solana Pay params.
 *
 * GET  /api/marketplace/purchase/:reference
 *   Returns { status, tx_signature, confirmed_at } for the caller's purchase.
 *
 * POST /api/marketplace/purchase/:reference/confirm
 *   Looks up the on-chain transaction by `reference`, validates it sent the
 *   expected amount of the expected SPL token to the agent owner's payout
 *   wallet, marks the purchase confirmed, records agent_revenue_events.
 *
 * Routed via vercel.json rewrites — see project root.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { findReference, validateTransfer } from '@solana/pay';
import BigNumber from 'bignumber.js';

import { sql } from '../_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { rpcFallbackFromEnv } from '../_lib/solana/rpc-fallback.js';

let _rpc;
function rpc() {
	if (!_rpc) _rpc = rpcFallbackFromEnv({ network: 'mainnet' });
	return _rpc;
}

const REFERENCE_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58 Pubkey

export default wrap(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	// Vercel rewrites pass reference/op as query params; allow path form too for
	// local dev where the rewrite chain may be skipped.
	const parts = url.pathname.split('/').filter(Boolean); // ['api','marketplace','purchase', ...]
	const reference = url.searchParams.get('reference') || parts[3] || null;
	const op = url.searchParams.get('op') || parts[4] || null;

	if (!reference) {
		if (req.method === 'POST') return handleCreate(req, res);
		return error(res, 405, 'method_not_allowed', 'POST required');
	}

	if (!REFERENCE_RE.test(reference)) {
		return error(res, 400, 'validation_error', 'invalid reference');
	}

	if (!op) return handleStatus(req, res, reference);
	if (op === 'confirm') return handleConfirm(req, res, reference);
	return error(res, 404, 'not_found', 'unknown purchase action');
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

// ── Create ─────────────────────────────────────────────────────────────────

async function handleCreate(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req).catch(() => null);
	const agentId = body?.agent_id;
	const skill = typeof body?.skill === 'string' ? body.skill.trim() : null;
	if (!agentId || !skill) {
		return error(res, 400, 'validation_error', 'agent_id and skill required');
	}

	// Look up the active price for this skill on this agent.
	const [price] = await sql`
		SELECT amount, currency_mint, chain
		FROM agent_skill_prices
		WHERE agent_id = ${agentId} AND skill = ${skill} AND is_active = true
	`;
	if (!price) return error(res, 404, 'not_found', 'this skill is not for sale');

	// Look up the agent owner's payout wallet for the relevant chain.
	const [payout] = await sql`
		SELECT pw.address
		FROM agent_identities a
		JOIN agent_payout_wallets pw
		  ON pw.user_id = a.user_id
		 AND pw.chain = ${price.chain}
		 AND (pw.agent_id = a.id OR pw.is_default = true)
		WHERE a.id = ${agentId} AND a.deleted_at IS NULL
		ORDER BY (pw.agent_id IS NOT NULL) DESC, pw.is_default DESC, pw.created_at ASC
		LIMIT 1
	`;
	if (!payout?.address) {
		return error(res, 412, 'creator_wallet_missing', 'agent owner has not configured a payout wallet');
	}

	// Block double-purchase: if the buyer already has a confirmed purchase
	// for this (agent, skill), return it as-is rather than minting a new ref.
	const [existing] = await sql`
		SELECT reference, status, tx_signature, confirmed_at
		FROM skill_purchases
		WHERE user_id = ${auth.userId} AND agent_id = ${agentId} AND skill = ${skill}
		  AND status = 'confirmed'
		LIMIT 1
	`;
	if (existing) {
		return json(res, 200, {
			data: {
				already_owned: true,
				reference: existing.reference,
				status: existing.status,
				tx_signature: existing.tx_signature,
				confirmed_at: existing.confirmed_at,
			},
		});
	}

	const reference = Keypair.generate().publicKey.toBase58();
	const label = `Skill: ${skill.slice(0, 40)}`;
	const message = `Unlock '${skill}' for this agent`;

	const [row] = await sql`
		INSERT INTO skill_purchases (
			user_id, agent_id, skill, status, reference,
			amount, currency_mint, chain
		)
		VALUES (
			${auth.userId}, ${agentId}, ${skill}, 'pending', ${reference},
			${price.amount}, ${price.currency_mint}, ${price.chain}
		)
		RETURNING reference, amount, currency_mint, chain, created_at
	`;

	return json(res, 201, {
		data: {
			reference: row.reference,
			recipient: payout.address,
			amount: String(row.amount),
			currency_mint: row.currency_mint,
			chain: row.chain,
			label,
			message,
		},
	});
}

// ── Status ─────────────────────────────────────────────────────────────────

async function handleStatus(req, res, reference) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [row] = await sql`
		SELECT reference, agent_id, skill, status, tx_signature, confirmed_at,
		       amount, currency_mint, chain
		FROM skill_purchases
		WHERE reference = ${reference} AND user_id = ${auth.userId}
	`;
	if (!row) return error(res, 404, 'not_found', 'purchase not found');

	return json(res, 200, { data: row }, { 'cache-control': 'no-store' });
}

// ── Confirm ────────────────────────────────────────────────────────────────

async function handleConfirm(req, res, reference) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [pur] = await sql`
		SELECT id, user_id, agent_id, skill, status, amount, currency_mint, chain, tx_signature
		FROM skill_purchases
		WHERE reference = ${reference} AND user_id = ${auth.userId}
	`;
	if (!pur) return error(res, 404, 'not_found', 'purchase not found');
	if (pur.status === 'confirmed') {
		return json(res, 200, { data: { status: 'confirmed', tx_signature: pur.tx_signature } });
	}
	if (pur.chain !== 'solana') {
		return error(res, 501, 'not_implemented', `chain '${pur.chain}' confirmation not yet supported`);
	}

	// Resolve the agent owner's payout wallet again — it must match what the
	// buyer paid to. Re-resolving on confirm protects against owner key
	// rotation between create and confirm.
	const [payout] = await sql`
		SELECT pw.address
		FROM agent_identities a
		JOIN agent_payout_wallets pw
		  ON pw.user_id = a.user_id
		 AND pw.chain = ${pur.chain}
		 AND (pw.agent_id = a.id OR pw.is_default = true)
		WHERE a.id = ${pur.agent_id}
		ORDER BY (pw.agent_id IS NOT NULL) DESC, pw.is_default DESC, pw.created_at ASC
		LIMIT 1
	`;
	if (!payout?.address) {
		return error(res, 412, 'creator_wallet_missing', 'agent owner has not configured a payout wallet');
	}

	const refKey = new PublicKey(reference);
	const recipient = new PublicKey(payout.address);
	const splToken = new PublicKey(pur.currency_mint);
	const expectedAmount = new BigNumber(pur.amount).dividedBy(1e6); // assume 6 decimals (USDC)

	let signatureInfo;
	try {
		signatureInfo = await rpc().withFallback((conn) => findReference(conn, refKey, { finality: 'confirmed' }));
	} catch (e) {
		// Solana Pay throws FindReferenceError when no tx is found yet.
		if (/FindReferenceError|not found/i.test(e?.message || '')) {
			return json(res, 200, { data: { status: 'pending' } });
		}
		throw e;
	}

	const txSignature = signatureInfo.signature;

	try {
		await rpc().withFallback((conn) =>
			validateTransfer(
				conn,
				txSignature,
				{ recipient, amount: expectedAmount, splToken, reference: refKey },
				{ commitment: 'confirmed' },
			),
		);
	} catch (e) {
		// Transfer was found but doesn't match — mark failed so the user can retry.
		await sql`
			UPDATE skill_purchases
			SET status = 'failed', tx_signature = ${txSignature}
			WHERE id = ${pur.id} AND status = 'pending'
		`;
		return error(res, 409, 'transfer_mismatch', `on-chain transfer did not match expected: ${e.message}`);
	}

	// Atomic confirm + revenue ledger. The status='pending' guard keeps concurrent
	// confirms idempotent: the second one updates 0 rows and skips the ledger writes.
	// agent_revenue_events.intent_id has a FK to agent_payment_intents, so we
	// synthesize a payment-intent row keyed off the skill_purchase id.
	const intentId = `sp_${pur.id}`;
	const updated = await sql`
		UPDATE skill_purchases
		SET status = 'confirmed', tx_signature = ${txSignature}, confirmed_at = now()
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
				 'mainnet', ${txSignature}, now(),
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
				 ${pur.currency_mint}, ${pur.chain}, ${payout.address})
		`;
	}

	return json(res, 200, { data: { status: 'confirmed', tx_signature: txSignature } });
}
