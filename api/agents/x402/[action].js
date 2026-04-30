// Consolidated x402 payment endpoints (invoke + manifest).

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { emit402, verifyPaid, consumeIntent, manifestOnly } from '../../_lib/x402.js';

const HANDLERS = { echo: async (args) => ({ ok: true, echoed: args }) };

function priceFor(agent, skill) {
	const prices = agent.meta?.skill_prices || {};
	const defaultPrice = agent.meta?.payments?.default_price;
	const fromMap = prices[skill];
	if (fromMap?.amount && fromMap?.currency) return fromMap;
	if (defaultPrice?.amount && defaultPrice?.currency) return defaultPrice;
	const cluster = agent.meta?.payments?.cluster || 'mainnet';
	return { amount: '10000', currency: cluster === 'devnet' ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' };
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId, scope: bearer.scope };
	return null;
}

// ── invoke ────────────────────────────────────────────────────────────────────

const invokeSchema = z.object({ agent_id: z.string().min(1).max(80), skill: z.string().min(1).max(64), args: z.record(z.any()).default({}) });

async function handleInvoke(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in or provide a bearer token');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(invokeSchema, await readJson(req));
	const [agent] = await sql`select id, name, meta from agent_identities where id = ${body.agent_id} and deleted_at is null limit 1`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (!agent.meta?.payments?.configured) return error(res, 409, 'precondition_failed', 'agent has not enabled payments');
	if (!HANDLERS[body.skill]) return error(res, 404, 'unknown_skill', `skill "${body.skill}" is not registered`);

	const price = priceFor(agent, body.skill);
	const paid = await verifyPaid(req, { agentId: agent.id, skill: body.skill, expectedAmount: price.amount, expectedCurrency: price.currency });
	if (!paid) return emit402(res, { agent, skill: body.skill, amount: price.amount, currency: price.currency });

	await consumeIntent(paid.intentId);
	const result = await HANDLERS[body.skill](body.args, { agent, caller: auth });
	return json(res, 200, { ok: true, intent_id: paid.intentId, amount: paid.amount, currency: paid.currency, result });
}

// ── manifest ──────────────────────────────────────────────────────────────────

async function handleManifest(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const agent_id = url.searchParams.get('agent_id');
	const skill = url.searchParams.get('skill');
	if (!agent_id || !skill) return error(res, 400, 'validation_error', 'agent_id and skill required');

	const [agent] = await sql`select id, name, meta from agent_identities where id = ${agent_id} and deleted_at is null limit 1`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (!agent.meta?.payments?.configured) return error(res, 409, 'no_payments', 'agent has not enabled payments');

	const cluster = agent.meta.payments.cluster || 'mainnet';
	const fallbackCurrency = cluster === 'devnet' ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
	const prices = agent.meta.skill_prices || {};
	const def = agent.meta.payments.default_price;
	const price = prices[skill] || def || { amount: '10000', currency: fallbackCurrency };

	return manifestOnly(res, { agent, skill, amount: price.amount, currency: price.currency });
}

// ── dispatcher ────────────────────────────────────────────────────────────────

const DISPATCH = { invoke: handleInvoke, manifest: handleManifest };

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown x402 action: ${action}`);
	return fn(req, res);
});
