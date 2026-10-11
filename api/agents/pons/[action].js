/**
 * Pons launches on Robinhood Chain, signed by the agent's custodial EVM wallet.
 *
 * Routes (via vercel.json rewrites):
 *   POST /api/agents/:id/pons/quote   price, policy and funding check, signs nothing
 *   POST /api/agents/:id/pons/launch  launch the coin from the agent's wallet
 *
 * Both take the same body, so a bot can quote, show its owner the cost, and
 * then send the identical request to launch. Auth is the owner's session or an
 * API key allowed to spend, exactly like /api/agents/:id/pumpfun/launch.
 * See docs/pons-launch.md.
 */

import { z } from 'zod';
import { getSessionUser, authenticateBearer, extractBearer, isSameSiteOrigin, assertBearerMaySpend } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error, rateLimited, serverError } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';
import { requireRealFundsAgreement } from '../../_lib/real-funds-agreement.js';
import { EvmLegError } from '../../_lib/evm-leg/chains.js';
import { PonsError, LIMITS } from '../../_lib/pons.js';
import { MAX_OPENING_BUY_ETH, launchOnPons, quotePonsLaunch } from '../../_lib/evm-leg/pons-launch.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) {
		// These handlers sign with a platform-held key, so a cross-site POST
		// riding the session cookie must never reach them.
		if (!isSameSiteOrigin(req)) {
			throw Object.assign(new Error('cross-site request blocked'), { status: 403, code: 'forbidden' });
		}
		return { userId: session.id };
	}
	const bearer = assertBearerMaySpend(await authenticateBearer(extractBearer(req)), req);
	if (bearer) return { userId: bearer.userId };
	return null;
}

const social = z.string().trim().max(LIMITS.social).optional();

const bodySchema = z.object({
	name: z.string().trim().min(1).max(LIMITS.name),
	symbol: z.string().trim().min(1).max(LIMITS.symbol),
	description: z.string().trim().max(LIMITS.description).optional(),
	image_url: z.string().trim().max(LIMITS.logo).optional(),
	socials: z
		.object({ twitter: social, telegram: social, discord: social, website: social, farcaster: social })
		.optional(),
	buy_eth: z.number().min(0).max(MAX_OPENING_BUY_ETH).default(0),
	creator_tax_bps: z.number().int().min(0).max(1000).default(0),
	buyback: z.boolean().default(false),
});

function extractAgentId(req) {
	const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
	if (parts[1] === 'agents' && parts[3] === 'pons') return parts[2];
	return req.query?.id || null;
}

function failure(res, err) {
	if (err instanceof PonsError || err instanceof EvmLegError || (err?.status && err?.code && err.status < 500) || err?.expose) {
		return error(res, err.status || 400, err.code || 'bad_request', err.message, err.detail ? { detail: err.detail } : {});
	}
	return serverError(res, 500, 'internal', err);
}

async function handle(req, res, id, action) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in or send an API key');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try {
		body = bodySchema.parse(await readJson(req));
	} catch (e) {
		return error(res, 400, 'validation_error', e.errors?.[0]?.message || 'invalid body');
	}

	try {
		if (action === 'quote') {
			return json(res, 200, { data: await quotePonsLaunch({ agentId: id, userId: auth.userId, input: body }) });
		}
		if (!(await requireRealFundsAgreement(req, res, { userId: auth.userId, network: 'mainnet', context: 'pons-launch' }))) return;
		return json(res, 201, { data: await launchOnPons({ agentId: id, userId: auth.userId, input: body, req }) });
	} catch (err) {
		if (!(err instanceof PonsError) && !(err instanceof EvmLegError)) console.error(`[pons/${action}]`, err);
		return failure(res, err);
	}
}

export default wrap(async (req, res) => {
	const action = req.query?.action;
	const id = extractAgentId(req);
	if (!id || !isUuid(id)) {
		if (cors(req, res)) return;
		return error(res, 404, 'not_found', 'agent not found');
	}
	if (action === 'quote' || action === 'launch') return handle(req, res, id, action);
	if (cors(req, res)) return;
	return error(res, 404, 'not_found', 'unknown pons action');
});
