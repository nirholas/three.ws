// GET /api/v1/me/dev-plan/receipts: every plan payment on the account, newest first.

import { defineEndpoint } from '../../../_lib/gateway.js';
import { listDevPlanReceipts } from '../../../_lib/dev-plans/billing.js';

export default defineEndpoint({
	name: 'v1.me.dev-plan.receipts',
	method: 'GET',
	auth: 'required',
	handler: async ({ res, principal, query }) => {
		res.setHeader('cache-control', 'private, no-store');
		return { receipts: await listDevPlanReceipts(principal.userId, Number(query.limit) || 50) };
	},
});
