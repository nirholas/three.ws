/**
 * POST /api/payments/purchase-skill
 * Alternative entry point for skill purchase initiation.
 * Body: { agentId, skillName } — delegates to the canonical skill_purchases flow.
 * Canonical endpoint: POST /api/marketplace/purchase
 */
import { Keypair } from '@solana/web3.js';

import { sql } from '../_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { z } from 'zod';

const bodySchema = z.object({
	agentId:   z.string().uuid(),
	skillName: z.string().trim().min(1).max(100),
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

	const { agentId, skillName } = parsed.data;

	// Fetch active price
	const [price] = await sql`
		SELECT amount, currency_mint, chain
		FROM agent_skill_prices
		WHERE agent_id = ${agentId} AND skill = ${skillName} AND is_active = true
		LIMIT 1
	`;
	if (!price) return error(res, 404, 'not_found', 'skill is not for sale');

	// Resolve payout wallet
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
	let recipient = payout?.address;
	if (!recipient) {
		const [row] = await sql`SELECT meta FROM agent_identities WHERE id = ${agentId}`;
		recipient = row?.meta?.solana_address ?? null;
	}
	if (!recipient) return error(res, 412, 'creator_wallet_missing', 'agent owner has not configured a payout wallet');

	// Already purchased?
	const [existing] = await sql`
		SELECT reference, status FROM skill_purchases
		WHERE user_id = ${auth.userId} AND agent_id = ${agentId} AND skill = ${skillName}
		  AND status = 'confirmed'
		LIMIT 1
	`;
	if (existing) {
		return json(res, 200, { data: { already_owned: true, reference: existing.reference } });
	}

	// Mint a Solana Pay reference keypair
	const reference = Keypair.generate().publicKey.toBase58();

	const [row] = await sql`
		INSERT INTO skill_purchases (user_id, agent_id, skill, status, reference, amount, currency_mint, chain)
		VALUES (${auth.userId}, ${agentId}, ${skillName}, 'pending', ${reference},
		        ${price.amount}, ${price.currency_mint}, ${price.chain})
		RETURNING reference, amount, currency_mint, chain
	`;

	return json(res, 201, {
		data: {
			reference:     row.reference,
			recipient,
			amount:        String(row.amount),
			currency_mint: row.currency_mint,
			chain:         row.chain,
			label:         `Skill: ${skillName.slice(0, 40)}`,
			message:       `Unlock '${skillName}' for this agent`,
		},
	});
});
