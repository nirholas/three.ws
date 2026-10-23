// /api/creator-payouts: where an agent's creator-fee share is paid, and the
// record of every distribution.
//
//   GET  ?info=1                      Public. The cadence of each stage, read from
//                                     the vercel.json cron definitions, and the
//                                     per-$100 flow, generated from the split policy.
//   GET  ?agent=<uuid>                Owner. Payout wallet (and any pending change),
//                                     totals, held reasons, recent distributions.
//   GET  ?agent=<uuid>&format=csv     Owner. Every distribution as CSV.
//   POST { action: 'challenge', agent_id, wallet }
//                                     Owner session. The message the wallet must sign.
//   POST { action: 'register', agent_id, wallet, message, signature, grant }
//                                     Owner session + step-up grant (action 'stepup'
//                                     on /api/wallet-whitelist with kind 'payout_wallet'
//                                     and op { wallet }). Registers or stages a change.
//   POST { action: 'cancel', agent_id }
//                                     Owner session. Drops a staged wallet change.
//
// Library: api/_lib/creator-payouts.js. Doc: docs/creator-payouts.md.

import { readFileSync } from 'node:fs';
import { getRequestUser } from './_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from './_lib/http.js';
import { requireCsrf } from './_lib/csrf.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { WhitelistError, STEP_UP_METHODS } from './_lib/destination-whitelist.js';
import { getAgentPayouts, listDistributions, issueRegistrationChallenge, registerPayoutWallet, cancelPendingWallet } from './_lib/creator-payouts.js';
import { distributionsToCsv, flowPer100, payoutSchedule, MIN_PAYOUT_LAMPORTS, LAMPORTS_PER_SOL } from './_lib/creator-payouts-core.js';
import { sql } from './_lib/db.js';

function readCrons() {
	try {
		const parsed = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
		return Array.isArray(parsed.crons) ? parsed.crons : [];
	} catch {
		return [];
	}
}

function info() {
	const crons = readCrons();
	return {
		schedule: payoutSchedule(crons),
		schedule_source: crons.length ? 'vercel.json crons' : 'unavailable',
		flow: flowPer100(),
		minimum_payout_sol: MIN_PAYOUT_LAMPORTS / LAMPORTS_PER_SOL,
	};
}

function actorFor(user) {
	if (user.sid) return { kind: 'owner', userId: user.id, sessionId: user.sid };
	return { kind: user.connector ? 'oauth' : 'api_key', userId: user.id, sessionId: null };
}

async function ownedAgent(agentId, userId) {
	if (!/^[0-9a-f-]{36}$/i.test(String(agentId || ''))) throw new WhitelistError(400, 'invalid_agent_id', 'agent must be a UUID');
	const [a] = await sql`SELECT id, name, user_id FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!a) throw new WhitelistError(404, 'agent_not_found', 'Agent not found.');
	if (a.user_id !== userId) throw new WhitelistError(403, 'forbidden', 'Only the owner of this agent can see its payout records.');
	return a;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	const params = new URL(req.url, 'http://x').searchParams;

	try {
		if (req.method === 'GET' && params.get('info') === '1') {
			const rl = await limits.creatorPayoutInfoIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			return json(res, 200, info(), { 'cache-control': 'public, max-age=300, s-maxage=300' });
		}

		const user = await getRequestUser(req);
		if (!user) return error(res, 401, 'unauthorized', 'sign in required');
		const rl = await limits.creatorPayoutUser(user.id);
		if (!rl.success) return rateLimited(res, rl);

		if (req.method === 'GET') {
			const agent = await ownedAgent(params.get('agent'), user.id);
			if (params.get('format') === 'csv') {
				const all = [];
				for (let offset = 0; offset < 20_000; offset += 1000) {
					const page = await listDistributions(agent.id, { limit: 1000, offset });
					all.push(...page);
					if (page.length < 1000) break;
				}
				const csv = distributionsToCsv(all.map((r) => ({ ...r })));
				res.statusCode = 200;
				res.setHeader('content-type', 'text/csv; charset=utf-8');
				res.setHeader('content-disposition', `attachment; filename="creator-payouts-${agent.id}.csv"`);
				res.setHeader('cache-control', 'no-store');
				res.setHeader('x-content-type-options', 'nosniff');
				return res.end(csv);
			}
			const payouts = await getAgentPayouts(agent.id);
			return json(res, 200, { agent: { id: agent.id, name: agent.name }, payouts, step_up_methods: STEP_UP_METHODS, ...info() }, { 'cache-control': 'no-store' });
		}

		if (!(await requireCsrf(req, res, user.id))) return;
		const body = (await readJson(req)) || {};
		const actor = actorFor(user);
		const grantId = typeof body.grant === 'string' ? body.grant : null;

		switch (body.action) {
			case 'challenge':
				return json(res, 200, await issueRegistrationChallenge({ agentId: body.agent_id, userId: user.id, wallet: String(body.wallet || '') }), { 'cache-control': 'no-store' });
			case 'register':
				return json(
					res,
					200,
					await registerPayoutWallet({
						actor, agentId: body.agent_id, wallet: String(body.wallet || ''),
						message: String(body.message || ''), signature: String(body.signature || ''), grantId, req,
					}),
					{ 'cache-control': 'no-store' },
				);
			case 'cancel':
				return json(res, 200, await cancelPendingWallet({ actor, agentId: body.agent_id, req }), { 'cache-control': 'no-store' });
			default:
				return error(res, 400, 'invalid_action', 'action must be challenge, register or cancel');
		}
	} catch (e) {
		if (e instanceof WhitelistError) return error(res, e.status, e.code, e.message, e.extra);
		throw e;
	}
});
