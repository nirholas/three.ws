import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';

// GET /api/agents/:id/payments?direction=sent|received&limit=20&cursor=
export const handlePayments = wrap(async (req, res, id) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [agent] = await sql`
		select id from agent_identities
		where id = ${id} and user_id = ${user.id} and deleted_at is null
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	const url = new URL(req.url, 'http://x');
	const direction = url.searchParams.get('direction') === 'received' ? 'received' : 'sent';
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
	const cursor = url.searchParams.get('cursor') || null;

	let rows;
	if (direction === 'sent') {
		rows = await sql`
			select
				ap.id, ap.payer_agent_id, ap.payee_agent_id,
				ap.amount_wei, ap.chain_id, ap.tx_hash, ap.memo, ap.status, ap.created_at,
				ms.name as skill_name, ms.slug as skill_slug,
				payee.name as payee_name
			from agent_payments ap
			left join marketplace_skills ms on ms.id = ap.skill_id
			left join agent_identities payee on payee.id = ap.payee_agent_id
			where ap.payer_agent_id = ${id}
			  and (${cursor}::uuid is null or ap.id < ${cursor}::uuid)
			order by ap.created_at desc
			limit ${limit + 1}
		`;
	} else {
		rows = await sql`
			select
				ap.id, ap.payer_agent_id, ap.payee_agent_id,
				ap.amount_wei, ap.chain_id, ap.tx_hash, ap.memo, ap.status, ap.created_at,
				ms.name as skill_name, ms.slug as skill_slug,
				payer.name as payer_name
			from agent_payments ap
			left join marketplace_skills ms on ms.id = ap.skill_id
			left join agent_identities payer on payer.id = ap.payer_agent_id
			where ap.payee_agent_id = ${id}
			  and (${cursor}::uuid is null or ap.id < ${cursor}::uuid)
			order by ap.created_at desc
			limit ${limit + 1}
		`;
	}

	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	const nextCursor = hasMore ? page[page.length - 1].id : null;

	return json(res, 200, { payments: page, next_cursor: nextCursor, direction });
});
