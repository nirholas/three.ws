/**
 * Copy-trading subscriptions — the copier's follow list.
 *
 *   GET    /api/copy/subscriptions                 list mine (+ leader info, counts, spend-cap usage)
 *   POST   /api/copy/subscriptions                 create/update a subscription
 *   POST   /api/copy/subscriptions  { id, status } pause / resume / stop
 *   DELETE /api/copy/subscriptions?id=<id>         stop (soft — keeps history)
 *
 * Auth required (session cookie or bearer). Non-custodial: we store the copier's
 * own wallet and their sizing/guard rules — never keys, never custody.
 *
 * Two anti-gaming gates run before a follow is accepted (api/_lib/copy-eligibility.js):
 * a copier may not follow an agent they own (a self-copy pays a performance fee
 * to itself and inflates the leader's public copier count and earnings), and a
 * leader must have cleared the copyable bar on real closed round-trips before
 * anyone can attach money to it.
 */

import { cors, json, error, method, wrap, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { sql } from '../_lib/db.js';
import { BREAKER_REASON, evaluateDrawdownBreaker, leaderCopyProfile } from '../_lib/copy-eligibility.js';
import { subscribeCopier } from '../_lib/copy-subscribe.js';
import { isUuid } from '../_lib/validate.js';

// Returns { userId, viaSession } or null (after writing a 401). Cookie-session
// writes additionally require a CSRF token; bearer clients are not CSRF-vulnerable.
async function requireUser(req, res) {
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) { error(res, 401, 'unauthorized', 'sign in required'); return null; }
	return { userId: session?.id ?? bearer.userId, viaSession: !!session };
}

async function listForUser(userId) {
	return sql`
		select s.*, a.name as leader_name, a.avatar_url as leader_avatar, a.profile_image_url as leader_image,
		       (select count(*) from copy_executions e where e.subscription_id = s.id and e.status = 'pending') as pending_count,
		       (select count(*) from copy_executions e where e.subscription_id = s.id and e.status = 'acted')   as acted_count,
		       -- SOL committed against the follow's lifetime spend cap, measured exactly
		       -- as api/cron/copy-fanout.js measures it, so the meter matches the engine.
		       case when s.spend_cap_sol is null then null else (
		         select coalesce(sum(e.planned_sol), 0) from copy_executions e
		         where e.subscription_id = s.id and e.direction = 'buy' and e.status in ('pending', 'acted')
		           and e.created_at >= coalesce(s.spend_cap_set_at, s.created_at)
		       ) end as cap_spent_sol
		from copy_subscriptions s
		join agent_identities a on a.id = s.leader_agent_id
		where s.copier_user_id = ${userId}
		order by s.created_at desc
	`;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const auth = await requireUser(req, res);
	if (!auth) return;
	const { userId } = auth;

	if (req.method === 'GET') {
		const rows = await listForUser(userId);
		return json(res, 200, { subscriptions: rows });
	}

	// State-changing methods: enforce CSRF for cookie-session callers.
	if (auth.viaSession && !(await requireCsrf(req, res, userId))) return;

	if (req.method === 'DELETE') {
		const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
		if (!isUuid(id)) return error(res, 400, 'invalid_id', 'id must be a subscription UUID');
		const [row] = await sql`
			update copy_subscriptions set status = 'stopped', updated_at = now()
			where id = ${id} and copier_user_id = ${userId}
			returning id
		`;
		if (!row) return error(res, 404, 'not_found', 'No such subscription.');
		return json(res, 200, { ok: true, id, status: 'stopped' });
	}

	// POST
	const body = await readJson(req).catch(() => null);
	if (!body || typeof body !== 'object') return error(res, 400, 'bad_request', 'JSON body required');

	// Status-only update (pause / resume / stop). Keyed on the absence of the
	// create fields rather than a key count: cookie clients may carry the CSRF
	// token in the body (_csrf), and a count test sent those through the create
	// path and answered a pause with "leader_agent_id must be an agent UUID".
	if (body.id && body.status && body.leader_agent_id == null && body.copier_wallet == null) {
		if (!isUuid(body.id)) return error(res, 400, 'invalid_id', 'id must be a subscription UUID');
		if (!['active', 'paused', 'stopped'].includes(body.status)) {
			return error(res, 400, 'invalid_status', 'status must be active, paused, or stopped');
		}
		// Resuming an auto-paused subscription must not hand the copier a button that
		// re-pauses on the next tick. If the breaker is still breached, refuse and say
		// what would clear it: raise the limit, or drop it.
		if (body.status === 'active') {
			const [paused] = await sql`
				select id, network, leader_agent_id, max_drawdown_pct, paused_reason
				from copy_subscriptions
				where id = ${body.id} and copier_user_id = ${userId}
				limit 1
			`;
			if (!paused) return error(res, 404, 'not_found', 'No such subscription.');
			if (paused.paused_reason === BREAKER_REASON && paused.max_drawdown_pct != null) {
				const leaderProfile = await leaderCopyProfile(paused.leader_agent_id, paused.network);
				const breaker = evaluateDrawdownBreaker(paused, leaderProfile.max_drawdown_pct);
				if (breaker.breached) {
					return error(
						res,
						409,
						'drawdown_still_breached',
						`This trader is still ${breaker.drawdown_pct}% below their peak, past your ${breaker.limit_pct}% limit. Raise or clear your drawdown limit to resume.`,
						{ breaker, leader_profile: leaderProfile },
					);
				}
			}
		}

		// A status change made BY the copier carries no machine reason, so the
		// auto-pause bookkeeping is cleared on every branch of this path: paused_reason
		// is only ever set by a guard acting on the copier's behalf.
		const [row] = await sql`
			update copy_subscriptions set status = ${body.status}, paused_reason = null, paused_at = null, updated_at = now()
			where id = ${body.id} and copier_user_id = ${userId}
			returning *
		`;
		if (!row) return error(res, 404, 'not_found', 'No such subscription.');
		return json(res, 200, { subscription: row });
	}

	// Create / update, through the one guarded follow path (self-copy refusal,
	// the copyable bar, the copier's own caps) that a syndicate join also uses.
	const result = await subscribeCopier({ userId, body });
	if (!result.ok) return error(res, result.status, result.code, result.message, result.extra);
	return json(res, 200, { subscription: result.subscription, leader: result.leader, leader_profile: result.profile });
});
