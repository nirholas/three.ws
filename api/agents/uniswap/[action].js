/**
 * Uniswap V3 launches on Base, signed by the agent's custodial EVM wallet.
 *
 * Routes (via vercel.json rewrites):
 *   POST /api/agents/:id/uniswap/quote   every fee, the lock, policy and funding check; signs nothing
 *   POST /api/agents/:id/uniswap/launch  launch the coin from the agent's wallet
 *                                        (send an Idempotency-Key; follow GET /api/launches/:id)
 *
 * quote and launch take the same body, so a bot can quote, show its owner the
 * cost, and then send the identical request to launch. Auth is the owner's
 * session or an API key allowed to spend. See docs/launch-lanes.md.
 */

import { z } from 'zod';
import { getSessionUser, authenticateBearer, extractBearer, isSameSiteOrigin, assertBearerMaySpend } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error, rateLimited, serverError } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';
import { requireRealFundsAgreement } from '../../_lib/real-funds-agreement.js';
import { EvmLegError } from '../../_lib/evm-leg/chains.js';
import { PairedMarketError } from '../../_lib/paired-markets.js';
import { readIdempotencyKey, runLaunch, publicRecord } from '../../_lib/evm-launch-records.js';
import { LIMITS } from '../../_lib/evm-leg/paired-launch.js';
import { launchUniswap, quoteUniswapLaunch } from '../../_lib/evm-leg/uniswap-launch.js';
import { MAX_LOCK_DAYS, MAX_START_MARKET_CAP_ETH, MIN_LOCK_DAYS, MIN_START_MARKET_CAP_ETH, UNISWAP_CHAIN } from '../../_lib/evm-leg/uniswap-config.js';

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
	const bearer = assertBearerMaySpend(await authenticateBearer(extractBearer(req)), req, { kind: 'trade' });
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
	// Pool fee tier in hundredths of a basis point: 100, 500, 3000 or 10000.
	fee_tier: z.number().int().optional(),
	// Market cap in ETH at the first block (price times the whole supply).
	start_market_cap_eth: z.number().min(MIN_START_MARKET_CAP_ETH).max(MAX_START_MARKET_CAP_ETH).optional(),
	lock: z
		.object({
			mode: z.enum(['none', 'timelock', 'permanent']),
			unlock_days: z.number().min(MIN_LOCK_DAYS).max(MAX_LOCK_DAYS).optional(),
		})
		.optional(),
	// Where collected pool fees go. A third-party address must be on the agent's EVM allowlist.
	fee_recipient: z.string().trim().max(64).optional(),
});

function extractAgentId(req) {
	const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
	if (parts[1] === 'agents' && parts[3] === 'uniswap') return parts[2];
	return req.query?.id || null;
}

function failure(res, err) {
	if (err instanceof PairedMarketError || err instanceof EvmLegError || (err?.status && err?.code && err.status < 500) || err?.expose) {
		return error(res, err.status || 400, err.code || 'bad_request', err.message, err.detail ? { detail: err.detail } : {});
	}
	return serverError(res, 500, 'internal', err);
}

/** 201 for a new finished launch, 200 for a replayed one, 202 while it is still in flight. */
function respondLaunch(res, { record, replayed }) {
	if (replayed) res.setHeader('idempotent-replay', 'true');
	res.setHeader('location', `/api/launches/${record.id}`);
	const launch = publicRecord(record);
	if (record.status === 'failed') {
		return error(res, 409, record.error?.code || 'launch_failed', record.error?.message || 'the launch failed', { launch });
	}
	if (record.status !== 'finalized') return json(res, 202, { data: { launch_id: record.id, status: record.status, launch } });
	return json(res, replayed ? 200 : 201, { data: { ...record.result, launch_id: record.id, launch } });
}

async function handle(req, res, id, action) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in or send an API key');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	try {
		let body;
		try {
			body = bodySchema.parse(await readJson(req));
		} catch (e) {
			return error(res, 400, 'validation_error', e.errors?.[0]?.message || 'invalid body');
		}
		if (action === 'quote') return json(res, 200, { data: await quoteUniswapLaunch({ agentId: id, userId: auth.userId, input: body }) });
		if (!(await requireRealFundsAgreement(req, res, { userId: auth.userId, network: 'mainnet', context: 'uniswap-launch' }))) return;
		const key = readIdempotencyKey(req);
		const run = await runLaunch({
			lane: 'uniswap',
			chain: UNISWAP_CHAIN.slug,
			userId: auth.userId,
			agentId: id,
			key,
			body,
			execute: ({ stage }) => launchUniswap({ agentId: id, userId: auth.userId, input: body, req, stage }),
		});
		return respondLaunch(res, run);
	} catch (err) {
		if (!(err instanceof PairedMarketError) && !(err instanceof EvmLegError)) console.error(`[uniswap/${action}]`, err);
		if (err?.launchId) res.setHeader('location', `/api/launches/${err.launchId}`);
		return failure(res, err);
	}
}

const ACTIONS = new Set(['quote', 'launch']);

export default wrap(async (req, res) => {
	const action = req.query?.action;
	const id = extractAgentId(req);
	if (!id || !isUuid(id)) {
		if (cors(req, res)) return;
		return error(res, 404, 'not_found', 'agent not found');
	}
	if (ACTIONS.has(action)) return handle(req, res, id, action);
	if (cors(req, res)) return;
	return error(res, 404, 'not_found', 'unknown uniswap action');
});
