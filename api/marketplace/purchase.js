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

import { Keypair } from '@solana/web3.js';

import { sql } from '../_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { confirmSkillPurchase, logEvent, resolvePayoutAddress } from '../_lib/purchase-confirm.js';
import { requireCsrf } from '../_lib/csrf.js';

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

	if (!(await requireCsrf(req, res, auth.userId))) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req).catch(() => null);
	const agentId = body?.agent_id;
	const skill = typeof body?.skill === 'string' ? body.skill.trim() : null;
	const durationHours = Number.isInteger(body?.duration_hours) && body.duration_hours > 0
		? Math.min(body.duration_hours, 720)
		: null;
	if (!agentId || !skill) {
		return error(res, 400, 'validation_error', 'agent_id and skill required');
	}

	// Look up the active price for this skill on this agent.
	const [price] = await sql`
		SELECT amount, currency_mint, chain, mint_decimals, trial_uses, time_pass_hours, time_pass_amount
		FROM agent_skill_prices
		WHERE agent_id = ${agentId} AND skill = ${skill} AND is_active = true
	`;
	if (!price) return error(res, 404, 'not_found', 'this skill is not for sale');

	// Resolve the agent owner's payout wallet for the relevant chain.
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

	// Already-owned short-circuit: any active access (confirmed purchase, live trial,
	// unexpired time-pass) returns the existing row so the buyer doesn't pay twice.
	const [existing] = await sql`
		SELECT reference, status, tx_signature, confirmed_at, valid_until, trial_remaining, kind
		FROM skill_purchases
		WHERE user_id = ${auth.userId} AND agent_id = ${agentId} AND skill = ${skill}
		  AND status IN ('confirmed', 'trial')
		  AND (valid_until IS NULL OR valid_until > now())
		ORDER BY (status = 'confirmed') DESC, confirmed_at DESC NULLS LAST
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
				valid_until: existing.valid_until,
				trial_remaining: existing.trial_remaining,
				kind: existing.kind,
			},
		});
	}

	// Idempotent create (A4): reuse a fresh pending row for the same (user, agent, skill)
	// rather than minting a new reference on every retry click.
	const referrerUserId = await resolveReferrer(req, auth.userId);
	const [pending] = await sql`
		SELECT reference, amount, currency_mint, chain, expires_at
		FROM skill_purchases
		WHERE user_id = ${auth.userId} AND agent_id = ${agentId} AND skill = ${skill}
		  AND status = 'pending'
		  AND expires_at > now()
		ORDER BY created_at DESC
		LIMIT 1
	`;
	const reference = pending?.reference ?? Keypair.generate().publicKey.toBase58();
	const label = `Skill: ${skill.slice(0, 40)}`;
	const message = `Unlock '${skill}' for this agent`;

	let row = pending;
	if (!pending) {
		const inserted = await sql`
			INSERT INTO skill_purchases (
				user_id, agent_id, skill, status, reference,
				amount, currency_mint, chain, expires_at, kind, referrer_user_id
			)
			VALUES (
				${auth.userId}, ${agentId}, ${skill}, 'pending', ${reference},
				${price.amount}, ${price.currency_mint}, ${price.chain},
				now() + interval '30 minutes', 'purchase', ${referrerUserId}
			)
			RETURNING reference, amount, currency_mint, chain, expires_at
		`;
		row = inserted[0];
		await logEvent(row.reference, 'created', { agent_id: agentId, skill });
	} else {
		await logEvent(pending.reference, 'create_idempotent_hit', { agent_id: agentId, skill });
	}

	return json(res, 201, {
		data: {
			reference: row.reference,
			recipient: payout.address,
			amount: String(row.amount),
			currency_mint: row.currency_mint,
			chain: row.chain,
			mint_decimals: price.mint_decimals,
			expires_at: row.expires_at,
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

	if (!(await requireCsrf(req, res, auth.userId))) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [pur] = await sql`
		SELECT sp.id, sp.user_id, sp.agent_id, sp.skill, sp.status,
		       sp.amount, sp.currency_mint, sp.chain, sp.tx_signature,
		       sp.expires_at, sp.referrer_user_id,
		       COALESCE(asp.mint_decimals, 6) AS mint_decimals
		FROM skill_purchases sp
		LEFT JOIN agent_skill_prices asp
		       ON asp.agent_id = sp.agent_id AND asp.skill = sp.skill
		WHERE sp.reference = ${reference} AND sp.user_id = ${auth.userId}
	`;
	if (!pur) return error(res, 404, 'not_found', 'purchase not found');
	if (pur.status === 'confirmed') {
		return json(res, 200, { data: { status: 'confirmed', tx_signature: pur.tx_signature } });
	}
	if (pur.status === 'expired' || (pur.expires_at && new Date(pur.expires_at) < new Date())) {
		return error(res, 410, 'purchase_expired', 'this pending purchase expired; please start a new one');
	}
	if (pur.chain !== 'solana') {
		return error(res, 501, 'not_implemented', `chain '${pur.chain}' confirmation not yet supported`);
	}

	const result = await confirmSkillPurchase({ ...pur, reference });
	if (result.status === 'pending') {
		return json(res, 200, { data: { status: 'pending' } });
	}
	if (result.status === 'tipped') {
		return error(res, 409, 'transfer_mismatch', result.message || 'on-chain transfer did not match expected', {
			status: 'tipped',
			tipped_amount: result.tipped_amount,
			tx_signature: result.tx_signature,
		});
	}
	if (result.status === 'mismatch') {
		return error(res, 409, 'transfer_mismatch', result.message || 'no matching transfer found');
	}
	if (result.status === 'expired') {
		return error(res, 410, 'purchase_expired', 'this pending purchase expired; please start a new one');
	}
	return json(res, 200, { data: { status: 'confirmed', tx_signature: result.tx_signature } });
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Look up the referrer who sent the buyer here. Two paths:
//   1. ?ref=<code> querystring — buyer arrived via a referral link.
//   2. users.referred_by_id — buyer signed up under someone.
async function resolveReferrer(req, buyerUserId) {
	const url = new URL(req.url, 'http://x');
	const code = url.searchParams.get('ref');
	if (code) {
		const [u] = await sql`SELECT id FROM users WHERE referral_code = ${code} LIMIT 1`;
		if (u && u.id !== buyerUserId) return u.id;
	}
	const [me] = await sql`SELECT referred_by_id FROM users WHERE id = ${buyerUserId}`;
	if (me?.referred_by_id && me.referred_by_id !== buyerUserId) return me.referred_by_id;
	return null;
}
