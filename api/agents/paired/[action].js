/**
 * Paired-coin launches on Robinhood Chain, signed by the agent's custodial EVM wallet.
 *
 * Routes (via vercel.json rewrites):
 *   POST /api/agents/:id/paired/quote   price, policy and funding check, signs nothing
 *   POST /api/agents/:id/paired/launch  launch the coin from the agent's wallet
 *   GET  /api/agents/:id/paired/fees    swap fees the agent has earned, per quote asset
 *   POST /api/agents/:id/paired/claim   claim every earned quote asset in one transaction
 *
 * quote and launch take the same body, so a bot can quote, show its owner the
 * cost, and then send the identical request to launch. Auth is the owner's
 * session or an API key allowed to spend, exactly like /api/agents/:id/pons/launch.
 * See docs/paired-coins.md.
 */

import { z } from 'zod';
import { getSessionUser, authenticateBearer, extractBearer, isSameSiteOrigin, assertBearerMaySpend } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error, rateLimited, serverError } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';
import { requireRealFundsAgreement } from '../../_lib/real-funds-agreement.js';
import { EvmLegError } from '../../_lib/evm-leg/chains.js';
import { PairedMarketError } from '../../_lib/paired-markets.js';
import { MAX_MARKETS } from '../../_lib/paired-launchpad.js';
import { LIMITS, claimPairedFees, launchPaired, pairedFeesFor, quotePairedLaunch } from '../../_lib/evm-leg/paired-launch.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) {
		// These handlers sign with a platform-held key, so a cross-site POST
		// riding the session cookie must never reach them.
		if (req.method !== 'GET' && !isSameSiteOrigin(req)) {
			throw Object.assign(new Error('cross-site request blocked'), { status: 403, code: 'forbidden' });
		}
		return { userId: session.id };
	}
	const bearer = assertBearerMaySpend(await authenticateBearer(extractBearer(req)), req);
	if (bearer) return { userId: bearer.userId };
	return null;
}

const link = z.string().trim().max(LIMITS.link).optional();

const bodySchema = z.object({
	name: z.string().trim().min(1).max(LIMITS.name),
	symbol: z.string().trim().min(1).max(LIMITS.symbol),
	description: z.string().trim().max(LIMITS.description).optional(),
	image_url: z.string().trim().max(LIMITS.image).optional(),
	socials: z.object({ website: link, twitter: link, telegram: link }).optional(),
	// Symbols ("NVDA", "WETH", "$USDG") or 0x quote addresses, 1 to MAX_MARKETS.
	markets: z.array(z.string().trim().min(1).max(64)).min(1).max(MAX_MARKETS),
	// Percentages, one per market, totalling 100. Omitted means an even split.
	weights: z.array(z.number().positive().max(100)).max(MAX_MARKETS).optional(),
	dev_buy: z
		.object({
			market: z.string().trim().max(64).optional(),
			amount: z.union([z.string().trim().max(40), z.number().nonnegative()]),
		})
		.optional(),
});

function extractAgentId(req) {
	const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
	if (parts[1] === 'agents' && parts[3] === 'paired') return parts[2];
	return req.query?.id || null;
}

function failure(res, err) {
	if (err instanceof PairedMarketError || err instanceof EvmLegError || (err?.status && err?.code && err.status < 500) || err?.expose) {
		return error(res, err.status || 400, err.code || 'bad_request', err.message, err.detail ? { detail: err.detail } : {});
	}
	return serverError(res, 500, 'internal', err);
}

async function handle(req, res, id, action) {
	const verbs = action === 'fees' ? ['GET'] : ['POST'];
	if (cors(req, res, { methods: `${verbs.join(',')},OPTIONS`, credentials: true })) return;
	if (!method(req, res, verbs)) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in or send an API key');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	try {
		if (action === 'fees') return json(res, 200, { data: await pairedFeesFor({ agentId: id, userId: auth.userId }) });
		if (action === 'claim') return json(res, 200, { data: await claimPairedFees({ agentId: id, userId: auth.userId, req }) });

		let body;
		try {
			body = bodySchema.parse(await readJson(req));
		} catch (e) {
			return error(res, 400, 'validation_error', e.errors?.[0]?.message || 'invalid body');
		}
		if (action === 'quote') {
			return json(res, 200, { data: await quotePairedLaunch({ agentId: id, userId: auth.userId, input: body }) });
		}
		if (!(await requireRealFundsAgreement(req, res, { userId: auth.userId, network: 'mainnet', context: 'paired-launch' }))) return;
		return json(res, 201, { data: await launchPaired({ agentId: id, userId: auth.userId, input: body, req }) });
	} catch (err) {
		if (!(err instanceof PairedMarketError) && !(err instanceof EvmLegError)) console.error(`[paired/${action}]`, err);
		return failure(res, err);
	}
}

const ACTIONS = new Set(['quote', 'launch', 'fees', 'claim']);

export default wrap(async (req, res) => {
	const action = req.query?.action;
	const id = extractAgentId(req);
	if (!id || !isUuid(id)) {
		if (cors(req, res)) return;
		return error(res, 404, 'not_found', 'agent not found');
	}
	if (ACTIONS.has(action)) return handle(req, res, id, action);
	if (cors(req, res)) return;
	return error(res, 404, 'not_found', 'unknown paired action');
});
