// Route table for /api/coin-control/*, in the v1 API contract (api/_lib/agents-v1/http.js).
// Mounted by api/coin-control/[...route].js. Guide: docs/coin-control.md.
//
// Public:
//   GET  /public/:mint                       the proof feed for a coin launched through three.ws
//
// Owner (session, API key or OAuth token):
//   GET  /coins                              every coin the owner launched
//   GET  /overview?agent_id=&network=        one coin: split, earnings, wallet, rules, totals, events, bounties
//   GET  /holders?agent_id=&network=         who a holder reward would reach right now
//   POST /bounties                           post a bounty for the coin, paid from the agent wallet
//   POST /bounties/:id/payout/preview        quote paying a submission; nothing moves
//
// Owner, browser session only (an agent's key can never pay out):
//   POST /bounties/:id/payout/confirm        pay the winner and close the bounty
//
// Rules (buyback and burn, holder rewards, DCA) are created and confirmed
// through /api/revenue/rules, the same engine every reinvest rule runs on.

import { ApiError, apiError, requireUuid, strParam } from '../agents-v1/http.js';
import { sql } from '../db.js';
import { limits } from '../rate-limit.js';
import {
	listCoins, overview, publicProof, createBounty, previewBountyPayout, confirmBountyPayout,
} from './index.js';

const NETWORKS = ['mainnet', 'devnet'];

function sessionOnly(principal) {
	if (principal?.source !== 'session') {
		throw apiError(403, 'session_required', 'Only the owner, signed in on three.ws, can pay out. API keys and agent tokens cannot.');
	}
}

function network(v) {
	const n = v || 'mainnet';
	if (!NETWORKS.includes(n)) throw apiError(400, 'invalid_parameter', 'network must be mainnet or devnet.', { parameter: 'network' });
	return n;
}

function agentId(v) {
	const id = strParam(v, { name: 'agent_id', max: 40 });
	if (!id) throw apiError(400, 'invalid_parameter', 'agent_id is required.', { parameter: 'agent_id' });
	requireUuid(id, 'agent');
	return id;
}

const UNAVAILABLE = new Set(['price_unavailable', 'holders_unavailable', 'tx_unreadable']);

/**
 * Service and commerce errors carry a snake_case code and a message written for
 * the owner; surface those in the v1 error shape. Anything else (a database or
 * RPC fault) is rethrown untouched so the router redacts it.
 */
async function run(fn) {
	try {
		return await fn();
	} catch (err) {
		const code = typeof err?.code === 'string' && /^[a-z][a-z0-9_]*$/.test(err.code) ? err.code : null;
		if (!code || err instanceof ApiError) throw err;
		const status = Number(err.status) || (UNAVAILABLE.has(code) ? 503 : 400);
		throw apiError(status, code, String(err.message || code));
	}
}

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function publicRoute({ params, res }) {
	if (!MINT_RE.test(params.mint || '')) throw apiError(404, 'not_found', 'That is not a Solana mint address.');
	res.setHeader('cache-control', 'public, max-age=30, stale-while-revalidate=120');
	return run(() => publicProof({ mint: params.mint }));
}

async function coinsRoute({ principal }) {
	return { coins: await listCoins(principal.userId) };
}

async function overviewRoute({ principal, query }) {
	return run(() => overview({ userId: principal.userId, agentId: agentId(query.agent_id), network: network(query.network) }));
}

async function holdersRoute({ principal, query }) {
	const id = agentId(query.agent_id);
	const net = network(query.network);
	const [coin] = await sql`select mint from pump_agent_mints where agent_id = ${id} and user_id = ${principal.userId} and network = ${net} order by created_at desc limit 1`;
	if (!coin) throw apiError(404, 'not_found', 'You have no coin for that agent on this network.');
	const [agent] = await sql`select meta->>'solana_address' as address from agent_identities where id = ${id}`;
	const own = await sql`select address from user_wallets where user_id = ${principal.userId} and chain_type = 'solana'`;
	const { fetchEligibleHolders } = await import('./chain.js');
	const { depositWallet } = await import('../credit-deposit.js');
	const holders = await run(() => fetchEligibleHolders({
		mint: coin.mint, network: net, exclude: [agent?.address, depositWallet(), ...own.map((w) => w.address)].filter(Boolean),
	}));
	return { mint: coin.mint, network: net, holders: holders.slice(0, 20), eligible: holders.length };
}

async function createBountyRoute({ principal, body }) {
	const rl = await limits.bountyCreate(principal.userId);
	if (!rl.success) throw apiError(429, 'rate_limited', 'Too many bounties. Slow down and try again shortly.');
	return run(() => createBounty({
		userId: principal.userId, agentId: agentId(body.agent_id), network: network(body.network),
		title: body.title, description: body.description, rewardSol: body.reward_sol, days: body.expires_in_days,
	}));
}

function bountyIds(params, body) {
	requireUuid(params.id, 'bounty');
	const sub = strParam(body.submission_id, { name: 'submission_id', max: 40 });
	if (!sub) throw apiError(400, 'invalid_parameter', 'submission_id is required.', { parameter: 'submission_id' });
	requireUuid(sub, 'submission');
	return { bountyId: params.id, submissionId: sub };
}

async function payoutPreviewRoute({ principal, params, body }) {
	return run(() => previewBountyPayout({ userId: principal.userId, ...bountyIds(params, body) }));
}

async function payoutConfirmRoute({ principal, params, body }) {
	sessionOnly(principal);
	const previewId = strParam(body.preview_id, { name: 'preview_id', max: 80 });
	if (!previewId) throw apiError(400, 'invalid_parameter', 'preview_id is required.', { parameter: 'preview_id' });
	return run(() => confirmBountyPayout({ userId: principal.userId, ...bountyIds(params, body), previewId }));
}

export const coinControlRoutes = [
	{ method: 'GET', path: '/public/:mint', name: 'coin_control.public', auth: 'public', handler: publicRoute },
	{ method: 'GET', path: '/coins', name: 'coin_control.coins', auth: 'required', scope: 'wallet:read', handler: coinsRoute },
	{ method: 'GET', path: '/overview', name: 'coin_control.overview', auth: 'required', scope: 'wallet:read', handler: overviewRoute },
	{ method: 'GET', path: '/holders', name: 'coin_control.holders', auth: 'required', scope: 'wallet:read', handler: holdersRoute },
	{ method: 'POST', path: '/bounties', name: 'coin_control.bounties.create', auth: 'required', scope: 'agents:write', handler: createBountyRoute },
	{ method: 'POST', path: '/bounties/:id/payout/preview', name: 'coin_control.bounties.preview', auth: 'required', scope: 'agents:write', handler: payoutPreviewRoute },
	{ method: 'POST', path: '/bounties/:id/payout/confirm', name: 'coin_control.bounties.confirm', auth: 'required', handler: payoutConfirmRoute },
];
