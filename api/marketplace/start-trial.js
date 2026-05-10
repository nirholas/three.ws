/**
 * POST /api/marketplace/start-trial
 * Body: { agent_id, skill }
 *
 * Checks the skill has trial_uses > 0 on agent_skill_prices.
 * Inserts a skill_purchases row with status='trial', kind='trial', no payment.
 * Rate-limit: one trial per (user, agent, skill).
 */

import { z } from 'zod';
import crypto from 'node:crypto';
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';

const bodySchema = z.object({
	agent_id: z.string().uuid(),
	skill: z.string().trim().min(1).max(100),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const csrfOk = await requireCsrf(req, res, user.id);
	if (!csrfOk) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const { agent_id, skill } = body;

	// Verify agent exists
	const [agent] = await sql`
		SELECT id FROM agent_identities WHERE id = ${agent_id} AND deleted_at IS NULL
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	// Check skill has trial_uses > 0
	const [price] = await sql`
		SELECT skill, trial_uses, amount, currency_mint, chain
		FROM agent_skill_prices
		WHERE agent_id = ${agent_id} AND skill = ${skill} AND is_active = true
	`;
	if (!price) return error(res, 404, 'not_found', 'skill not found or not priced');
	if ((price.trial_uses || 0) <= 0) {
		return error(res, 422, 'no_trials', 'this skill does not offer free trials');
	}

	// Check for existing active (confirmed or trial) purchase — one per (user, agent, skill)
	const [existing] = await sql`
		SELECT id, status, trial_remaining
		FROM skill_purchases
		WHERE user_id = ${user.id} AND agent_id = ${agent_id} AND skill = ${skill}
		  AND status IN ('confirmed', 'trial')
		LIMIT 1
	`;
	if (existing) {
		if (existing.status === 'confirmed') {
			return error(res, 409, 'already_owned', 'you already own this skill');
		}
		// Active trial — return current state
		return json(res, 200, {
			data: {
				trial_remaining: existing.trial_remaining,
				reference: null,
				already_trialing: true,
			},
		});
	}

	// Check rate-limit: one trial attempt per (user, agent, skill) — look at any prior trial row
	const [priorTrial] = await sql`
		SELECT id FROM skill_purchases
		WHERE user_id = ${user.id} AND agent_id = ${agent_id} AND skill = ${skill}
		  AND kind = 'trial'
		LIMIT 1
	`;
	if (priorTrial) {
		return error(res, 409, 'trial_used', 'you have already used the trial for this skill');
	}

	const reference = crypto.randomBytes(32).toString('hex');

	const [purchase] = await sql`
		INSERT INTO skill_purchases
			(user_id, agent_id, skill, status, kind, reference, amount, currency_mint, chain, trial_remaining)
		VALUES
			(${user.id}, ${agent_id}, ${skill}, 'trial', 'trial', ${reference},
			 ${price.amount}, ${price.currency_mint}, ${price.chain}, ${price.trial_uses})
		RETURNING id, trial_remaining, reference, created_at
	`;

	return json(res, 201, {
		data: {
			trial_remaining: purchase.trial_remaining,
			reference: purchase.reference,
			purchase_id: purchase.id,
		},
	});
});
