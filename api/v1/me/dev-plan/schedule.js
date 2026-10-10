// POST /api/v1/me/dev-plan/schedule: downgrade (or cancel) at the end of the
// period, or clear a scheduled change by naming the current plan.
//
// Body: { plan }   Nothing is charged and nothing changes until period_end.

import { defineEndpoint, fail } from '../../../_lib/gateway.js';
import { checkCsrf } from '../../../_lib/csrf.js';
import { rateLimited } from '../../../_lib/http.js';
import { limits } from '../../../_lib/rate-limit.js';
import { scheduleDevPlanChange } from '../../../_lib/dev-plans/billing.js';

export default defineEndpoint({
	name: 'v1.me.dev-plan.schedule',
	method: 'POST',
	auth: 'required',
	handler: async ({ req, res, principal, body }) => {
		if (principal.source !== 'session') fail(403, 'session_required', 'plan changes are made from the dashboard with a signed-in session');
		const csrf = await checkCsrf(req, principal.userId);
		if (!csrf.ok) fail(403, csrf.code, csrf.message);
		const rl = await limits.apiKeyManage(principal.userId);
		if (!rl.success) return rateLimited(res, rl);
		const sub = await scheduleDevPlanChange({ userId: principal.userId, planId: String(body.plan || '').toLowerCase(), req });
		res.setHeader('cache-control', 'private, no-store');
		return {
			plan: sub.planId,
			scheduled_plan: sub.scheduledPlanId,
			period_end: sub.periodEnd.toISOString(),
		};
	},
});
