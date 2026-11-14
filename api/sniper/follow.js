/**
 * Follow a trader.
 *
 *   GET    /api/sniper/follow?agent_id=<uuid>  -> { following, follower_count, is_owner }
 *   POST   /api/sniper/follow  { agent_id }    -> follow   (idempotent; session + CSRF)
 *   DELETE /api/sniper/follow?agent_id=<uuid>  -> unfollow (idempotent; session + CSRF)
 *
 * A follow means "tell me when this trader goes on a hot streak"
 * (api/_lib/hot-streak-push.js). It costs nothing and moves no funds; copying a
 * trader stays a separate, money-backed action (copy_subscriptions) whose
 * copiers get the same push without needing to follow.
 *
 * follower_count is public. `following` is false for signed-out viewers. Only
 * public agents can be followed, and an owner cannot follow their own agent
 * (they already hear about it elsewhere): that answers 400 `own_agent`, and GET
 * reports `is_owner` so the client can hide the control.
 *
 * Until the trader_follows migration is applied every call answers 503
 * `trader_follows_unavailable` so the UI can say so honestly.
 */

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error, rateLimited, readJson } from '../_lib/http.js';
import { getSessionUser } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isUuid } from '../_lib/validate.js';

const MISSING_TABLE = '42P01';

async function followerCount(agentId) {
	const [row] = await sql`
		select count(*)::int as n
		from trader_follows f
		join users u on u.id = f.user_id and u.deleted_at is null
		where f.agent_id = ${agentId}
	`;
	return row?.n ?? 0;
}

async function isFollowing(userId, agentId) {
	if (!userId) return false;
	const rows = await sql`
		select 1 from trader_follows where user_id = ${userId} and agent_id = ${agentId} limit 1
	`;
	return rows.length > 0;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	// The read bucket gates every verb first: GET is public and costs three
	// statements, and a write must clear it before the stricter write bucket.
	const readRl = await limits.authedReadIp(clientIp(req));
	if (!readRl.success) return rateLimited(res, readRl);

	let agentId;
	if (req.method === 'POST') {
		const body = await readJson(req).catch(() => null);
		agentId = String(body?.agent_id || '').trim();
	} else {
		const params = new URL(req.url, `http://${req.headers.host || 'x'}`).searchParams;
		agentId = (params.get('agent_id') || '').trim();
	}
	if (!isUuid(agentId)) {
		return error(res, 400, 'validation_error', 'agent_id must be a valid agent UUID');
	}

	try {
		const [agent] = await sql`
			select id, user_id from agent_identities
			where id = ${agentId} and is_public is not false and deleted_at is null
			limit 1
		`;
		if (!agent) return error(res, 404, 'not_found', 'No such agent, or it is not a public trader.');

		const viewer = await getSessionUser(req).catch(() => null);
		const isOwner = Boolean(viewer && String(viewer.id) === String(agent.user_id));

		if (req.method === 'GET') {
			const [following, follower_count] = await Promise.all([
				isFollowing(viewer?.id, agentId),
				followerCount(agentId),
			]);
			return json(res, 200, { following, follower_count, is_owner: isOwner }, { 'cache-control': 'no-store' });
		}

		if (!viewer) return error(res, 401, 'unauthorized', 'Sign in to follow a trader.');
		if (!(await requireCsrf(req, res, viewer.id))) return;
		const rl = await limits.authIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);

		if (req.method === 'POST') {
			if (isOwner) return error(res, 400, 'own_agent', 'You already get notifications for your own agent.');
			await sql`
				insert into trader_follows (user_id, agent_id)
				values (${viewer.id}, ${agentId})
				on conflict do nothing
			`;
		} else {
			await sql`
				delete from trader_follows where user_id = ${viewer.id} and agent_id = ${agentId}
			`;
		}

		const [following, follower_count] = await Promise.all([
			isFollowing(viewer.id, agentId),
			followerCount(agentId),
		]);
		return json(res, 200, { following, follower_count, is_owner: isOwner }, { 'cache-control': 'no-store' });
	} catch (err) {
		if (err?.code === MISSING_TABLE) {
			return error(res, 503, 'trader_follows_unavailable', 'Following traders is not available yet. Try again shortly.');
		}
		throw err;
	}
});
