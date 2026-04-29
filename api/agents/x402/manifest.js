/**
 * GET /api/agents/x402/manifest?agent_id=...&skill=...
 *
 * Returns the x402 payment manifest for a given (agent, skill) pair *without*
 * issuing 402. Useful for x402 clients that want to prefetch the price before
 * making the real call, and for discovery tooling (x402scan, etc).
 *
 * Public — anyone can read pricing.
 */

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { manifestOnly } from '../../_lib/x402.js';

const querySchema = z.object({
	agent_id: z.string().min(1).max(80),
	skill: z.string().min(1).max(64),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const q = querySchema.parse({
		agent_id: url.searchParams.get('agent_id'),
		skill: url.searchParams.get('skill'),
	});

	const [agent] = await sql`
		select id, name, meta from agent_identities
		where id = ${q.agent_id} and deleted_at is null limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (!agent.meta?.payments?.configured) {
		return error(res, 409, 'no_payments', 'agent has not enabled payments');
	}

	// Same pricing rule as invoke.js — keep in sync.
	const cluster = agent.meta.payments.cluster || 'mainnet';
	const fallbackCurrency =
		cluster === 'devnet'
			? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
			: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
	const prices = agent.meta.skill_prices || {};
	const def = agent.meta.payments.default_price;
	const price =
		prices[q.skill] || def || { amount: '10000', currency: fallbackCurrency };

	return manifestOnly(res, {
		agent,
		skill: q.skill,
		amount: price.amount,
		currency: price.currency,
	});
});
