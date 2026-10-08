// @ts-check
// Shared auth + ownership + reputation gating for the Back-an-Agent Vaults routes.
// Mirrors api/_lib/labor-auth.js: session OR bearer, CSRF on session writes, clean
// structured errors. Adds the reputation gate that only lets a verifiably-skilled
// agent open a vault.

import { getSessionUser, authenticateBearer, extractBearer } from './auth.js';
import { requireCsrf } from './csrf.js';
import { assertBearerMaySpend } from './spend-scope.js';
import { error } from './http.js';
import { sql } from './db.js';
import { getTraderStats } from './trader-stats.js';

/** Resolve the caller's user id from a session or a bearer token (or null). */
export async function resolveUserId(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, session: true };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId, session: false, scope: bearer.scope || '' };
	return null;
}

/**
 * Authenticate a write. Returns { userId, session } or null (having already sent a
 * 401/403). CSRF is enforced for session callers; bearer/API-key callers are exempt
 * inside requireCsrf, like every other write path in the app.
 *
 * `spend: true` marks a write that moves vault or agent USDC (deposit, redeem,
 * trade, claim fees): a bearer must then hold wallet:write.
 */
export async function authWrite(req, res, { spend = false } = {}) {
	const who = await resolveUserId(req);
	if (!who) { error(res, 401, 'unauthorized', 'sign in required'); return null; }
	if (spend && !who.session) {
		try {
			assertBearerMaySpend({ scope: who.scope }, req);
		} catch (e) {
			error(res, e.status, e.code, e.message);
			return null;
		}
	}
	if (who.session && !(await requireCsrf(req, res, who.userId))) return null;
	return who;
}

/** Load an agent the caller owns, or throw a structured boundary error. */
export async function loadOwnedAgent(agentId, userId) {
	const [agent] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!agent) throw Object.assign(new Error('agent not found'), { status: 404, code: 'not_found' });
	if (agent.user_id !== userId) throw Object.assign(new Error('you do not own this agent'), { status: 403, code: 'forbidden' });
	return agent;
}

/** Load any agent (public), or throw 404. */
export async function loadAgent(agentId) {
	const [agent] = await sql`
		SELECT id, user_id, name, description, meta,
		       COALESCE(profile_image_url, avatar_url) AS image
		FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!agent) throw Object.assign(new Error('agent not found'), { status: 404, code: 'not_found' });
	return agent;
}

// The reputation bar to open a vault: a real, verifiable trading track record.
// This is the SAME badge api/_lib/trader-stats.js computes from chain-proven closed
// positions (≥12 closed trades, net-positive realized P&L, ≥5 distinct coins,
// ≤40% churn). A brand-new agent has to earn it before strangers can back it.
export async function assertReputationVerified(agentId, network = 'mainnet') {
	const stats = await getTraderStats({ agentId, network, window: 'all' }).catch(() => null);
	const m = stats?.metrics || null;
	if (!m || !m.verified) {
		const reason = !m
			? 'this agent has no on-chain trading history yet'
			: `not yet reputation-verified — needs ≥12 closed trades, net-positive P&L, ≥5 distinct coins (has ${m.closed_count} closed, ${m.unique_coins} coins)`;
		throw Object.assign(new Error(reason), { status: 403, code: 'not_verified', detail: { metrics: m ? { closed_count: m.closed_count, unique_coins: m.unique_coins, verified: false, score: m.score } : null } });
	}
	return m;
}

/** Lightweight trader metrics for display/ranking (verified badge + score + pnl). */
export async function traderBadge(agentId, network = 'mainnet') {
	const stats = await getTraderStats({ agentId, network, window: 'all' }).catch(() => null);
	const m = stats?.metrics;
	if (!m) return null;
	return {
		verified: !!m.verified, score: m.score, closed_count: m.closed_count,
		win_rate: m.win_rate, realized_pnl_sol: m.realized_pnl_sol,
		max_drawdown_pct: m.max_drawdown_pct, unique_coins: m.unique_coins, roi_pct: m.roi_pct,
	};
}
