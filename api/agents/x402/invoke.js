/**
 * POST /api/agents/x402/invoke
 *
 * Reference paid-skill endpoint. Demonstrates the x402 flow end-to-end:
 *
 *   1. Caller POSTs { agent_id, skill, args } with no payment header.
 *   2. We compute the price for (agent, skill) from the agent's skill
 *      manifest (defaulting to a flat per-call price), and emit 402 with
 *      the canonical manifest.
 *   3. Caller pays via the payments endpoints, retries with
 *      `x-payment-intent: <intent_id>`. We verify, mark the intent
 *      consumed, then dispatch the actual skill.
 *
 * Skill dispatch is deliberately stub-like — production paid skills will
 * register handlers via `registerPaidSkill('summarize', handler)` once we
 * wire this into the runtime. For now: an `echo` skill returns the args.
 */

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { emit402, verifyPaid, consumeIntent } from '../../_lib/x402.js';

const bodySchema = z.object({
	agent_id: z.string().min(1).max(80),
	skill: z.string().min(1).max(64),
	args: z.record(z.any()).default({}),
});

// ── Skill registry (stub) ──────────────────────────────────────────────────
//
// In a future runtime hook, these are registered via the agent's skill
// manifest; here we hardcode a single demo skill so the e2e flow is real.

const HANDLERS = {
	echo: async (args) => ({ ok: true, echoed: args }),
};

function priceFor(agent, skill) {
	// Look up per-skill price from agent.meta.skill_prices, fall back to a
	// flat per-call default declared at meta.payments.default_price.
	const prices = agent.meta?.skill_prices || {};
	const defaultPrice = agent.meta?.payments?.default_price;
	const fromMap = prices[skill];
	if (fromMap?.amount && fromMap?.currency) return fromMap;
	if (defaultPrice?.amount && defaultPrice?.currency) return defaultPrice;
	// Hard default: 0.01 USDC = 10000 raw (6 decimals). Demo-only.
	const cluster = agent.meta?.payments?.cluster || 'mainnet';
	return {
		amount: '10000',
		currency:
			cluster === 'devnet'
				? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
				: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	};
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId, scope: bearer.scope };
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in or provide a bearer token');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	const [agent] = await sql`
		select id, name, meta from agent_identities
		where id = ${body.agent_id} and deleted_at is null
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (!agent.meta?.payments?.configured) {
		return error(res, 409, 'precondition_failed', 'agent has not enabled payments');
	}
	if (!HANDLERS[body.skill]) {
		return error(res, 404, 'unknown_skill', `skill "${body.skill}" is not registered`);
	}

	const price = priceFor(agent, body.skill);

	// Verify payment header — emit 402 if missing or invalid.
	const paid = await verifyPaid(req, {
		agentId: agent.id,
		skill: body.skill,
		expectedAmount: price.amount,
		expectedCurrency: price.currency,
	});
	if (!paid) {
		return emit402(res, {
			agent,
			skill: body.skill,
			amount: price.amount,
			currency: price.currency,
		});
	}

	// Single-shot: consume the intent before dispatch so a retry of the same
	// intent fails. (Skill failures don't refund — the intent paid for the
	// attempt, not the success. Future work: idempotency keys for retries.)
	await consumeIntent(paid.intentId);

	const result = await HANDLERS[body.skill](body.args, { agent, caller: auth });
	return json(res, 200, {
		ok: true,
		intent_id: paid.intentId,
		amount: paid.amount,
		currency: paid.currency,
		result,
	});
});
