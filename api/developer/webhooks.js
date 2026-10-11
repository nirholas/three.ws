// GET  /api/developer/webhooks — list user's registered webhooks
// POST /api/developer/webhooks — create a new webhook

import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { getSessionUser } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { sql } from '../_lib/db.js';
import { EVENT_TYPES, newWebhookSecret, selectEventTypes, webhookUrlProblem } from '../_lib/webhook-dispatch.js';
import { getDevSubscription } from '../_lib/dev-plans/subscription.js';
import { DEV_PLAN_UPGRADE_URL } from '../_lib/dev-plans/config.js';

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;

	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'Sign in required');

	if (req.method === 'GET') {
		// One round trip for the list AND its 7-day delivery stats: the lateral
		// join keeps a 10-webhook dashboard at a single query instead of 1 + N.
		const rows = await sql`
			select w.id, w.url, w.events, w.active, w.description, w.agent_id, w.disabled_reason,
			       w.consecutive_failures, w.created_at, w.updated_at,
			       s.total, s.succeeded, s.failed, s.pending, s.last_delivery_at
			from developer_webhooks w
			left join lateral (
				select
					count(*)::int as total,
					-- Queue rows (status set) count by their final state; legacy
					-- one-row-per-attempt rows (status null) count by HTTP code.
					count(*) filter (where status = 'succeeded' or (status is null and status_code between 200 and 299))::int as succeeded,
					count(*) filter (where status = 'failed' or (status is null and (status_code is null or status_code >= 400)))::int as failed,
					count(*) filter (where status in ('pending', 'delivering'))::int as pending,
					max(created_at) as last_delivery_at
				from webhook_deliveries d
				where d.webhook_id = w.id and d.created_at > now() - interval '7 days'
			) s on true
			where w.user_id = ${user.id}
			order by w.created_at desc
		`;

		const webhooks = rows.map(({ total, succeeded, failed, pending, last_delivery_at, ...wh }) => ({
			...wh,
			stats_7d: { total, succeeded, failed, pending, last_delivery_at },
		}));

		return json(res, 200, { webhooks, event_types: EVENT_TYPES });
	}

	if (!method(req, res, ['POST'])) return;

	if (!(await requireCsrf(req, res, user.id))) return;

	let body;
	try {
		body = await readJson(req, 5000);
	} catch (e) {
		return error(res, e.status || 400, 'bad_request', e.message);
	}

	const url = typeof body.url === 'string' ? body.url.trim() : '';
	// HTTPS to a public address (SSRF): checked here at registration, and again
	// with a pinned connection on every delivery attempt.
	const urlProblem = await webhookUrlProblem(url);
	if (urlProblem) return error(res, 400, 'bad_request', urlProblem);

	const selection = selectEventTypes(body.events);
	if (selection.error) return error(res, 400, 'bad_request', selection.error);
	const events = selection.events;
	const description =
		typeof body.description === 'string' ? body.description.trim().slice(0, 200) : null;

	// The cap is the developer plan's (api/_lib/dev-plans/config.js).
	const [[{ count: existing }], sub] = await Promise.all([
		sql`select count(*)::int as count from developer_webhooks where user_id = ${user.id}`,
		getDevSubscription(user.id),
	]);
	if (existing >= sub.plan.webhooks) {
		return error(
			res,
			409,
			'limit_reached',
			`The ${sub.plan.name} plan allows ${sub.plan.webhooks} webhooks per account; delete one or upgrade`,
			{ plan: sub.planId, limit: sub.plan.webhooks, upgrade_url: DEV_PLAN_UPGRADE_URL },
		);
	}

	const secret = newWebhookSecret();

	const [webhook] = await sql`
		insert into developer_webhooks (user_id, url, secret, events, description)
		values (${user.id}, ${url}, ${secret}, ${events}, ${description})
		returning id, url, events, active, description, created_at
	`;

	return json(res, 201, { webhook: { ...webhook, secret } });
});
